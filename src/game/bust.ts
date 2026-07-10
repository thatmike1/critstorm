import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import { blobOffsets, eruptionMass } from "./eruption";
import type { PotState } from "./surge";

// the overheat-bust payload (design §3): the sibling of the BANK eruption. where a
// bank turns the surge pot into a collectable gold mountain, an overheat bust turns
// it into a lava+fire detonation at the storm core — the player watches the pot
// burn. the pot never lands as gold, so its value is accounted as LOST through the
// same gold-loss ledger the in-world hazards use (design §4.1), and tier 6-8 heat
// (§6) is injected around the core so pooled world gold melts and sits at risk next
// to the fresh lava. this module owns ONLY the grid-side conversion; the surge state
// machine's 'bust' exit reason (hkm.1) routes here, and the screen flash/shake is the
// caller's (crit-engine) spectacle layer.

/** default radius (cells) of the heat-injection disc stamped around the core. */
export const BUST_HEAT_RADIUS = 12;

/**
 * temperature stamped around the core on a bust — design §6 tier 8 ("600+, lava
 * spray"), the hottest rung since a detonation is the catastrophic exit. it sits
 * well above gold's 300 melt point, so pooled world GOLD near the core liquefies to
 * MOLTEN_GOLD (value preserved by the melt carry) and is put physically at risk.
 */
export const BUST_CORE_TEMP = 600;

/** the grid-side result of a bust, for the conservation ledger + spectacle wiring. */
export interface BustResult {
    /** pot value accounted as lost (it never lands as gold) — equals `pot.value`. */
    readonly lost: number;
    /** cells painted as the lava/fire burn at the core. */
    readonly burnCells: number;
}

/** clamp `v` into the inclusive integer range [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * detonate the surge pot at (cx,cy) as a lava/fire eruption (design §3 overheat).
 * three steps, all conservation-safe:
 *
 *  1. account the pot as LOST. the pot lives only in the {@link PotState}, never in
 *     the value field, so it is reported through {@link Simulation.reportLoss} with a
 *     `bust` cause — the same ledger seam the acid/lava/erase hazards fire, so one
 *     subscriber buckets every loss and `sum(value) + collected + lost` stays whole.
 *  2. paint the burn: a compact lava+fire blob sized to the pot like a bank eruption
 *     (reusing {@link eruptionMass}/{@link blobOffsets}), but molten rock, not gold.
 *     a valued GOLD/MOLTEN_GOLD cell is SKIPPED, never painted over — burying it
 *     would silently zero its value (paint→setCell drops non-carry value with no loss
 *     event) and break the ledger; those cells are left to melt via the heat field.
 *  3. inject tier-8 heat around the core so pooled world gold melts (≥300) into
 *     MOLTEN_GOLD and sits at risk beside the lava (value preserved by the melt; it
 *     is only truly lost if the lava then devours it, which fires its own loss).
 *
 * @param sim the world sim to detonate into.
 * @param cx storm-core cell x (the detonation centre).
 * @param cy storm-core cell y.
 * @param pot the final pot at the surge's bust exit.
 * @param radius heat-injection disc radius; defaults to {@link BUST_HEAT_RADIUS}.
 * @param temp injected core temperature; defaults to {@link BUST_CORE_TEMP}.
 * @returns the value lost + the burn size, for the ledger and the spectacle layer.
 */
export function bustPot(
    sim: Simulation,
    cx: number,
    cy: number,
    pot: PotState,
    radius: number = BUST_HEAT_RADIUS,
    temp: number = BUST_CORE_TEMP
): BustResult {
    // 1. the pot burns instead of banking: its value is lost, not collected.
    sim.reportLoss(cx, cy, pot.value, "bust");

    // 2. the visible burn — lava body with fire flecks, sized to the dead pot. every
    // third cell is FIRE so flame licks through the molten rock; the rest is LAVA.
    const m = Math.max(1, eruptionMass(pot.value));
    let burnCells = 0;
    blobOffsets(m).forEach(({ dx, dy }, k) => {
        const x = clamp(cx + dx, 0, sim.W - 1);
        const y = clamp(cy + dy, 0, sim.H - 1);
        const c = sim.cells[y * sim.W + x];
        // never bury a wall (indestructible) or a valued gold cell (silent value drop).
        if (c === Mat.WALL || c === Mat.GOLD || c === Mat.MOLTEN_GOLD) return;
        sim.paint(x, y, 0, k % 3 === 0 ? Mat.FIRE : Mat.LAVA);
        burnCells++;
    });

    // 3. melt the neighbourhood: pooled world gold near the core goes molten and at risk.
    sim.injectHeat(cx, cy, radius, temp);

    return { lost: pot.value, burnCells };
}
