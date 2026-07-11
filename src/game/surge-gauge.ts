import { CRIT_SPIKE_BANDS, CORE_CRITICAL_TEMP } from "./surge";

// the core-temp gauge math (design §3): the gauge is the *instrument*, not a
// countdown. it reads headroom in "one more crit" units — from the live coreTemp
// and the {@link CRIT_SPIKE_BANDS} it answers two legible questions: does a typical
// (median tier-1..2) crit's heat spike still fit under critical, and does the hottest
// possible (max-tier) spike still fit. these are pure functions so the HUD renders
// two threshold ticks without reaching into the surge machine, and so the "can a crit
// still fit" logic is unit-tested away from React.

/**
 * the representative heat spike of a single crit tier: the midpoint of its
 * {@link CRIT_SPIKE_BANDS} band. tier is clamped into the band table so callers can
 * pass a raw tier without bounds-checking.
 * @param tier the crit tier to look up.
 * @param bands the spike-band table; defaults to {@link CRIT_SPIKE_BANDS}.
 */
export function spikeMidpoint(tier: number, bands = CRIT_SPIKE_BANDS): number {
    const t = Math.min(Math.max(Math.floor(tier), 0), bands.length - 1);
    const [lo, hi] = bands[t];
    return (lo + hi) / 2;
}

/**
 * the representative heat spike of a "typical" surge crit (design §3 — the gauge's
 * median mark): the mean of the tier-1 and tier-2 band midpoints. surge crits floor
 * at tier 1, so tiers 1..2 are the everyday case a player rides through, and this is
 * the spike the "one more crit still fits" reassurance is measured against.
 * @param bands the spike-band table; defaults to {@link CRIT_SPIKE_BANDS}.
 */
export function medianLowSpike(bands = CRIT_SPIKE_BANDS): number {
    return (spikeMidpoint(1, bands) + spikeMidpoint(2, bands)) / 2;
}

/**
 * the representative heat spike of the hottest crit the game can roll (design §3 —
 * the gauge's max-tier danger mark): the midpoint of the top {@link CRIT_SPIKE_BANDS}
 * band. at the base critical temp this exceeds the ceiling, so a max-tier crit is an
 * instant bust from a cold core — a true, teachable fact the gauge surfaces until
 * Aegis raises the ceiling.
 * @param bands the spike-band table; defaults to {@link CRIT_SPIKE_BANDS}.
 */
export function maxTierSpike(bands = CRIT_SPIKE_BANDS): number {
    return spikeMidpoint(bands.length - 1, bands);
}

/**
 * a read-only headroom snapshot for the core-temp gauge (design §3). every field is
 * derived from the live coreTemp + critical ceiling and the spike bands, so the HUD
 * can render the fill, the two threshold ticks, and the "one more crit" readout with
 * no logic of its own.
 */
export interface CoreHeadroom {
    /** heat left before the core busts: `criticalTemp - coreTemp`, clamped `>= 0`. */
    headroom: number;
    /** gauge fill fraction `coreTemp / criticalTemp`, clamped `[0, 1]`. */
    load: number;
    /** the representative median low-tier spike this snapshot was measured against. */
    medianSpike: number;
    /** the representative max-tier spike this snapshot was measured against. */
    maxSpike: number;
    /** true while a median low-tier crit's spike still fits under critical. */
    medianFits: boolean;
    /** true while a max-tier crit's spike still fits under critical. */
    maxFits: boolean;
    /** gauge fill position `[0, 1]` of the median mark; past it a median crit busts. */
    medianTick: number;
    /** gauge fill position `[0, 1]` of the max-tier mark; past it a max crit busts. */
    maxTick: number;
    /** whole median crits that still fit in the headroom — the "one more crit" count. */
    medianCritsLeft: number;
}

/**
 * derive the {@link CoreHeadroom} for a live core temperature. a threshold tick sits
 * at the fill level where one more spike of that size would reach critical, i.e.
 * `(criticalTemp - spike) / criticalTemp`; once the fill passes a tick, that spike no
 * longer fits and the next crit of that size busts the surge.
 * @param coreTemp the live core temperature (negatives read as 0).
 * @param criticalTemp the bust ceiling; defaults to {@link CORE_CRITICAL_TEMP}.
 * @param bands the spike-band table; defaults to {@link CRIT_SPIKE_BANDS}.
 */
export function coreHeadroom(
    coreTemp: number,
    criticalTemp = CORE_CRITICAL_TEMP,
    bands = CRIT_SPIKE_BANDS
): CoreHeadroom {
    const ceiling = criticalTemp > 0 ? criticalTemp : 1;
    const temp = Math.max(0, coreTemp);
    const headroom = Math.max(0, ceiling - temp);
    const load = Math.min(1, temp / ceiling);
    const medianSpike = medianLowSpike(bands);
    const maxSpike = maxTierSpike(bands);
    const tick = (spike: number): number => Math.min(1, Math.max(0, (ceiling - spike) / ceiling));
    return {
        headroom,
        load,
        medianSpike,
        maxSpike,
        medianFits: headroom >= medianSpike,
        maxFits: headroom >= maxSpike,
        medianTick: tick(medianSpike),
        maxTick: tick(maxSpike),
        medianCritsLeft: Math.floor(headroom / medianSpike),
    };
}
