import { beforeEach, describe, expect, it } from "vitest";
import { Simulation } from "./simulation";
import { Mat } from "./materials";

// the render-only gold shimmer hook (design §3, surge tell ladder): `goldShimmer`
// brightens/flickers solid GOLD in the writeImage() output as the surge core nears
// critical, WITHOUT touching the grid, heat field, or value — it is a pure display
// cue. these tests pin exactly that: the pixel changes, nothing else does.

const W = 16;
const H = 16;
const idx = (x: number, y: number) => y * W + x;

describe("gold shimmer render hook", () => {
    let s: Simulation;

    beforeEach(() => {
        s = new Simulation(W, H);
        s.paint(8, 8, 0, Mat.GOLD);
    });

    it("defaults to 0 (gold rendered steady)", () => {
        expect(s.goldShimmer).toBe(0);
        s.writeImage();
        const steady = s.buf32[idx(8, 8)];
        s.writeImage();
        // same frame, same shimmer -> identical pixel (no hidden animation at 0).
        expect(s.buf32[idx(8, 8)]).toBe(steady);
    });

    it("changes the GOLD pixel once shimmer is engaged", () => {
        s.writeImage();
        const steady = s.buf32[idx(8, 8)];
        s.goldShimmer = 1;
        s.writeImage();
        expect(s.buf32[idx(8, 8)]).not.toBe(steady);
    });

    it("brightens the GOLD pixel on average as shimmer rises", () => {
        // average luminance across a sweep of the per-cell flicker phase: shimmer adds
        // a positive bias, so the mean at full intensity clears the steady mean.
        const meanLuma = () => {
            let sum = 0;
            const samples = 24;
            for (let f = 0; f < samples; f++) {
                s.frame = f;
                s.writeImage();
                const c = s.buf32[idx(8, 8)];
                sum += (c & 0xff) + ((c >> 8) & 0xff) + ((c >> 16) & 0xff);
            }
            return sum / samples;
        };
        s.goldShimmer = 0;
        const steady = meanLuma();
        s.goldShimmer = 1;
        const lit = meanLuma();
        expect(lit).toBeGreaterThan(steady);
    });

    it("leaves the grid, heat, and value untouched (render-only)", () => {
        const before = { cell: s.cells[idx(8, 8)], heat: s.heat[idx(8, 8)] };
        s.goldShimmer = 1;
        s.writeImage();
        expect(s.cells[idx(8, 8)]).toBe(before.cell);
        expect(s.cells[idx(8, 8)]).toBe(Mat.GOLD);
        expect(s.heat[idx(8, 8)]).toBe(before.heat);
    });

    it("does not touch non-gold cells", () => {
        s.paint(4, 4, 0, Mat.SAND);
        s.writeImage();
        const sandSteady = s.buf32[idx(4, 4)];
        s.goldShimmer = 1;
        s.writeImage();
        expect(s.buf32[idx(4, 4)]).toBe(sandSteady);
    });
});
