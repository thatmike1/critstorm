import { Graphics } from "pixi.js";
import type { CollectorRegion } from "./collector";

/** an axis-aligned rectangle in screen pixels. */
export interface ScreenRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * map a drain region (grid cells) onto the stretched sim sprite in screen px. the
 * sim sprite fills the whole stage, so each cell maps to `screen / grid` px on
 * each axis; the region's rect scales by the same factors. pure + side-effect free
 * so the geometry is unit-testable without a GPU.
 */
export function regionToScreenRect(
    region: CollectorRegion,
    gridW: number,
    gridH: number,
    screenW: number,
    screenH: number
): ScreenRect {
    const sx = screenW / gridW;
    const sy = screenH / gridH;
    return {
        x: region.x * sx,
        y: region.y * sy,
        w: region.w * sx,
        h: region.h * sy,
    };
}

/** dim cyan the drain glows at rest — a cool "sink" tone against the warm gold storm. */
const DRAIN_COLOR = 0x2ad4ff;
/** brighter cyan for the grate's top lip + the collection bloom. */
const DRAIN_HILITE = 0x9af0ff;
/** target screen px between grate bars; the count derives from the region width. */
const BAR_SPACING = 22;
/** seconds a collection pulse takes to fade back to the resting shimmer. */
const PULSE_DECAY = 2.6;
/** radians/sec the resting shimmer breathes at. */
const SHIMMER_RATE = 2.4;

/**
 * the on-screen tell for the collector drain (design pillar 4, pixel-native): a
 * dim animated grate/glow strip drawn over the sim but under the eruptions, aligned
 * to the drain's grid rect scaled to the stage. gold landing here otherwise vanishes
 * with no marker, which playtests read as a bug. owns exactly one {@link Graphics},
 * redrawn once per frame — no per-cell sprites.
 */
export class DrainMarker {
    readonly gfx = new Graphics();
    private region: CollectorRegion | null = null;
    private gridW = 1;
    private gridH = 1;
    /** resting shimmer phase, advanced each frame so the grate breathes. */
    private shimmer = 0;
    /** collection pulse, latched to 1 on a drain and decaying toward 0. */
    private pulse = 0;

    /** latch the drain rect (grid coords) + the grid dims it scales against. */
    setRegion(region: CollectorRegion, gridW: number, gridH: number): void {
        this.region = region;
        this.gridW = Math.max(1, gridW);
        this.gridH = Math.max(1, gridH);
    }

    /**
     * flag that the collector drained gold this frame: kick the pulse to full so the
     * grate flares + blooms upward, reading as essence income rising FROM the drain.
     */
    collected(): void {
        this.pulse = 1;
    }

    /** advance the shimmer + pulse and redraw the grate for the current stage size. */
    update(dtSec: number, screenW: number, screenH: number): void {
        this.shimmer += dtSec * SHIMMER_RATE;
        if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dtSec * PULSE_DECAY);
        this.redraw(screenW, screenH);
    }

    /** rebuild the single Graphics: dim glow strip + grate bars + collection bloom. */
    private redraw(screenW: number, screenH: number): void {
        const g = this.gfx;
        g.clear();
        if (!this.region) return;
        const r = regionToScreenRect(this.region, this.gridW, this.gridH, screenW, screenH);
        if (r.w <= 0 || r.h <= 0) return;

        // resting breath: a gentle 0..1 wave the whole marker rides, boosted by the
        // decaying collection pulse so a drain visibly flares the strip brighter.
        const breath = 0.5 + 0.5 * Math.sin(this.shimmer);
        const lit = 0.14 + 0.08 * breath + this.pulse * 0.55;

        // base glow strip: a dim wash marking the catchment so at-rest gold has a tell.
        g.rect(r.x, r.y, r.w, r.h).fill({ color: DRAIN_COLOR, alpha: lit * 0.35 });

        // grate bars: evenly spaced vertical slats, pixel-native and cheap (one path).
        const bars = Math.max(2, Math.round(r.w / BAR_SPACING));
        const step = r.w / bars;
        const barW = Math.max(1, step * 0.32);
        for (let i = 0; i < bars; i++) {
            g.rect(r.x + i * step, r.y, barW, r.h).fill({ color: DRAIN_COLOR, alpha: lit * 0.7 });
        }

        // top lip: a bright line where gold meets the drain, the strongest resting tell.
        g.rect(r.x, r.y, r.w, Math.max(1, r.h * 0.16)).fill({ color: DRAIN_HILITE, alpha: lit });

        // collection bloom: on a drain, a band rises off the lip and fades — essence
        // leaving the drain as income. height + alpha both scale with the live pulse.
        if (this.pulse > 0) {
            const bloomH = r.h * (0.4 + this.pulse * 1.6);
            g.rect(r.x, r.y - bloomH, r.w, bloomH).fill({
                color: DRAIN_HILITE,
                alpha: this.pulse * 0.4,
            });
        }
    }

    /** release the Graphics (the stage owns it as a child, so detach happens there). */
    destroy(): void {
        this.gfx.destroy();
    }
}
