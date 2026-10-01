import { describe, expect, it } from "vitest";
import { createWorld } from "./world";
import { createState } from "./economy";
import { createRouting, placeCollector, buyEfficiency, coolantHeadroom } from "./routing";
import { brushUnlocked, brushById, paintBrush } from "./brush";
import { Mat } from "../sim/materials";
import { Surge, SURGE_HEAT_THRESHOLD } from "./surge";
import { StormEvents, createStormEventRng, triggerStormEvent } from "./storm-events";
import { depositEruption, eruptionTemperature } from "./eruption";

describe("paid routing", () => {
    it("opens two permanent side routes and rejects an overlapping purchase without charge", () => {
        const world = createWorld({ seed: 3 });
        const routing = createRouting(world, 0.3, 2);
        const state = createState(); state.essence = 1000;
        expect(routing.collectors).toHaveLength(3);
        expect(placeCollector(world, state, routing, world.core.x)).toBe(false);
        expect(state.essence).toBe(1000);
        expect(placeCollector(world, state, routing, 100)).toBe(true);
        expect(state.essence).toBe(760);
    });
    it("charges for efficiency and gives new drains the improved rate without crediting core income", () => {
        const world = createWorld({ seed: 3 });
        const routing = createRouting(world, 0.3, 0);
        const state = createState(); state.essence = 1000;
        expect(buyEfficiency(state, routing)).toBe(true);
        expect(routing.collectors[0].fee).toBeCloseTo(0.27);
        placeCollector(world, state, routing, 60);
        expect(routing.collectors[1].fee).toBeCloseTo(0.27);
        expect(state.bankedEssence).toBe(0);
    });
});

describe("earned, mortal defenses", () => {
    it("unlocks advanced materials by collection or permanent Aegis strength", () => {
        expect(brushUnlocked("ice", 499, 0)).toBe(false);
        expect(brushUnlocked("ice", 500, 0)).toBe(true);
        expect(brushUnlocked("ice", 0, 60)).toBe(true);
        expect(brushUnlocked("wall", 4999, 0)).toBe(false);
        expect(brushUnlocked("wall", 0, 140)).toBe(true);
    });
    it("protects wealth and machine markers from both advanced brushes", () => {
        const world = createWorld({ seed: 3 });
        const { sim, core } = world;
        sim.paint(core.x, core.y, 0, Mat.GOLD); sim.addValue(core.x, core.y, 500);
        sim.paint(core.x + 1, core.y, 0, Mat.METAL);
        const state = createState(); state.essence = 10000;
        for (const id of ["ice", "wall"] as const) {
            paintBrush(sim, state, brushById(id), brushById(id).costPerCell, core.x, core.y);
            expect(sim.totalValue()).toBe(500);
            expect(sim.cells[core.y * sim.W + core.x + 1]).toBe(Mat.METAL);
        }
    });
    it("adds nearby coolant headroom, removes it when the water boils, and can bust on shield loss", () => {
        const world = createWorld({ seed: 3 });
        const { sim, core } = world;
        sim.paint(core.x + 3, core.y, 1, Mat.ICE);
        expect(coolantHeadroom(world)).toBe(50);
        sim.paint(core.x + 3, core.y, 1, Mat.STEAM);
        expect(coolantHeadroom(world)).toBe(0);
        const exits: string[] = [];
        const surge = new Surge({ onEnd: reason => exits.push(reason) });
        surge.setCoolingCapacity(100); surge.addHeat(SURGE_HEAT_THRESHOLD);
        surge.addExternalCoreHeat(650);
        expect(surge.active).toBe(true);
        surge.setCoolingCapacity(0);
        expect(exits).toEqual(["bust"]);
    });
});

describe("real event upgrades", () => {
    it("scales gold rain value at the source and conserves the larger shower", () => {
        const a = createWorld({ seed: 3 }), b = createWorld({ seed: 3 });
        const ordinary = triggerStormEvent(a, "gold-rain", 1, () => 0.5);
        const upgraded = triggerStormEvent(b, "gold-rain", 1, () => 0.5, 1.25);
        expect(upgraded.erupted).toBeGreaterThan(ordinary.erupted);
        expect(b.sim.totalValue()).toBeCloseTo(upgraded.erupted);
    });
    it("forecasts the event it actually dispatches and consumes permanent severity upgrades", () => {
        const a = new StormEvents(createWorld({ seed: 3 }), createStormEventRng(0));
        const b = new StormEvents(createWorld({ seed: 3 }), createStormEventRng(0),
            [{ event: "gold-rain", severityMultiplier: 2 }]);
        const next = a.forecast;
        const normal = a.tick(next.at)[0], rich = b.tick(next.at)[0];
        expect(normal.type).toBe(next.type);
        expect(next.type).toBe("gold-rain");
        expect(rich.erupted).toBeGreaterThan(normal.erupted);
    });
    it("keeps blocked projectile shares in the loss ledger instead of disappearing", () => {
        const world = createWorld({ seed: 3 });
        let lost = 0; world.sim.setGoldLossListener(event => { lost += event.amount; });
        world.sim.paint(20, 20, 2, Mat.WALL);
        const deposited = depositEruption(world.sim, 20, 20, 1000);
        world.sim.reportLoss(20, 20, 1000 - deposited, "blocked");
        expect(world.sim.totalValue() + lost).toBeCloseTo(1000);
    });
});

describe("tier heat reaches physical gold", () => {
    it("keeps starter strikes cool and jackpot strikes hot without changing their value", () => {
        const a = createWorld({ seed: 3 }), b = createWorld({ seed: 3 });
        depositEruption(a.sim, 30, 20, 1000, 0);
        depositEruption(b.sim, 30, 20, 1000, 8);
        expect(a.sim.heat[20 * a.sim.W + 30]).toBe(eruptionTemperature(0));
        expect(b.sim.heat[20 * b.sim.W + 30]).toBe(eruptionTemperature(8));
        expect(a.sim.totalValue()).toBeCloseTo(b.sim.totalValue());
        b.sim.step();
        const hotGold = [...b.sim.value].some((value, index) => value > 0 && b.sim.heat[index] > 150);
        expect(hotGold).toBe(true);
    });
});

describe("edge deposits keep old wealth", () => {
    it("conserves repeated corner impacts before and after solidification", () => {
        const world = createWorld({ seed: 3 });
        depositEruption(world.sim, 0, 0, 1000, 0);
        depositEruption(world.sim, 0, 0, 2000, 0);
        expect(world.sim.totalValue()).toBeCloseTo(3000, 2);
        world.sim.step();
        depositEruption(world.sim, 0, 0, 3000, 0);
        expect(world.sim.totalValue()).toBeCloseTo(6000, 2);
    });
});
