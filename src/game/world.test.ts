import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
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

/** count solid terrain cells (sand + stone) across the whole grid. */
function countSolid(sim: ReturnType<typeof createWorld>["sim"]): number {
    let n = 0;
    for (let i = 0; i < sim.W * sim.H; i++) if (SOLID.has(sim.cells[i])) n++;
    return n;
}
