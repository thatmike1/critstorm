import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { createState } from "./economy";
import { placeMagnet, structureById } from "./structures";

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

        expect(sim.cells[15 * sim.W + 11]).toBe(Mat.GOLD);
        expect(sim.getValue(11, 15)).toBe(100);
        expect(sim.totalValue()).toBe(totalBefore);
    });
});
