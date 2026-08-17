import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import { blobOffsets, eruptionMass } from "./eruption";
import type { PotState } from "./surge";

// the overheat-bust payload (design §3): the sibling of the BANK eruption. where a
// bank turns the surge pot into a collectable gold mountain, an overheat bust turns
// it into a lava+fire detonation at the storm core that floods the ground below with
// molten rock — the player watches the pot burn AND has to deal with what it leaves
// lying across the gold route. the pot never lands as gold, so its value is accounted
// as LOST through the same gold-loss ledger the in-world hazards use (design §4.1),
// and tier 6-8 heat
// (§6) is injected around the core so pooled world gold melts and sits at risk next
// to the fresh lava. this module owns ONLY the grid-side conversion; the surge state
// machine's 'bust' exit reason (hkm.1) routes here, and the screen flash/shake is the
// caller's (crit-engine) spectacle layer.

/** default radius (cells) of the heat-injection disc stamped around the core. */
export const BUST_HEAT_RADIUS = 12;

/**
 * hard cap on the fallout pool's half-width in cells. the default drain is 40 cells
 * wide centred under the core (see collector.ts), so a cap of 12 keeps the flood well
 * inside it: the bust drowns the MIDDLE of the collector approach — the spot directly
 * under the core, which is where a player parks the cursor — and never the flanks.
 * that is the fun-floor (design §2): the aftermath forces a reroute or a quench, it
 * does not end the run.
 */
export const BUST_FALLOUT_SPREAD = 12;

/**
 * share of the burn mass that rains onto the ground as fallout rather than staying
 * in the core detonation. a bust has to leave a hazard ON the route, not a decorative
 * clump at the core, so most of the molten rock lands where gold travels; the rest
 * stays at the core as the visible "pot burning" beat (design §3).
 */
export const BUST_FALLOUT_SHARE = 0.65;

/**
 * multiplier on the fallout mass. the burn mass is sized from the pot for SPECTACLE
 * (log10, §6), which is far too little molten rock to obstruct anything once it is
 * laid along a floor; the fallout carries no value, so scaling it costs the ledger
 * nothing and buys a hazard that actually blocks. it stays bounded by the same log
 * curve (and by {@link BUST_FALLOUT_SPREAD}), so a late-game bust never drowns the sim.
 */
export const BUST_FALLOUT_SCALE = 3;

/**
 * rows above the highest ground in the flooded span the pool is filled to. this is
 * the number that makes the hazard bite: the collector's drain band reaches
 * `DEFAULT_BAND_ABOVE` (3) rows above the terrain and converts any solid gold inside
 * it, so a pool that only films the floor sits BELOW the catch line and arriving gold
 * banks straight over it. filled to the same 3 rows, the pool's surface is at the
 * catch line — gold must pass through molten rock to reach the drain.
 */
export const BUST_FALLOUT_RISE = 3;

/** most cells one column of the pool may take, so a chasm can't swallow the mass. */
export const BUST_FALLOUT_MAX_COLUMN = 6;

/**
 * half-width of the window whose highest ground sets the pool's level. it matches the
 * default drain (40 wide), because the collector's catch line is likewise pinned to
 * the highest ground across the drain — levelling the pool against a narrower window
 * would leave it under the catch line wherever the terrain dips.
 */
export const BUST_FALLOUT_LEVEL_WINDOW = 20;

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
    /** cells painted as molten rock: the core detonation plus the fallout pool. */
    readonly burnCells: number;
}

/** clamp `v` into the inclusive integer range [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/** gases never stop falling matter, so they don't count as ground when landing. */
function isGas(m: number): boolean {
    return m === Mat.EMPTY || m === Mat.SMOKE || m === Mat.STEAM || m === Mat.FIRE;
}

/**
 * the pool's column offsets relative to the core column, centre-out: `0, -1, +1, -2,
 * …, ±halfWidth`. each column is filled to the pool level before the next one starts,
 * so the flood grows outward from directly under the core and stops where the mass
 * runs out — a contiguous pool, never a scatter. scattering was the first attempt at
 * this fix and it does not work: gold pools where it lands and is drained, so a lone
 * lava cell two columns over is simply stepped past. only molten rock the landing
 * zone cannot avoid is a hazard.
 */
export function falloutColumns(halfWidth: number): number[] {
    const out = [0];
    for (let d = 1; d <= halfWidth; d++) out.push(-d, d);
    return out;
}

/**
 * y of the cell a splash lands in for column `x`: one row above the topmost
 * non-gas cell (the ground, a pool, or a gold pile), i.e. resting ON the surface
 * rather than in mid-air. returns the grid floor for an empty column. the row is
 * walked upward while it is occupied so two splashes in the same column stack
 * instead of overwriting, and -1 when the column is packed to the top.
 */
function landingRow(sim: Simulation, x: number): number {
    let surface = sim.H; // no ground found -> the grid floor
    for (let y = 0; y < sim.H; y++) {
        if (!isGas(sim.cells[y * sim.W + x])) {
            surface = y;
            break;
        }
    }
    let y = Math.min(surface - 1, sim.H - 1);
    while (y >= 0 && !isGas(sim.cells[y * sim.W + x])) y--;
    return y;
}

/**
 * detonate the surge pot at (cx,cy) as a lava/fire eruption (design §3 overheat).
 * four steps, all conservation-safe:
 *
 *  1. account the pot as LOST. the pot lives only in the {@link PotState}, never in
 *     the value field, so it is reported through {@link Simulation.reportLoss} with a
 *     `bust` cause — the same ledger seam the acid/lava/erase hazards fire, so one
 *     subscriber buckets every loss and `sum(value) + collected + lost` stays whole.
 *  2. paint the core detonation: a compact lava+fire blob at (cx,cy), sized to the
 *     pot like a bank eruption (reusing {@link eruptionMass}/{@link blobOffsets}) but
 *     molten rock, not gold. this is the "watch the pot burn" beat.
 *  3. flood the ground below with the FALLOUT POOL (critstorm-ak0). the core blob
 *     alone falls as one narrow stream and settles in a single column, so a player who
 *     kept striking beside it collected as if nothing had happened — the punishment was
 *     decorative. instead the bulk of the burn lands directly ON the ground under the
 *     core as a level-topped pool: it fills the drain approach the gold has to cross,
 *     up to the height the collector catches gold at ({@link BUST_FALLOUT_RISE}), out
 *     to at most {@link BUST_FALLOUT_SPREAD} columns either side. arriving molten gold
 *     that touches it is devoured (a `lava` loss), solid gold beside it melts and is
 *     then devoured, so the aftermath keeps costing until the player quenches it or
 *     routes the gold around it (design §3).
 *  4. inject tier-8 heat around the core so pooled world gold melts (≥300) into
 *     MOLTEN_GOLD and sits at risk beside the lava (value preserved by the melt; it
 *     is only truly lost if the lava then devours it, which fires its own loss).
 *
 * a valued GOLD/MOLTEN_GOLD cell is SKIPPED by every paint here, never painted over —
 * burying it would silently zero its value (paint→setCell drops non-carry value with
 * no loss event) and break the ledger; those cells are left to melt via the heat field
 * and to be devoured through the lava path, which books the loss properly.
 *
 * @param sim the world sim to detonate into.
 * @param cx storm-core cell x (the detonation centre).
 * @param cy storm-core cell y.
 * @param pot the final pot at the surge's bust exit.
 * @param radius heat-injection disc radius; defaults to {@link BUST_HEAT_RADIUS}.
 * @param temp injected core temperature; defaults to {@link BUST_CORE_TEMP}.
 * @param spread fallout half-width; defaults to {@link BUST_FALLOUT_SPREAD}.
 * @returns the value lost + the burn size, for the ledger and the spectacle layer.
 */
export function bustPot(
    sim: Simulation,
    cx: number,
    cy: number,
    pot: PotState,
    radius: number = BUST_HEAT_RADIUS,
    temp: number = BUST_CORE_TEMP,
    spread: number = BUST_FALLOUT_SPREAD
): BustResult {
    // 1. the pot burns instead of banking: its value is lost, not collected.
    sim.reportLoss(cx, cy, pot.value, "bust");

    // the burn mass is split: a minority stays at the core as the detonation the
    // player watches, the rest rains onto the ground as the lasting hazard — scaled
    // up, since spectacle-sized mass spread along a floor obstructs nothing.
    const m = Math.max(1, eruptionMass(pot.value));
    const groundShare = Math.min(m - 1, Math.round(m * BUST_FALLOUT_SHARE));
    const coreCells = m - groundShare;
    const falloutCells = groundShare * BUST_FALLOUT_SCALE;
    let burnCells = 0;

    /** paint one burn cell, refusing to bury a wall or a valued gold cell. */
    const burn = (x: number, y: number, mat: number): void => {
        const c = sim.cells[y * sim.W + x];
        if (c === Mat.WALL || c === Mat.GOLD || c === Mat.MOLTEN_GOLD) return;
        sim.paint(x, y, 0, mat);
        burnCells++;
    };

    // 3a. resolve where the fallout lands BEFORE the core blob exists — the blob sits
    // in mid-air in the same columns, and a column scan would otherwise stop on it and
    // stack the pool onto the detonation instead of onto the ground.
    const ground = new Map<number, number>();
    const groundAt = (x: number): number => {
        const known = ground.get(x);
        if (known !== undefined) return known;
        const row = landingRow(sim, x);
        ground.set(x, row);
        return row;
    };
    const columns = falloutColumns(spread).map((dx) => clamp(cx + dx, 0, sim.W - 1));
    // a liquid seeks its level, so the pool has ONE surface row: BUST_FALLOUT_RISE
    // above the highest ground across the drain-sized window. filling to that line is
    // what puts molten rock at the collector's catch height instead of under it.
    let highest = sim.H;
    for (const dx of falloutColumns(BUST_FALLOUT_LEVEL_WINDOW)) {
        const row = groundAt(clamp(cx + dx, 0, sim.W - 1));
        if (row >= 0 && row < highest) highest = row;
    }
    const level = Math.max(0, highest - BUST_FALLOUT_RISE);
    // pour column by column, centre-out, each filled bottom-up to the level, until the
    // mass is spent: the flood is deepest under the core and simply stops where the
    // pot could not carry it any further.
    const fallout: { x: number; y: number }[] = [];
    const poured = new Set<number>(); // a core near the grid edge clamps columns together
    let left = falloutCells;
    for (const x of columns) {
        if (left <= 0) break;
        if (poured.has(x)) continue;
        poured.add(x);
        const bottom = groundAt(x);
        if (bottom < 0) continue; // column packed to the top — nowhere to land
        const depth = Math.max(0, Math.min(bottom - level + 1, BUST_FALLOUT_MAX_COLUMN, left));
        for (let d = 0; d < depth; d++) fallout.push({ x, y: bottom - d });
        left -= depth;
    }

    // 2. the core detonation — lava body with fire flecks. every third cell is FIRE
    // so flame licks through the molten rock; the rest is LAVA.
    blobOffsets(coreCells).forEach(({ dx, dy }, k) => {
        const x = clamp(cx + dx, 0, sim.W - 1);
        const y = clamp(cy + dy, 0, sim.H - 1);
        burn(x, y, k % 3 === 0 ? Mat.FIRE : Mat.LAVA);
    });

    // 3b. the fallout pool — molten rock flooding the ground across the gold route.
    // all LAVA: fire rises and dies out, so it would leave no lasting hazard.
    for (const { x, y } of fallout) burn(x, y, Mat.LAVA);

    // 4. melt the neighbourhood: pooled world gold near the core goes molten and at risk.
    sim.injectHeat(cx, cy, radius, temp);

    return { lost: pot.value, burnCells };
}
