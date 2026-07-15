import { describe, expect, it } from "vitest";
import { coresFromEssence, createState } from "../src/game/economy";
import { bankAtN, neverRide, strategyByName } from "./bot-strategy";
import {
    cumulativeEssenceAtMinutes,
    stepEconomy,
    StormSimulator,
    type StormSummary,
} from "./storm-simulator";

// the storm harness must be deterministic: a fixed seed reproduces the whole
// run — economy rolls and the sim's internal randomness both flow from the seed.
// runs are kept short and on a tiny grid so the suite stays fast.

/** run a short storm on a small grid for the given seed/strategy */
function shortStorm(seed: number, strategyName = "bank-at-6"): StormSummary {
    return new StormSimulator({
        durationSec: 120,
        strategy: strategyByName(strategyName),
        seed,
        gridW: 48,
        gridH: 32,
    }).run();
}

describe("storm simulator determinism", () => {
    it("credits collected essence to the cumulative storm ledger", () => {
        const economy = createState();
        const { collected } = stepEconomy(economy, 1, () => 1);

        expect(collected).toBeGreaterThan(0);
        expect(economy.bankedEssence).toBe(collected);
    });

    it("reproduces an identical summary for a fixed seed", () => {
        const a = shortStorm(1234);
        const b = shortStorm(1234);
        expect(a).toEqual(b);
    });

    it("produces different results for different seeds", () => {
        const a = shortStorm(1);
        const b = shortStorm(2);
        expect(a.totalDamage).not.toBe(b.totalDamage);
    });

    it("samples once per minute plus the zero mark", () => {
        const s = shortStorm(42);
        // 120 s storm → samples at t=0 and t=60 (t=120 is past the last frame)
        expect(s.samples.map((m) => m.minute)).toEqual([0, 1]);
    });

    it("counts every attack and classifies crits and golden hits", () => {
        const s = shortStorm(99);
        expect(s.attacks).toBeGreaterThan(0);
        expect(s.crits).toBeLessThanOrEqual(s.attacks);
        expect(s.goldenHits).toBeLessThanOrEqual(s.attacks);
        expect(s.totalDamage).toBeGreaterThan(0);
    });
});

describe("bot strategies (surge stubbed)", () => {
    it("no strategy banks or busts while surge mechanics are absent", () => {
        for (const name of ["never-ride", "always-ride", "bank-at-6"]) {
            const s = shortStorm(7, name);
            expect(s.banks).toBe(0);
            expect(s.busts).toBe(0);
        }
    });

    it("never-ride banks the moment an active surge is present", () => {
        const surge = {
            phase: "active" as const,
            critCount: 0,
            pot: 0,
            multiplier: 1,
            coreLoad: 0,
        };
        const view = { time: 0, economy: emptyEconomy(), coreTemp: 20, surge };
        expect(neverRide.decide(view).type).toBe("bank");
    });

    it("bank-at-n rides below n crits and banks at or above n", () => {
        const strat = bankAtN(6);
        const base = { time: 0, economy: emptyEconomy(), coreTemp: 20 };
        const below = { ...base, surge: mkSurge(3) };
        const at = { ...base, surge: mkSurge(6) };
        expect(strat.decide(below).type).toBe("ride");
        expect(strat.decide(at).type).toBe("bank");
    });

    it("strategies are inert with no surge", () => {
        const view = { time: 0, economy: emptyEconomy(), coreTemp: 20 };
        expect(neverRide.decide(view).type).toBe("none");
        expect(bankAtN(4).decide(view).type).toBe("none");
    });
});

// design.md §6 mandates three economic assertions for the tuning harness:
// EV-crossover, bust-hazard, and anti-farming. EV-crossover and bust-hazard read
// the surge pot/overheat model and live in sim/surge-harness.test.ts, which drives
// the real Surge machine. anti-farming depends only on the in-storm essence economy
// and lives here, now that the storm harness credits collector essence
// (critstorm-4cz.3): each frame mints valueToEssence(payout), so the greedy economy
// actually compounds instead of sitting at zero.
//
// THE PROPERTY (design §5/§6): cores/min must strictly increase with storm depth
// across the 8->35 min arc, where cores = coresFromEssence(bankedEssence) and
// bankedEssence is cumulative collected essence. sqrt(essence) is concave, so if
// in-storm essence growth ever flattens, spamming tiny storms becomes the optimal
// core grind — this assertion is what catches that.
//
// WHY MEDIAN, WHY COARSE MARKS (read before tightening): the greedy economy is a
// lumpy staircase — a single seed's cores/min wiggles a few percent as greedy saves
// for the next critMulti tier, and the post-eruption cumulative-essence distribution
// is heavy-tailed (rare golden-chain runs inflate the MEAN). so the honest,
// non-cherry-picked statistic is the MEDIAN cumulative essence of a "typical
// competent storm" over a seed sweep, sampled at the design's coarse arc marks. at
// that resolution the property holds with the shipped constants; at fine (per-minute)
// resolution the staircase still dips, and pushing strict monotonicity there needs a
// sustained super-quadratic growth lever the in-storm upgrade set does not have (its
// only late engine, critMulti under geometric cost, yields ~quadratic essence and a
// FLATTENING cores/min past ~30 min). that residual is a MECHANICAL gap for the meta
// layer (a compounding collection/structure lever), not a constants miss — see the
// wave-5b PR body. this suite pins the achievable coarse-arc guarantee.
describe("storm economy (design.md §6 anti-farming)", () => {
    /** design §5 arc marks (minutes); the storm must get strictly core-richer with depth. */
    const ARC = [8, 15, 22, 29, 35] as const;
    /** odd trial count → a clean single-element median; ≥129 is where the coarse arc is stable. */
    const TRIALS = 129;
    const SEED_BASE = 1000;

    const median = (xs: number[]): number => {
        const s = [...xs].sort((a, b) => a - b);
        return s[s.length >> 1];
    };

    /** median cumulative essence at each arc mark over TRIALS seeded competent storms. */
    function medianCumulativeByMinute(): Map<number, number> {
        const cols = new Map<number, number[]>(ARC.map((m) => [m, []]));
        for (let i = 0; i < TRIALS; i++) {
            const traj = cumulativeEssenceAtMinutes((SEED_BASE + i * 40507) | 0, ARC);
            for (const m of ARC) cols.get(m)!.push(traj.get(m) ?? 0);
        }
        return new Map(ARC.map((m) => [m, median(cols.get(m)!)]));
    }

    it("cores/min strictly increases with storm depth across the 8->35 min arc", () => {
        const cum = medianCumulativeByMinute();
        const coresPerMin = ARC.map((m) => coresFromEssence(cum.get(m)!) / m);
        for (let i = 1; i < coresPerMin.length; i++) {
            expect(coresPerMin[i]).toBeGreaterThan(coresPerMin[i - 1]);
        }
        // and the deepest storm is the core-efficiency argmax — a shallow storm never
        // out-farms it, which is the anti-farming guarantee in one line.
        const deepest = coresPerMin[coresPerMin.length - 1];
        expect(deepest).toBe(Math.max(...coresPerMin));
    });

    it("every storm reaching its first surge (~90 s) yields at least 1 core", () => {
        // design §5 teaching-moment floor: even a first-storm blow-up right after the
        // first surge must bank a core, never 8 minutes of zero meta progress. the §8
        // pacing gate puts the first surge within ~90 s, so cumulative essence at 90 s
        // must clear the 1-core threshold (coresFromEssence >= 1 ⇔ banked >= 500) on
        // EVERY seed, not just the median.
        for (let i = 0; i < TRIALS; i++) {
            const at90 = cumulativeEssenceAtMinutes((SEED_BASE + i * 40507) | 0, [1.5]).get(1.5)!;
            expect(coresFromEssence(at90)).toBeGreaterThanOrEqual(1);
        }
    });
});

/** a minimal economy state stand-in for pure strategy-decision tests */
function emptyEconomy() {
    return {
        essence: 0,
        bankedEssence: 0,
        reachedFirstSurge: false,
        totalDamage: 0,
        elapsed: 0,
        attackTimer: 0,
        frenzyTimer: 0,
        levels: { baseDamage: 0, critChance: 0, critMulti: 0, attackRate: 0, golden: 0 },
    };
}

/** build an active surge state with the given crit count */
function mkSurge(critCount: number) {
    return {
        phase: "active" as const,
        critCount,
        pot: 0,
        multiplier: Math.pow(1.5, critCount),
        coreLoad: 0,
    };
}
