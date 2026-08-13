import { describe, expect, it } from "vitest";
import { COLLECTOR_BASE_FEE, valueToEssence } from "../src/game/economy";
import { Collector, defaultCollectorRegion } from "../src/game/collector";
import { depositEruption } from "../src/game/eruption";
import { createWorld } from "../src/game/world";
import {
    FRESH_PACING_PROFILE,
    PACING_COLLECTION_DELAY_SEC,
    PACING_STEP_SEC,
    runStormBot,
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
