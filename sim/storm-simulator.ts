/**
 * headless storm simulator (design.md §6): steps the game economy
 * (src/game/economy.ts) and the headless sim core (src/sim/simulation.ts)
 * together on a fixed timestep, driven by a bot strategy. it is the tuning
 * harness — the same deterministic seed always yields the same summary, so
 * balance changes are verifiable without playing.
 *
 * composition per frame: advance the economy (rolling attacks), spend essence
 * with a greedy dps policy, fire a physical strike into the sim for notable
 * crits, step the sim one frame, then let the strategy decide bank-or-ride. the
 * surge bank/ride path is stubbed until the hkm.* surge mechanics land; the
 * wiring is in place so it activates without reworking this loop.
 */
import {
    buy,
    canBuy,
    coresFromEssence,
    createState,
    critChance,
    critMulti,
    expectedDps,
    rankInfo,
    tick,
    upgradeCost,
    UPGRADES,
    valueToEssence,
    type AttackResult,
    type EconomyState,
    type UpgradeId,
} from "../src/game/economy";
import { Simulation } from "../src/sim/simulation";
import { mulberry32, withSeededRandom, type Rng } from "./rng";
import type { BotStrategy, StormView } from "./bot-strategy";

/** default simulation grid; §7 targets ~320×180 upscaled */
export const DEFAULT_GRID_W = 320;
export const DEFAULT_GRID_H = 180;

/** fixed timestep in seconds (20 Hz), matching the original economy sim */
export const DEFAULT_STEP_SEC = 0.05;

export interface StormConfig {
    /** storm length in seconds */
    durationSec: number;
    /** bank-or-ride bot driving the surge decisions */
    strategy: BotStrategy;
    /** rng seed; reproduces the whole run (economy rolls + sim physics) */
    seed: number;
    gridW?: number;
    gridH?: number;
    stepSec?: number;
}

/** one row of the per-minute progression table */
export interface MinuteSample {
    minute: number;
    essence: number;
    /**
     * cumulative essence collected by this minute — the sum of every frame's
     * collector conversion, never reduced by spending (design §5). this is the
     * `bankedEssence` the storm-core formula reads, and the series the §6
     * anti-farming assertion tracks across the 8→35 min arc.
     */
    cumulativeEssence: number;
    /** storm cores this cumulative essence would mint: {@link coresFromEssence}. */
    cores: number;
    dps: number;
    totalDamage: number;
    critPct: number;
    multi: number;
    coreTemp: number;
    rank: string;
    levels: Record<UpgradeId, number>;
}

/** end-of-storm rollup asserted for reproducibility by the harness tests */
export interface StormSummary {
    strategy: string;
    seed: number;
    durationSec: number;
    finalEssence: number;
    /** total essence collected across the whole storm (design §5 `bankedEssence`). */
    cumulativeEssence: number;
    /** storm cores the run banked out: {@link coresFromEssence} of {@link cumulativeEssence}. */
    cores: number;
    totalDamage: number;
    finalDps: number;
    attacks: number;
    crits: number;
    goldenHits: number;
    /** surge banks taken — 0 until surge mechanics (hkm.*) land */
    banks: number;
    /** surge overheat busts — 0 until surge mechanics (hkm.*) land */
    busts: number;
    rank: string;
    samples: MinuteSample[];
}

/**
 * advance one frame of the pure in-storm economy: roll the frame's attacks, credit
 * the collected essence (design §4.3, whole-payout at the base fee — see the run
 * loop), then greedy-buy one upgrade. returns the attacks rolled and the essence
 * collected this frame. the physical sim never touches essence, so the §6
 * anti-farming trajectory ({@link cumulativeEssenceAtMinutes}) runs this alone,
 * while {@link StormSimulator} wraps it with the sim strikes/steps and sampling.
 */
export function stepEconomy(
    economy: EconomyState,
    stepSec: number,
    rng: Rng
): { attacks: AttackResult[]; collected: number } {
    const attacks = tick(economy, stepSec, rng);
    let frameDamage = 0;
    for (const r of attacks) frameDamage += r.damage;
    const collected = valueToEssence(frameDamage);
    economy.essence += collected;
    const id = greedyBuy(economy);
    if (id) buy(economy, id);
    return { attacks, collected };
}

/**
 * the cumulative-essence trajectory of a storm's economy for a seed, sampled at the
 * requested minute marks (design §5 `bankedEssence`). this is the sim-free economic
 * core the §6 anti-farming assertion reads: it reproduces exactly the economy stream
 * of a full {@link StormSimulator} run (same seed → same `mulberry32` roll stream),
 * minus the physical sim that does not affect essence, so many long storms can be
 * swept cheaply.
 * @param seed the economy seed; matches {@link StormSimulator}'s economy stream.
 * @param minutes the minute marks to record cumulative essence at (any order).
 * @param stepSec fixed timestep; defaults to {@link DEFAULT_STEP_SEC}.
 * @returns a map from each requested minute to cumulative essence collected by then.
 */
export function cumulativeEssenceAtMinutes(
    seed: number,
    minutes: readonly number[],
    stepSec: number = DEFAULT_STEP_SEC
): Map<number, number> {
    const rng = mulberry32(seed | 0);
    const economy = createState();
    // targets in seconds, ascending; supports fractional-minute marks (e.g. the
    // 90 s first-surge mark) as well as the whole-minute arc.
    const targets = [...new Set(minutes)].sort((a, b) => a - b).map((m) => ({ m, sec: m * 60 }));
    // +2 frames of buffer so the last target's second is strictly crossed despite
    // float accumulation of the 0.05 s step — otherwise it can fall a rounding
    // epsilon short and never sample.
    const totalFrames = Math.round((targets[targets.length - 1].sec / stepSec) | 0) + 2;
    const out = new Map<number, number>();
    let cumulative = 0;
    let ti = 0;
    // mirror StormSimulator.runInner: credit the frame first, then record any mark the
    // frame just crossed, so a whole-minute mark's total matches a real run's MinuteSample.
    for (let frame = 0; frame < totalFrames && ti < targets.length; frame++) {
        cumulative += stepEconomy(economy, stepSec, rng).collected;
        while (ti < targets.length && economy.elapsed >= targets[ti].sec) {
            out.set(targets[ti].m, cumulative);
            ti++;
        }
    }
    return out;
}

/** greedy: buy the affordable upgrade with the best dps gain per essence spent */
export function greedyBuy(s: EconomyState): UpgradeId | null {
    let best: UpgradeId | null = null;
    let bestRatio = 0;
    for (const u of UPGRADES) {
        if (!canBuy(s, u.id)) continue;
        const cost = upgradeCost(s, u.id);
        const before = expectedDps(s);
        s.levels[u.id] += 1;
        const gain = expectedDps(s) - before;
        s.levels[u.id] -= 1;
        const ratio = gain / cost;
        if (ratio > bestRatio) {
            bestRatio = ratio;
            best = u.id;
        }
    }
    return best;
}

/**
 * the composed storm run. constructs the sim inside the seeded-random scope so
 * the sim's internal `Math.random` (cell dithering, bolt jitter) is deterministic
 * too, then holds the sim for the lifetime of the run. the economy uses its own
 * independent seeded stream so its rolls never shift when the sim's random usage
 * changes.
 */
export class StormSimulator {
    private readonly cfg: Required<StormConfig>;
    private readonly economyRng: Rng;

    constructor(cfg: StormConfig) {
        this.cfg = {
            gridW: DEFAULT_GRID_W,
            gridH: DEFAULT_GRID_H,
            stepSec: DEFAULT_STEP_SEC,
            ...cfg,
        };
        this.economyRng = mulberry32(this.cfg.seed | 0);
    }

    /** run the storm to completion and return its deterministic summary */
    run(): StormSummary {
        return withSeededRandom(this.cfg.seed, () => this.runInner());
    }

    private runInner(): StormSummary {
        const { durationSec, stepSec, gridW, gridH, strategy } = this.cfg;
        const sim = new Simulation(gridW, gridH);
        const economy = createState();

        // the core sits high-centre; strikes rain down from it and its cell
        // temperature is the overheat instrument the strategy reads (§3).
        const coreX = (gridW / 2) | 0;
        const coreY = (gridH * 0.2) | 0;
        const coreIdx = coreY * gridW + coreX;

        let attacks = 0;
        let crits = 0;
        let goldenHits = 0;
        let banks = 0;
        let busts = 0;
        // cumulative essence collected this storm. the economy state's own `essence`
        // is the spendable balance (greedy draws it down); this ledger is the design
        // §5 `bankedEssence` — collected minus nothing — and drives the core count.
        let cumulativeEssence = 0;

        const samples: MinuteSample[] = [];
        let nextSampleAt = 0;

        const totalFrames = Math.round(durationSec / stepSec);
        for (let frame = 0; frame < totalFrames; frame++) {
            // one economy frame: roll attacks, credit collected essence (design §4.3 —
            // a competent bot routes its whole payout to the collector, minted at the
            // base fee; the headless harness has no spatial routing), greedy-buy once.
            // this is the essence source that makes the in-storm economy compound
            // (attackRate → crit → multi) instead of sitting at zero.
            const { attacks: results, collected } = stepEconomy(economy, stepSec, this.economyRng);
            cumulativeEssence += collected;
            this.tally(results, (r) => {
                attacks++;
                if (r.tier > 0) crits++;
                if (r.golden) goldenHits++;
            });

            // fire at most one physical strike per frame for the most notable
            // crit, so coreTemp reflects storm intensity without unbounded work.
            const notable = pickNotable(results);
            if (notable) sim.strike(coreX, coreY);

            sim.step(1);

            const view: StormView = {
                time: economy.elapsed,
                economy,
                coreTemp: sim.heat[coreIdx],
                // surge undefined until hkm.* surge mechanics land
                surge: undefined,
            };
            const action = strategy.decide(view);
            // wiring for the surge exits; inert while surge is undefined, but the
            // counters and branches are in place for when the mechanics arrive.
            if (action.type === "bank") banks++;
            else if (action.type === "ride") {
                // riding accepts the next crit's bust risk; overheat detonation
                // will bump `busts` once the surge core-heat model exists.
            }

            if (economy.elapsed >= nextSampleAt) {
                samples.push(sample(economy, sim.heat[coreIdx], nextSampleAt, cumulativeEssence));
                nextSampleAt += 60;
            }
        }

        return {
            strategy: strategy.name,
            seed: this.cfg.seed,
            durationSec,
            finalEssence: economy.essence,
            cumulativeEssence,
            cores: coresFromEssence(cumulativeEssence),
            totalDamage: economy.totalDamage,
            finalDps: expectedDps(economy),
            attacks,
            crits,
            goldenHits,
            banks,
            busts,
            rank: rankInfo(economy).name,
            samples,
        };
    }

    /** apply `fn` to each attack result of the frame */
    private tally(results: AttackResult[], fn: (r: AttackResult) => void): void {
        for (const r of results) fn(r);
    }
}

/** the most spectacle-worthy result of a frame: golden, else highest tier ≥ 4 */
function pickNotable(results: AttackResult[]): AttackResult | null {
    let best: AttackResult | null = null;
    for (const r of results) {
        if (r.golden) return r;
        if (r.tier >= 4 && (!best || r.tier > best.tier)) best = r;
    }
    return best;
}

/** build a per-minute sample row from the current state */
function sample(
    economy: EconomyState,
    coreTemp: number,
    atSec: number,
    cumulativeEssence: number
): MinuteSample {
    return {
        minute: Math.round(atSec / 60),
        essence: economy.essence,
        cumulativeEssence,
        cores: coresFromEssence(cumulativeEssence),
        dps: expectedDps(economy),
        totalDamage: economy.totalDamage,
        critPct: critChance(economy) * 100,
        multi: critMulti(economy),
        coreTemp,
        rank: rankInfo(economy).name,
        levels: { ...economy.levels },
    };
}
