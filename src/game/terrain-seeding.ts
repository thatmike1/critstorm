import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import type { OilPocketConfig, PlantPatchConfig } from "./fronts";

// front terrain hooks (design §4.5): deterministic helpers that compose extra
// materials into a freshly painted floor. they run once at world creation,
// before any cell carries value, so direct cell writes are safe here — the
// Lagrangian value-carry contract only binds once gold exists.

/** a deterministic source of random values in the half-open range [0, 1). */
export type SeedRng = () => number;

/** pick an integer in the inclusive range `[lo, hi]` from `rng`. */
function randomInt(rng: SeedRng, lo: number, hi: number): number {
    return lo + Math.floor(Math.min(rng(), 0.9999999999999999) * (hi - lo + 1));
}

/**
 * carve buried oil pockets into the stone floor body. every converted cell is
 * STONE at least `minCover` rows below its own column's sand cap and above the
 * bottom row, so each pocket stays fully enclosed by stone (or other pocket
 * oil) — the liquid physically cannot leak or slide.
 *
 * @param sim the simulation whose floor was already painted.
 * @param surface per-column topmost-solid y from the world height map.
 * @param sandCap rows of SAND capping the STONE body (must match the floor paint).
 * @param config pocket count and size tuning.
 * @param rng deterministic rng driving pocket placement.
 * @returns the number of cells converted to oil.
 */
export function seedOilPockets(
    sim: Simulation,
    surface: Int32Array,
    sandCap: number,
    config: OilPocketConfig,
    rng: SeedRng
): number {
    const { W, H, cells } = sim;
    let converted = 0;
    for (let p = 0; p < config.count; p++) {
        const radius = randomInt(rng, config.minRadius, config.maxRadius);
        const cx = randomInt(rng, radius, W - 1 - radius);
        const minY = surface[cx] + sandCap + config.minCover + radius;
        const maxY = H - 2 - radius;
        if (minY > maxY) continue;
        const cy = randomInt(rng, minY, maxY);
        const r2 = radius * radius;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dy * dy > r2) continue;
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || x >= W || y >= H - 1) continue;
                // adjacent surfaces differ by at most 1 per column, so keeping
                // minCover depth per-column guarantees stone above every oil cell.
                if (y < surface[x] + sandCap + config.minCover) continue;
                const i = y * W + x;
                if (cells[i] !== Mat.STONE) continue;
                cells[i] = Mat.OIL;
                converted++;
            }
        }
    }
    return converted;
}

/**
 * grow plant tufts on the terrain surface: short static-solid columns rising
 * from the floor, 1..maxHeight cells tall per column for a scruffy silhouette.
 * only open air is overwritten, so overlapping patches simply merge.
 *
 * @param sim the simulation whose floor was already painted.
 * @param surface per-column topmost-solid y from the world height map.
 * @param config patch count and size tuning.
 * @param rng deterministic rng driving patch placement.
 * @returns the number of cells converted to plant.
 */
export function seedPlantPatches(
    sim: Simulation,
    surface: Int32Array,
    config: PlantPatchConfig,
    rng: SeedRng
): number {
    const { W, cells } = sim;
    let planted = 0;
    for (let p = 0; p < config.count; p++) {
        const width = randomInt(rng, config.minWidth, config.maxWidth);
        const start = randomInt(rng, 0, W - width);
        for (let x = start; x < start + width; x++) {
            const height = randomInt(rng, 1, config.maxHeight);
            for (let h = 1; h <= height; h++) {
                const y = surface[x] - h;
                if (y < 0) break;
                const i = y * W + x;
                if (cells[i] !== Mat.EMPTY) break;
                cells[i] = Mat.PLANT;
                planted++;
            }
        }
    }
    return planted;
}
