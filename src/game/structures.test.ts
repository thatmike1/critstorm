import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { AUTO_STRIKER_PURCHASE_COST } from "./auto-striker";
import { createState } from "./economy";
import {
    placeLightningRod,
    placeMagnet,
    placeSprinkler,
    SPRINKLER_INTERVAL_SEC,
    SPRINKLER_OFFSETS,
    SINGULAR_MARKER_OFFSETS,
    isStructureInstalled,
    tickSprinkler,
    structureById,
    STRUCTURES,
} from "./structures";

describe("structure catalogue", () => {
    it("lists the auto-striker as a placed structure at its purchase price", () => {
        expect(STRUCTURES.map((s) => s.id)).toContain("auto-striker");
        expect(structureById("auto-striker").cost).toBe(AUTO_STRIKER_PURCHASE_COST);
        expect(structureById("sprinkler").cost).toBe(180);
        expect(structureById("lightning-rod").cost).toBe(1000);
    });
});

describe("sprinkler structure", () => {
    it("places once, sprays after 4 seconds, and charges eligible cells atomically", () => {
        const sim = new Simulation(30, 20);
        const state = createState();
        state.essence = 200;
        const sprinkler = placeSprinkler(sim, state, 15, 10);
        expect(sprinkler).not.toBeNull();
        expect(state.essence).toBe(20);
        expect(placeSprinkler(sim, state, 20, 10)).toBeNull();
        expect(tickSprinkler(sim, sprinkler!, state, SPRINKLER_INTERVAL_SEC - 0.1).spent).toBe(0);
        const tick = tickSprinkler(sim, sprinkler!, state, 0.1);
        expect(tick.sprayedCells).toHaveLength(SPRINKLER_OFFSETS.length);
        expect(tick.spent).toBe(SPRINKLER_OFFSETS.length * 3);
        for (const { x, y } of tick.sprayedCells) expect(sim.cells[y * sim.W + x]).toBe(Mat.WATER);
    });

    it("does not overwrite protected/value cells and an underfunded cycle changes nothing", () => {
        const sim = new Simulation(30, 20);
        const state = createState();
        state.essence = 183;
        const sprinkler = placeSprinkler(sim, state, 15, 10)!;
        sim.paint(15, 7, 0, Mat.GOLD);
        sim.addValue(15, 7, 50);
        const before = Array.from(sim.cells);
        const result = tickSprinkler(sim, sprinkler, state, 4);
        expect(result.spent).toBe(0);
        expect(state.essence).toBe(3);
        expect(sim.cells).toEqual(Uint8Array.from(before));
        expect(sim.totalValue()).toBe(50);
    });
});

describe("lightning rod structure", () => {
    it("is singular and uses a distinct empty-air metal marker", () => {
        const sim = new Simulation(30, 20);
        const state = createState();
        state.essence = 2000;
        expect(placeLightningRod(sim, state, 15, 10)).toEqual({ x: 15, y: 10 });
        expect(placeLightningRod(sim, state, 20, 10)).toBeNull();
        expect(state.essence).toBe(1000);
        for (const offset of SINGULAR_MARKER_OFFSETS["lightning-rod"]) {
            expect(sim.cells[(10 + offset.y) * sim.W + 15 + offset.x]).toBe(Mat.METAL);
        }
        expect(SINGULAR_MARKER_OFFSETS.sprinkler).not.toEqual(
            SINGULAR_MARKER_OFFSETS["lightning-rod"]
        );
    });

    it("rejects a value-carrying marker footprint without charging", () => {
        const sim = new Simulation(30, 20);
        const state = createState();
        state.essence = 1000;
        sim.addValue(15, 8, 50);
        expect(placeLightningRod(sim, state, 15, 10)).toBeNull();
        expect(state.essence).toBe(1000);
        expect(sim.getValue(15, 8)).toBe(50);
    });
});

describe("structure installation state", () => {
    it("marks singular structure buttons as installed", () => {
        const installed = { sprinkler: true, "lightning-rod": false } as const;
        expect(isStructureInstalled("sprinkler", installed)).toBe(true);
        expect(isStructureInstalled("lightning-rod", installed)).toBe(false);
        expect(isStructureInstalled("magnet", installed)).toBe(false);
    });
});

describe("magnet structure placement", () => {
    it("deducts its one-time essence cost and paints a static marker", () => {
        const sim = new Simulation(30, 20);
        const state = createState();
        const magnet = structureById("magnet");
        state.essence = magnet.cost;

        expect(placeMagnet(sim, state, 15, 10)).toBe(true);
        expect(state.essence).toBe(0);
        expect(sim.cells[10 * sim.W + 15]).toBe(Mat.METAL);
        expect(sim.cells[9 * sim.W + 15]).toBe(Mat.METAL);
        expect(sim.cells[10 * sim.W + 14]).toBe(Mat.METAL);
        expect(sim.cells[10 * sim.W + 16]).toBe(Mat.METAL);
        expect(sim.cells[11 * sim.W + 15]).toBe(Mat.METAL);
    });

    it("rejects an occupied footprint without charging or destroying gold value", () => {
        const sim = new Simulation(30, 20);
        const state = createState();
        state.essence = structureById("magnet").cost;
        sim.cells[10 * sim.W + 15] = Mat.GOLD;
        sim.addValue(15, 10, 250);

        expect(placeMagnet(sim, state, 15, 10)).toBe(false);
        expect(state.essence).toBe(structureById("magnet").cost);
        expect(sim.cells[10 * sim.W + 15]).toBe(Mat.GOLD);
        expect(sim.getValue(15, 10)).toBe(250);
        expect(sim.totalValue()).toBe(250);
    });

    it("registers fixed-step attraction for the placed magnet", () => {
        const sim = new Simulation(40, 25);
        const state = createState();
        state.essence = structureById("magnet").cost;
        expect(placeMagnet(sim, state, 25, 15)).toBe(true);
        sim.cells[15 * sim.W + 10] = Mat.GOLD;
        sim.addValue(10, 15, 100);
        const totalBefore = sim.totalValue();

        sim.step();

        expect(sim.cells[15 * sim.W + 12]).toBe(Mat.GOLD);
        expect(sim.getValue(12, 15)).toBe(100);
        expect(sim.totalValue()).toBe(totalBefore);
    });

    it("overcomes gravity when routing gold upward", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        state.essence = structureById("magnet").cost;
        expect(placeMagnet(sim, state, 20, 5)).toBe(true);
        sim.cells[15 * sim.W + 20] = Mat.GOLD;
        sim.addValue(20, 15, 100);

        sim.step();

        expect(sim.cells[14 * sim.W + 20]).toBe(Mat.GOLD);
        expect(sim.getValue(20, 14)).toBe(100);
        expect(sim.totalValue()).toBe(100);
    });
});
