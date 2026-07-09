import { describe, it, expect } from "vitest";
import { Mat } from "../sim/materials";
import { createWorld } from "./world";
import { erupt, MAX_ERUPTION_CELLS } from "./eruption";
import { Collector, defaultCollectorRegion } from "./collector";
import { COLLECTOR_BASE_FEE } from "./economy";

/** count molten-gold cells currently in the sim. */
function moltenCount(cells: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] === Mat.MOLTEN_GOLD) n++;
    return n;
}

describe("erupt", () => {
    it("seeds molten gold at the core carrying the hit's full value", () => {
        const world = createWorld({ seed: 3 });
        const placed = erupt(world, 100);

        expect(placed).toBeGreaterThan(0);
        // every seeded cell is molten gold, spawned hot in open air
        expect(moltenCount(world.sim.cells)).toBe(placed);
        // value is conserved: the whole hit enters the world's value field
        // (Float32 value field, so compare with a relative tolerance).
        expect(world.sim.totalValue()).toBeCloseTo(100, 3);
    });

    it("seeds nothing and returns 0 for a non-positive hit", () => {
        const world = createWorld({ seed: 3 });
        expect(erupt(world, 0)).toBe(0);
        expect(erupt(world, -5)).toBe(0);
        expect(moltenCount(world.sim.cells)).toBe(0);
        expect(world.sim.totalValue()).toBe(0);
    });

    it("caps the gush width but still seeds the full value on a huge hit", () => {
        const world = createWorld({ seed: 3 });
        const placed = erupt(world, 1e9);

        expect(placed).toBeGreaterThan(0);
        expect(placed).toBeLessThanOrEqual(MAX_ERUPTION_CELLS);
        // Float32 value field can't hold 1e9 exactly; assert a tiny relative error.
        expect(Math.abs(world.sim.totalValue() - 1e9) / 1e9).toBeLessThan(1e-5);
    });

    it("feeds the collector end-to-end: erupted value drains to essence at the fee", () => {
        const world = createWorld({ seed: 3 });
        erupt(world, 1000);
        // run the sim until the molten gold cools, settles, and rests in the band.
        for (let i = 0; i < 3000; i++) world.sim.step();

        const collector = new Collector(defaultCollectorRegion(world));
        const essence = collector.collect(world.sim);

        // no value sinks (no lava/acid in the flats world), so the whole hit drains
        // (Float32 value field, so allow a small relative tolerance).
        expect(essence).toBeCloseTo(1000 * (1 - COLLECTOR_BASE_FEE), 3);
    });
});
