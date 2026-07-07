import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";

// default grid size for a storm world (see design.md §7 — 320x180 upscaled).
const DEFAULT_W = 320;
const DEFAULT_H = 180;

// floor tuning for the "flats" front (design.md §4.5): open ground, a solid
// stone body capped by a thin sand surface, with mild deterministic height
// variation. defaults chosen so the floor sits in the lower ~35% of the grid,
// leaving a tall air column for eruptions and the strike zone above it.
const DEFAULT_FLOOR_LEVEL = 0.72; // surface baseline as a fraction of H from the top
const DEFAULT_VARIATION = 6; // max cells the surface deviates from the baseline
const DEFAULT_SAND_CAP = 4; // rows of SAND capping the STONE body

// core + strike-zone defaults. the core sits in open air above the floor and the
// strike zone is the clickable disc around it (design.md §2 — "click anywhere in
// the strike zone around the storm core").
const DEFAULT_CORE_ABOVE_FLOOR = 62; // cells between the core and the floor surface
const DEFAULT_STRIKE_RADIUS = 44;

/** immutable 2d grid coordinate. */
export interface Vec2 {
    readonly x: number;
    readonly y: number;
}

/** the clickable disc around the storm core; `contains` is inclusive of the edge. */
export interface StrikeZone {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    /** true when grid point (x,y) lies within `radius` cells of the core centre. */
    contains(x: number, y: number): boolean;
}

/** tuning knobs for {@link createWorld}; every field has a sensible default. */
export interface WorldOptions {
    /** deterministic seed for the terrain height variation. same seed -> same floor. */
    seed?: number;
    /** grid width in cells (default 320). */
    width?: number;
    /** grid height in cells (default 180). */
    height?: number;
    /** floor surface baseline as a fraction of height from the top (default 0.72). */
    floorLevel?: number;
    /** max cells the surface deviates above/below the baseline (default 6). */
    variation?: number;
    /** rows of SAND capping the STONE floor body (default 4). */
    sandCap?: number;
    /** cells between the core and the floor surface below it (default 62). */
    coreAboveFloor?: number;
    /** radius of the clickable strike zone in cells (default 44). */
    strikeRadius?: number;
}

/**
 * a bootstrapped storm world: the headless {@link Simulation} with terrain
 * already painted, the storm-core position, and the strike zone around it.
 * consumed by the pixi render layer and the eruption spawner in wave 3.
 */
export interface World {
    /** the headless falling-sand simulation, pre-seeded with the terrain floor. */
    readonly sim: Simulation;
    /** storm-core position in grid coords; sits in open air above the floor. */
    readonly core: Vec2;
    /** clickable region around the core. */
    readonly strikeZone: StrikeZone;
    /** the y of the topmost solid cell for column `x` (the floor surface). */
    floorHeightAt(x: number): number;
}

/**
 * mulberry32 — a tiny deterministic prng. returns a function yielding floats in
 * [0,1). used for the terrain height walk so the same seed reproduces the same
 * floor, independent of the sim's own Math.random color dithering.
 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * build a deterministic surface height map: one topmost-solid y per column.
 * a bounded random walk with per-column steps of at most 1 keeps the slope
 * shallow, which matters physically — a step >1 would leave a surface SAND cell
 * with an empty diagonal below it and let the powder slide on the first step.
 * a mild pull toward the baseline keeps the walk from drifting to the clamp.
 */
function buildHeightMap(
    width: number,
    baseline: number,
    variation: number,
    rand: () => number
): Int32Array {
    const surface = new Int32Array(width);
    const lo = baseline - variation;
    const hi = baseline + variation;
    let y = baseline;
    for (let x = 0; x < width; x++) {
        surface[x] = y;
        // bias the next step gently back toward the baseline so the walk stays
        // centred instead of wandering to (and sticking at) a clamp bound.
        const bias = y > baseline ? 0.62 : y < baseline ? 0.38 : 0.5;
        const r = rand();
        const step = r < bias * 0.5 ? -1 : r < bias * 0.5 + 0.5 ? 0 : 1;
        y += step;
        if (y < lo) y = lo;
        else if (y > hi) y = hi;
    }
    return surface;
}

/**
 * paint the terrain floor into the sim: every cell from a column's surface down
 * to the bottom is solid (SAND for the top `sandCap` rows, STONE below). written
 * directly into `sim.cells` — the cells are static solids resting at ambient, so
 * they need no heat seeding, and the constructor already flags every chunk active
 * for the first step.
 */
function paintFloor(sim: Simulation, surface: Int32Array, sandCap: number): void {
    const { W, H, cells } = sim;
    for (let x = 0; x < W; x++) {
        const top = surface[x];
        for (let y = top; y < H; y++) {
            cells[y * W + x] = y < top + sandCap ? Mat.SAND : Mat.STONE;
        }
    }
}

/**
 * bootstrap a storm world for the "flats" front: a 320x180 sim with a generated
 * terrain floor, a storm core in the open air above it, and the strike zone
 * around the core. the terrain is fully deterministic given `opts.seed`.
 *
 * @param opts optional tuning; see {@link WorldOptions}.
 * @returns the sim plus the derived core and strike-zone geometry.
 */
export function createWorld(opts: WorldOptions = {}): World {
    const width = opts.width ?? DEFAULT_W;
    const height = opts.height ?? DEFAULT_H;
    const seed = opts.seed ?? 0;
    const variation = opts.variation ?? DEFAULT_VARIATION;
    const sandCap = opts.sandCap ?? DEFAULT_SAND_CAP;
    const coreAboveFloor = opts.coreAboveFloor ?? DEFAULT_CORE_ABOVE_FLOOR;
    const strikeRadius = opts.strikeRadius ?? DEFAULT_STRIKE_RADIUS;

    const baseline = Math.round(height * (opts.floorLevel ?? DEFAULT_FLOOR_LEVEL));
    const rand = mulberry32(seed);
    const surface = buildHeightMap(width, baseline, variation, rand);

    const sim = new Simulation(width, height);
    paintFloor(sim, surface, sandCap);

    // core: horizontally centred, sitting `coreAboveFloor` cells above the floor
    // surface at its own column — guaranteed open air above the terrain.
    const coreX = width >> 1;
    const coreY = surface[coreX] - coreAboveFloor;
    const core: Vec2 = { x: coreX, y: coreY };

    const r2 = strikeRadius * strikeRadius;
    const strikeZone: StrikeZone = {
        x: coreX,
        y: coreY,
        radius: strikeRadius,
        contains(px: number, py: number): boolean {
            const dx = px - coreX;
            const dy = py - coreY;
            return dx * dx + dy * dy <= r2;
        },
    };

    return {
        sim,
        core,
        strikeZone,
        floorHeightAt(x: number): number {
            const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
            return surface[cx];
        },
    };
}
