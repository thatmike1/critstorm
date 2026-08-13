import { describe, it, expect } from "vitest";
import { Simulation } from "../sim/simulation";
import { Mat } from "../sim/materials";
import { createState } from "./economy";
import {
    BRUSHES,
    brushById,
    canPaint,
    fullStrokeCellCount,
    fullStrokeCost,
    paintBrush,
    type BrushDef,
} from "./brush";

const stone = brushById("stone");
const water = brushById("water");

/** count cells of a given material across the whole grid. */
function countMat(sim: Simulation, mat: number): number {
    let c = 0;
    for (let k = 0; k < sim.W * sim.H; k++) if (sim.cells[k] === mat) c++;
    return c;
}

/** a brush with a fixed radius, for deterministic cell-count assertions. */
function brushWithRadius(base: BrushDef, radius: number): BrushDef {
    return { ...base, radius };
}

describe("brush catalogue", () => {
    it("ships stone and water only for the v0.1 slice", () => {
        expect(BRUSHES.map((b) => b.id)).toEqual(["stone", "water"]);
    });

    it("maps each brush to its sim material", () => {
        expect(stone.mat).toBe(Mat.STONE);
        expect(water.mat).toBe(Mat.WATER);
    });

    it("prices one complete radius-3 stone stroke as 29 cells", () => {
        expect(fullStrokeCellCount(stone)).toBe(29);
        expect(fullStrokeCost(stone)).toBe(174);
    });

    it("keeps stronger water strictly more expensive than cheap stone", () => {
        expect(water.costPerCell).toBe(7);
        expect(water.costPerCell).toBeGreaterThan(stone.costPerCell);
    });
});

describe("paintBrush per-cell cost deduction", () => {
    it("deducts costPerCell for every cell actually painted", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        state.essence = 1000;
        const painted = paintBrush(sim, state, stone, stone.costPerCell, 20, 15);
        expect(painted).toBeGreaterThan(0);
        expect(countMat(sim, Mat.STONE)).toBe(painted);
        expect(state.essence).toBeCloseTo(1000 - painted * stone.costPerCell, 10);
    });

    it("charges the water brush its higher per-cell price", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        state.essence = 1000;
        const painted = paintBrush(sim, state, water, water.costPerCell, 20, 15);
        expect(state.essence).toBeCloseTo(1000 - painted * water.costPerCell, 10);
    });

    it("does not charge for cells already holding the brush material", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        state.essence = 1000;
        const first = paintBrush(sim, state, stone, stone.costPerCell, 20, 15);
        const afterFirst = state.essence;
        // repainting the identical spot re-paints nothing and costs nothing.
        const second = paintBrush(sim, state, stone, stone.costPerCell, 20, 15);
        expect(second).toBe(0);
        expect(state.essence).toBe(afterFirst);
        expect(countMat(sim, Mat.STONE)).toBe(first);
    });
});

describe("paintBrush insufficient-essence rejection", () => {
    it("paints nothing when the player can't afford a single cell", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        state.essence = 0;
        expect(canPaint(state, stone.costPerCell)).toBe(false);
        const painted = paintBrush(sim, state, stone, stone.costPerCell, 20, 15);
        expect(painted).toBe(0);
        expect(countMat(sim, Mat.STONE)).toBe(0);
        expect(state.essence).toBe(0);
    });

    it("stops mid-stroke and never overspends when essence runs out", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        // enough for exactly three cells of a larger disc.
        state.essence = 3 * stone.costPerCell;
        const painted = paintBrush(
            sim,
            state,
            brushWithRadius(stone, 5),
            stone.costPerCell,
            20,
            15
        );
        expect(painted).toBe(3);
        expect(countMat(sim, Mat.STONE)).toBe(3);
        expect(state.essence).toBe(0);
    });
});

describe("paintBrush never destroys value", () => {
    it("skips gold and molten-gold cells, leaving their material and value intact", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        state.essence = 1000;
        // seed value-carrying cells at the stroke centre.
        sim.cells[15 * sim.W + 20] = Mat.GOLD;
        sim.addValue(20, 15, 500);
        sim.cells[15 * sim.W + 21] = Mat.MOLTEN_GOLD;
        sim.addValue(21, 15, 250);
        const totalBefore = sim.totalValue();

        const painted = paintBrush(sim, state, stone, stone.costPerCell, 20, 15);

        expect(painted).toBeGreaterThan(0);
        // the gold cells survive untouched.
        expect(sim.cells[15 * sim.W + 20]).toBe(Mat.GOLD);
        expect(sim.cells[15 * sim.W + 21]).toBe(Mat.MOLTEN_GOLD);
        expect(sim.getValue(20, 15)).toBe(500);
        expect(sim.getValue(21, 15)).toBe(250);
        // no value left the world.
        expect(sim.totalValue()).toBe(totalBefore);
        // and the two protected cells were not charged for.
        expect(state.essence).toBeCloseTo(1000 - painted * stone.costPerCell, 10);
    });

    it("leaves indestructible walls in place", () => {
        const sim = new Simulation(40, 30);
        const state = createState();
        state.essence = 1000;
        sim.cells[15 * sim.W + 20] = Mat.WALL;
        paintBrush(sim, state, water, water.costPerCell, 20, 15);
        expect(sim.cells[15 * sim.W + 20]).toBe(Mat.WALL);
    });
});

describe("effective per-cell costs", () => {
    it("deducts exact undiscounted and discounted Stone costs across multiple cells", () => {
        const fullPriceSim = new Simulation(20, 20);
        const discountedSim = new Simulation(20, 20);
        const fullPriceState = createState();
        const discountedState = createState();
        fullPriceState.essence = 10;
        discountedState.essence = 10;
        const smallStone = brushWithRadius(stone, 1);

        expect(paintBrush(fullPriceSim, fullPriceState, smallStone, 1, 10, 10)).toBe(5);
        expect(paintBrush(discountedSim, discountedState, smallStone, 0.8, 10, 10)).toBe(5);
        expect(fullPriceState.essence).toBe(5);
        expect(discountedState.essence).toBeCloseTo(6, 10);
        expect(stone.costPerCell).toBe(1);
    });

    it("deducts exact undiscounted and discounted Water costs across multiple cells", () => {
        const fullPriceSim = new Simulation(20, 20);
        const discountedSim = new Simulation(20, 20);
        const fullPriceState = createState();
        const discountedState = createState();
        fullPriceState.essence = 20;
        discountedState.essence = 20;
        const smallWater = brushWithRadius(water, 1);

        expect(paintBrush(fullPriceSim, fullPriceState, smallWater, 3, 10, 10)).toBe(5);
        expect(paintBrush(discountedSim, discountedState, smallWater, 2.4, 10, 10)).toBe(5);
        expect(fullPriceState.essence).toBe(5);
        expect(discountedState.essence).toBeCloseTo(8, 10);
        expect(water.costPerCell).toBe(3);
    });

    it("requires 0.8 essence for one discounted Stone cell", () => {
        const sim = new Simulation(20, 20);
        const state = createState();
        const singleStone = brushWithRadius(stone, 0);

        state.essence = 0.79;
        expect(canPaint(state, 0.8)).toBe(false);
        expect(paintBrush(sim, state, singleStone, 0.8, 10, 10)).toBe(0);
        expect(state.essence).toBe(0.79);

        state.essence = 0.8;
        expect(canPaint(state, 0.8)).toBe(true);
        expect(paintBrush(sim, state, singleStone, 0.8, 10, 10)).toBe(1);
        expect(state.essence).toBeCloseTo(0, 10);
    });

    it("does not charge a discounted brush for protected or already-matching cells", () => {
        const sim = new Simulation(20, 20);
        const state = createState();
        state.essence = 10;
        sim.cells[10 * sim.W + 10] = Mat.GOLD;
        sim.addValue(10, 10, 50);
        sim.cells[10 * sim.W + 11] = Mat.WALL;
        sim.cells[11 * sim.W + 10] = Mat.STONE;
        const smallStone = brushWithRadius(stone, 1);

        const painted = paintBrush(sim, state, smallStone, 0.8, 10, 10);

        expect(painted).toBe(2);
        expect(state.essence).toBeCloseTo(8.4, 10);
        expect(sim.getValue(10, 10)).toBe(50);
        expect(sim.cells[10 * sim.W + 11]).toBe(Mat.WALL);
        expect(sim.cells[11 * sim.W + 10]).toBe(Mat.STONE);
    });
});
