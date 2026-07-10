import { describe, it, expect } from "vitest";
import { type GoldLossEvent, Simulation } from "../sim/simulation";
import { Mat } from "../sim/materials";
import { createWorld } from "./world";
import { Collector, defaultCollectorRegion, type CollectorRegion } from "./collector";
import { COLLECTOR_BASE_FEE } from "./economy";

/** place a solid GOLD cell carrying `value` at (x,y). */
function placeGold(sim: Simulation, x: number, y: number, value: number): void {
    sim.cells[y * sim.W + x] = Mat.GOLD;
    sim.addValue(x, y, value);
}

const FULL_REGION = (sim: Simulation): CollectorRegion => ({ x: 0, y: 0, w: sim.W, h: sim.H });

describe("Collector.collect", () => {
    it("converts an arriving gold cell to essence at the base fee and clears it", () => {
        const sim = new Simulation(8, 8);
        placeGold(sim, 3, 4, 100);
        const collector = new Collector(FULL_REGION(sim));

        const essence = collector.collect(sim);

        expect(essence).toBeCloseTo(70, 10); // 100 × (1 − 0.3)
        // the cell is drained: gold removed and its value zeroed.
        expect(sim.cells[4 * sim.W + 3]).toBe(Mat.EMPTY);
        expect(sim.getValue(3, 4)).toBe(0);
        expect(sim.totalValue()).toBe(0);
    });

    it("sums the value of every gold cell in the region", () => {
        const sim = new Simulation(8, 8);
        placeGold(sim, 1, 1, 40);
        placeGold(sim, 2, 5, 60);
        placeGold(sim, 6, 6, 200);
        const collector = new Collector(FULL_REGION(sim));

        expect(collector.collect(sim)).toBeCloseTo(210, 10); // (40+60+200) × 0.7
    });

    it("honors a configurable fee (fully upgraded collector keeps everything)", () => {
        const sim = new Simulation(8, 8);
        placeGold(sim, 2, 2, 100);
        const collector = new Collector(FULL_REGION(sim), 0);

        expect(collector.collect(sim)).toBe(100);
    });

    it("ignores cells outside the drain region and leaves them intact", () => {
        const sim = new Simulation(10, 10);
        placeGold(sim, 1, 1, 100); // inside
        placeGold(sim, 8, 8, 100); // outside
        const collector = new Collector({ x: 0, y: 0, w: 4, h: 4 });

        const essence = collector.collect(sim);

        expect(essence).toBeCloseTo(70, 10); // only the inside cell
        expect(sim.cells[1 * sim.W + 1]).toBe(Mat.EMPTY);
        expect(sim.cells[8 * sim.W + 8]).toBe(Mat.GOLD); // untouched
        expect(sim.getValue(8, 8)).toBe(100);
    });

    it("ignores non-gold cells and returns 0 when no gold has arrived", () => {
        const sim = new Simulation(6, 6);
        sim.cells[2 * sim.W + 2] = Mat.MOLTEN_GOLD; // still in flight, not collected
        sim.addValue(2, 2, 100);
        const collector = new Collector(FULL_REGION(sim));

        expect(collector.collect(sim)).toBe(0);
        expect(sim.cells[2 * sim.W + 2]).toBe(Mat.MOLTEN_GOLD);
        expect(sim.getValue(2, 2)).toBe(100);
    });

    it("does not double-collect: a second scan of a drained cell yields nothing", () => {
        const sim = new Simulation(6, 6);
        placeGold(sim, 3, 3, 100);
        const collector = new Collector(FULL_REGION(sim));

        expect(collector.collect(sim)).toBeCloseTo(70, 10);
        expect(collector.collect(sim)).toBe(0);
    });

    it("clamps an off-grid region to a safe no-op", () => {
        const sim = new Simulation(6, 6);
        placeGold(sim, 3, 3, 100);
        const collector = new Collector({ x: 20, y: 20, w: 4, h: 4 });

        expect(collector.collect(sim)).toBe(0);
        expect(sim.cells[3 * sim.W + 3]).toBe(Mat.GOLD);
    });
    it("collection is silent: mints essence but fires ZERO gold-loss events", () => {
        const sim = new Simulation(8, 8);
        placeGold(sim, 3, 4, 100);
        const collector = new Collector(FULL_REGION(sim));
        const events: GoldLossEvent[] = [];
        sim.setGoldLossListener((e) => events.push(e));

        const essence = collector.collect(sim);

        expect(essence).toBeCloseTo(70, 10); // conversion still happens
        expect(sim.cells[4 * sim.W + 3]).toBe(Mat.EMPTY);
        expect(sim.getValue(3, 4)).toBe(0);
        // the drain is not destruction — no loss tell fires at the collector.
        expect(events).toHaveLength(0);
    });

    it("a plain paint-erase of gold still fires exactly one loss (drain is the only exception)", () => {
        const sim = new Simulation(8, 8);
        placeGold(sim, 3, 4, 100);
        const events: GoldLossEvent[] = [];
        sim.setGoldLossListener((e) => events.push(e));

        sim.paint(3, 4, 0, Mat.EMPTY); // manual brush erase

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ x: 3, y: 4, amount: 100, cause: "erase" });
    });
});

describe("defaultCollectorRegion", () => {
    it("is a narrow band centred under the core, hugging the terrain surface", () => {
        const world = createWorld({ seed: 1 });
        const region = defaultCollectorRegion(world);

        // narrow patch, not the full floor — everything outside stays at risk.
        expect(region.w).toBeLessThan(world.sim.W);
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.x + region.w).toBeLessThanOrEqual(world.sim.W);
        // centred under the storm core (within rounding).
        expect(Math.abs(region.x + region.w / 2 - world.core.x)).toBeLessThanOrEqual(1);
        expect(region.h).toBeGreaterThan(0);
        // the band reaches a few rows above the highest surface point of its span.
        let minSurface = Infinity;
        for (let x = region.x; x < region.x + region.w; x++) {
            minSurface = Math.min(minSurface, world.floorHeightAt(x));
        }
        expect(region.y).toBeLessThan(minSurface);
        expect(region.y).toBeGreaterThanOrEqual(0);
    });

    it("gold settling outside the drain span is not collected", () => {
        const world = createWorld({ seed: 1 });
        const region = defaultCollectorRegion(world);
        const collector = new Collector(region);
        // place gold at rest on the surface well outside the drain columns.
        const x = region.x > world.sim.W - (region.x + region.w) ? 0 : world.sim.W - 1;
        const y = world.floorHeightAt(x) - 1;
        placeGold(world.sim, x, y, 100);

        expect(collector.collect(world.sim)).toBe(0);
        expect(world.sim.cells[y * world.sim.W + x]).toBe(Mat.GOLD);
    });

    it("uses the base fee by default when a collector drains that region", () => {
        const world = createWorld({ seed: 2 });
        const collector = new Collector(defaultCollectorRegion(world));
        expect(collector.fee).toBe(COLLECTOR_BASE_FEE);
    });
});
