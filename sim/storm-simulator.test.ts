import { describe, expect, it } from "vitest";
import { bankAtN, neverRide, strategyByName } from "./bot-strategy";
import { StormSimulator, type StormSummary } from "./storm-simulator";

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

/** a minimal economy state stand-in for pure strategy-decision tests */
function emptyEconomy() {
    return {
        essence: 0,
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
