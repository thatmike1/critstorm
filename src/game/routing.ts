import { Mat, boilPoint } from "../sim/materials";
import type { World } from "./world";
import { Collector, DEFAULT_DRAIN_WIDTH, defaultCollectorRegion, type CollectorRegion } from "./collector";
import type { EconomyState } from "./economy";

export const COLLECTOR_PURCHASE_COST = 240;
export const MAX_COOLANT_HEADROOM = 380;

export interface RoutingState {
    collectors: Collector[];
    efficiencyLevel: number;
}

/** build a surface-hugging drain at a chosen horizontal route. */
export function collectorRegionAt(world: World, centreX: number): CollectorRegion {
    const w = Math.min(DEFAULT_DRAIN_WIDTH, world.sim.W);
    const x = Math.max(0, Math.min(world.sim.W - w, Math.round(centreX) - Math.floor(w / 2)));
    let lo = world.sim.H, hi = 0;
    for (let column = x; column < x + w; column++) {
        lo = Math.min(lo, world.floorHeightAt(column));
        hi = Math.max(hi, world.floorHeightAt(column));
    }
    const y = Math.max(0, lo - 3);
    return { x, y, w, h: Math.max(1, hi - y) };
}

/** install the default drain and spatially separated permanent Vault drains. */
export function createRouting(world: World, fee: number, extras: number): RoutingState {
    const collectors = [new Collector(defaultCollectorRegion(world), fee)];
    for (const fraction of [0.18, 0.82].slice(0, Math.min(2, extras))) {
        const region = collectorRegionAt(world, world.sim.W * fraction);
        if (!collectors.some(({ region: other }) => overlaps(region, other))) collectors.push(new Collector(region, fee));
    }
    return { collectors, efficiencyLevel: 0 };
}

/** reject overlapping catchments so purchases always open a new route. */
function overlaps(a: CollectorRegion, b: CollectorRegion): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w;
}

/** purchase a new surface drain without modifying or protecting world matter. */
export function placeCollector(world: World, state: EconomyState, routing: RoutingState, x: number): boolean {
    if (!Number.isFinite(x) || state.essence < COLLECTOR_PURCHASE_COST || routing.collectors.length >= 5) return false;
    const region = collectorRegionAt(world, x);
    if (routing.collectors.some(({ region: other }) => overlaps(region, other))) return false;
    routing.collectors.push(new Collector(region, routing.collectors[0].fee));
    state.essence -= COLLECTOR_PURCHASE_COST;
    return true;
}

/** geometric essence price of the next three-point collector fee reduction. */
export function efficiencyCost(routing: RoutingState): number {
    return Math.ceil(120 * 1.3 ** routing.efficiencyLevel);
}

/** upgrade every installed drain and inherit its fee on future placements. */
export function buyEfficiency(state: EconomyState, routing: RoutingState): boolean {
    const cost = efficiencyCost(routing);
    if (state.essence < cost || routing.collectors[0].fee < 0.00001) return false;
    state.essence -= cost;
    routing.efficiencyLevel++;
    for (const collector of routing.collectors) collector.fee = Math.max(0, collector.fee - 0.03);
    return true;
}

/** count paid, surviving coolant near the core; steam offers no protection. */
export function coolantHeadroom(world: World): number {
    const { sim, core } = world;
    let capacity = 0;
    const radius = 32;
    for (let y = Math.max(0, core.y - radius); y <= Math.min(sim.H - 1, core.y + radius); y++) {
        for (let x = Math.max(0, core.x - radius); x <= Math.min(sim.W - 1, core.x + radius); x++) {
            if ((x - core.x) ** 2 + (y - core.y) ** 2 > radius ** 2) continue;
            const index = y * sim.W + x;
            if (sim.cells[index] === Mat.ICE) capacity += 10;
            else if (sim.cells[index] === Mat.WATER && sim.heat[index] < boilPoint[Mat.WATER]) capacity += 6;
        }
    }
    return Math.min(MAX_COOLANT_HEADROOM, capacity);
}
