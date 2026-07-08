import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { DEFAULT_STEP_SEC } from "../../sim/storm-simulator";
import { MAX_SIM_STEPS_PER_FRAME, SIM_STEP_SEC, bytesOf, drainFixedSteps } from "./sim-layer";

// these tests cover the headless wiring the Pixi layer depends on: the zero-copy
// byte view over the sim's scene buffer, and the fixed-timestep accumulator. the
// actual GPU texture upload needs a renderer and is verified by typecheck + a
// manual dev-server pass (see PR body), not here — vitest runs under node.

const W = 320;
const H = 180;

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
        sim.paint((W * 0.5) | 0, H - 2, 12, Mat.SAND);
        sim.step();
        sim.writeImage();
        // same backing buffer, and it now carries non-background pixels.
        expect(bytes.buffer).toBe(sim.buf32.buffer);
        expect(bytes.some((b) => b !== 0)).toBe(true);
    });
});

describe("drainFixedSteps — fixed timestep", () => {
    it("matches the storm harness step rate (single source of truth)", () => {
        // the on-screen sim must advance at the same 20 Hz the economy was tuned
        // against; if DEFAULT_STEP_SEC ever changes, this pins SIM_STEP_SEC to it.
        expect(SIM_STEP_SEC).toBe(DEFAULT_STEP_SEC);
    });

    it("banks sub-step time and steps once a full increment accrues", () => {
        // a 60 Hz-ish frame (16.67 ms) is smaller than a 50 ms step: no step yet,
        // but the delta is carried forward in the accumulator.
        const f1 = drainFixedSteps(0, 1000 / 60, SIM_STEP_SEC, MAX_SIM_STEPS_PER_FRAME);
        expect(f1.steps).toBe(0);
        expect(f1.accumulatorSec).toBeCloseTo(1 / 60, 6);
        // by the third such frame (~50 ms banked) exactly one step fires.
        const f2 = drainFixedSteps(
            f1.accumulatorSec,
            1000 / 60,
            SIM_STEP_SEC,
            MAX_SIM_STEPS_PER_FRAME
        );
        const f3 = drainFixedSteps(
            f2.accumulatorSec,
            1000 / 60,
            SIM_STEP_SEC,
            MAX_SIM_STEPS_PER_FRAME
        );
        expect(f2.steps + f3.steps).toBe(1);
    });

    it("advances the same total steps per real second regardless of refresh rate", () => {
        // feed one real second as 60 Hz frames and as 144 Hz frames; both must
        // yield ~20 steps (1s / 0.05s), proving the sim is decoupled from refresh.
        const run = (fps: number): number => {
            let acc = 0;
            let total = 0;
            const dtMs = 1000 / fps;
            for (let i = 0; i < fps; i++) {
                const r = drainFixedSteps(acc, dtMs, SIM_STEP_SEC, MAX_SIM_STEPS_PER_FRAME);
                acc = r.accumulatorSec;
                total += r.steps;
            }
            return total;
        };
        expect(run(60)).toBe(20);
        expect(run(144)).toBe(20);
    });

    it("caps steps per frame and drops backlog after a stall (no spiral)", () => {
        // a 10 s hitch would demand 200 steps; the cap holds it to the max and
        // discards the backlog so the next frame starts fresh instead of spiraling.
        const r = drainFixedSteps(0, 10_000, SIM_STEP_SEC, MAX_SIM_STEPS_PER_FRAME);
        expect(r.steps).toBe(MAX_SIM_STEPS_PER_FRAME);
        expect(r.accumulatorSec).toBe(0);
    });
});
