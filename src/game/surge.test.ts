import { describe, it, expect, vi } from "vitest";
import {
    Surge,
    SURGE_HEAT_THRESHOLD,
    POT_MULTIPLIER_STEP,
    CORE_CRITICAL_TEMP,
    CRIT_SPIKE_BANDS,
    SURGE_TIER_FLOOR,
    critHeatSpike,
    potMultiplier,
    potState,
    type SurgeEndReason,
    type PotState,
} from "./surge";
import { createState, rollAttack, baseDamage, type AttackResult } from "./economy";
import { mulberry32 } from "../../sim/rng";

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

describe("critHeatSpike (design §6 tier-temperature bands)", () => {
    it("draws uniformly inside the crit's §6 tier band", () => {
        // rng at 0 hits the band floor, at ~1 the band ceiling.
        expect(critHeatSpike(1, () => 0)).toBe(CRIT_SPIKE_BANDS[1][0]);
        expect(critHeatSpike(1, () => 0.9999999)).toBeCloseTo(CRIT_SPIKE_BANDS[1][1], 4);
        expect(critHeatSpike(8, () => 0)).toBe(CRIT_SPIKE_BANDS[8][0]);
        // spikes climb monotonically with tier at a fixed roll (higher tier = hotter).
        for (let t = 1; t < CRIT_SPIKE_BANDS.length - 1; t++) {
            expect(critHeatSpike(t + 1, () => 0.5)).toBeGreaterThan(critHeatSpike(t, () => 0.5));
        }
    });

    it("floors sub-tier-1 inputs to the tier-1 band (design §3 surge tier floor)", () => {
        expect(SURGE_TIER_FLOOR).toBe(1);
        expect(critHeatSpike(0, () => 0.3)).toBe(critHeatSpike(1, () => 0.3));
    });
});

describe("Surge core heat (design §3/§6)", () => {
    it("starts cold and warms only on crits, not non-crit strikes", () => {
        const s = new Surge({}, { rng: () => 0 }); // rng 0 -> spike is the band floor
        s.addHeat(100);
        expect(s.coreTemp).toBe(0);
        s.recordStrike(normal(0), 5);
        expect(s.coreTemp).toBe(0); // a non-crit adds base to the pot, no heat
        s.recordStrike(crit(40, 1), 5);
        expect(s.coreTemp).toBe(CRIT_SPIKE_BANDS[1][0]); // one tier-1 spike at its floor
    });

    it("ramps ambient heat by q·n² per second and only while surging", () => {
        const s = new Surge({}, { rng: () => 0, ambientCoeff: 0.15 });
        s.tickHeat(1); // idle -> no-op
        expect(s.coreTemp).toBe(0);
        s.addHeat(100);
        s.recordStrike(crit(40, 1), 5); // n = 1
        const afterSpike = s.coreTemp;
        s.tickHeat(2); // +0.15 · 1² · 2 = 0.3
        expect(s.coreTemp).toBeCloseTo(afterSpike + 0.3, 10);
    });

    it("reports coreLoad as the fraction of critical temp", () => {
        const s = new Surge({}, { rng: () => 0.5, criticalTemp: 200 });
        s.addHeat(100);
        s.recordStrike(crit(40, 1), 5); // tier-1 midpoint spike = 75
        expect(s.criticalTemp).toBe(200);
        expect(s.coreLoad).toBeCloseTo(75 / 200, 6);
    });

    it("busts through the exit seam when a crit spike crosses critical temp", () => {
        const ends: { reason: SurgeEndReason; pot: PotState }[] = [];
        // a low ceiling so a single tier-1 spike overheats deterministically.
        const s = new Surge(
            { onEnd: (reason, pot) => ends.push({ reason, pot }) },
            { rng: () => 1, criticalTemp: 50 }
        );
        s.addHeat(100);
        s.recordStrike(crit(40, 1), 5); // spike ~90 >= 50 -> bust
        expect(ends).toHaveLength(1);
        expect(ends[0].reason).toBe("bust");
        // the busting crit is captured in the final pot (rode it, it pumped, then burned).
        expect(ends[0].pot.crits).toBe(1);
        expect(ends[0].pot.value).toBeCloseTo(40 * POT_MULTIPLIER_STEP, 10);
        expect(s.active).toBe(false);
        expect(s.coreTemp).toBe(0); // reset after the exit
    });

    it("reports the busting crit as captured so callers do not also erupt it (critstorm-cjs)", () => {
        // same deterministic single-spike bust as above: the strike deactivates the
        // surge inside recordStrike, yet it WAS folded into the (now burned) pot.
        // callers key the de-dup erupt guard on this return value, not on `active`.
        const s = new Surge({}, { rng: () => 1, criticalTemp: 50 });
        s.addHeat(100);
        expect(s.recordStrike(crit(40, 1), 5)).toBe(true); // captured AND busts
        expect(s.active).toBe(false);
        // after the bust the machine is idle again: nothing is captured.
        expect(s.recordStrike(crit(40, 1), 5)).toBe(false);
    });

    it("busts on the ambient ramp alone — the anti-stall clock cannot be waited out", () => {
        const ends: SurgeEndReason[] = [];
        const s = new Surge(
            { onEnd: (reason) => ends.push(reason) },
            { rng: () => 0, criticalTemp: 100, ambientCoeff: 5 }
        );
        s.addHeat(100);
        s.recordStrike(crit(40, 1), 5); // n = 1, spike 60 — well under 100
        expect(s.active).toBe(true);
        // sit on the pot: ambient q·1²·dt accrues until it detonates.
        for (let i = 0; i < 100 && s.active; i++) s.tickHeat(1);
        expect(ends).toEqual(["bust"]);
    });
});

describe("Surge bust hazard shape (design §3/§6 tuning target)", () => {
    /**
     * simulate one always-ride surge with independent seeded streams for the tier
     * rolls (economy) and the intra-band spike lottery (surge). returns the crit
     * count at which the core overheated, or -1 if it never busted within the cap.
     */
    function rideToBust(seed: number): number {
        const econ = createState(); // no upgrades: base crit chance, "no defenses"
        const econRng = mulberry32((seed * 2 + 1) | 0);
        let bustAt = -1;
        const s = new Surge(
            {
                onEnd: (reason, pot) => {
                    if (reason === "bust") bustAt = pot.crits;
                },
            },
            { rng: mulberry32((seed * 2) | 0) }
        );
        s.addHeat(SURGE_HEAT_THRESHOLD);
        // fixed 0.05 s cadence per strike keeps ambient a mild add next to the
        // crit spikes, so the crossover is driven by the stochastic spikes (§3).
        for (let strike = 0; strike < 2000 && s.active; strike++) {
            const r = rollAttack(econ, econRng);
            s.recordStrike(r, baseDamage(econ));
            s.tickHeat(0.05);
        }
        return bustAt;
    }

    const SEEDS = 3000;
    const bustN: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) bustN.push(rideToBust(seed));

    it("every undefended ride eventually busts, in a sane crit band", () => {
        expect(bustN.every((n) => n > 0)).toBe(true); // none hit the strike cap
        expect(Math.min(...bustN)).toBeGreaterThanOrEqual(3);
        expect(Math.max(...bustN)).toBeLessThanOrEqual(12);
    });

    it("centres the bust near the §3 target of n≈6", () => {
        const sorted = [...bustN].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        const mean = bustN.reduce((a, b) => a + b, 0) / bustN.length;
        expect(median).toBeGreaterThanOrEqual(5);
        expect(median).toBeLessThanOrEqual(8);
        expect(mean).toBeGreaterThan(5);
        expect(mean).toBeLessThan(8);
    });

    it("has a monotone-increasing per-crit hazard crossing ~1/3 near n≈6", () => {
        // hazard(k) = P(the k-th crit is the one that busts | the ride reached k crits).
        const reached = (k: number): number => bustN.filter((n) => n >= k).length;
        const bustedAt = (k: number): number => bustN.filter((n) => n === k).length;
        const hazard = (k: number): number => {
            const r = reached(k);
            return r === 0 ? 0 : bustedAt(k) / r;
        };
        // monotone non-decreasing across the populated range (enough survivors to be stable).
        let prev = 0;
        for (let k = 4; k <= 9; k++) {
            if (reached(k) < 50) break;
            const h = hazard(k);
            expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = h;
        }
        // the design §3 crossover: riding the 6th crit busts roughly a third of the time,
        // which is exactly where 1.5× stops paying — banking early becomes rational.
        expect(CORE_CRITICAL_TEMP).toBe(490);
        expect(hazard(6)).toBeGreaterThan(0.2);
        expect(hazard(6)).toBeLessThan(0.5);
    });
});
