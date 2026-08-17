import { describe, expect, it } from "vitest";
import { COLLECTOR_BASE_FEE, valueToEssence } from "../src/game/economy";
import { Collector, defaultCollectorRegion } from "../src/game/collector";
import { depositEruption } from "../src/game/eruption";
import { createWorld } from "../src/game/world";
import { bankAtN } from "./bot-strategy";
import {
    competentPacingProfile,
    FRESH_PACING_PROFILE,
    LATE_PACING_SAMPLE_MINUTES,
    PACING_COLLECTION_DELAY_SEC,
    PACING_STEP_SEC,
    runStormBot,
    summarizeLatePacing,
    type LatePacingReport,
    type StormBotSummary,
} from "./storm-bot";
import { withSeededRandom } from "./rng";

/** select a stable nearest-rank quantile from sorted deterministic trials. */
function quantile(summaries: StormBotSummary[], key: keyof StormBotSummary, p: number): number {
    const raw = summaries.map((summary) => summary[key]);
    if (raw.some((value) => typeof value !== "number")) {
        throw new Error(`${String(key)} was not reached in every pacing trial`);
    }
    const values = (raw as number[]).sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * p)];
}

/** run the reference profile across a deterministic fresh-player seed set. */
function referenceSweep(): StormBotSummary[] {
    return Array.from({ length: 65 }, (_, i) =>
        runStormBot({ durationSec: 180, seed: (1000 + i * 40507) | 0 })
    );
}

/** run one side of the 129-seed turret/overclock causal ablation. */
function lateSweep(
    allowAutoStriker: boolean,
    allowAutoStrikerOverclock = allowAutoStriker
): StormBotSummary[] {
    return Array.from({ length: 129 }, (_, i) =>
        runStormBot({
            durationSec: 35 * 60,
            seed: (1000 + i * 40507) | 0,
            profile: competentPacingProfile(allowAutoStriker, allowAutoStrikerOverclock),
            strategy: bankAtN(6),
            sampleAtMinutes: LATE_PACING_SAMPLE_MINUTES,
        })
    );
}

/** make the exact distribution readable without hiding balance-significant precision. */
function roundedReport(report: LatePacingReport) {
    return {
        trials: report.trials,
        samples: report.samples.map((sample) => ({
            minute: sample.minute,
            cumulativeEssence: Math.round(sample.cumulativeEssence),
            coresPerMin: Number(sample.coresPerMin.toFixed(3)),
        })),
        essenceGrowth20To30: Number(report.essenceGrowth20To30.toFixed(3)),
        essenceGrowth25To35: Number(report.essenceGrowth25To35.toFixed(3)),
        coarseCoresPerMinGrowth: report.coarseCoresPerMinGrowth.map((growth) =>
            Number(growth.toFixed(3))
        ),
        coresPerMin35Over30Growth: Number(report.coresPerMin35Over30Growth.toFixed(3)),
        passes: report.passes,
    };
}

describe("fresh storm pacing bot", () => {
    it("reproduces the complete summary for a fixed seed", () => {
        const a = runStormBot({ durationSec: 180, seed: 1234 });
        const b = runStormBot({ durationSec: 180, seed: 1234 });
        expect(a).toEqual(b);
    });

    it("isolates physical randomness from combat and surge decisions", () => {
        const a = runStormBot({ durationSec: 180, seed: 1234, physicsSeed: 1 });
        const b = runStormBot({ durationSec: 180, seed: 1234, physicsSeed: 999 });
        expect(a).toEqual(b);
    });

    it("keeps the §8 first-surge and complete-stone-stroke gates near 90 seconds", () => {
        const summaries = referenceSweep();
        expect(quantile(summaries, "firstSurgeAtSec", 0.5)).toBeGreaterThanOrEqual(45);
        expect(quantile(summaries, "firstSurgeAtSec", 0.9)).toBeLessThanOrEqual(90);
        expect(quantile(summaries, "firstBrushAffordableAtSec", 0.5)).toBeGreaterThanOrEqual(75);
        expect(quantile(summaries, "firstBrushAffordableAtSec", 0.5)).toBeLessThanOrEqual(105);
        expect(quantile(summaries, "firstBrushAffordableAtSec", 0.9)).toBeLessThanOrEqual(120);
        expect(quantile(summaries, "firstBrushPaintedAtSec", 0.9)).toBeLessThanOrEqual(120);
    });

    it("fails a timing distribution when any trial does not reach the gate", () => {
        const incomplete = [runStormBot({ durationSec: 1, seed: 1 })];
        expect(() => quantile(incomplete, "firstSurgeAtSec", 0.5)).toThrow(/not reached/);
        expect(() => quantile(incomplete, "firstBrushAffordableAtSec", 0.5)).toThrow(/not reached/);
    });

    it("bounds delayed collection by the real core-to-drain physical path", () => {
        const frames = Math.round(PACING_COLLECTION_DELAY_SEC / PACING_STEP_SEC);
        expect(frames).toBe(62);
        for (const seed of [3, 7, 42]) {
            const result = withSeededRandom(seed, () => {
                const world = createWorld({ seed });
                const collector = new Collector(defaultCollectorRegion(world));
                const payout = 1000;
                depositEruption(world.sim, world.core.x, world.core.y, payout);
                let essence = 0;
                for (let frame = 0; frame < frames; frame++) {
                    world.sim.step();
                    essence += collector.collect(world.sim);
                }
                return { essence, pending: world.sim.totalValue(), payout };
            });
            expect(result.essence).toBeCloseTo(
                valueToEssence(result.payout, COLLECTOR_BASE_FEE),
                4
            );
            expect(result.pending).toBeCloseTo(0, 4);
        }
    });

    it("paints exactly one 29-cell stone stroke without reducing banked essence", () => {
        const summary = runStormBot({ durationSec: 180, seed: 1000 });
        expect(summary.firstBrushAffordableAtSec).not.toBeNull();
        expect(summary.firstBrushPaintedAtSec).not.toBeNull();
        expect(summary.firstBrushPaintedAtSec!).toBeGreaterThanOrEqual(
            summary.firstBrushAffordableAtSec!
        );
        expect(summary.brushActions).toBe(1);
        expect(summary.brushCellsPainted).toBe(29);
        expect(summary.brushEssenceSpent).toBe(174);
        expect(summary.brushBankedEssenceDelta).toBe(0);
    });

    it("uses one scheduled pointer action for painting instead of attacking", () => {
        const withPaint = runStormBot({ durationSec: 120, seed: 42 });
        const withoutPaint = runStormBot({
            durationSec: 120,
            seed: 42,
            profile: {
                ...FRESH_PACING_PROFILE,
                name: "fresh-no-paint",
                paintFirstStoneStroke: false,
            },
        });
        expect(withPaint.brushActions).toBe(1);
        expect(withPaint.manualActions).toBe(withoutPaint.manualActions);
        expect(withPaint.manualAttacks).toBe(withoutPaint.manualAttacks - 1);
        expect(withPaint.manualActions).toBe(withPaint.manualAttacks + withPaint.brushActions);
    });

    it("is invariant to fixed-step resolution because actions use exact elapsed times", () => {
        const coarse = runStormBot({ durationSec: 180, seed: 1000, stepSec: 0.05 });
        const fine = runStormBot({ durationSec: 180, seed: 1000, stepSec: 0.025 });
        expect({ ...coarse, stepSec: 0 }).toEqual({ ...fine, stepSec: 0 });
    });

    it("rejects invalid duration, timestep, and click cadence", () => {
        expect(() => runStormBot({ durationSec: 0, seed: 1 })).toThrow(/durationSec/);
        expect(() => runStormBot({ durationSec: 1, seed: 1, stepSec: Number.NaN })).toThrow(
            /stepSec/
        );
        expect(() =>
            runStormBot({
                durationSec: 1,
                seed: 1,
                profile: { ...FRESH_PACING_PROFILE, manualClicksPerSec: 0 },
            })
        ).toThrow(/manualClicksPerSec/);
    });

    it("conserves generated value through pending, collection, fees, and loss", () => {
        const summary = runStormBot({ durationSec: 180, seed: 1000 });
        expect(summary.capturedAttacks).toBeGreaterThan(0);
        expect(summary.bustedPotValue).toBeGreaterThan(0);
        expect(summary.attacks).toBe(summary.routedAttacks + summary.capturedAttacks);
        expect(summary.generatedValue).toBeCloseTo(
            summary.pendingValue + summary.rawCollectedValue + summary.lostValue,
            8
        );
        expect(summary.lostValue).toBe(summary.bustedPotValue);
        expect(summary.cumulativeEssence + summary.collectorFeeValue).toBeCloseTo(
            summary.rawCollectedValue,
            8
        );
        expect(summary.cumulativeEssence).toBeCloseTo(
            valueToEssence(summary.rawCollectedValue, COLLECTOR_BASE_FEE),
            8
        );
    });

    it("keeps the conservation ledger closed across the full reference sweep", () => {
        for (const summary of referenceSweep()) {
            expect(summary.generatedValue).toBeCloseTo(
                summary.pendingValue + summary.rawCollectedValue + summary.lostValue,
                8
            );
        }
    });

    it("marks actual first-surge ignition for storm-end core accounting", () => {
        const summary = runStormBot({ durationSec: 63, seed: 1000 });
        expect(summary.firstSurgeAtSec).toBe(62.4);
        expect(summary.reachedFirstSurge).toBe(true);
        expect(summary.blowUpCores).toBeGreaterThanOrEqual(1);
    });
});

describe("competent late-storm pacing profile", () => {
    it("places and upgrades the real turret without spending cumulative essence", () => {
        const summary = runStormBot({
            durationSec: 180,
            seed: 42,
            profile: competentPacingProfile(true),
            strategy: bankAtN(6),
        });

        expect(summary.firstAutoStrikerAtSec).toBe(summary.firstBrushPaintedAtSec);
        expect(summary.autoStrikerLevel).toBe(12);
        expect(summary.autoStrikerEssenceSpent).toBe(3896);
        expect(summary.autoStrikerBankedEssenceDelta).toBe(0);
    });

    it("routes automatic strikes through capture, bank/bust, and collection accounting", () => {
        const summary = runStormBot({
            durationSec: 180,
            seed: 42,
            profile: competentPacingProfile(true),
            strategy: bankAtN(6),
        });

        expect(summary.automaticRoutedAttacks).toBeGreaterThan(0);
        expect(summary.automaticCapturedAttacks).toBeGreaterThan(0);
        expect(summary.banks).toBeGreaterThan(0);
        expect(summary.busts).toBeGreaterThan(0);
        expect(summary.automaticAttacks).toBe(
            summary.automaticRoutedAttacks + summary.automaticCapturedAttacks
        );
        expect(summary.attacks).toBe(summary.manualAttacks + summary.automaticAttacks);
        expect(summary.generatedValue).toBeCloseTo(
            summary.pendingValue + summary.rawCollectedValue + summary.lostValue,
            8
        );
    });

    it("retains seeded and fixed-dt determinism with the automatic timer active", () => {
        const config = {
            durationSec: 35 * 60,
            seed: 42,
            profile: competentPacingProfile(true),
            strategy: bankAtN(6),
            sampleAtMinutes: LATE_PACING_SAMPLE_MINUTES,
        } as const;
        const coarse = runStormBot({ ...config, stepSec: 0.05 });
        const repeat = runStormBot({ ...config, stepSec: 0.05 });
        const fine = runStormBot({ ...config, stepSec: 0.025 });

        expect(coarse).toEqual(repeat);
        expect({ ...coarse, stepSec: 0 }).toEqual({ ...fine, stepSec: 0 });
    });

    it("rejects missing, non-finite, and out-of-run late samples", () => {
        const complete = [
            runStormBot({
                durationSec: 35 * 60,
                seed: 42,
                sampleAtMinutes: LATE_PACING_SAMPLE_MINUTES.slice(1),
            }),
        ];
        expect(() => summarizeLatePacing(complete)).toThrow(/missing 8m sample/);
        expect(() =>
            runStormBot({ durationSec: 60, seed: 1, sampleAtMinutes: [Number.NaN] })
        ).toThrow(/sampleAtMinutes/);
        expect(() => runStormBot({ durationSec: 60, seed: 1, sampleAtMinutes: [2] })).toThrow(
            /sampleAtMinutes/
        );
    });

    it("pins the 129-seed overclock, baseline turret, and no-turret distributions", () => {
        const overclockRuns = lateSweep(true, true);
        const baselineRuns = lateSweep(true, false);
        const noTurretRuns = lateSweep(false, false);
        const overclock = summarizeLatePacing(overclockRuns);
        const baseline = summarizeLatePacing(baselineRuns);
        const noTurret = summarizeLatePacing(noTurretRuns);

        expect(roundedReport(overclock)).toEqual({
            trials: 129,
            samples: [
                { minute: 8, cumulativeEssence: 42994082, coresPerMin: 36.625 },
                { minute: 15, cumulativeEssence: 630221142, coresPerMin: 74.8 },
                { minute: 20, cumulativeEssence: 1541940689, coresPerMin: 87.8 },
                { minute: 22, cumulativeEssence: 2771247738, coresPerMin: 107 },
                { minute: 25, cumulativeEssence: 4492659239, coresPerMin: 119.88 },
                { minute: 29, cumulativeEssence: 9399055469, coresPerMin: 149.483 },
                { minute: 30, cumulativeEssence: 14560311357, coresPerMin: 179.867 },
                { minute: 35, cumulativeEssence: 34121839384, coresPerMin: 236 },
            ],
            essenceGrowth20To30: 9.443,
            essenceGrowth25To35: 7.595,
            coarseCoresPerMinGrowth: [1.042, 0.43, 0.397, 0.579],
            coresPerMin35Over30Growth: 0.312,
            passes: true,
        });
        expect(roundedReport(baseline)).toEqual({
            trials: 129,
            samples: [
                { minute: 8, cumulativeEssence: 46643651, coresPerMin: 38.125 },
                { minute: 15, cumulativeEssence: 771464748, coresPerMin: 82.8 },
                { minute: 20, cumulativeEssence: 1867636173, coresPerMin: 96.6 },
                { minute: 22, cumulativeEssence: 3348324216, coresPerMin: 117.591 },
                { minute: 25, cumulativeEssence: 5274784229, coresPerMin: 129.92 },
                { minute: 29, cumulativeEssence: 9731407163, coresPerMin: 152.103 },
                { minute: 30, cumulativeEssence: 10039518382, coresPerMin: 149.333 },
                { minute: 35, cumulativeEssence: 15767631932, coresPerMin: 160.429 },
            ],
            essenceGrowth20To30: 5.376,
            essenceGrowth25To35: 2.989,
            coarseCoresPerMinGrowth: [1.172, 0.42, 0.293, 0.055],
            coresPerMin35Over30Growth: 0.074,
            passes: false,
        });
        expect(roundedReport(noTurret)).toEqual({
            trials: 129,
            samples: [
                { minute: 8, cumulativeEssence: 17771437, coresPerMin: 23.5 },
                { minute: 15, cumulativeEssence: 674755401, coresPerMin: 77.4 },
                { minute: 20, cumulativeEssence: 2777263367, coresPerMin: 117.8 },
                { minute: 22, cumulativeEssence: 4115015221, coresPerMin: 130.364 },
                { minute: 25, cumulativeEssence: 7158035367, coresPerMin: 151.32 },
                { minute: 29, cumulativeEssence: 19794437735, coresPerMin: 216.931 },
                { minute: 30, cumulativeEssence: 19801536186, coresPerMin: 209.767 },
                { minute: 35, cumulativeEssence: 36486667663, coresPerMin: 244.057 },
            ],
            essenceGrowth20To30: 7.13,
            essenceGrowth25To35: 5.097,
            coarseCoresPerMinGrowth: [2.294, 0.684, 0.664, 0.125],
            coresPerMin35Over30Growth: 0.163,
            passes: true,
        });

        expect(overclock.passes).toBe(true);
        expect(baseline.passes).toBe(false);
        expect(noTurret.passes).toBe(true);

        const overclock35 = overclock.samples.at(-1)!.coresPerMin;
        const baseline35 = baseline.samples.at(-1)!.coresPerMin;
        const noTurret35 = noTurret.samples.at(-1)!.coresPerMin;
        // these two ratios are PINS ON THE TUNING COHORT, not validated floors.
        // the overclock constants were tuned against exactly these 129 seeds, so
        // asserting a 0.9 floor here only restated the tuning result. critstorm-5xo
        // re-measured both on 3096 disjoint holdout seeds: all 24 holdout cohorts
        // fell below 0.9 (median -0.107) and none reached 0.95 on the second ratio
        // (best 0.72). they are pinned exactly so a balance change is still caught,
        // and sim/overclock-holdout.test.ts carries the honest holdout measurement.
        const deficitClosed = (overclock35 - baseline35) / (noTurret35 - baseline35);
        expect(deficitClosed).toBeCloseTo(0.903656, 6);
        expect(overclock35 / noTurret35).toBeCloseTo(0.966987, 6);
        // the ceiling guardrail — automation never beats hands-on play — does hold
        // on holdout too, so it stays a real assertion rather than a pin.
        expect(overclock35).toBeLessThan(noTurret35);

        for (const summary of overclockRuns) {
            expect(summary.autoStrikerLevel).toBeGreaterThan(0);
            expect(summary.automaticRoutedAttacks).toBeGreaterThan(0);
            expect(summary.automaticCapturedAttacks).toBeGreaterThan(0);
            expect(summary.autoStrikerOverclockBankGains).toBeGreaterThan(0);
            expect(summary.autoStrikerSurgeHeatAdded).toBeGreaterThan(0);
        }

        for (const summary of [...overclockRuns, ...baselineRuns, ...noTurretRuns]) {
            const accounted =
                summary.pendingValue + summary.rawCollectedValue + summary.lostValue;
            expect(Math.abs(summary.generatedValue - accounted)).toBeLessThanOrEqual(
                Math.max(1, summary.generatedValue) * 1e-12
            );
            expect(summary.cumulativeEssence + summary.collectorFeeValue).toBeCloseTo(
                summary.rawCollectedValue,
                -2
            );
            expect(summary.hazardModel).toBe("surge-bust-only");
        }
        // three 129-seed sweeps of 35-minute storms; ~3.5s of cpu alone, and more
        // under parallel load, so it needs an explicit budget over the 5s default.
    }, 60_000);
});
