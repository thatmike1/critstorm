import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import type { EconomyState } from "./economy";

/** defense brush identifiers (design §4.2). v0.1 ships stone + water only;
 * ice/wall follow later with the rest of the epic. */
export type BrushId = "stone" | "water";

export interface BrushDef {
    id: BrushId;
    name: string;
    desc: string;
    /** the sim material id this brush paints (see {@link Mat}). */
    mat: number;
    /** essence charged per cell actually painted (design §4.2 per-cell pricing). */
    costPerCell: number;
    /** paint radius in grid cells; a stroke covers a filled disc of this radius. */
    radius: number;
}

/**
 * defense brushes purchasable with essence and painted with the mouse like the
 * powder-lab brushes (design §4.2). costs are flat per cell (not leveled) and sit
 * in the same affordability regime as the crit upgrades (design §6 cost band),
 * rebased so a first stone stroke — a disc of ~28 cells at 1 essence each — is a
 * deliberate purchase reachable around the ~90 s first-surge gate (design §8),
 * not an instant freebie. water quenches molten gold and costs more per cell.
 */
export const BRUSHES: BrushDef[] = [
    {
        id: "stone",
        name: "Stone",
        desc: "cheap baffles — channels gold flows",
        mat: Mat.STONE,
        costPerCell: 1,
        radius: 3,
    },
    {
        id: "water",
        name: "Water",
        desc: "quenches molten gold fast",
        mat: Mat.WATER,
        costPerCell: 3,
        radius: 3,
    },
];

/** look up a brush definition by id. */
export function brushById(id: BrushId): BrushDef {
    const def = BRUSHES.find((b) => b.id === id);
    if (!def) throw new Error(`unknown brush: ${id}`);
    return def;
}

/** true when the player can afford at least one cell of `brush`. */
export function canPaint(state: EconomyState, brush: BrushDef): boolean {
    return state.essence >= brush.costPerCell;
}

/**
 * a cell may be painted over only when it holds no gold value and is not an
 * indestructible wall: painting must never destroy value (design §4.1), so GOLD
 * and MOLTEN_GOLD cells are skipped, and WALL is left intact. cells already
 * holding the brush's own material are skipped too, so holding a stroke still
 * over one spot doesn't drain essence re-painting what is already there.
 */
function paintable(sim: Simulation, x: number, y: number, mat: number): boolean {
    const c = sim.cells[y * sim.W + x];
    if (c === mat) return false;
    if (c === Mat.WALL || c === Mat.GOLD || c === Mat.MOLTEN_GOLD) return false;
    return true;
}

/**
 * paint a filled disc of `brush` centred on grid cell (cx,cy), charging
 * `brush.costPerCell` in essence for each cell actually painted. per-cell pricing
 * (design §4.2): every painted cell is deducted from essence, and painting stops
 * as soon as the next cell can't be afforded — you can't paint what you can't pay
 * for. value is never destroyed: gold/molten-gold and wall cells are skipped (and
 * not charged for). deducts from `state.essence` in place.
 * @returns the number of cells actually painted this stroke.
 */
export function paintBrush(
    sim: Simulation,
    state: EconomyState,
    brush: BrushDef,
    cx: number,
    cy: number
): number {
    const r = brush.radius;
    const r2 = r * r;
    let painted = 0;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) continue;
            if (!paintable(sim, x, y, brush.mat)) continue;
            // can't paint what you can't afford: once a single cell is out of
            // reach, the whole rest of the stroke is too (flat per-cell cost).
            if (state.essence < brush.costPerCell) return painted;
            state.essence -= brush.costPerCell;
            // r=0 paints exactly one vetted cell; matches the eruption spawner's
            // single-cell paint so we reuse the sim's public paint API rather than
            // repainting the whole disc (which would overwrite the value cells we
            // just took care to skip).
            sim.paint(x, y, 0, brush.mat);
            painted++;
        }
    }
    return painted;
}
