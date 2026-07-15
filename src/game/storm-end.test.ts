import { describe, expect, it } from "vitest";
import { buy, createState, creditEssence, upgradeCost } from "./economy";
import { BANK_OUT_CORE_MULTIPLIER, endStorm, markFirstSurge } from "./storm-end";

describe("storm-end accounting (design §5)", () => {
    it("converts cumulative collected essence even after in-storm spending", () => {
        const state = createState();
        const cost = upgradeCost(state, "baseDamage");
        creditEssence(state, 2_000);

        expect(buy(state, "baseDamage")).toBe(true);
        expect(state.essence).toBe(2_000 - cost);
        expect(state.bankedEssence).toBe(2_000);

        const result = endStorm(state, "blow-up");
        expect(result.bankedEssence).toBe(2_000);
        expect(result.rawCores).toBe(2);
        expect(result.cores).toBe(2);
    });

    it("applies the voluntary bank-out bonus after square-root conversion", () => {
        const state = createState();
        creditEssence(state, 500);

        const result = endStorm(state, "bank-out");

        expect(BANK_OUT_CORE_MULTIPLIER).toBe(1.5);
        expect(result.rawCores).toBe(1);
        expect(result.coreMultiplier).toBe(1.5);
        expect(result.cores).toBe(1.5);
    });

    it("gives a blow-up no bank-out bonus while preserving collected essence conversion", () => {
        const state = createState();
        creditEssence(state, 4_500);

        const result = endStorm(state, "blow-up");

        expect(result.rawCores).toBe(3);
        expect(result.coreMultiplier).toBe(1);
        expect(result.cores).toBe(3);
    });

    it("guarantees one core after the first surge, including for a blow-up", () => {
        const state = createState();
        markFirstSurge(state);

        expect(endStorm(state, "blow-up").cores).toBe(1);
        expect(endStorm(state, "bank-out").cores).toBe(1.5);
    });

    it("does not grant the first-surge floor before a storm has reached a surge", () => {
        expect(endStorm(createState(), "blow-up").cores).toBe(0);
    });

    it("does not convert spendable grants that did not pass through collection", () => {
        const state = createState();
        state.essence += 500;

        expect(endStorm(state, "blow-up").rawCores).toBe(0);
    });
});
