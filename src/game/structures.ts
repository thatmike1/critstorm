import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import type { EconomyState } from "./economy";

/** structure identifiers available in the in-storm placement flow. */
export type StructureId = "magnet";

export interface StructureDef {
    id: StructureId;
    name: string;
    desc: string;
    /** one-time essence price charged only after a valid placement. */
    cost: number;
}

/** cells painted as the persistent, pixel-native magnet marker. */
const MAGNET_MARKER = [
    { x: 0, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
] as const;

/** attraction radius in grid cells; broad enough to route a local gold pool. */
export const MAGNET_RADIUS = 36;

/** structure catalogue for one-click placement rather than brush painting. */
export const STRUCTURES: StructureDef[] = [
    {
        id: "magnet",
        name: "Magnet",
        desc: "pulls solid gold toward its field",
        cost: 100,
    },
];

/** return the structure definition for `id`. */
export function structureById(id: StructureId): StructureDef {
    const def = STRUCTURES.find((structure) => structure.id === id);
    if (!def) throw new Error(`unknown structure: ${id}`);
    return def;
}

/** true when `state` has enough essence to place `structure`. */
export function canPlaceStructure(state: EconomyState, structure: StructureDef): boolean {
    return state.essence >= structure.cost;
}

/** true when every marker cell is in-bounds and empty, so placement destroys nothing. */
function hasEmptyMarkerFootprint(sim: Simulation, x: number, y: number): boolean {
    return MAGNET_MARKER.every((offset) => {
        const px = x + offset.x;
        const py = y + offset.y;
        return px >= 0 && py >= 0 && px < sim.W && py < sim.H && sim.cells[py * sim.W + px] === Mat.EMPTY;
    });
}

/**
 * place a magnet structure at one grid coordinate. Its METAL cross is the visible
 * static marker, while the simulation owns the fixed-step gold attraction pass.
 * Invalid terrain or occupied cells are rejected before any essence is charged.
 */
export function placeMagnet(sim: Simulation, state: EconomyState, x: number, y: number): boolean {
    const magnet = structureById("magnet");
    if (!canPlaceStructure(state, magnet) || !hasEmptyMarkerFootprint(sim, x, y)) return false;
    for (const offset of MAGNET_MARKER) sim.paint(x + offset.x, y + offset.y, 0, Mat.METAL);
    state.essence -= magnet.cost;
    sim.addGoldMagnet(x, y, MAGNET_RADIUS);
    return true;
}
