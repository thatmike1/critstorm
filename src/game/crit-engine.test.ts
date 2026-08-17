import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { CritEngine } from "./crit-engine";
import { SimLayer, type SimAudioSink } from "./sim-layer";

// the app seam for sim audio: app.tsx calls engine.attachAudio(audioRef.current)
// on storm start, and the effect cleanup's engine.destroy() must release it —
// StormView remounts per run, so a missed detach stacks a dead storm's tells.
//
// CritEngine.create needs a WebGL context, so these run its REAL methods (off the
// real prototype) against a real SimLayer + Simulation, with only the Pixi
// Application stubbed. the single type assertion is Object.create's untyped return;
// the class's private field list can't be expressed structurally.

const W = 20;
const H = 15;

/** the slice of CritEngine's private state attachAudio + destroy actually read. */
interface EngineParts {
    app: { destroy: (removeView: boolean, opts: { children: boolean }) => void };
    simLayer: SimLayer;
}

/**
 * a CritEngine over a real sim layer with the Pixi app faked out: the real class
 * prototype (so `attachAudio` / `destroy` are the shipped implementations) with
 * only the state those two methods read planted on the instance.
 */
function engineOver(sim: Simulation): { engine: CritEngine; destroyedApp: () => boolean } {
    let appDestroyed = false;
    const parts: EngineParts = {
        app: {
            destroy: () => {
                appDestroyed = true;
            },
        },
        simLayer: new SimLayer(sim),
    };
    const engine = Object.create(CritEngine.prototype) as CritEngine;
    Object.assign(engine, parts);
    return { engine, destroyedApp: () => appDestroyed };
}

/** a recording stand-in for AudioEngine — no AudioContext needed. */
function recorder(): SimAudioSink & { calls: { method: string; arg: number }[] } {
    const calls: { method: string; arg: number }[] = [];
    return {
        calls,
        quench: (intensity = 1) => calls.push({ method: "quench", arg: intensity }),
        ignite: () => calls.push({ method: "ignite", arg: 0 }),
        goldLand: (value: number) => calls.push({ method: "goldLand", arg: value }),
    };
}

/** drop a valued molten pool at (x,y) and cool it under the freeze gate. */
function settleGold(sim: Simulation, x: number, y: number, value: number): void {
    sim.paint(x, y, 0, Mat.MOLTEN_GOLD);
    sim.addValue(x, y, value);
    sim.heat[y * sim.W + x] = 0;
    sim.step();
}

describe("CritEngine.attachAudio", () => {
    it("wires the app's synth to the running storm's sim", () => {
        const sim = new Simulation(W, H);
        const { engine } = engineOver(sim);
        const audio = recorder();

        engine.attachAudio(audio);
        settleGold(sim, 6, H - 1, 420);

        expect(audio.calls).toEqual([{ method: "goldLand", arg: 420 }]);
    });

    it("is silent until a synth is attached (a storm can run without audio)", () => {
        const sim = new Simulation(W, H);
        engineOver(sim);

        expect(() => settleGold(sim, 6, H - 1, 420)).not.toThrow();
    });

    it("destroy releases the subscription, so a remount cannot stack tells", () => {
        const sim = new Simulation(W, H);
        const { engine, destroyedApp } = engineOver(sim);
        const audio = recorder();

        engine.attachAudio(audio);
        engine.destroy();
        settleGold(sim, 6, H - 1, 420);

        expect(audio.calls).toHaveLength(0);
        expect(destroyedApp()).toBe(true); // the rest of teardown still ran
    });

    it("two storms in a row leave exactly one live subscription", () => {
        // the remount shape: build, attach, destroy, then a fresh engine on a fresh
        // sim. the dead storm's synth must hear nothing from the new world.
        const firstSim = new Simulation(W, H);
        const first = engineOver(firstSim);
        const firstAudio = recorder();
        first.engine.attachAudio(firstAudio);
        first.engine.destroy();

        const secondSim = new Simulation(W, H);
        const second = engineOver(secondSim);
        const secondAudio = recorder();
        second.engine.attachAudio(secondAudio);

        settleGold(secondSim, 6, H - 1, 420);

        expect(firstAudio.calls).toHaveLength(0);
        expect(secondAudio.calls).toHaveLength(1);
    });
});
