import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";

// the eruption spawner's grid-side math (design.md §4.1 materials, §6 economy).
// the sim has no velocity, so an eruption's FLIGHT is a Pixi-layer projectile
// phase (see crit-engine.ts). this module owns the moment it LANDS: turning a
// payout into molten gold on the cell grid and seeding the Lagrangian value
// field so `sum(value) + collected + lost === total erupted` holds (design §4.1).

/** floor on eruption mass in cells — even a trivial payout lands as a small blob. */
export const MIN_ERUPTION_CELLS = 4;
/** ceiling on eruption mass in cells — spectacle scales sublinearly so late-game
 * payouts don't drown the sim (design §6). */
export const MAX_ERUPTION_CELLS = 64;

/** a grid offset from an eruption's impact centre. */
export interface CellOffset {
    readonly dx: number;
    readonly dy: number;
}

/**
 * cells an eruption of payout `P` deposits: `m = clamp(4 + 6·log10(P), 4, 64)`
 * (design §6), rounded to a whole cell count. spectacle grows with log(P) so a
 * jackpot is denser than a trickle without the cell count exploding. a non-positive
 * payout has nothing to erupt, so it collapses to the floor (callers guard anyway).
 */
export function eruptionMass(payout: number): number {
    if (!(payout > 0)) return MIN_ERUPTION_CELLS;
    const m = Math.round(4 + 6 * Math.log10(payout));
    return Math.max(MIN_ERUPTION_CELLS, Math.min(MAX_ERUPTION_CELLS, m));
}

/** value carried by each cell of an eruption: the payout split evenly across its
 * mass, so `perCell · mass === payout` (the conservation contract, design §4.1). */
export function eruptionValuePerCell(payout: number): number {
    return payout / eruptionMass(payout);
}

/**
 * `count` grid offsets forming a compact blob around the origin, nearest-first.
 * an eruption's molten cells cluster tightly at the impact point instead of
 * scattering. deterministic: a square just large enough to hold `count` cells is
 * enumerated and sorted by squared distance (ties broken by scan order), so the
 * same count always yields the same shape.
 */
export function blobOffsets(count: number): CellOffset[] {
    if (count <= 0) return [];
    const r = Math.ceil(Math.sqrt(count));
    const cells: { dx: number; dy: number; d: number }[] = [];
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            cells.push({ dx, dy, d: dx * dx + dy * dy });
        }
    }
    cells.sort((a, b) => a.d - b.d);
    return cells.slice(0, count).map(({ dx, dy }) => ({ dx, dy }));
}

/** clamp `v` into the inclusive integer range [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * land an eruption: convert payout `P` into molten gold on the grid at impact
 * (cx,cy), distributing `P` across `m = eruptionMass(P)` cells at `P/m` each
 * (design §4.1 / §6). two passes, and the order is load-bearing:
 *
 *  1. paint every cell MOLTEN_GOLD — `setCell` zeroes the Lagrangian value of a
 *     fresh EMPTY→MOLTEN_GOLD cell, so seeding value inside this pass would be
 *     wiped by a later paint that clamps onto the same edge cell.
 *  2. add each cell's `P/m` share (plus any value the cell already carried) — done
 *     after all paints so no share is lost, which is exactly what makes an eruption
 *     conserve `P` into the value field.
 *
 * overlapping eruptions land on cells that are ALREADY MOLTEN_GOLD and may still
 * hold uncollected value. `paint` routes through `setCell`, and MOLTEN_GOLD→
 * MOLTEN_GOLD is NOT a value-preserving phase change (only the GOLD<->MOLTEN_GOLD
 * melt/freeze pair is), so the repaint zeroes that value. to keep the conservation
 * invariant across overlaps, each target's prior value is captured before pass 1
 * and re-added in pass 2, so an overlapping deposit adds its share on top of the
 * existing value instead of destroying it.
 *
 * offsets are clamped in-bounds (a corner impact still deposits the full payout),
 * and indestructible WALL cells are skipped so value never lands on a non-gold
 * cell it could never be collected from. a skipped wall share is neither deposited
 * nor ledgered as lost — it simply never enters the world; the caller can detect
 * this because the return value falls short of `P` (see @returns).
 * @returns the value actually deposited this call (== P for any wall-free in-grid
 *   impact; less than P if wall cells swallowed part of the blob). the value
 *   restored from prior overlapping deposits is NOT included — only the new share.
 */
export function depositEruption(sim: Simulation, cx: number, cy: number, payout: number): number {
    if (!(payout > 0)) return 0;
    const m = eruptionMass(payout);
    const per = payout / m;
    // resolve + filter target cells once so the two passes agree exactly.
    const targets: { x: number; y: number }[] = [];
    for (const { dx, dy } of blobOffsets(m)) {
        const x = clamp(cx + dx, 0, sim.W - 1);
        const y = clamp(cy + dy, 0, sim.H - 1);
        if (sim.cells[y * sim.W + x] === Mat.WALL) continue;
        targets.push({ x, y });
    }
    // capture any value the target already carries (overlapping still-molten cells)
    // BEFORE painting zeroes it, so pass 2 can restore it alongside the new share.
    const prior = targets.map(({ x, y }) => sim.getValue(x, y));
    for (const { x, y } of targets) sim.paint(x, y, 0, Mat.MOLTEN_GOLD);
    targets.forEach(({ x, y }, i) => sim.addValue(x, y, prior[i] + per));
    return per * targets.length;
}
