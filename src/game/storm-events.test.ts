import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { createWorld } from "./world";
import {
    INITIAL_STORM_EVENT_CADENCE,
    MIN_STORM_EVENT_CADENCE,
    STORM_EVENT_ESCALATION_DURATION,
    StormEvents,
    createStormEventRng,
    stormEventCadence,
    stormEventSeverity,
    triggerStormEvent,
} from "./storm-events";

/** count the cells matching `mat` in a simulation. */
function countMat(world: ReturnType<typeof createWorld>, mat: number): number {
    let count = 0;
    for (const cell of world.sim.cells) if (cell === mat) count++;
    return count;
}

/** return a stable random source for testing one event's placement. */
function fixedRng(): number {
    return 0.5;
}

describe("storm event escalation", () => {
    it("shortens the event cadence and raises severity as the storm runs", () => {
        expect(stormEventCadence(0)).toBe(INITIAL_STORM_EVENT_CADENCE);
        expect(stormEventCadence(STORM_EVENT_ESCALATION_DURATION)).toBe(MIN_STORM_EVENT_CADENCE);
        expect(stormEventCadence(12 * 60)).toBeLessThan(stormEventCadence(2 * 60));
        expect(stormEventSeverity(0)).toBe(1);
        expect(stormEventSeverity(12 * 60)).toBeGreaterThan(stormEventSeverity(2 * 60));
    });

    it("schedules the same events for the same seeded rng", () => {
        const worldA = createWorld({ seed: 7 });
        const a = new StormEvents(worldA, createStormEventRng(123));
        const b = new StormEvents(createWorld({ seed: 7 }), createStormEventRng(123));
        const eventsA = a.tick(15 * 60);
        const eventsB = b.tick(15 * 60);
        expect(eventsA).toEqual(eventsB);
        expect(a.totalErupted).toBe(b.totalErupted);
        expect(eventsA.length).toBeGreaterThan(0);
        expect(worldA.sim.totalValue()).toBeCloseTo(a.totalErupted, 6);

        const firstGap = eventsA[1].elapsed - eventsA[0].elapsed;
        const lastGap = eventsA.at(-1)!.elapsed - eventsA.at(-2)!.elapsed;
        expect(lastGap).toBeLessThan(firstGap);
        expect(eventsA.at(-1)!.severity).toBeGreaterThan(eventsA[0].severity);
    });
});

describe("storm event simulation effects", () => {
    it("spawns value-carrying gold at the top and records it as erupted", () => {
        const world = createWorld({ seed: 2 });
        const event = triggerStormEvent(world, "gold-rain", 3, fixedRng);
        expect(event.cells.length).toBeGreaterThan(0);
        expect(event.erupted).toBeGreaterThan(0);
        expect(world.sim.totalValue()).toBeCloseTo(event.erupted, 6);
        for (const cell of event.cells) {
            expect(cell.y).toBe(0);
            expect(world.sim.cells[cell.y * world.sim.W + cell.x]).toBe(Mat.GOLD);
            expect(world.sim.getValue(cell.x, cell.y)).toBeGreaterThan(0);
        }
    });

    it("rains acid over a sky band", () => {
        const world = createWorld({ seed: 3 });
        const event = triggerStormEvent(world, "acid-drizzle", 2, fixedRng);
        expect(event.erupted).toBe(0);
        expect(event.cells.length).toBeGreaterThan(0);
        expect(countMat(world, Mat.ACID)).toBe(event.cells.length);
        for (const cell of event.cells) expect(cell.y).toBe(0);
    });

    it("opens a heated lava fissure along the terrain floor", () => {
        const world = createWorld({ seed: 4 });
        const event = triggerStormEvent(world, "lava-fissure", 3, fixedRng);
        expect(event.erupted).toBe(0);
        expect(event.cells.length).toBeGreaterThan(0);
        expect(countMat(world, Mat.LAVA)).toBe(event.cells.length);
        for (const cell of event.cells) {
            expect(cell.y).toBe(world.floorHeightAt(cell.x));
            expect(world.sim.heat[cell.y * world.sim.W + cell.x]).toBeGreaterThanOrEqual(700);
        }
    });

    it("keeps lightning-front as an explicit no-op stub", () => {
        const world = createWorld({ seed: 5 });
        const before = Array.from(world.sim.cells);
        const event = triggerStormEvent(world, "lightning-front", 1, fixedRng);
        expect(event.cells).toEqual([]);
        expect(Array.from(world.sim.cells)).toEqual(before);
    });
});
