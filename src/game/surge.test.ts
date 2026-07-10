import { describe, it, expect, vi } from "vitest";
import {
    Surge,
    SURGE_HEAT_THRESHOLD,
    POT_MULTIPLIER_STEP,
    potMultiplier,
    potState,
    type SurgeEndReason,
    type PotState,
} from "./surge";
import type { AttackResult } from "./economy";

/** a non-crit strike (tier 0). */
function normal(damage: number): AttackResult {
    return { damage, tier: 0, golden: false };
}

/** a crit strike (tier >= 1). */
function crit(damage: number, tier = 1): AttackResult {
    return { damage, tier, golden: false };
}

describe("potMultiplier", () => {
    it("is 1.5^n, starting at 1 for zero crits", () => {
        expect(potMultiplier(0)).toBe(1);
        expect(potMultiplier(1)).toBeCloseTo(1.5, 10);
        expect(potMultiplier(2)).toBeCloseTo(2.25, 10);
        expect(potMultiplier(6)).toBeCloseTo(Math.pow(1.5, 6), 10);
        expect(POT_MULTIPLIER_STEP).toBe(1.5);
    });

    it("multiplies the pot by 1.5 for each additional crit (design §3)", () => {
        for (let n = 0; n < 10; n++) {
            expect(potMultiplier(n + 1) / potMultiplier(n)).toBeCloseTo(1.5, 10);
        }
    });
});

describe("potState", () => {
    it("derives value = contributions × multiplier", () => {
        const p = potState(100, 2);
        expect(p.contributions).toBe(100);
        expect(p.crits).toBe(2);
        expect(p.multiplier).toBeCloseTo(2.25, 10);
        expect(p.value).toBeCloseTo(225, 10);
    });
});

describe("Surge heat / trigger", () => {
    it("fills the heat meter without surging below the threshold", () => {
        const s = new Surge();
        expect(s.addHeat(50)).toBe(false);
        expect(s.heat).toBe(50);
        expect(s.active).toBe(false);
        expect(s.phase).toBe("idle");
    });

    it("ignites a surge exactly when heat reaches 100 (design §3)", () => {
        const s = new Surge();
        s.addHeat(93);
        expect(s.active).toBe(false);
        const started = s.addHeat(7);
        expect(started).toBe(true);
        expect(s.active).toBe(true);
        expect(s.phase).toBe("surging");
        // igniting consumes the meter.
        expect(s.heat).toBe(0);
        expect(SURGE_HEAT_THRESHOLD).toBe(100);
    });

    it("clamps heat at the threshold and ignites on overfill", () => {
        const s = new Surge();
        expect(s.addHeat(1000)).toBe(true);
        expect(s.active).toBe(true);
    });

    it("drains heat while idle and ignores negatives", () => {
        const s = new Surge();
        s.addHeat(40);
        s.decayHeat(15);
        expect(s.heat).toBe(25);
        s.decayHeat(-5);
        expect(s.heat).toBe(25);
        s.decayHeat(1000);
        expect(s.heat).toBe(0);
    });

    it("ignores heat inputs once a surge is live", () => {
        const s = new Surge();
        s.addHeat(100);
        expect(s.addHeat(50)).toBe(false);
        s.decayHeat(50);
        expect(s.heat).toBe(0);
        expect(s.active).toBe(true);
    });
});

describe("Surge pot accrual", () => {
    it("adds base damage for a non-crit strike and does not touch the multiplier", () => {
        const s = new Surge();
        s.addHeat(100);
        s.recordStrike(normal(999), 5);
        const pot = s.pot;
        // non-crit contributes BASE (5), not the strike's damage (999).
        expect(pot.contributions).toBe(5);
        expect(pot.crits).toBe(0);
        expect(pot.multiplier).toBe(1);
        expect(pot.value).toBe(5);
    });

    it("adds a crit's payout and bumps the multiplier by 1.5", () => {
        const s = new Surge();
        s.addHeat(100);
        s.recordStrike(crit(40), 5);
        const pot = s.pot;
        // crit contributes its payout (40), not base, and lands one crit.
        expect(pot.contributions).toBe(40);
        expect(pot.crits).toBe(1);
        expect(pot.multiplier).toBeCloseTo(1.5, 10);
        expect(pot.value).toBeCloseTo(60, 10);
    });

    it("accumulates a mixed run: contributions sum, value = sum × 1.5^n", () => {
        const s = new Surge();
        s.addHeat(100);
        s.recordStrike(normal(0), 5); // +5 base
        s.recordStrike(crit(40, 2), 5); // +40 payout, n=1
        s.recordStrike(normal(0), 5); // +5 base
        s.recordStrike(crit(100, 3), 5); // +100 payout, n=2
        const pot = s.pot;
        expect(pot.contributions).toBe(150);
        expect(pot.crits).toBe(2);
        expect(pot.multiplier).toBeCloseTo(2.25, 10);
        expect(pot.value).toBeCloseTo(150 * 2.25, 10);
    });

    it("ignores strikes recorded outside a surge", () => {
        const s = new Surge();
        s.recordStrike(crit(1000), 5);
        expect(s.pot.value).toBe(0);
        expect(s.active).toBe(false);
    });
});

describe("Surge exit seam", () => {
    it("endSurge('bank') returns the final pot and resets to idle", () => {
        const s = new Surge();
        s.addHeat(100);
        s.recordStrike(crit(40), 5);
        const final = s.endSurge("bank");
        expect(final.value).toBeCloseTo(60, 10);
        expect(s.active).toBe(false);
        expect(s.phase).toBe("idle");
        expect(s.pot.value).toBe(0);
    });

    it("endSurge('bust') is an accepted exit reason and also resets", () => {
        const s = new Surge();
        s.addHeat(100);
        s.recordStrike(normal(0), 10);
        const final = s.endSurge("bust");
        expect(final.contributions).toBe(10);
        expect(s.active).toBe(false);
    });

    it("is a safe no-op when no surge is live", () => {
        const s = new Surge();
        const final = s.endSurge("bank");
        expect(final.value).toBe(0);
        expect(s.active).toBe(false);
    });

    it("supports re-igniting after an exit", () => {
        const s = new Surge();
        s.addHeat(100);
        s.recordStrike(crit(40), 5);
        s.endSurge("bank");
        // heat starts fresh at zero after an exit.
        expect(s.addHeat(50)).toBe(false);
        expect(s.addHeat(50)).toBe(true);
        expect(s.active).toBe(true);
        // and the pot is fresh, not carried over.
        expect(s.pot.value).toBe(0);
    });
});

describe("Surge listeners (render/audio seams)", () => {
    it("fires onStart at ignition and onEnd with the reason + final pot", () => {
        const onStart = vi.fn();
        const ends: { reason: SurgeEndReason; pot: PotState }[] = [];
        const s = new Surge({ onStart, onEnd: (reason, pot) => ends.push({ reason, pot }) });
        s.addHeat(100);
        expect(onStart).toHaveBeenCalledTimes(1);
        s.recordStrike(crit(40), 5);
        s.endSurge("bank");
        expect(ends).toHaveLength(1);
        expect(ends[0].reason).toBe("bank");
        expect(ends[0].pot.value).toBeCloseTo(60, 10);
    });

    it("fires onPotChange on ignition, each strike, and exit (the visible-swell seam)", () => {
        const values: number[] = [];
        const s = new Surge({ onPotChange: (pot) => values.push(pot.value) });
        s.addHeat(100); // ignition -> 0
        s.recordStrike(crit(40), 5); // -> 60
        s.endSurge("bank"); // reset -> 0
        expect(values).toEqual([0, 60, 0]);
    });
});
