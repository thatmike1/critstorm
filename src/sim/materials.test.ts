import { describe, expect, it } from "vitest";
import {
    CONDUCT,
    density,
    emitTemp,
    freezePoint,
    isDissolvable,
    isMovable,
    Mat,
    MAT_COUNT,
    meltPoint,
    PALETTE,
} from "./materials";

// table-entry tests for the gold matter loop materials (GOLD + MOLTEN_GOLD). the
// parallel property arrays are indexed directly in the hot loop, so a missing or
// mis-ordered entry silently breaks physics — these pin the load-bearing values.

describe("gold materials table entries", () => {
    it("registers both ids inside the bumped MAT_COUNT", () => {
        expect(Mat.GOLD).toBe(20);
        expect(Mat.MOLTEN_GOLD).toBe(21);
        expect(MAT_COUNT).toBe(22);
        expect(Mat.GOLD).toBeLessThan(MAT_COUNT);
        expect(Mat.MOLTEN_GOLD).toBeLessThan(MAT_COUNT);
    });

    it("sizes every parallel property array to MAT_COUNT", () => {
        expect(density.length).toBe(MAT_COUNT);
        expect(CONDUCT.length).toBe(MAT_COUNT);
        expect(meltPoint.length).toBe(MAT_COUNT);
        expect(freezePoint.length).toBe(MAT_COUNT);
        expect(emitTemp.length).toBe(MAT_COUNT);
    });

    it("orders density so molten gold sinks through water but lava outweighs it", () => {
        // sinks through water (30) and acid (36); lighter than lava (90) so lava
        // absorbs it rather than being displaced.
        expect(density[Mat.MOLTEN_GOLD]).toBeGreaterThan(density[Mat.WATER]);
        expect(density[Mat.MOLTEN_GOLD]).toBeGreaterThan(density[Mat.ACID]);
        expect(density[Mat.MOLTEN_GOLD]).toBeLessThan(density[Mat.LAVA]);
        // solid gold powder also sinks through water and settles under sand (60).
        expect(density[Mat.GOLD]).toBeGreaterThan(density[Mat.WATER]);
        expect(density[Mat.GOLD]).toBeGreaterThan(density[Mat.SAND]);
    });

    it("sets the melt/freeze/emit thresholds for the gold phase pair", () => {
        expect(meltPoint[Mat.GOLD]).toBe(300);
        expect(freezePoint[Mat.MOLTEN_GOLD]).toBe(150);
        // spawn temperature sits above both its freeze gate and gold's melt point so
        // fresh molten gold reads liquid.
        expect(emitTemp[Mat.MOLTEN_GOLD]).toBeGreaterThan(freezePoint[Mat.MOLTEN_GOLD]);
        expect(emitTemp[Mat.MOLTEN_GOLD]).toBeGreaterThan(meltPoint[Mat.GOLD]);
        // solid gold is not a heat source.
        expect(emitTemp[Mat.GOLD]).toBe(0);
    });

    it("conducts heat like a metal in both phases", () => {
        expect(CONDUCT[Mat.GOLD]).toBeCloseTo(CONDUCT[Mat.METAL]);
        expect(CONDUCT[Mat.MOLTEN_GOLD]).toBeCloseTo(CONDUCT[Mat.METAL]);
    });

    it("marks molten gold movable and solid gold immovable (a resting powder)", () => {
        expect(isMovable(Mat.MOLTEN_GOLD)).toBe(true);
        expect(isMovable(Mat.GOLD)).toBe(false);
    });

    it("lets acid dissolve solid gold but not the molten liquid", () => {
        expect(isDissolvable(Mat.GOLD)).toBe(true);
        expect(isDissolvable(Mat.MOLTEN_GOLD)).toBe(false);
    });

    it("gives both materials a palette swatch with a category", () => {
        const gold = PALETTE.find((p) => p.id === Mat.GOLD);
        const molten = PALETTE.find((p) => p.id === Mat.MOLTEN_GOLD);
        expect(gold).toBeDefined();
        expect(molten).toBeDefined();
        expect(gold?.cat).toBe("Solids");
        expect(molten?.cat).toBe("Liquids");
        expect(gold?.rgb).toHaveLength(3);
        expect(molten?.rgb).toHaveLength(3);
    });
});
