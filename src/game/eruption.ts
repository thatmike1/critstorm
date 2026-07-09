import { Mat } from "../sim/materials";
import type { World } from "./world";

/** how far each side of the core an eruption's molten-gold gush may fan out, in cells. */
const ERUPTION_SPREAD = 2;

/** most molten-gold cells one eruption seeds; caps the gush so a huge hit can't carpet the air. */
export const MAX_ERUPTION_CELLS = 9;

/**
 * cell count for a hit of magnitude `value`: a tight single spout for a trickle,
 * fanning wider with the order of magnitude so a big crit reads as a fatter gush.
 * clamped to [1, {@link MAX_ERUPTION_CELLS}].
 */
function gushCells(value: number): number {
    const n = 1 + Math.floor(Math.log10(value + 1));
    return n < 1 ? 1 : n > MAX_ERUPTION_CELLS ? MAX_ERUPTION_CELLS : n;
}

/**
 * the eruption spawner (design §4.3): an attack erupts molten gold from the storm
 * core carrying the hit's full `value`. that gold falls, cools to solid GOLD, and
 * settles into the collector band, which drains it to essence — this is now the
 * ONLY path that mints essence (applyAttack no longer credits it directly), so an
 * attack pays out only once its gold reaches home.
 *
 * seeds a small cluster of MOLTEN_GOLD cells (spawned hot via the material's
 * emission temperature) in the open air around the core and spreads `value`
 * evenly across the cells it actually places. targets EMPTY cells only, so it
 * never overwrites terrain or in-flight gold and destroys their value. returns
 * the number of cells seeded — 0 for a non-positive hit or a fully boxed-in core
 * (in which case no gold, and no value, could enter the world).
 */
export function erupt(world: World, value: number): number {
    if (value <= 0) return 0;
    const { sim, core } = world;
    const want = gushCells(value);
    // gather empty targets in growing square rings around the core, nearest first,
    // so the gush fans outward only as far as the hit's magnitude needs.
    const targets: number[] = [];
    for (let ring = 0; ring <= ERUPTION_SPREAD && targets.length < want; ring++) {
        for (let dy = -ring; dy <= ring && targets.length < want; dy++) {
            for (let dx = -ring; dx <= ring && targets.length < want; dx++) {
                // only cells on this ring's shell (skip the interior filled by smaller rings)
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                const x = core.x + dx;
                const y = core.y + dy;
                if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) continue;
                if (sim.cells[y * sim.W + x] !== Mat.EMPTY) continue;
                targets.push(y * sim.W + x);
            }
        }
    }
    if (targets.length === 0) return 0;
    const per = value / targets.length;
    for (const i of targets) {
        const x = i % sim.W;
        const y = (i / sim.W) | 0;
        // radius-0 paint sets exactly this cell to molten gold and seeds its molten
        // emission temperature (assignSpawnHeat), so it won't petrify before it flows.
        sim.paint(x, y, 0, Mat.MOLTEN_GOLD);
        sim.addValue(x, y, per);
    }
    return targets.length;
}
