import { BufferImageSource, Sprite, Texture } from "pixi.js";
import type { PhaseChangeKind, Simulation } from "../sim/simulation";

/**
 * fixed sim timestep in seconds (20 Hz). must match the headless storm harness
 * (`sim/storm-simulator.ts` DEFAULT_STEP_SEC) so on-screen physics advances at the
 * same rate the economy was tuned against; a consistency test pins the two.
 */
export const SIM_STEP_SEC = 0.05;

/**
 * cap on sim steps advanced per rendered frame. after a stall (a backgrounded tab,
 * a GC pause) the accumulated delta can be huge; without a cap we would try to
 * catch up in one frame and spiral (each catch-up frame falls further behind).
 */
export const MAX_SIM_STEPS_PER_FRAME = 5;

/**
 * reinterpret the sim's packed-RGBA `Uint32` scene buffer as the byte view a GPU
 * texture uploads. the sim packs each cell as little-endian `0xAABBGGRR`, so the
 * underlying bytes are already in R,G,B,A order — i.e. `rgba8unorm`. this is a
 * ZERO-COPY view over the same `ArrayBuffer`: `writeImage()` writes `buf32` and
 * these bytes change in lockstep, so the texture never needs a per-frame copy.
 */
export function bytesOf(buf32: Uint32Array<ArrayBuffer>): Uint8Array {
    return new Uint8Array(buf32.buffer);
}

/**
 * drain a real-time delta into a whole number of fixed sim steps. `accumulatorSec`
 * carries the sub-step remainder across frames so the sim advances at a steady
 * {@link SIM_STEP_SEC} rate regardless of frame cadence. steps are capped at
 * `maxSteps`; when the cap is hit the leftover backlog is dropped (returned
 * accumulator resets toward 0) so a stall cannot snowball into a catch-up spiral.
 * pure and side-effect free so the timestep logic is unit-testable without a GPU.
 */
export function drainFixedSteps(
    accumulatorSec: number,
    elapsedMs: number,
    stepSec: number,
    maxSteps: number
): { steps: number; accumulatorSec: number } {
    let acc = accumulatorSec + elapsedMs / 1000;
    let steps = 0;
    while (acc >= stepSec && steps < maxSteps) {
        acc -= stepSec;
        steps++;
    }
    // hit the cap with time to spare: discard the backlog instead of banking debt.
    if (acc > stepSec) acc = 0;
    return { steps, accumulatorSec: acc };
}

// ---- sim-event -> audio bridge ------------------------------------------------
// the sim stays presentation-free: it exposes listener seams and knows nothing
// about sound. this is the game-side subscriber that turns those events into synth
// calls, kept as a plain function (no Pixi, no AudioContext) so it unit-tests.

/**
 * the slice of `AudioEngine` the sim-event bridge drives. structural, so a test can
 * pass a recorder and the bridge never needs a real AudioContext.
 */
export interface SimAudioSink {
    /** steam hiss; `intensity` in [0,1] scales loudness and length. */
    quench(intensity?: number): void;
    /** dry spark crackle from a seeded rng. */
    ignite(rng?: () => number): void;
    /** pentatonic tick for a gold cell settling with `value`. */
    goldLand(value: number): void;
}

/**
 * hiss intensity per phase-change kind. a single water cell flashing to steam is a
 * tick; lava crusting against coolant is the fat end of the same voice, so it gets
 * most of the range. `ignite` never reaches {@link SimAudioSink.quench}.
 */
export const PHASE_QUENCH_INTENSITY: Record<PhaseChangeKind, number> = {
    boil: 0.35,
    quench: 0.85,
    ignite: 0,
};

/**
 * subscribe a synth to the sim's gold-settle and phase-change seams (design §2
 * feedback): MOLTEN_GOLD→GOLD ticks, WATER→STEAM and lava-crust hiss, flammables
 * crackle. the returned function unsubscribes — call it on teardown so a replaced
 * sim cannot leak a listener into the audio engine. does NOT touch the gold-loss
 * seam, which the storm lifecycle owns.
 * @param rng seeded source handed to the ignition crackle (determinism convention).
 */
export function attachSimAudio(
    sim: Simulation,
    audio: SimAudioSink,
    rng: () => number = Math.random
): () => void {
    sim.setGoldSettleListener((e) => audio.goldLand(e.amount));
    sim.setPhaseChangeListener((e) => {
        if (e.kind === "ignite") audio.ignite(rng);
        else audio.quench(PHASE_QUENCH_INTENSITY[e.kind]);
    });
    return () => {
        sim.setGoldSettleListener(null);
        sim.setPhaseChangeListener(null);
    };
}

/**
 * renders a headless {@link Simulation}'s pixel buffer as a nearest-neighbor
 * upscaled Pixi sprite — the bottom layer of the CritEngine stage. owns exactly
 * one texture backed by the sim's `buf32` and reuses it forever: `update()` steps
 * the sim, refills the buffer, and re-uploads in place (the texture is never
 * recreated). the sim core stays untouched; this is a pure presentation adapter,
 * the Pixi-side sibling of the canvas `SimulationRenderer`.
 */
export class SimLayer {
    readonly sim: Simulation;
    readonly sprite: Sprite;
    private readonly source: BufferImageSource;
    private readonly texture: Texture;
    /** unspent real-time carried between frames, drained in fixed sim steps. */
    private accumulatorSec = 0;
    /** teardown for the live audio subscription; null when no synth is attached. */
    private audioDetach: (() => void) | null = null;

    constructor(sim: Simulation) {
        this.sim = sim;
        // pack the initial grid (e.g. the bootstrapped terrain floor) into buf32
        // so the very first uploaded frame shows the world even before any step.
        sim.writeImage();
        // one texture over the sim's own buffer bytes; `format` is forced because
        // BufferImageSource would otherwise infer `bgra8unorm` from a Uint8Array
        // and swap the red/blue channels of every cell.
        this.source = new BufferImageSource({
            resource: bytesOf(sim.buf32),
            width: sim.W,
            height: sim.H,
            format: "rgba8unorm",
            scaleMode: "nearest",
        });
        this.texture = new Texture({ source: this.source });
        this.sprite = new Sprite(this.texture);
    }

    /** stretch the layer to fill (w,h) screen px; nearest upscaling keeps cells crisp. */
    resize(w: number, h: number): void {
        this.sprite.width = w;
        this.sprite.height = h;
    }

    /**
     * advance the sim on a fixed 20 Hz timestep and re-upload its pixel buffer.
     * `elapsedMs` (the pixi ticker's real-time frame delta) is accumulated and
     * drained in fixed {@link SIM_STEP_SEC} increments, so the sim runs at a
     * deterministic rate independent of display refresh — a 144 Hz and a 60 Hz
     * monitor step it the same number of times per real second, keeping it in
     * lockstep with the dtMs-based crit-number overlay instead of drifting.
     * steps per frame are capped ({@link MAX_SIM_STEPS_PER_FRAME}) to avoid a
     * spiral-of-death after a stall. order within a step matters: step mutates the
     * grid, writeImage() packs it into `buf32` (which the texture bytes alias),
     * then source.update() flags the GPU upload — skipped entirely on frames that
     * advance no steps, since the buffer is unchanged.
     */
    update(elapsedMs: number): void {
        const { steps, accumulatorSec } = drainFixedSteps(
            this.accumulatorSec,
            elapsedMs,
            SIM_STEP_SEC,
            MAX_SIM_STEPS_PER_FRAME
        );
        this.accumulatorSec = accumulatorSec;
        if (steps === 0) return;
        this.sim.step(steps);
        this.sim.writeImage();
        this.source.update();
    }

    /**
     * subscribe a synth to this sim's event seams ({@link attachSimAudio}): settle
     * ticks, boil/quench hisses, ignition crackles. the layer already owns the sim's
     * presentation lifetime, so the subscription lives and dies with it. idempotent —
     * attaching again REPLACES the previous subscription instead of stacking a second
     * one, so a re-attach cannot double up the tells.
     * @param rng seeded source for the ignition crackle (determinism convention).
     */
    attachAudio(audio: SimAudioSink, rng: () => number = Math.random): void {
        this.detachAudio();
        this.audioDetach = attachSimAudio(this.sim, audio, rng);
    }

    /** drop the audio subscription if one is live; safe when none ever attached. */
    private detachAudio(): void {
        this.audioDetach?.();
        this.audioDetach = null;
    }

    /**
     * release the reused texture + its buffer source (the sprite is owned by the
     * stage) and unsubscribe any attached synth — a remounted storm builds a fresh
     * layer, so leaving the old subscription live would stack tells on a dead sim.
     */
    destroy(): void {
        this.detachAudio();
        this.texture.destroy(true);
    }
}
