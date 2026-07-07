import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { bytesOf, paintDemoScene } from "./sim-layer";

// these tests cover the headless wiring the Pixi layer depends on: the zero-copy
// byte view over the sim's scene buffer, and the demo bootstrap painter. the
// actual GPU texture upload needs a renderer and is verified by typecheck + a
// manual dev-server pass (see PR body), not here — vitest runs under node.

const W = 320;
const H = 180;

/** count cells of a given material across the grid. */
function countMat(sim: Simulation, mat: number): number {
    let c = 0;
    for (let i = 0; i < sim.W * sim.H; i++) if (sim.cells[i] === mat) c++;
    return c;
}

describe("bytesOf", () => {
    it("aliases the sim's buf32 rather than copying it", () => {
        const sim = new Simulation(W, H);
        const bytes = bytesOf(sim.buf32);
        expect(bytes.buffer).toBe(sim.buf32.buffer);
        expect(bytes.length).toBe(sim.buf32.length * 4);
    });

    it("reflects writeImage() output in R,G,B,A byte order (rgba8unorm)", () => {
        const sim = new Simulation(W, H);
        const bytes = bytesOf(sim.buf32);
        // paint one opaque cell, render, and read its bytes back through the view.
        sim.paint(4, 4, 0, Mat.SAND);
        sim.writeImage();
        const cell = 4 * W + 4;
        const packed = sim.buf32[cell];
        const off = cell * 4;
        // little-endian 0xAABBGGRR -> bytes [R, G, B, A].
        expect(bytes[off + 0]).toBe(packed & 0xff);
        expect(bytes[off + 1]).toBe((packed >> 8) & 0xff);
        expect(bytes[off + 2]).toBe((packed >> 16) & 0xff);
        expect(bytes[off + 3]).toBe((packed >> 24) & 0xff);
        // sand is opaque and non-black, so the view must show real pixel data.
        expect(bytes[off + 3]).toBe(0xff);
        expect(packed).not.toBe(0);
    });

    it("stays valid after a step (buf32 is never reallocated)", () => {
        const sim = new Simulation(W, H);
        const bytes = bytesOf(sim.buf32);
        paintDemoScene(sim);
        sim.step();
        sim.writeImage();
        // same backing buffer, and it now carries non-background pixels.
        expect(bytes.buffer).toBe(sim.buf32.buffer);
        expect(bytes.some((b) => b !== 0)).toBe(true);
    });
});

describe("paintDemoScene", () => {
    it("seeds a visible sand pile and water pocket", () => {
        const sim = new Simulation(W, H);
        expect(countMat(sim, Mat.SAND)).toBe(0);
        expect(countMat(sim, Mat.WATER)).toBe(0);
        paintDemoScene(sim);
        expect(countMat(sim, Mat.SAND)).toBeGreaterThan(0);
        expect(countMat(sim, Mat.WATER)).toBeGreaterThan(0);
    });
});
