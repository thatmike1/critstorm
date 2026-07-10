import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import type { World } from "./world";
import { COLLECTOR_BASE_FEE, valueToEssence } from "./economy";

/** an axis-aligned drain region in grid cell coordinates. */
export interface CollectorRegion {
    x: number;
    y: number;
    /** width in cells; the region spans columns [x, x + w). */
    w: number;
    /** height in cells; the region spans rows [y, y + h). */
    h: number;
}

/** rows above the terrain surface the default drain band reaches, catching gold at rest. */
const DEFAULT_BAND_ABOVE = 3;

/** width of the default drain in cells — a narrow patch of floor, NOT the full
 * width. gold sitting outside it is the unbanked, at-risk pot the player routes
 * toward the drain (design §2); a full-width drain silently auto-banks every
 * grain the moment it lands, which reads on screen as gold vanishing into an
 * invisible barrier above the terrain. */
export const DEFAULT_DRAIN_WIDTH = 40;

/**
 * build the default collector for a bootstrapped world: a narrow band hugging
 * the terrain surface, centred under the storm core, spanning the surface
 * variation plus a few rows above it — so gold that settles on the drain patch
 * is collected while gold landing elsewhere visibly pools and must be routed.
 * gameplay may later replace this with placed collectors.
 */
export function defaultCollectorRegion(world: World): CollectorRegion {
    const { W } = world.sim;
    const w = Math.min(DEFAULT_DRAIN_WIDTH, W);
    const x0 = Math.max(0, Math.min(world.core.x - (w >> 1), W - w));
    let minSurface = Infinity;
    let maxSurface = -Infinity;
    for (let x = x0; x < x0 + w; x++) {
        const s = world.floorHeightAt(x);
        if (s < minSurface) minSurface = s;
        if (s > maxSurface) maxSurface = s;
    }
    const top = Math.max(0, minSurface - DEFAULT_BAND_ABOVE);
    return { x: x0, y: top, w, h: Math.max(1, maxSurface - top) };
}

/**
 * the collector (design §4.3): a drain region that turns arriving solid GOLD
 * cells into essence at (1 − fee). each scan reads a collected cell's value via
 * the sim value API, credits `value × (1 − fee)` as essence, then drains the cell
 * (clearing the gold and zeroing its value through the sim's silent-drain path, so
 * collection fires NO gold-loss event — it is conversion, not destruction).
 *
 * presentation-free and economy-free: {@link collect} returns the essence minted
 * this call and the caller adds it to the {@link EconomyState}.
 */
export class Collector {
    readonly region: CollectorRegion;
    /** skim fraction on conversion; 0.3 base, driven toward 0 by upgrades (design §4.3). */
    fee: number;

    constructor(region: CollectorRegion, fee: number = COLLECTOR_BASE_FEE) {
        this.region = region;
        this.fee = fee;
    }

    /**
     * scan the drain region, convert every solid GOLD cell to essence, and clear
     * it. returns the essence produced this call (0 when no gold has arrived). the
     * region is clamped to the grid, so an off-grid region is a safe no-op.
     */
    collect(sim: Simulation): number {
        const x0 = Math.max(0, this.region.x);
        const y0 = Math.max(0, this.region.y);
        const x1 = Math.min(sim.W, this.region.x + this.region.w);
        const y1 = Math.min(sim.H, this.region.y + this.region.h);
        let essence = 0;
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                if (sim.cells[y * sim.W + x] !== Mat.GOLD) continue;
                essence += valueToEssence(sim.getValue(x, y), this.fee);
                // remove the collected cell via the silent drain: clears the cell and
                // zeroes its value WITHOUT firing an erase loss event — collection is
                // conversion to essence, not destruction, so the loss tell stays quiet.
                sim.drainCell(x, y);
            }
        }
        return essence;
    }
}
