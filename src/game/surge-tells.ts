// the staged physical-tell ladder (design §3): as the surge core temperature climbs
// toward critical, the WORLD around the core reacts in a fixed, learnable order —
// ice sweats -> water steams -> plants smoke -> oil flashes -> world gold shimmers
// toward melt. legibility is the whole point of this wave: the physics IS the
// instrument, so the tell is a real heat reaction radiating from the core, not a HUD
// widget. this module is pure + presentation-free: it maps a single `coreLoad`
// fraction (`coreTemp / criticalTemp`, always in [0,1]) onto (1) an ambient heat
// target to stamp near the core so placed matter visibly reacts, and (2) a gold
// shimmer intensity for the render-side flicker. it CONSUMES coreLoad and never
// mutates the surge machine (the 5b tune owns the heating math + constants).

/**
 * one rung of the tell ladder. `minLoad` is the coreLoad at/above which the rung is
 * the active tell; `heatTarget` is the ambient temperature stamped into the world
 * near the core while this rung is active, chosen so the named matter crosses its own
 * physics threshold (melt/boil/ignite) and reacts on the next sim step. rungs are
 * strictly ordered by ascending `minLoad` AND ascending `heatTarget`, so the ladder
 * is monotonic: a hotter core can only ever escalate the tell, never retreat it.
 */
export interface TellRung {
    /** stable id of the rung, for tests + any host that wants to name the tell. */
    name: string;
    /** coreLoad at/above which this rung is active (fraction of critical, [0,1]). */
    minLoad: number;
    /**
     * ambient temperature stamped near the core while this rung is active. anchored
     * below the world materials' own thresholds so each rung trips the next reaction:
     * ICE melts at 40, WATER boils at 100, PLANT ignites at 170, OIL at 150. kept
     * strictly under GOLD's 300 melt point on every rung — the gold tell is a render
     * shimmer only, so ambient heat must never actually melt (destroy) placed gold.
     */
    heatTarget: number;
}

/**
 * the fixed tell ladder (design §3). `calm` is the resting rung: below the first
 * threshold nothing is stamped (heatTarget 0 = no injection), so a cool core leaves
 * the world untouched. every subsequent rung raises the ambient target past the next
 * material's reaction point, so the tells escalate in the design's order. tunable:
 * shift a `minLoad` to re-stage the ladder, or a `heatTarget` to re-anchor a reaction.
 */
export const TELL_LADDER: readonly TellRung[] = [
    { name: "calm", minLoad: 0, heatTarget: 0 },
    { name: "ice-sweat", minLoad: 0.12, heatTarget: 45 }, // > ICE melt (40)
    { name: "water-steam", minLoad: 0.3, heatTarget: 110 }, // > WATER boil (100)
    { name: "plant-smoke", minLoad: 0.5, heatTarget: 185 }, // > PLANT ignite (170)
    { name: "oil-flash", minLoad: 0.68, heatTarget: 220 }, // sustained flash heat
    { name: "gold-shimmer", minLoad: 0.82, heatTarget: 260 }, // still < GOLD melt (300)
] as const;

/**
 * coreLoad at which the render-side gold shimmer begins to ramp in (design §3). anchored
 * to the gold-shimmer rung's `minLoad` so the shimmer only appears once that final rung is
 * active — never before oil-flash (0.68) — keeping the fixed ice→water→plant→oil→gold order.
 */
export const GOLD_SHIMMER_START = 0.82;

/** coreLoad at which the gold shimmer reaches full intensity — the melt edge. */
export const GOLD_SHIMMER_FULL = 1;

/** the resolved tell for a given coreLoad: which rung is active + its render shimmer. */
export interface TellState {
    /** index into {@link TELL_LADDER} of the active rung (0 = calm). */
    rung: number;
    /** the active rung. */
    stage: TellRung;
    /** ambient temperature to stamp near the core this frame (0 = stamp nothing). */
    heatTarget: number;
    /** gold render-shimmer intensity in [0,1] (0 = steady, 1 = full melt-edge flicker). */
    goldShimmer: number;
}

/** clamp `v` into [0,1]. */
function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * the active ladder rung index for `coreLoad` (design §3). strictly ordered: scans
 * the ladder for the highest rung whose `minLoad` the load has reached. the mapping
 * is a pure step function with no hysteresis — the same load always yields the same
 * rung — so the tell is learnable. `coreLoad` is clamped to [0,1] first.
 */
export function tellRungForLoad(coreLoad: number): number {
    const load = clamp01(coreLoad);
    let rung = 0;
    for (let i = 1; i < TELL_LADDER.length; i++) {
        if (load >= TELL_LADDER[i].minLoad) rung = i;
        else break;
    }
    return rung;
}

/**
 * the ambient heat target to stamp near the core for `coreLoad` — the active rung's
 * {@link TellRung.heatTarget}. 0 means stamp nothing (a cool core leaves the world
 * cold). driven straight off the rung, so it is monotonic in load.
 */
export function ambientHeatForLoad(coreLoad: number): number {
    return TELL_LADDER[tellRungForLoad(coreLoad)].heatTarget;
}

/**
 * the render-side gold shimmer intensity for `coreLoad`, in [0,1] (design §3 — "world
 * gold shimmers toward melt"). a linear ramp from 0 at {@link GOLD_SHIMMER_START} to 1
 * at {@link GOLD_SHIMMER_FULL}, so pooled gold visibly quickens its flicker as the core
 * approaches critical. this is a pure render cue: it never melts or moves the gold.
 */
export function goldShimmerForLoad(coreLoad: number): number {
    const load = clamp01(coreLoad);
    if (load <= GOLD_SHIMMER_START) return 0;
    if (load >= GOLD_SHIMMER_FULL) return 1;
    return (load - GOLD_SHIMMER_START) / (GOLD_SHIMMER_FULL - GOLD_SHIMMER_START);
}

/**
 * resolve the full {@link TellState} for a coreLoad in one call (design §3): the active
 * rung, its ambient heat target, and the gold shimmer intensity. the single entry a
 * host wires — everything downstream (heat stamp near the core, gold render flicker) is
 * derived here, so the ladder stays the one source of truth for "what tell is showing".
 */
export function tellsForLoad(coreLoad: number): TellState {
    const rung = tellRungForLoad(coreLoad);
    return {
        rung,
        stage: TELL_LADDER[rung],
        heatTarget: TELL_LADDER[rung].heatTarget,
        goldShimmer: goldShimmerForLoad(coreLoad),
    };
}
