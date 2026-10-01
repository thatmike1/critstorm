import { describe, expect, it } from "vitest";
import { createState, creditEssence, buy } from "./economy";
import { coreProjection, stormGoal } from "./storm-goals";
import { markFirstSurge } from "./storm-end";
import { createStormEventRng } from "./storm-events";
import { Simulation } from "../sim/simulation";
import { Mat } from "../sim/materials";

describe("storm guidance", () => {
    it("follows collection, purchasing, automation and the first bank", () => {
        const state = createState();
        expect(stormGoal(state, 0, 0).title).toBe("Wealth has to land");
        creditEssence(state, 100);
        expect(stormGoal(state, 0, 0).title).toBe("Give the core some teeth");
        buy(state, "baseDamage");
        expect(stormGoal(state, 0, 0).title).toBe("Build your first machine");
        expect(stormGoal(state, 1, 0).title).toBe("Ride it. Then release it.");
        expect(stormGoal(state, 1, 50).title).toContain("2,000");
    });

    it("projects earned cores across spending and honors the first-surge floor", () => {
        const state = createState();
        expect(coreProjection(state).cores).toBe(0);
        markFirstSurge(state);
        expect(coreProjection(state).cores).toBe(1.5);
        creditEssence(state, 2000);
        const before = coreProjection(state);
        buy(state, "baseDamage");
        expect(coreProjection(state)).toEqual(before);
        expect(before).toEqual({ cores: 3, nextEssence: 4500 });
    });
});

describe("isolated physics rng", () => {
    it("reproduces cells, heat and wealth even when another sim runs between steps", () => {
        const a = new Simulation(32, 24, createStormEventRng(42));
        const b = new Simulation(32, 24, createStormEventRng(42));
        const noise = new Simulation(32, 24, createStormEventRng(99));
        for (const sim of [a, b]) {
            sim.paint(16, 5, 3, Mat.MOLTEN_GOLD);
            sim.addValue(16, 5, 100);
            sim.paint(13, 15, 2, Mat.WATER);
        }
        for (let i = 0; i < 100; i++) { a.step(); noise.step(); b.step(); }
        expect(a.cells).toEqual(b.cells);
        expect(a.heat).toEqual(b.heat);
        expect(a.value).toEqual(b.value);
        expect(a.totalValue()).toBeCloseTo(100);
    });
});
