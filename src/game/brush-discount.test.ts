import { describe, expect, it } from "vitest";
import { Simulation } from "../sim/simulation";
import { createState } from "./economy";
import { brushById, canPaint, paintBrush } from "./brush";
import {
    brushCostWith,
    buyNode,
    createWorkshopState,
    creditCores,
    nodeCost,
    trackById,
    workshopEffects,
    type WorkshopState,
    type WorkshopTrackId,
} from "./workshop";
import { applyPurchasedNodes, deserializeWorkshop, serializeWorkshop } from "./workshop-storage";

// end-to-end guard for the Aegis brush-discount nodes (design §5 aegis track,
// §4.2 per-cell pricing): the multiplier folded by workshopEffects must reach the
// essence actually deducted by a stroke, not just the effects aggregate. the app
// charges paintBrush with brushCostWith(effects, brush) — these tests pin that
// contract so a future caller can't silently go back to the raw costPerCell.

const stone = brushById("stone");
const water = brushById("water");

/** aegis ladder indices of the two brush-cost nodes (Mason's Kit, Diviner's Kit). */
const MASONS_KIT_INDEX = 2;
const DIVINERS_KIT_INDEX = 6;

/** buy the first `count` nodes of a track, funding the wallet exactly as needed. */
function buyNodes(state: WorkshopState, trackId: WorkshopTrackId, count: number): void {
    const track = trackById(trackId);
    for (let i = 0; i < count; i++) {
        creditCores(state, nodeCost(track, i));
        expect(buyNode(state, trackId)).toBe(true);
    }
}

/** paint one stroke on a fresh grid at the supplied per-cell cost; report spend. */
function strokeSpend(costPerCell: number, brush = stone): { painted: number; spent: number } {
    const sim = new Simulation(40, 30);
    const state = createState();
    state.essence = 1000;
    const painted = paintBrush(sim, state, brush, costPerCell, 20, 15);
    return { painted, spent: 1000 - state.essence };
}

describe("aegis brush discount reaches the painting path", () => {
    it("makes an identical stone stroke cost 20% less once Mason's Kit is bought", () => {
        const fresh = workshopEffects(createWorkshopState());
        const bought = createWorkshopState();
        buyNodes(bought, "aegis", MASONS_KIT_INDEX + 1);
        const fx = workshopEffects(bought);

        expect(brushCostWith(fresh, stone)).toBe(6);
        expect(brushCostWith(fx, stone)).toBeCloseTo(4.8, 10);

        const base = strokeSpend(brushCostWith(fresh, stone));
        const discounted = strokeSpend(brushCostWith(fx, stone));

        // same 29-cell disc either way: only the price per cell moves.
        expect(base.painted).toBe(29);
        expect(discounted.painted).toBe(29);
        expect(base.spent).toBeCloseTo(174, 10);
        expect(discounted.spent).toBeCloseTo(139.2, 10);
        expect(discounted.spent).toBeCloseTo(base.spent * 0.8, 10);
    });

    it("discounts water only once Diviner's Kit is reached, leaving stone's discount intact", () => {
        const masonOnly = createWorkshopState();
        buyNodes(masonOnly, "aegis", MASONS_KIT_INDEX + 1);
        const masonFx = workshopEffects(masonOnly);
        // Mason's Kit is stone-only: a water stroke still pays full price.
        expect(strokeSpend(brushCostWith(masonFx, water), water).spent).toBeCloseTo(203, 10);

        const both = createWorkshopState();
        buyNodes(both, "aegis", DIVINERS_KIT_INDEX + 1);
        const bothFx = workshopEffects(both);
        expect(strokeSpend(brushCostWith(bothFx, water), water).spent).toBeCloseTo(162.4, 10);
        expect(strokeSpend(brushCostWith(bothFx, stone)).spent).toBeCloseTo(139.2, 10);
    });

    it("keeps per-cell semantics: a partial purse still stops the stroke mid-disc", () => {
        const bought = createWorkshopState();
        buyNodes(bought, "aegis", MASONS_KIT_INDEX + 1);
        const cost = brushCostWith(workshopEffects(bought), stone);

        const sim = new Simulation(40, 30);
        const state = createState();
        // exactly three discounted cells' worth — the fourth must not be painted.
        state.essence = 3 * cost;
        const painted = paintBrush(sim, state, stone, cost, 20, 15);
        expect(painted).toBe(3);
        expect(state.essence).toBeCloseTo(0, 10);
    });

    it("lets the discount open the affordability gate the HUD reads", () => {
        const fresh = workshopEffects(createWorkshopState());
        const bought = createWorkshopState();
        buyNodes(bought, "aegis", MASONS_KIT_INDEX + 1);
        const fx = workshopEffects(bought);

        const state = createState();
        // 5 essence: short of the 6/cell base price, enough for one 4.8/cell cell.
        state.essence = 5;
        expect(canPaint(state, brushCostWith(fresh, stone))).toBe(false);
        expect(canPaint(state, brushCostWith(fx, stone))).toBe(true);
    });
});

describe("saved profiles with the aegis brush nodes already bought", () => {
    it("restores the discount from a persisted workshop payload", () => {
        const bought = createWorkshopState();
        buyNodes(bought, "aegis", MASONS_KIT_INDEX + 1);
        const restored = deserializeWorkshop(serializeWorkshop(bought));

        expect(restored.purchased.aegis).toBe(MASONS_KIT_INDEX + 1);
        expect(strokeSpend(brushCostWith(workshopEffects(restored), stone)).spent).toBeCloseTo(
            139.2,
            10
        );
    });

    it("restores the discount from profile node ids", () => {
        const state = createWorkshopState();
        applyPurchasedNodes(state, ["aegis:0", "aegis:1", "aegis:2"]);
        expect(strokeSpend(brushCostWith(workshopEffects(state), stone)).spent).toBeCloseTo(
            139.2,
            10
        );
    });

    it("tolerates a hand-written legacy payload that only carries purchase counts", () => {
        const restored = deserializeWorkshop(JSON.stringify({ cores: 0, purchased: { aegis: 7 } }));
        expect(restored.purchased.aegis).toBe(7);
        const fx = workshopEffects(restored);
        expect(strokeSpend(brushCostWith(fx, stone)).spent).toBeCloseTo(139.2, 10);
        expect(strokeSpend(brushCostWith(fx, water), water).spent).toBeCloseTo(162.4, 10);
    });
});
