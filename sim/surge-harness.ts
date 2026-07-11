/**
 * surge tuning harness (design.md §3, §6). drives the REAL {@link Surge} state
 * machine under a bot strategy with a seeded rng so the bank-or-ride economics
 * are measurable without playing. it does NOT reimplement any surge math: heat
 * spikes, the ambient ramp, the pot multiplier and the overheat bust all come
 * from `src/game/surge.ts`; this module only feeds it real economy rolls and a
 * strategy's bank/ride decisions.
 *
 * the two §6 economic assertions live on top of this:
 * - EV crossover: sweep bank-at-n and find where riding one more crit stops
 *   paying (mean banked essence peaks).
 * - bust hazard shape: P(bust on the next ride) as a function of n — monotone
 *   and crossing 1/3 near the design bank point (§3).
 */
import {
    attacksPerSec,
    baseDamage,
    createState,
    rollAttack,
    valueToEssence,
    type EconomyState,
} from "../src/game/economy";
import { Surge, SURGE_HEAT_THRESHOLD, type SurgeEndReason } from "../src/game/surge";
import { mulberry32 } from "./rng";
import type { BotStrategy, StormView, SurgeState } from "./bot-strategy";

/** default per-frame timestep (20 Hz), matching the storm simulator. */
export const DEFAULT_STEP_SEC = 0.05;

/** knobs for a single surge run; everything but the strategy has a sane default. */
export interface SurgeRunConfig {
    /** the bank-or-ride bot driving the surge. */
    strategy: BotStrategy;
    /** seed; reproduces the whole run (economy rolls + the surge spike lottery). */
    seed: number;
    /**
     * economy state the surge draws its strikes from. defaults to a fresh,
     * undefended state (design.md "no defenses" reference). crit chance/tier
     * distribution here is what maps crit count to heat, so it is the main lever.
     */
    economy?: EconomyState;
    /** core critical temperature; defaults to the surge machine's own default. */
    criticalTemp?: number;
    /** per-frame timestep; defaults to {@link DEFAULT_STEP_SEC}. */
    stepSec?: number;
    /** hard frame cap so a never-banking run can never loop forever. */
    maxFrames?: number;
}

/** the result of driving one surge to its exit (bank or bust). */
export interface SurgeOutcome {
    /** how the surge ended: voluntary `bank` or overheat `bust`. */
    reason: SurgeEndReason;
    /** crits landed this surge (the exponent `n` of the pot multiplier). */
    crits: number;
    /** the pot value at exit — the erupt-able amount, `0` when it busted. */
    bankedValue: number;
    /** banked value after the collector fee — what actually reaches the wallet. */
    bankedEssence: number;
    /**
     * the ride index that killed the surge, or `null` if it banked. a "ride" is
     * an attempt to add one more crit: riding from `k` crits to `k+1` is ride
     * `k+1`. a crit-spike bust at crit `k` died on ride `k`; an ambient bust while
     * sitting on `k` crits died trying to reach `k+1`, so ride `k+1`. this is the
     * survival-analysis index the bust-hazard curve is built from.
     */
    diedAtRide: number | null;
}

/** build the read-only view a strategy decides from, out of the live surge. */
function surgeView(economy: EconomyState, surge: Surge): StormView {
    const pot = surge.pot;
    const surgeState: SurgeState = {
        phase: surge.active ? "active" : "idle",
        critCount: pot.crits,
        pot: pot.value,
        multiplier: pot.multiplier,
        coreLoad: surge.coreLoad,
    };
    return {
        time: economy.elapsed,
        economy,
        coreTemp: surge.coreTemp,
        surge: surgeState,
    };
}

/**
 * drive one surge from ignition to exit under `cfg.strategy`, returning its
 * outcome. the strategy decides bank-or-ride once per frame off the live surge
 * snapshot; on `ride` the frame advances, folding any strikes into the pot and
 * ticking the ambient ramp — either of which can bust the surge mid-frame.
 */
export function runSurge(cfg: SurgeRunConfig): SurgeOutcome {
    const economy = cfg.economy ?? createState();
    const step = cfg.stepSec ?? DEFAULT_STEP_SEC;
    const maxFrames = cfg.maxFrames ?? 1_000_000;

    // two independent streams off the one seed: one for economy rolls, one for
    // the surge's intra-band spike lottery, so neither shifts the other.
    const rollRng = mulberry32((cfg.seed ^ 0x1a2b3c4d) | 0);
    const spikeRng = mulberry32((cfg.seed ^ 0x5e6f7a8b) | 0);

    // the last heat source touched before an exit, so a bust can be attributed to
    // the crit that spiked it vs. the ambient tick that cooked it.
    let lastHeatSource: "crit" | "ambient" = "ambient";
    let exit: { reason: SurgeEndReason; crits: number; value: number } | null = null;

    const surge = new Surge(
        {
            onEnd: (reason, pot) => {
                exit = { reason, crits: pot.crits, value: pot.value };
            },
        },
        { rng: spikeRng, criticalTemp: cfg.criticalTemp }
    );

    surge.addHeat(SURGE_HEAT_THRESHOLD); // ignite

    const aps = attacksPerSec(economy);
    let attackTimer = 0;
    for (let frame = 0; frame < maxFrames && surge.active; frame++) {
        const action = cfg.strategy.decide(surgeView(economy, surge));
        if (action.type === "bank") {
            surge.endSurge("bank");
            break;
        }
        // ride: play out one frame of strikes, then the ambient ramp.
        attackTimer += step * aps;
        while (attackTimer >= 1 && surge.active) {
            attackTimer -= 1;
            lastHeatSource = "crit";
            surge.recordStrike(rollAttack(economy, rollRng), baseDamage(economy));
        }
        if (surge.active) {
            lastHeatSource = "ambient";
            surge.tickHeat(step);
        }
    }

    // if the run hit the frame cap still surging, bank it out so a strategy that
    // never banks (always-ride on an impossibly cool seed) still terminates.
    if (surge.active) surge.endSurge("bank");

    const settled = exit ?? { reason: "bank" as SurgeEndReason, crits: 0, value: 0 };
    const diedAtRide =
        settled.reason === "bust"
            ? lastHeatSource === "crit"
                ? settled.crits
                : settled.crits + 1
            : null;

    return {
        reason: settled.reason,
        crits: settled.crits,
        bankedValue: settled.reason === "bank" ? settled.value : 0,
        bankedEssence: settled.reason === "bank" ? valueToEssence(settled.value) : 0,
        diedAtRide,
    };
}

/** shared options for the many-trial sweeps below. */
export interface SweepConfig {
    /** number of seeded trials; more trials = tighter estimates, slower. */
    trials: number;
    /** first seed; trial `i` uses a spread offset from this base. */
    seedBase?: number;
    /** economy reference for every trial (see {@link SurgeRunConfig.economy}). */
    economy?: EconomyState;
    /** core critical temperature override for every trial. */
    criticalTemp?: number;
}

/** derive the seed for trial `i` from a base, spread so streams stay distinct. */
function trialSeed(seedBase: number, i: number): number {
    return (seedBase + Math.imul(i, 0x9e3779b1)) | 0;
}

/**
 * the bust-hazard curve (design.md §6). runs `trials` always-ride surges and
 * returns `hazard[n]` = P(the surge dies riding from `n` crits to `n+1` | it was
 * still alive at `n` crits), for `n = 0 .. maxN`. driven entirely by the real
 * surge machine; the harness only tallies the ride each trial died on.
 */
export function bustHazardCurve(alwaysRide: BotStrategy, maxN: number, cfg: SweepConfig): number[] {
    const seedBase = cfg.seedBase ?? 0;
    const diedAt: number[] = [];
    for (let i = 0; i < cfg.trials; i++) {
        const outcome = runSurge({
            strategy: alwaysRide,
            seed: trialSeed(seedBase, i),
            economy: cfg.economy,
            criticalTemp: cfg.criticalTemp,
        });
        // always-ride only exits by bust, so diedAtRide is always set; guard anyway.
        if (outcome.diedAtRide !== null) diedAt.push(outcome.diedAtRide);
    }
    const hazard: number[] = [];
    for (let n = 0; n <= maxN; n++) {
        const deaths = diedAt.filter((d) => d === n + 1).length;
        const atRisk = diedAt.filter((d) => d >= n + 1).length;
        hazard.push(atRisk === 0 ? NaN : deaths / atRisk);
    }
    return hazard;
}

/**
 * expected banked essence of banking at exactly `n` crits, averaged over
 * `trials` seeded surges (busted rides bank nothing). this is the EV curve the
 * §3 crossover reads: the `n` that maximizes it is where riding one more crit
 * stops paying.
 */
export function expectedBankedEssence(
    strategyForN: (n: number) => BotStrategy,
    n: number,
    cfg: SweepConfig
): number {
    const seedBase = cfg.seedBase ?? 0;
    const strategy = strategyForN(n);
    let total = 0;
    for (let i = 0; i < cfg.trials; i++) {
        total += runSurge({
            strategy,
            seed: trialSeed(seedBase, i),
            economy: cfg.economy,
            criticalTemp: cfg.criticalTemp,
        }).bankedEssence;
    }
    return total / cfg.trials;
}
