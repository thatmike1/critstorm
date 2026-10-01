import { describe, expect, it } from "vitest";
import { FINAL_POT_THRESHOLD, qualifiesForFinale, finaleBursts, FINALE_BURSTS } from "./finale";
import { potState, Surge } from "./surge";
import { createWorld } from "./world";
import { FRONTS } from "./fronts";
import { StormEvents, createStormEventRng } from "./storm-events";
import { Mat } from "../sim/materials";
import { depositEruption, eruptionMass } from "./eruption";
import { createState } from "./economy";
import { executeResolvedStrike } from "./auto-striker";
import { endStorm } from "./storm-end";

describe("a finite Eye", () => {
    it("requires the Eye, the pre-Forge target and an actual max-tier strike", () => {
        const pot = { ...potState(FINAL_POT_THRESHOLD / 1.5, 1), maxTier: 8 };
        expect(qualifiesForFinale("eye", pot)).toBe(true);
        expect(qualifiesForFinale("bog", pot)).toBe(false);
        expect(qualifiesForFinale("eye", { ...pot, value: FINAL_POT_THRESHOLD - 1 })).toBe(false);
        expect(qualifiesForFinale("eye", { ...pot, maxTier: 7 })).toBe(false);
    });
    it("does not mistake an upgraded tier floor for a rolled max tier and clears it each surge", () => {
        const surge = new Surge({}, { tierFloor: 8, criticalTemp: 2000, rng: () => 0 });
        const state = createState();
        surge.addHeat(100);
        executeResolvedStrike(state, surge, () => 0, { onSurgeStart: () => {}, onStrike: () => {} },
            { tier: 1, damage: 100, golden: false });
        expect(surge.pot.maxTier).toBe(1);
        surge.endSurge("bank"); surge.addHeat(100);
        expect(surge.pot.maxTier).toBe(0);
        surge.recordStrike({ tier: 8, damage: 100, golden: false }, 1);
        expect(surge.endSurge("bank").maxTier).toBe(8);
    });
    it("creates a molten floor and constant lightning reproducibly across tick sizes", () => {
        const a = createWorld({ seed: 42, front: FRONTS.eye });
        const b = createWorld({ seed: 42, front: FRONTS.eye });
        expect(a.sim.cells.filter(cell => cell === Mat.LAVA).length).toBe(960);
        const one = new StormEvents(a, createStormEventRng(4));
        const fine = new StormEvents(b, createStormEventRng(4));
        const coarse = one.tick(22);
        const events = Array.from({ length: 44 }, (_, i) => fine.tick((i + 1) * 0.5)).flat();
        expect(coarse).toEqual(events);
        expect(coarse.map(event => event.elapsed)).toEqual([4, 10, 16, 22]);
        expect([...a.sim.cells]).toEqual([...b.sim.cells]);
    });
    it("conserves the final pot across a deterministic screen-wide shower and hazards", () => {
        const world = createWorld({ seed: 42, front: FRONTS.eye });
        const bursts = finaleBursts(320, 180, FINAL_POT_THRESHOLD, createStormEventRng(42));
        expect(bursts).toEqual(finaleBursts(320, 180, FINAL_POT_THRESHOLD, createStormEventRng(42)));
        expect(bursts).toHaveLength(FINALE_BURSTS);
        expect(bursts.reduce((sum, burst) => sum + burst.payout, 0)).toBe(FINAL_POT_THRESHOLD);
        expect(bursts.reduce((sum, burst) => sum + eruptionMass(burst.payout), 0)).toBeLessThanOrEqual(1536);
        let loss = 0; world.sim.setGoldLossListener(event => { loss += event.amount; });
        for (const burst of bursts) depositEruption(world.sim, burst.x, burst.y, burst.payout, 8);
        for (let i = 0; i < 180; i++) world.sim.step();
        expect((world.sim.totalValue() + loss) / FINAL_POT_THRESHOLD).toBeCloseTo(1, 5);
    });
    it("awards the voluntary core bonus at victory without counting uncollected pot value", () => {
        const state = createState(); state.bankedEssence = 2000;
        expect(endStorm(state, "victory").cores).toBe(3);
    });
});
