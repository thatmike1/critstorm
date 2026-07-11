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
// WHAT "CROSSOVER" MEANS HERE: §3/§6 phrase the target as P(bust on the next
// CRIT). this harness measures P(bust on the next full RIDE) — the crit spike PLUS
// the ambient heat accrued while the player waits for that crit to land. that is the
// EV-correct quantity (you cannot ride to n+1 without eating the wait), and it is
// sensitive to the wait length: these trials assume the fixed ~1-attack/sec fresh
// undefended cadence (attacksPerSec, no simulated clicking). faster clicking shortens
// the wait, lowers the ambient toll, and pushes the crossover out further.
//
// WAVE-5B PACING TUNE (critstorm-4cz.3, resolved): the pre-tune constants
// (CORE_CRITICAL_TEMP=490 / AMBIENT_HEAT_COEFF=0.15) put the full-RIDE crossover at
// n=4 — two crits short of the §3 target n≈6 — because the quadratic ambient ramp
// cooked the low-cadence ride early. of the two levers the harness flagged, we took
// (b), the retune, over (a), redefining the target: crit-spike magnitude is the WRONG
// direction (sharper spikes move the crossover EARLIER), so reaching n≈6 needs
// headroom + a lighter wait toll, not sharper spikes. we raised CORE_CRITICAL_TEMP to
// 620 and trimmed AMBIENT_HEAT_COEFF to 0.10 (a 33% cut, not off — ~46% of undefended
// busts stay ambient, so the anti-stall clock still bites and the ride is a sharp
// n≈6 cliff, not a slow cook). the tests below now assert the on-target n=6 for both
// the EV peak and the 1/3 hazard crossover; drift in the surge heat model trips them.

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
        const ev = Array.from({ length: 9 }, (_, n) => expectedBankedEssence(bankAtN, n, REF));
        // strictly increasing while riding is still cheap (n = 1..6)…
        for (let n = 2; n <= 6; n++) expect(ev[n]).toBeGreaterThan(ev[n - 1]);
        // …then greed detonates the pot: banking at 7 is far worse than at the peak.
        expect(ev[7]).toBeLessThan(ev[6] * 0.5);
    });

    it("the EV-maximizing bank point lands at n≈6 (design §3)", () => {
        // wave-5b pacing tune (critstorm-4cz.3): with CORE_CRITICAL_TEMP=620 and
        // AMBIENT_HEAT_COEFF=0.10 the undefended full-ride EV peak sits at n=6, on the
        // §3 target — up from the pre-tune n=4, where the 490 ceiling and 0.15 ambient
        // toll cooked the ride two crits early.
        const ev = Array.from({ length: 9 }, (_, n) => expectedBankedEssence(bankAtN, n, REF));
        expect(evArgmax(ev)).toBe(6);
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

    it("the 1/3 full-ride crossover lands at n≈6 (design §3)", () => {
        // this is P(bust on the next full RIDE) — crit spike PLUS the ambient heat
        // accrued waiting for that crit at the ~1-attack/sec fresh cadence — the §3
        // gamble the player actually faces (you cannot reach n+1 without eating the
        // wait). wave-5b pacing tune (critstorm-4cz.3) moved it from the pre-tune n=4
        // to the target n=6 by raising CORE_CRITICAL_TEMP to 620 (more headroom) and
        // trimming AMBIENT_HEAT_COEFF to 0.10 (33% less wait toll — the anti-stall
        // clock still bites, ~46% of undefended busts stay ambient). the result is a
        // sharp cliff: haz[5]≈0.26 (still cheap), haz[6]≈0.83 (a coin-flip-plus bust).
        const haz = bustHazardCurve(alwaysRide, MAX_N, REF);
        expect(hazardCrossover(haz)).toBe(6);
    });
});
