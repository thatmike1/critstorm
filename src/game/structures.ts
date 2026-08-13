import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import { AUTO_STRIKER_PURCHASE_COST } from "./auto-striker";
import type { EconomyState } from "./economy";

/** structure identifiers available in the in-storm placement flow. */
export type StructureId = "auto-striker" | "magnet" | "sprinkler" | "lightning-rod";

/** structures with one installed instance per storm. */
export type SingularStructureId = "sprinkler" | "lightning-rod";

/** fixed grid position for a placed structure. */
export interface StructurePosition {
    readonly x: number;
    readonly y: number;
}

/** fixed-step state for the singular sprinkler. */
export interface SprinklerState extends StructurePosition {
    elapsedSec: number;
}

/** position state for the singular lightning rod. */
export interface LightningRodState extends StructurePosition {}

/** result of one sprinkler scheduler tick. */
export interface SprinklerTickResult {
    readonly cycles: number;
    readonly sprayedCells: readonly StructurePosition[];
    readonly spent: number;
}

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
        id: "auto-striker",
        name: "Auto-Striker",
        desc: "timer-fired strikes with independent aim",
        cost: AUTO_STRIKER_PURCHASE_COST,
    },
    {
        id: "magnet",
        name: "Magnet",
        desc: "pulls solid gold toward its field",
        cost: 100,
    },
    {
        id: "sprinkler",
        name: "Sprinkler",
        desc: "sprays water every 4s · 3 essence per cell",
        cost: 180,
    },
    {
        id: "lightning-rod",
        name: "Lightning Rod",
        desc: "turns each lightning front into a max-tier strike",
        cost: 1000,
    },
];

/** singular structures use a metal marker and cannot be placed twice per storm. */
const placedSingular = new WeakMap<Simulation, Set<StructureId>>();

/** sprinkler spray cadence and fixed operating price. */
export const SPRINKLER_INTERVAL_SEC = 4;
export const SPRINKLER_WATER_COST = 3;

/** offsets above a sprinkler's marker, in deterministic spray order. */
export const SPRINKLER_OFFSETS: readonly StructurePosition[] = [
    { x: -2, y: -2 },
    { x: -1, y: -3 },
    { x: 0, y: -3 },
    { x: 1, y: -3 },
    { x: 2, y: -2 },
];

/** distinct visible marker footprints for the singular structures. */
export const SINGULAR_MARKER_OFFSETS: Readonly<Record<SingularStructureId, readonly StructurePosition[]>> = {
    sprinkler: [
        { x: 0, y: 0 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
    ],
    "lightning-rod": [
        { x: 0, y: 0 },
        { x: 0, y: -1 },
        { x: 0, y: -2 },
        { x: -1, y: -2 },
        { x: 1, y: -2 },
    ],
};

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
        return (
            px >= 0 &&
            py >= 0 &&
            px < sim.W &&
            py < sim.H &&
            sim.cells[py * sim.W + px] === Mat.EMPTY
        );
    });
}

/** return true when a singular structure has already been installed in this sim. */
function alreadyPlaced(sim: Simulation, id: StructureId): boolean {
    return placedSingular.get(sim)?.has(id) ?? false;
}

/** record a singular structure after its marker has been painted successfully. */
function markPlaced(sim: Simulation, id: StructureId): void {
    const ids = placedSingular.get(sim) ?? new Set<StructureId>();
    ids.add(id);
    placedSingular.set(sim, ids);
}

/** return whether an id consumes a singular structure slot. */
export function isSingularStructure(id: StructureId): id is SingularStructureId {
    return id === "sprinkler" || id === "lightning-rod";
}

/** return whether a singular structure is already installed in the supplied state. */
export function isStructureInstalled(
    id: StructureId,
    installed: Readonly<Record<SingularStructureId, boolean>>
): boolean {
    return isSingularStructure(id) && installed[id];
}

/** place a distinct metal marker after checking its footprint, value, cost, and singularity. */
function placeSingular(
    sim: Simulation,
    state: EconomyState,
    id: "sprinkler" | "lightning-rod",
    x: number,
    y: number
): boolean {
    const def = structureById(id);
    if (alreadyPlaced(sim, id) || !canPlaceStructure(state, def)) return false;
    const footprint = SINGULAR_MARKER_OFFSETS[id];
    for (const offset of footprint) {
        const px = x + offset.x;
        const py = y + offset.y;
        if (
            px < 0 ||
            py < 0 ||
            px >= sim.W ||
            py >= sim.H ||
            sim.cells[py * sim.W + px] !== Mat.EMPTY ||
            sim.getValue(px, py) !== 0
        ) {
            return false;
        }
    }
    for (const offset of footprint) sim.paint(x + offset.x, y + offset.y, 0, Mat.METAL);
    state.essence -= def.cost;
    markPlaced(sim, id);
    return true;
}

/** place the singular sprinkler and return its fixed-step scheduler state. */
export function placeSprinkler(
    sim: Simulation,
    state: EconomyState,
    x: number,
    y: number
): SprinklerState | null {
    return placeSingular(sim, state, "sprinkler", x, y) ? { x, y, elapsedSec: 0 } : null;
}

/** place the singular lightning rod and return its event-observer state. */
export function placeLightningRod(
    sim: Simulation,
    state: EconomyState,
    x: number,
    y: number
): LightningRodState | null {
    return placeSingular(sim, state, "lightning-rod", x, y) ? { x, y } : null;
}

/** true when sprinkler spray may replace the current non-value material. */
function sprinklerEligible(sim: Simulation, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) return false;
    const mat = sim.cells[y * sim.W + x];
    return (
        mat !== Mat.WALL &&
        mat !== Mat.GOLD &&
        mat !== Mat.MOLTEN_GOLD &&
        mat !== Mat.WATER &&
        mat !== Mat.METAL &&
        sim.getValue(x, y) === 0
    );
}

/** advance the sprinkler in fixed time, charging and painting each cycle atomically. */
export function tickSprinkler(
    sim: Simulation,
    state: SprinklerState,
    economy: EconomyState,
    dtSec: number
): SprinklerTickResult {
    if (!(dtSec > 0) || !Number.isFinite(dtSec)) {
        return { cycles: 0, sprayedCells: [], spent: 0 };
    }
    state.elapsedSec += dtSec;
    const sprayedCells: StructurePosition[] = [];
    let cycles = 0;
    let spent = 0;
    while (state.elapsedSec >= SPRINKLER_INTERVAL_SEC) {
        state.elapsedSec -= SPRINKLER_INTERVAL_SEC;
        cycles++;
        const eligible = SPRINKLER_OFFSETS.filter(({ x, y }) =>
            sprinklerEligible(sim, state.x + x, state.y + y)
        );
        const cost = eligible.length * SPRINKLER_WATER_COST;
        if (cost > economy.essence) continue;
        for (const offset of eligible) {
            const x = state.x + offset.x;
            const y = state.y + offset.y;
            sim.paint(x, y, 0, Mat.WATER);
            sprayedCells.push({ x, y });
        }
        economy.essence -= cost;
        spent += cost;
    }
    return { cycles, sprayedCells, spent };
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
