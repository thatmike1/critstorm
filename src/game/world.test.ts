import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { FRONTS } from "./fronts";
import { createWorld } from "./world";

// world-bootstrap tests (design.md §2, §7): assert the generated terrain floor
// is solid, the storm core sits in open air above it, and the strike-zone
// containment math is correct. all deterministic given a fixed seed.

const SOLID = new Set<number>([Mat.SAND, Mat.STONE]);

describe("createWorld — terrain floor", () => {
    it("fills a solid floor in every column down to the bottom row", () => {
        const { sim, floorHeightAt } = createWorld({ seed: 1 });
        const { W, H, cells } = sim;
        for (let x = 0; x < W; x++) {
            const top = floorHeightAt(x);
            // bottom row is always solid
            expect(SOLID.has(cells[(H - 1) * W + x])).toBe(true);
            // the whole column from the surface down is solid, contiguous
            for (let y = top; y < H; y++) {
                expect(SOLID.has(cells[y * W + x])).toBe(true);
            }
            // the cell directly above the surface is open air
            expect(cells[(top - 1) * W + x]).toBe(Mat.EMPTY);
        }
    });

    it("caps the stone body with a sand surface layer", () => {
        const { sim, floorHeightAt } = createWorld({ seed: 3, sandCap: 4 });
        const { W } = sim;
        const x = 100;
        const top = floorHeightAt(x);
        expect(sim.cells[top * W + x]).toBe(Mat.SAND); // surface is sand
        expect(sim.cells[(top + 4) * W + x]).toBe(Mat.STONE); // body is stone
    });

    it("keeps the surface slope shallow so the packed floor never slides", () => {
        // adjacent columns differ by <= 1 cell: a steeper step would leave a
        // surface sand cell with an empty diagonal below and let it flow.
        const { sim, floorHeightAt } = createWorld({ seed: 7 });
        for (let x = 1; x < sim.W; x++) {
            expect(Math.abs(floorHeightAt(x) - floorHeightAt(x - 1))).toBeLessThanOrEqual(1);
        }
    });

    it("leaves the floor solid after stepping the sim (powder is supported)", () => {
        const { sim } = createWorld({ seed: 2 });
        const before = countSolid(sim);
        sim.step(30);
        const after = countSolid(sim);
        // no cells vanished off the bottom or dissolved — the floor is stable.
        expect(after).toBe(before);
    });

    it("varies the surface height (not a flat line) yet stays bounded", () => {
        const { floorHeightAt } = createWorld({ seed: 5, variation: 6 });
        let min = Infinity;
        let max = -Infinity;
        for (let x = 0; x < 320; x++) {
            const h = floorHeightAt(x);
            if (h < min) min = h;
            if (h > max) max = h;
        }
        expect(max - min).toBeGreaterThan(0); // there IS variation
        expect(max - min).toBeLessThanOrEqual(12); // within ±variation of baseline
    });

    it("is deterministic: same seed -> identical terrain", () => {
        const a = createWorld({ seed: 42 });
        const b = createWorld({ seed: 42 });
        expect(Array.from(a.sim.cells)).toEqual(Array.from(b.sim.cells));
    });

    it("differs across seeds", () => {
        const a = createWorld({ seed: 1 });
        const b = createWorld({ seed: 999 });
        const heightsA = Array.from({ length: 320 }, (_, x) => a.floorHeightAt(x));
        const heightsB = Array.from({ length: 320 }, (_, x) => b.floorHeightAt(x));
        expect(heightsA).not.toEqual(heightsB);
    });
});

describe("createWorld — storm core", () => {
    it("places the core in open air above the floor", () => {
        const { sim, core, floorHeightAt } = createWorld({ seed: 4 });
        // core cell itself is empty
        expect(sim.cells[core.y * sim.W + core.x]).toBe(Mat.EMPTY);
        // core sits strictly above the floor surface at its column
        expect(core.y).toBeLessThan(floorHeightAt(core.x));
        // the full column between the core and the floor is open air
        for (let y = core.y; y < floorHeightAt(core.x); y++) {
            expect(sim.cells[y * sim.W + core.x]).toBe(Mat.EMPTY);
        }
    });

    it("centres the core horizontally", () => {
        const { sim, core } = createWorld({ seed: 4 });
        expect(core.x).toBe(sim.W >> 1);
    });

    it("keeps the core inside the grid bounds", () => {
        const { sim, core } = createWorld({ seed: 4 });
        expect(core.x).toBeGreaterThanOrEqual(0);
        expect(core.x).toBeLessThan(sim.W);
        expect(core.y).toBeGreaterThanOrEqual(0);
        expect(core.y).toBeLessThan(sim.H);
    });

    it("clamps the core in-bounds for a large coreAboveFloor (never negative)", () => {
        // a coreAboveFloor taller than the whole grid would push coreY negative
        // and cause an out-of-range sim.cells read; the clamp must hold the core
        // at row 0 while keeping it strictly in open air above the floor.
        const { sim, core, floorHeightAt } = createWorld({ seed: 4, coreAboveFloor: 500 });
        expect(core.y).toBeGreaterThanOrEqual(0);
        expect(core.y).toBeLessThan(sim.H);
        // still above the floor surface, so the core cell is open air.
        expect(core.y).toBeLessThan(floorHeightAt(core.x));
        expect(sim.cells[core.y * sim.W + core.x]).toBe(Mat.EMPTY);
    });
});

describe("createWorld — strike zone", () => {
    it("centres on the core with the requested radius", () => {
        const { core, strikeZone } = createWorld({ seed: 6, strikeRadius: 40 });
        expect(strikeZone.x).toBe(core.x);
        expect(strikeZone.y).toBe(core.y);
        expect(strikeZone.radius).toBe(40);
    });

    it("contains the centre and points within the radius", () => {
        const { strikeZone } = createWorld({ seed: 6, strikeRadius: 40 });
        const { x, y } = strikeZone;
        expect(strikeZone.contains(x, y)).toBe(true);
        expect(strikeZone.contains(x + 30, y)).toBe(true); // 30 < 40
        expect(strikeZone.contains(x, y - 40)).toBe(true); // exactly on the edge
        expect(strikeZone.contains(x + 24, y + 24)).toBe(true); // dist ~33.9 < 40
    });

    it("rejects points outside the radius", () => {
        const { strikeZone } = createWorld({ seed: 6, strikeRadius: 40 });
        const { x, y } = strikeZone;
        expect(strikeZone.contains(x + 41, y)).toBe(false);
        expect(strikeZone.contains(x, y + 41)).toBe(false);
        expect(strikeZone.contains(x + 30, y + 30)).toBe(false); // dist ~42.4 > 40
    });
});

describe("createWorld — storm fronts (design §4.5)", () => {
    it("defaults to the flats and carries the front on the world", () => {
        expect(createWorld({ seed: 1 }).front.id).toBe("flats");
        expect(createWorld({ seed: 1, front: FRONTS.bog }).front.id).toBe("bog");
    });

    it("keeps the flats free of oil and plant (no regression)", () => {
        const { sim } = createWorld({ seed: 1, front: FRONTS.flats });
        expect(countMat(sim, Mat.OIL)).toBe(0);
        expect(countMat(sim, Mat.PLANT)).toBe(0);
    });

    it("builds the flats byte-identically with and without an explicit front", () => {
        const implicit = createWorld({ seed: 42 });
        const explicit = createWorld({ seed: 42, front: FRONTS.flats });
        expect(Array.from(implicit.sim.cells)).toEqual(Array.from(explicit.sim.cells));
    });

    it("seeds oil pockets and plant patches into the bog", () => {
        const { sim } = createWorld({ seed: 1, front: FRONTS.bog });
        expect(countMat(sim, Mat.OIL)).toBeGreaterThan(0);
        expect(countMat(sim, Mat.PLANT)).toBeGreaterThan(0);
    });

    it("keeps the bog's base floor identical to the flats' for the same seed", () => {
        const flats = createWorld({ seed: 9, front: FRONTS.flats });
        const bog = createWorld({ seed: 9, front: FRONTS.bog });
        for (let x = 0; x < flats.sim.W; x++) {
            expect(bog.floorHeightAt(x)).toBe(flats.floorHeightAt(x));
        }
    });

    it("buries oil pockets fully enclosed: no oil cell touches air or sand", () => {
        const { sim } = createWorld({ seed: 4, front: FRONTS.bog });
        const { W, H, cells } = sim;
        let oil = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (cells[y * W + x] !== Mat.OIL) continue;
                oil++;
                for (const [dx, dy] of [
                    [0, -1],
                    [0, 1],
                    [-1, 0],
                    [1, 0],
                ]) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; // grid edge is a wall
                    const neighbour = cells[ny * W + nx];
                    expect(neighbour === Mat.STONE || neighbour === Mat.OIL).toBe(true);
                }
            }
        }
        expect(oil).toBeGreaterThan(0);
    });

    it("grows plant patches on the surface, in what was open air", () => {
        const flats = createWorld({ seed: 4, front: FRONTS.flats });
        const bog = createWorld({ seed: 4, front: FRONTS.bog });
        const { W, H, cells } = bog.sim;
        let plants = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (cells[y * W + x] !== Mat.PLANT) continue;
                plants++;
                // plant sits above the floor surface, where the flats had air.
                expect(y).toBeLessThan(bog.floorHeightAt(x));
                expect(flats.sim.cells[y * W + x]).toBe(Mat.EMPTY);
            }
        }
        expect(plants).toBeGreaterThan(0);
    });

    it("is deterministic per seed and differs across seeds", () => {
        const a = createWorld({ seed: 11, front: FRONTS.bog });
        const b = createWorld({ seed: 11, front: FRONTS.bog });
        const c = createWorld({ seed: 12, front: FRONTS.bog });
        expect(Array.from(a.sim.cells)).toEqual(Array.from(b.sim.cells));
        expect(Array.from(a.sim.cells)).not.toEqual(Array.from(c.sim.cells));
    });

    it("stays stable after stepping: oil never leaks, plants never fall", () => {
        const { sim } = createWorld({ seed: 2, front: FRONTS.bog });
        const oilBefore = countMat(sim, Mat.OIL);
        const plantBefore = countMat(sim, Mat.PLANT);
        sim.step(30);
        expect(countMat(sim, Mat.OIL)).toBe(oilBefore);
        expect(countMat(sim, Mat.PLANT)).toBe(plantBefore);
    });
});

/** count cells of one material across the whole grid. */
function countMat(sim: ReturnType<typeof createWorld>["sim"], mat: number): number {
    let n = 0;
    for (let i = 0; i < sim.W * sim.H; i++) if (sim.cells[i] === mat) n++;
    return n;
}

/** count solid terrain cells (sand + stone) across the whole grid. */
function countSolid(sim: ReturnType<typeof createWorld>["sim"]): number {
    let n = 0;
    for (let i = 0; i < sim.W * sim.H; i++) if (SOLID.has(sim.cells[i])) n++;
    return n;
}
