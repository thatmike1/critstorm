import { describe, expect, it } from "vitest";
import { Mat } from "./materials";
import { Simulation } from "./simulation";

// spec for the Lagrangian value field (the gold-loop keystone). value is a
// property of the PARTICLE: it rides with a cell through swap() and survives the
// GOLD<->MOLTEN_GOLD melt/freeze round-trip, but any other material change
// destroys it. these tests pin those rules as hard invariants, because the
// collector / eruption / ingot work builds directly on them.

const W = 20;
const H = 15;
const idx = (x: number, y: number) => y * W + x;
const fresh = () => new Simulation(W, H);

describe("value field carry contract", () => {
    it("(a) conserves total value across many steps with no sinks or sources", () => {
        const s = fresh();
        // a small gold pile near the top, each cell seeded with a distinct amount.
        const seeds = [
            { x: 8, y: 2, v: 100 },
            { x: 9, y: 2, v: 250 },
            { x: 10, y: 2, v: 40 },
            { x: 9, y: 1, v: 333 },
        ];
        let expected = 0;
        for (const { x, y, v } of seeds) {
            s.paint(x, y, 0, Mat.GOLD);
            s.addValue(x, y, v);
            expected += v;
        }
        expect(s.totalValue()).toBeCloseTo(expected);
        // gold falls and piles; movement is swap-only, so the ledger must not drift.
        for (let f = 0; f < 60; f++) {
            s.step();
            expect(s.totalValue()).toBeCloseTo(expected);
        }
    });

    it("(b) carries value with the particle through a swap (gold falling)", () => {
        const s = fresh();
        const x = 10;
        const y = 5; // empty below, so it falls exactly one cell per step
        s.paint(x, y, 0, Mat.GOLD);
        s.addValue(x, y, 100);
        s.step();
        // the gold moved down one; its value went with it and the vacated cell is 0.
        expect(s.cells[idx(x, y + 1)]).toBe(Mat.GOLD);
        expect(s.getValue(x, y + 1)).toBeCloseTo(100);
        expect(s.getValue(x, y)).toBe(0);
    });

    it("(c) preserves value across GOLD->MOLTEN_GOLD melt and freeze back", () => {
        const s = fresh();
        const x = 10;
        const y = H - 1; // bottom row so the cell never moves under gravity
        const i = idx(x, y);
        s.paint(x, y, 0, Mat.GOLD);
        s.addValue(x, y, 500);

        // drive it past the melt point; update() reads heat before diffuse.
        s.heat[i] = 350;
        s.step();
        expect(s.cells[i]).toBe(Mat.MOLTEN_GOLD);
        expect(s.getValue(x, y)).toBeCloseTo(500);
        expect(s.totalValue()).toBeCloseTo(500);

        // cool it below the freeze gate; it solidifies in place, value intact.
        s.heat[i] = 100;
        s.step();
        expect(s.cells[i]).toBe(Mat.GOLD);
        expect(s.getValue(x, y)).toBeCloseTo(500);
        expect(s.totalValue()).toBeCloseTo(500);
    });

    it("(d) zeroes value when a cell is set to an unrelated material", () => {
        const s = fresh();
        const x = 6;
        const y = 6;
        s.paint(x, y, 0, Mat.GOLD);
        s.addValue(x, y, 400);
        expect(s.getValue(x, y)).toBeCloseTo(400);
        // painting water over the gold is a non-carry transition: value is destroyed.
        s.paint(x, y, 0, Mat.WATER);
        expect(s.cells[idx(x, y)]).toBe(Mat.WATER);
        expect(s.getValue(x, y)).toBe(0);
        expect(s.totalValue()).toBe(0);
    });

    it("destroys value when molten gold is absorbed by lava", () => {
        const s = fresh();
        const x = 6;
        const y = 6;
        s.paint(x, y, 0, Mat.MOLTEN_GOLD);
        s.addValue(x, y, 200);
        // a lava neighbor devours the molten gold: cell emptied, value lost.
        s.paint(x + 1, y, 0, Mat.LAVA);
        s.step();
        expect(s.cells[idx(x, y)]).not.toBe(Mat.MOLTEN_GOLD);
        expect(s.getValue(x, y)).toBe(0);
    });
});
