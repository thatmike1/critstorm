import { describe, expect, it } from "vitest";
import { COLLECTOR_BASE_FEE, createState } from "./economy";
import { AMBIENT_HEAT_COEFF, CORE_CRITICAL_TEMP } from "./surge";
import {
    ambientCoeffWith,
    applyStormStart,
    baselineEffects,
    buyNode,
    canBuyNode,
    collectorFeeWith,
    createWorkshopState,
    creditCores,
    criticalTempWith,
    nodeCost,
    trackById,
    workshopEffects,
    WORKSHOP_COST_GROWTH,
    WORKSHOP_TRACKS,
    type WorkshopState,
    type WorkshopTrackId,
} from "./workshop";
import { deserializeWorkshop, serializeWorkshop } from "./workshop-storage";

/** buy every node of a track, funding the wallet as needed. */
function buyOut(state: WorkshopState, trackId: WorkshopTrackId): void {
    const track = trackById(trackId);
    for (let i = 0; i < track.nodes.length; i++) {
        creditCores(state, nodeCost(track, i));
        expect(buyNode(state, trackId)).toBe(true);
    }
}

describe("workshop node tables (design §5)", () => {
    it("ships ~15 nodes on every track", () => {
        expect(WORKSHOP_TRACKS).toHaveLength(4);
        for (const track of WORKSHOP_TRACKS) {
            expect(track.nodes).toHaveLength(15);
        }
    });

    it("grows node costs geometrically at ~1.6 per node", () => {
        expect(WORKSHOP_COST_GROWTH).toBe(1.6);
        for (const track of WORKSHOP_TRACKS) {
            expect(nodeCost(track, 0)).toBe(track.baseCost);
            for (let i = 0; i < track.nodes.length; i++) {
                const exact = track.baseCost * Math.pow(track.costGrowth, i);
                expect(nodeCost(track, i)).toBe(Math.ceil(exact));
            }
            // deep in the ladder (past ceil noise) the step ratio approaches 1.6.
            const deepRatio = nodeCost(track, 14) / nodeCost(track, 13);
            expect(deepRatio).toBeGreaterThan(1.5);
            expect(deepRatio).toBeLessThan(1.7);
        }
    });

    it("keeps every node's cost strictly increasing along its ladder", () => {
        for (const track of WORKSHOP_TRACKS) {
            for (let i = 1; i < track.nodes.length; i++) {
                expect(nodeCost(track, i)).toBeGreaterThanOrEqual(nodeCost(track, i - 1));
            }
        }
    });
});

describe("workshop purchases", () => {
    it("buys strictly in ladder order and deducts the core cost", () => {
        const state = createWorkshopState();
        const forge = trackById("forge");
        creditCores(state, 10);

        expect(buyNode(state, "forge")).toBe(true);
        expect(state.purchased.forge).toBe(1);
        expect(state.cores).toBe(10 - nodeCost(forge, 0));

        expect(buyNode(state, "forge")).toBe(true);
        expect(state.purchased.forge).toBe(2);
        expect(state.cores).toBe(10 - nodeCost(forge, 0) - nodeCost(forge, 1));
    });

    it("refuses an unaffordable node without mutating state", () => {
        const state = createWorkshopState();
        creditCores(state, trackById("front").baseCost - 1);
        const before = state.cores;

        expect(canBuyNode(state, "front")).toBe(false);
        expect(buyNode(state, "front")).toBe(false);
        expect(state.cores).toBe(before);
        expect(state.purchased.front).toBe(0);
    });

    it("refuses to buy past the end of a ladder", () => {
        const state = createWorkshopState();
        buyOut(state, "vault");
        creditCores(state, 1_000_000);

        expect(canBuyNode(state, "vault")).toBe(false);
        expect(buyNode(state, "vault")).toBe(false);
        expect(state.purchased.vault).toBe(15);
    });

    it("ignores non-positive and non-finite core credits", () => {
        const state = createWorkshopState();
        expect(creditCores(state, 0)).toBe(0);
        expect(creditCores(state, -3)).toBe(0);
        expect(creditCores(state, Number.NaN)).toBe(0);
        expect(creditCores(state, Number.POSITIVE_INFINITY)).toBe(0);
        expect(state.cores).toBe(0);
        expect(creditCores(state, 1.5)).toBe(1.5);
        expect(state.cores).toBe(1.5);
    });
});

describe("workshop effect aggregation", () => {
    it("starts at the no-purchases baseline", () => {
        const fx = workshopEffects(createWorkshopState());
        expect(fx).toEqual(baselineEffects());
        expect(collectorFeeWith(fx)).toBe(COLLECTOR_BASE_FEE);
        expect(criticalTempWith(fx)).toBe(CORE_CRITICAL_TEMP);
        expect(ambientCoeffWith(fx)).toBe(AMBIENT_HEAT_COEFF);
    });

    it("aggregates only purchased nodes, in ladder order", () => {
        const state = createWorkshopState();
        creditCores(state, 100);
        // forge nodes 0..2: +2 base damage, +1 crit chance, eruption ×1.1.
        buyNode(state, "forge");
        buyNode(state, "forge");
        buyNode(state, "forge");
        const fx = workshopEffects(state);

        expect(fx.startingLevels.baseDamage).toBe(2);
        expect(fx.startingLevels.critChance).toBe(1);
        expect(fx.startingLevels.critMulti).toBe(0);
        expect(fx.eruptionValueMultiplier).toBeCloseTo(1.1, 10);
    });

    it("folds a fully bought forge into starting levels and eruption value", () => {
        const state = createWorkshopState();
        buyOut(state, "forge");
        const fx = workshopEffects(state);

        expect(fx.startingLevels).toEqual({
            baseDamage: 10,
            critChance: 4,
            critMulti: 10,
            golden: 3,
        });
        expect(fx.eruptionValueMultiplier).toBeCloseTo(1.1 * 1.1 * 1.15 * 1.25, 10);
    });

    it("folds vault into fee reduction, starting essence, and later-consumed drains", () => {
        const state = createWorkshopState();
        buyOut(state, "vault");
        const fx = workshopEffects(state);

        expect(fx.collectorFeeReduction).toBeCloseTo(0.23, 10);
        expect(collectorFeeWith(fx)).toBeCloseTo(COLLECTOR_BASE_FEE - 0.23, 10);
        expect(fx.startingEssence).toBe(25 + 50 + 100 + 200 + 400 + 800);
        expect(fx.extraCollectors).toBe(2);
    });

    it("never lets vault push the collector fee below zero", () => {
        const fx = baselineEffects();
        fx.collectorFeeReduction = 5;
        expect(collectorFeeWith(fx)).toBe(0);
    });

    it("folds aegis into critical temp, ambient resistance, and starting brushes", () => {
        const state = createWorkshopState();
        buyOut(state, "aegis");
        const fx = workshopEffects(state);

        expect(fx.criticalTempBonus).toBe(30 + 30 + 40 + 40 + 50 + 50 + 60 + 80);
        expect(criticalTempWith(fx)).toBe(CORE_CRITICAL_TEMP + 380);
        expect(fx.ambientHeatMultiplier).toBeCloseTo(0.95 * 0.95 * 0.9 * 0.9 * 0.85, 10);
        expect(ambientCoeffWith(fx)).toBeCloseTo(AMBIENT_HEAT_COEFF * fx.ambientHeatMultiplier, 10);
        expect(fx.startingBrushes).toEqual(["stone", "water"]);
    });

    it("folds front into unlocks, event modifiers, and the surge tier floor", () => {
        const state = createWorkshopState();
        buyOut(state, "front");
        const fx = workshopEffects(state);

        expect(fx.unlockedFronts).toBe(4);
        expect(fx.surgeTierFloor).toBe(5);
        expect(fx.eventModifiers).toHaveLength(8);
        const goldRain = fx.eventModifiers.filter((m) => m.event === "gold-rain");
        expect(goldRain.map((m) => m.severityMultiplier)).toEqual([1.25, 1.25, 1.5, 2]);
    });
});

describe("storm-start application", () => {
    it("applies starting levels and grants spendable-only essence", () => {
        const state = createWorkshopState();
        creditCores(state, 100);
        buyNode(state, "forge"); // +2 base damage start
        buyNode(state, "vault"); // fee node
        buyNode(state, "vault"); // +25 starting essence
        const fx = workshopEffects(state);

        const economy = createState();
        applyStormStart(economy, fx);

        expect(economy.levels.baseDamage).toBe(2);
        expect(economy.essence).toBe(25);
        // the meta grant is NOT collected essence: it must never convert to cores.
        expect(economy.bankedEssence).toBe(0);
    });
});

describe("workshop persistence", () => {
    it("round-trips state through serialize/deserialize", () => {
        const state = createWorkshopState();
        creditCores(state, 42.5);
        buyNode(state, "forge");
        buyNode(state, "aegis");

        const restored = deserializeWorkshop(serializeWorkshop(state));
        expect(restored).toEqual(state);
    });

    it("falls back to a fresh state on null, garbage, or non-object input", () => {
        expect(deserializeWorkshop(null)).toEqual(createWorkshopState());
        expect(deserializeWorkshop("not json {")).toEqual(createWorkshopState());
        expect(deserializeWorkshop("42")).toEqual(createWorkshopState());
    });

    it("sanitizes corrupt fields and clamps purchase counts to ladder length", () => {
        const restored = deserializeWorkshop(
            JSON.stringify({
                cores: -5,
                purchased: { forge: 99, vault: 2.5, aegis: "lots", front: 3 },
            })
        );
        expect(restored.cores).toBe(0);
        expect(restored.purchased.forge).toBe(15);
        expect(restored.purchased.vault).toBe(0);
        expect(restored.purchased.aegis).toBe(0);
        expect(restored.purchased.front).toBe(3);
    });
});
