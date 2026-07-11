import { describe, expect, it } from "vitest";
import { alwaysRide, bankAtN, neverRide } from "./bot-strategy";
import {
    bustHazardCurve,
    expectedBankedEssence,
    runSurge,
    type SweepConfig,
} from "./surge-harness";

// design.md §3/§6: the surge is a bank-or-ride gamble. riding to n+1 multiplies
// the pot by 1.5, so riding stops being EV-positive once P(bust on the next
// crit) exceeds ~1/3 — and the spike distribution is meant to put that crossover
// near n≈6 with no defenses. this suite drives the REAL Surge machine (heat
// spikes, ambient ramp, overheat bust all from src/game/surge.ts) under the
// bank/ride bots and pins where the crossover actually lands.
//
// every trial is seeded, so these are deterministic computations, not flaky
// statistical samples. trial counts are kept small enough that the whole file
// runs in well under a second.
//
// MEASURED-vs-DESIGN GAP (owned by critstorm-4cz.3, the pacing tune — NOT this
// harness, whose job is to measure and pin, not retune): with the shipped
// CRIT_SPIKE_BANDS / CORE_CRITICAL_TEMP=490 / AMBIENT_HEAT_COEFF=0.15, the
// full-system crossover on a fresh undefended economy lands at n=4, not the §3
// target of n≈6. the crit-spike hazard alone crosses 1/3 at n=6 (on target); it
// is the quadratic ambient ramp (+q·n²/s) that, at the low fresh-economy crit
// cadence, cooks the core early and pulls the crossover down to n=4. this stays
// in [4,5] across the whole crit-chance range and never reaches 6 while ambient
// is on. the tests below assert the MEASURED n=4 and flag the gap, so the suite
// stays honest and green until 4cz.3 retunes the bands/coefficient.

/** fresh undefended economy, fixed seed base — the design "no defenses" reference. */
const REF: SweepConfig = { trials: 3000, seedBase: 1234 };

/** the largest crit count the hazard curve is defined for (deeper is all-NaN). */
const MAX_N = 8;

/** the EV break-even bust probability from §3: (1 − p)·1.5 = 1 ⇒ p = 1/3. */
const EV_BREAKEVEN = 1 / 3;

/** first n where the bust hazard exceeds the 1/3 EV break-even, over `haz`. */
function hazardCrossover(haz: number[]): number {
    return haz.findIndex((h) => Number.isFinite(h) && h > EV_BREAKEVEN);
}

/** the n that maximizes expected banked essence over `evByN`. */
function evArgmax(evByN: number[]): number {
    let best = 0;
    for (let n = 1; n < evByN.length; n++) if (evByN[n] > evByN[best]) best = n;
    return best;
}

describe("surge harness drives the real Surge machine", () => {
    it("is deterministic for a fixed seed", () => {
        const a = runSurge({ strategy: alwaysRide, seed: 7 });
        const b = runSurge({ strategy: alwaysRide, seed: 7 });
        expect(a).toEqual(b);
    });

    it("never-ride banks an empty pot (zero crits, zero value)", () => {
        const out = runSurge({ strategy: neverRide, seed: 7 });
        expect(out.reason).toBe("bank");
        expect(out.crits).toBe(0);
        expect(out.bankedValue).toBe(0);
        expect(out.diedAtRide).toBeNull();
    });

    it("always-ride rides until the core overheats and busts", () => {
        const out = runSurge({ strategy: alwaysRide, seed: 7 });
        expect(out.reason).toBe("bust");
        expect(out.crits).toBeGreaterThan(0);
        expect(out.bankedValue).toBe(0);
        expect(out.diedAtRide).not.toBeNull();
    });

    it("bank-at-n cashes out a positive pot when it survives to n crits", () => {
        // n=3 sits comfortably below the bust crossover, so most seeds survive.
        const out = runSurge({ strategy: bankAtN(3), seed: 7 });
        expect(out.reason).toBe("bank");
        expect(out.crits).toBe(3);
        expect(out.bankedValue).toBeGreaterThan(0);
        expect(out.bankedEssence).toBeGreaterThan(0);
    });
});

describe("surge harness — bank/ride EV (design.md §3/§6)", () => {
    it("never-ride and always-ride both bank the EV floor (~0)", () => {
        // never-ride cashes empty pots; always-ride always busts. both are the
        // floor the bank-at-n strategies must beat.
        const neverEv = expectedBankedEssence(() => neverRide, 0, REF);
        const alwaysEv = expectedBankedEssence(() => alwaysRide, 0, REF);
        expect(neverEv).toBe(0);
        expect(alwaysEv).toBe(0);
    });

    it("EV rises with bank depth up to the crossover, then collapses on greed", () => {
        const ev = Array.from({ length: 7 }, (_, n) => expectedBankedEssence(bankAtN, n, REF));
        // strictly increasing while riding is still cheap (n = 1..4)…
        for (let n = 2; n <= 4; n++) expect(ev[n]).toBeGreaterThan(ev[n - 1]);
        // …then greed detonates the pot: banking at 6 is far worse than at the peak.
        expect(ev[6]).toBeLessThan(ev[4] * 0.5);
    });

    it("[MEASURED, design gap] EV-maximizing bank point lands at n=4 (§3 targets n≈6)", () => {
        // TODO(critstorm-4cz.3): retune CRIT_SPIKE_BANDS / AMBIENT_HEAT_COEFF so the
        // EV peak moves out to n≈6 undefended. pinned to the measured value here so a
        // regression in the surge math is caught; this harness does not retune.
        const ev = Array.from({ length: 9 }, (_, n) => expectedBankedEssence(bankAtN, n, REF));
        expect(evArgmax(ev)).toBe(4);
    });
});

describe("surge harness — bust hazard shape (design.md §6)", () => {
    it("P(bust on the next ride) is monotonically non-decreasing in n", () => {
        const haz = bustHazardCurve(alwaysRide, MAX_N, REF);
        const defined = haz.filter((h) => Number.isFinite(h));
        for (let n = 1; n < defined.length; n++) {
            expect(defined[n]).toBeGreaterThanOrEqual(defined[n - 1]);
        }
    });

    it("P(bust on the next ride) starts near 0 and crosses the 1/3 break-even", () => {
        const haz = bustHazardCurve(alwaysRide, MAX_N, REF);
        expect(haz[0]).toBeLessThan(0.01); // riding the first crit is essentially free
        const crossover = hazardCrossover(haz);
        // it must actually cross, and land in a sane band (not degenerate at 0 or off the end).
        expect(crossover).toBeGreaterThan(0);
        expect(crossover).toBeLessThanOrEqual(6);
        expect(haz[crossover - 1]).toBeLessThan(EV_BREAKEVEN);
        expect(haz[crossover]).toBeGreaterThan(EV_BREAKEVEN);
    });

    it("[MEASURED, design gap] the 1/3 crossover lands at n=4 (§3 targets n≈6)", () => {
        // TODO(critstorm-4cz.3): the crit-spike hazard alone crosses 1/3 at n=6 (on
        // target); the ambient ramp pulls the full-system crossover down to n=4. the
        // pacing tune owns moving this back out. pinned to the measured value so any
        // drift in the surge heat model trips this test.
        const haz = bustHazardCurve(alwaysRide, MAX_N, REF);
        expect(hazardCrossover(haz)).toBe(4);
    });
});
