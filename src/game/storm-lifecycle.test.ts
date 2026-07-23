import { describe, expect, it } from "vitest";
import { Simulation } from "../sim/simulation";
import { buy, creditEssence, upgradeCost } from "./economy";
import { markFirstSurge } from "./storm-end";
import {
    BLOW_UP_UNBANKED_THRESHOLD,
    bustTriggersBlowUp,
    createNextStormState,
    StormLifecycle,
} from "./storm-lifecycle";

describe("storm summary accounting (design §5, against the wave-6a model)", () => {
    it("applies the ×1.5 bank-out bonus to cores after the sqrt", () => {
        const lifecycle = new StormLifecycle();
        const state = createNextStormState();
        creditEssence(state, 2_000); // sqrt(2000/500) = 2 raw cores

        const summary = lifecycle.summarize(state, "bank-out");

        expect(summary.rawCores).toBe(2);
        expect(summary.coreMultiplier).toBe(1.5);
        expect(summary.cores).toBe(3);
        expect(summary.bankedEssence).toBe(2_000);
    });

    it("gives a blow-up the sqrt conversion but no bonus", () => {
        const lifecycle = new StormLifecycle();
        const state = createNextStormState();
        creditEssence(state, 2_000);

        const summary = lifecycle.summarize(state, "blow-up");

        expect(summary.coreMultiplier).toBe(1);
        expect(summary.cores).toBe(2);
    });

    it("converts cumulative collected essence even after in-storm spending", () => {
        const lifecycle = new StormLifecycle();
        const state = createNextStormState();
        creditEssence(state, 2_000);
        const cost = upgradeCost(state, "baseDamage");
        expect(buy(state, "baseDamage")).toBe(true);
        expect(state.essence).toBe(2_000 - cost);

        expect(lifecycle.summarize(state, "blow-up").cores).toBe(2);
    });

    it("keeps the first-surge floor for both endings", () => {
        const lifecycle = new StormLifecycle();
        const state = createNextStormState();
        markFirstSurge(state);

        expect(lifecycle.summarize(state, "blow-up").cores).toBe(1);
        expect(lifecycle.summarize(state, "bank-out").cores).toBe(1.5);
    });

    it("carries the storm's running stats into the summary", () => {
        const lifecycle = new StormLifecycle();
        const sim = new Simulation(16, 16);
        lifecycle.attach(sim);
        lifecycle.recordSurgeStart();
        lifecycle.recordSurgeStart();
        sim.reportLoss(1, 1, 150, "lava");
        sim.reportLoss(2, 2, 50, "bust");
        const state = createNextStormState();
        state.elapsed = 480;

        const summary = lifecycle.summarize(state, "blow-up");

        expect(summary.surgeCount).toBe(2);
        expect(summary.goldLost).toBe(200);
        expect(summary.durationSec).toBe(480);
    });
});

describe("interim blow-up condition (npq.2, pending npq.1 escalation)", () => {
    it("triggers only strictly above the unbanked-gold threshold", () => {
        expect(bustTriggersBlowUp(BLOW_UP_UNBANKED_THRESHOLD)).toBe(false);
        expect(bustTriggersBlowUp(BLOW_UP_UNBANKED_THRESHOLD + 1)).toBe(true);
        expect(bustTriggersBlowUp(0)).toBe(false);
    });

    it("honors a custom threshold override", () => {
        expect(bustTriggersBlowUp(100, 50)).toBe(true);
        expect(bustTriggersBlowUp(100, 100)).toBe(false);
    });
});

describe("next-storm reset (workshop seam)", () => {
    it("builds a fresh economy with nothing carried over", () => {
        const state = createNextStormState();
        expect(state.essence).toBe(0);
        expect(state.bankedEssence).toBe(0);
        expect(state.reachedFirstSurge).toBe(false);
        expect(state.elapsed).toBe(0);
        expect(state.levels).toEqual({ baseDamage: 0, critChance: 0, critMulti: 0, golden: 0 });
    });

    it("grants workshop starting essence as spendable but never as collected", () => {
        const state = createNextStormState({ startingEssence: 750 });
        expect(state.essence).toBe(750);
        expect(state.bankedEssence).toBe(0);

        // a starting grant alone must not convert to cores (design §5).
        const summary = new StormLifecycle().summarize(state, "blow-up");
        expect(summary.rawCores).toBe(0);
    });

    it("ignores non-positive starting grants", () => {
        expect(createNextStormState({ startingEssence: -5 }).essence).toBe(0);
        expect(createNextStormState({ startingEssence: 0 }).essence).toBe(0);
    });
});

describe("lifecycle teardown (the leaked-listener smoke test)", () => {
    it("stops counting losses after detach", () => {
        const lifecycle = new StormLifecycle();
        const sim = new Simulation(16, 16);
        lifecycle.attach(sim);
        sim.reportLoss(1, 1, 100, "acid");
        expect(lifecycle.goldLost).toBe(100);

        lifecycle.detach();
        sim.reportLoss(1, 1, 100, "acid");
        expect(lifecycle.goldLost).toBe(100);
    });

    it("is idempotent and safe before any attach", () => {
        const lifecycle = new StormLifecycle();
        expect(() => {
            lifecycle.detach();
            lifecycle.detach();
        }).not.toThrow();
    });

    it("re-attaching to a new sim releases the old one", () => {
        const lifecycle = new StormLifecycle();
        const oldSim = new Simulation(16, 16);
        const newSim = new Simulation(16, 16);
        lifecycle.attach(oldSim);
        lifecycle.attach(newSim);

        oldSim.reportLoss(1, 1, 999, "lava");
        newSim.reportLoss(1, 1, 25, "lava");
        expect(lifecycle.goldLost).toBe(25);
    });
});
