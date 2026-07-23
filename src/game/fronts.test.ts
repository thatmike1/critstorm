import { afterEach, describe, expect, it } from "vitest";
import {
    FRONTS,
    applyPayoutModifier,
    frontFromQuery,
    getSelectedFront,
    setSelectedFront,
} from "./fronts";
import { chooseStormEventType, createStormEventRng } from "./storm-events";

// front-definition tests (design §4.5): the flats and the bog exist as data,
// the payout/risk knobs apply as plain multipliers, the selection seam works,
// and the debug query param parses.

describe("front definitions", () => {
    it("ships the flats and the bog", () => {
        expect(FRONTS.flats.id).toBe("flats");
        expect(FRONTS.bog.id).toBe("bog");
    });

    it("gives the flats open ground: no terrain hooks, neutral modifiers", () => {
        const { terrain, modifiers } = FRONTS.flats;
        expect(terrain.oilPockets).toBeNull();
        expect(terrain.plantPatches).toBeNull();
        expect(modifiers.payoutMult).toBe(1);
        expect(modifiers.riskMult).toBe(1);
    });

    it("gives the bog oil pockets, plant patches, and hot risk x reward knobs", () => {
        const { terrain, modifiers } = FRONTS.bog;
        expect(terrain.oilPockets).not.toBeNull();
        expect(terrain.plantPatches).not.toBeNull();
        expect(modifiers.payoutMult).toBeGreaterThan(1);
        expect(modifiers.riskMult).toBeGreaterThan(1);
    });

    it("rains gold more often in the bog than on the flats", () => {
        expect(FRONTS.bog.eventWeights["gold-rain"]).toBeGreaterThan(
            FRONTS.flats.eventWeights["gold-rain"]
        );
    });
});

describe("applyPayoutModifier", () => {
    it("is the identity on the flats", () => {
        expect(applyPayoutModifier(FRONTS.flats, 240)).toBe(240);
    });

    it("scales a payout by the bog's reward knob", () => {
        expect(applyPayoutModifier(FRONTS.bog, 100)).toBeCloseTo(
            100 * FRONTS.bog.modifiers.payoutMult
        );
    });
});

describe("front selection seam", () => {
    afterEach(() => setSelectedFront("flats"));

    it("defaults to the flats", () => {
        expect(getSelectedFront().id).toBe("flats");
    });

    it("returns the front picked by setSelectedFront", () => {
        setSelectedFront("bog");
        expect(getSelectedFront().id).toBe("bog");
    });
});

describe("frontFromQuery", () => {
    it("parses ?front=bog", () => {
        expect(frontFromQuery("?front=bog")).toBe("bog");
        expect(frontFromQuery("?front=flats")).toBe("flats");
    });

    it("ignores other params around the front", () => {
        expect(frontFromQuery("?debug=1&front=bog&x=2")).toBe("bog");
    });

    it("returns null when absent or unknown", () => {
        expect(frontFromQuery("")).toBeNull();
        expect(frontFromQuery("?debug=1")).toBeNull();
        expect(frontFromQuery("?front=eye")).toBeNull();
        expect(frontFromQuery("?front=")).toBeNull();
    });
});

describe("chooseStormEventType with front weights", () => {
    /** count picks per event type over `n` draws from a fresh seeded rng. */
    function tally(weights: (typeof FRONTS)["flats"]["eventWeights"], n: number) {
        const rng = createStormEventRng(1234);
        const counts = {
            "gold-rain": 0,
            "acid-drizzle": 0,
            "lava-fissure": 0,
            "lightning-front": 0,
        };
        for (let i = 0; i < n; i++) counts[chooseStormEventType(rng, weights)]++;
        return counts;
    }

    it("follows the flats mix: hazards favoured over the jackpot", () => {
        const counts = tally(FRONTS.flats.eventWeights, 4000);
        expect(counts["acid-drizzle"]).toBeGreaterThan(counts["gold-rain"]);
        expect(counts["lightning-front"]).toBeLessThan(counts["lava-fissure"]);
    });

    it("shifts toward gold rain under the bog mix", () => {
        const flats = tally(FRONTS.flats.eventWeights, 4000);
        const bog = tally(FRONTS.bog.eventWeights, 4000);
        expect(bog["gold-rain"]).toBeGreaterThan(flats["gold-rain"]);
    });

    it("is deterministic for a given seed and weights", () => {
        const a = tally(FRONTS.bog.eventWeights, 500);
        const b = tally(FRONTS.bog.eventWeights, 500);
        expect(a).toEqual(b);
    });
});
