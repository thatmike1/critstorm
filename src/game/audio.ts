/** clamp to [lo,hi]; NaN-safe enough for the mapping helpers below. */
function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

// ---- pure mappings (unit-tested in audio.test.ts, no AudioContext needed) ----

/** major-pentatonic semitone offsets — the chiptune scale every gold tick snaps to. */
export const PENTATONIC_SEMITONES = [0, 2, 4, 7, 9] as const;

/** root of the gold-tick scale (C4). */
export const GOLD_TICK_ROOT_HZ = 261.63;

/** highest scale degree a gold tick can reach (4 pentatonic octaves). */
export const GOLD_TICK_MAX_DEGREE = 19;

/**
 * frequency of a pentatonic scale degree above {@link GOLD_TICK_ROOT_HZ}. degree 5
 * is the octave, so the scale is 5 degrees per octave. negative degrees clamp to
 * the root; the ladder is unbounded upward (callers clamp via
 * {@link goldTickDegree}).
 */
export function pentatonicFreq(degree: number): number {
    const d = Math.max(0, Math.round(degree));
    const octave = Math.floor(d / 5);
    const semitone = PENTATONIC_SEMITONES[d % 5];
    return GOLD_TICK_ROOT_HZ * Math.pow(2, octave + semitone / 12);
}

/**
 * quantize a landed gold value to a pentatonic scale degree. log-scaled so a
 * cascade of similar-sized cells lands on the SAME degree (an arpeggio, not a
 * smear) while an order-of-magnitude jump climbs roughly four degrees. clamped to
 * [0, {@link GOLD_TICK_MAX_DEGREE}] so a jackpot cell can't shriek.
 */
export function goldTickDegree(value: number): number {
    if (!(value > 0)) return 0;
    return clamp(Math.round(Math.log10(1 + value) * 4), 0, GOLD_TICK_MAX_DEGREE);
}

/** pitch of a gold-settle tick for `value` — {@link goldTickDegree} on the scale. */
export function goldTickFreq(value: number): number {
    return pentatonicFreq(goldTickDegree(value));
}

/** shortest gap between two gold ticks, in seconds (~22 ticks/s ceiling). */
export const GOLD_TICK_MIN_INTERVAL = 0.045;

/** rolling window the voice cap is counted over, in seconds. */
export const GOLD_TICK_WINDOW = 0.5;

/** max gold ticks allowed inside one {@link GOLD_TICK_WINDOW}. */
export const GOLD_TICK_WINDOW_CAP = 8;

/** throttle bookkeeping for a self-limiting voice; see {@link stepThrottle}. */
export interface ThrottleState {
    /** timestamp of the last event that actually sounded. */
    lastAt: number;
    /** start of the current rolling window. */
    windowStart: number;
    /** events sounded since `windowStart`. */
    windowCount: number;
}

/** the two gates a throttled voice obeys, all in seconds/counts. */
export interface ThrottleLimits {
    /** shortest gap between two sounding events. */
    minInterval: number;
    /** rolling window the cap is counted over. */
    window: number;
    /** max events allowed inside one window. */
    cap: number;
}

/** a throttle state that has never fired. */
export function newThrottleState(): ThrottleState {
    return { lastAt: -Infinity, windowStart: -Infinity, windowCount: 0 };
}

/**
 * decide whether an event requested at `now` (seconds) may sound, and return the
 * advanced throttle state. two gates: a minimum interval so voices stay separable,
 * and a per-window cap so a burst plays a musical handful rather than a clipped
 * wall. pure — the engine only owns the state.
 */
export function stepThrottle(
    state: ThrottleState,
    now: number,
    limits: ThrottleLimits
): { state: ThrottleState; play: boolean } {
    let { windowStart, windowCount } = state;
    if (!(now - windowStart < limits.window)) {
        windowStart = now;
        windowCount = 0;
    }
    const play = now - state.lastAt >= limits.minInterval && windowCount < limits.cap;
    if (!play) return { state: { ...state, windowStart, windowCount }, play };
    return { state: { lastAt: now, windowStart, windowCount: windowCount + 1 }, play };
}

/** throttle bookkeeping for {@link AudioEngine.goldLand}. */
export type GoldTickState = ThrottleState;

/** a gold-tick throttle state that has never ticked. */
export function newGoldTickState(): GoldTickState {
    return newThrottleState();
}

/** the gold-settle gates: dense cascades collapse to a musical handful. */
export const GOLD_TICK_LIMITS: ThrottleLimits = {
    minInterval: GOLD_TICK_MIN_INTERVAL,
    window: GOLD_TICK_WINDOW,
    cap: GOLD_TICK_WINDOW_CAP,
};

/** {@link stepThrottle} bound to {@link GOLD_TICK_LIMITS}. */
export function stepGoldTick(
    state: GoldTickState,
    now: number
): { state: GoldTickState; play: boolean } {
    return stepThrottle(state, now, GOLD_TICK_LIMITS);
}

/** drone pitch at coreLoad 0 (a low hum you feel more than hear). */
export const SURGE_DRONE_BASE_HZ = 55;

/**
 * drone frequency for a surge core load in [0,1]. rises a perfect twelfth across
 * the range and accelerates near the top (load², so the last quarter of the gauge
 * climbs fastest) — the ear should hear the bust coming before the number does.
 */
export function surgeDroneFreq(coreLoad: number): number {
    const load = clamp(coreLoad, 0, 1);
    return SURGE_DRONE_BASE_HZ * Math.pow(2, 0.4 * load + 1.2 * load * load);
}

/**
 * drone loudness for a surge core load in [0,1]. quiet bed at the start, pushing
 * hard only once the core is genuinely hot; never loud enough to bury {@link
 * AudioEngine.bank}.
 */
export function surgeDroneGain(coreLoad: number): number {
    const load = clamp(coreLoad, 0, 1);
    return 0.015 + 0.075 * load * load;
}

/** one spark inside an {@link AudioEngine.ignite} crackle. */
export interface CrackleSpark {
    /** delay from the burst start, in seconds. */
    delay: number;
    /** square-voice pitch in Hz. */
    freq: number;
    /** peak gain. */
    gain: number;
}

/**
 * schedule the sparks of an ignition crackle from a seeded rng. deterministic for a
 * given rng, so the shape is unit-testable; the engine only renders what this
 * returns. sparks scatter across ~140 ms and fall in pitch as the burst decays.
 */
export function crackleSchedule(rng: () => number, count = 7): CrackleSpark[] {
    const sparks: CrackleSpark[] = [];
    for (let i = 0; i < count; i++) {
        const p = count === 1 ? 0 : i / (count - 1);
        sparks.push({
            delay: p * 0.14 + rng() * 0.02,
            freq: 1600 * Math.pow(0.55, p) * (0.85 + rng() * 0.3),
            gain: 0.05 * (1 - 0.6 * p),
        });
    }
    return sparks;
}

/**
 * lightning gates: a hard 90 ms minimum so a rod firing several strikes in one
 * frame reads as ONE crack, with a small per-window cap so a lightning front plus a
 * rod reward can still double-strike without stacking into mush.
 */
export const LIGHTNING_LIMITS: ThrottleLimits = { minInterval: 0.09, window: 0.6, cap: 2 };

/**
 * the bright transient of a lightning crack: a handful of very short, very high
 * square voices. pitches are drawn from the TOP of the pentatonic ladder
 * ({@link pentatonicFreq}) so even the snap stays in key, and the whole scatter
 * fits in ~30 ms — a snap, not a chord. deterministic for a given seeded rng.
 */
export function lightningCrackSchedule(rng: () => number, count = 3): CrackleSpark[] {
    const sparks: CrackleSpark[] = [];
    for (let i = 0; i < count; i++) {
        const degree = GOLD_TICK_MAX_DEGREE - 4 + Math.floor(rng() * 5);
        sparks.push({
            delay: i * 0.008 + rng() * 0.006,
            freq: pentatonicFreq(degree),
            gain: 0.13 * Math.pow(0.7, i),
        });
    }
    return sparks;
}

/** tiny webaudio synth for feedback blips — zero assets, everything is oscillators */
export class AudioEngine {
    private ctx: AudioContext | null = null;
    muted = false;
    private noise: AudioBuffer | null = null;
    private goldTick: GoldTickState = newGoldTickState();
    private lightningThrottle: ThrottleState = newThrottleState();
    private drone: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode } | null = null;

    /** browsers require a user gesture before audio; call this from any input handler */
    unlock(): void {
        this.ensure();
    }

    private ensure(): AudioContext {
        if (!this.ctx) this.ctx = new AudioContext();
        if (this.ctx.state === "suspended") void this.ctx.resume();
        return this.ctx;
    }

    private blip(
        freq: number,
        duration: number,
        type: OscillatorType,
        gain: number,
        delay = 0
    ): void {
        if (this.muted || !this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + duration);
    }

    /** crit blip: pitch and presence climb with the chain tier; silent for normal hits */
    attack(tier: number): void {
        if (tier < 1 || !this.ctx) return;
        const freq = 220 * Math.pow(1.26, tier);
        this.blip(freq, 0.12 + tier * 0.02, "square", Math.min(0.02 + tier * 0.012, 0.1));
        if (tier >= 4) this.blip(freq * 1.5, 0.25, "sawtooth", 0.05, 0.03);
    }

    /** golden hits get a little coin arpeggio */
    golden(): void {
        this.blip(880, 0.1, "triangle", 0.08);
        this.blip(1174, 0.1, "triangle", 0.08, 0.07);
        this.blip(1568, 0.18, "triangle", 0.08, 0.14);
    }

    /** purchase confirmation: two-note thunk-chime */
    buy(): void {
        this.blip(196, 0.08, "square", 0.07);
        this.blip(392, 0.15, "triangle", 0.09, 0.06);
    }

    /** frenzy ignition: rising four-note sweep */
    frenzy(): void {
        [330, 440, 587, 784].forEach((f, i) => this.blip(f, 0.14, "sawtooth", 0.07, i * 0.07));
    }

    /** jackpot catch: big slot-machine payout arpeggio */
    jackpot(): void {
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.blip(f, 0.2, "triangle", 0.1, i * 0.06));
        this.blip(262, 0.5, "square", 0.05, 0.1);
    }

    /**
     * BANK the surge pot (design §3): the spectacle payoff, so this is the loudest
     * moment in the game — a deep detonation boom under a rising gold arpeggio that
     * lengthens and brightens with the pot, so a jackpot bank sounds bigger than a
     * trickle. at least as loud as {@link jackpot} (peak gain ≥ its 0.1). `potValue`
     * scales the run length; a non-positive pot still rings the floor volley.
     */
    bank(potValue = 0): void {
        // heft in [0,1] from pot magnitude (log10) → a fatter pot rings longer/brighter.
        const heft = Math.min(1, Math.log10(1 + Math.max(0, potValue)) / 8);
        // deep detonation: a low sub swelling under the whole arpeggio.
        this.blip(90, 0.6, "square", 0.13);
        this.blip(60, 0.75, "sine", 0.11, 0.02);
        // rising gold arpeggio, brighter/louder than the jackpot payout run; 5→7 notes
        // as the pot grows so the bank literally sounds bigger the more you banked.
        const notes = [392, 523, 659, 784, 1047, 1319, 1568];
        const count = 5 + Math.round(heft * 2);
        for (let i = 0; i < count; i++) {
            this.blip(notes[i], 0.24, "triangle", 0.12, 0.05 + i * 0.06);
        }
        // a bright topping shimmer crowns a fat-pot bank.
        if (heft > 0.5) this.blip(2093, 0.3, "triangle", 0.09, 0.05 + count * 0.06);
    }

    // ---- sim-event layer (sh8.2) -------------------------------------------

    /** one second of white noise, built once and reused by every noise voice. */
    private noiseBuffer(ctx: AudioContext): AudioBuffer {
        if (this.noise) return this.noise;
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buf;
        return buf;
    }

    /**
     * play a filtered noise burst: the shared body of {@link quench}, {@link ignite}
     * and {@link bust}. `sweepTo` slides the filter cutoff across the burst (the one
     * place a glide is allowed — it is a texture, not a pitch).
     */
    private noiseBurst(opts: {
        duration: number;
        gain: number;
        type: BiquadFilterType;
        freq: number;
        sweepTo?: number;
        q?: number;
        delay?: number;
    }): void {
        if (this.muted || !this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime + (opts.delay ?? 0);
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = opts.type;
        filter.frequency.setValueAtTime(opts.freq, t);
        if (opts.sweepTo !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.duration);
        }
        filter.Q.value = opts.q ?? 1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(opts.gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
        src.connect(filter).connect(g).connect(ctx.destination);
        src.start(t);
        src.stop(t + opts.duration);
    }

    /**
     * molten gold hitting coolant: a short steam hiss, bandpass noise sweeping down
     * as the flash boils off. `intensity` in [0,1] scales loudness and length, so a
     * single droplet ticks and a whole stream roars.
     *
     * WIRING: the sim has no boil/quench event today — the phase changes happen
     * inline in `Simulation.updateWater` (WATER→STEAM) and `Simulation.updateLava`
     * (lava crust). Either add a listener seam mirroring `setGoldLossListener`, or
     * call this from the frame loop off a steam-cell delta.
     */
    quench(intensity = 1): void {
        const k = clamp(intensity, 0, 1);
        const dur = 0.18 + k * 0.22;
        this.noiseBurst({
            duration: dur,
            gain: 0.03 + k * 0.05,
            type: "bandpass",
            freq: 5200,
            sweepTo: 1400,
            q: 0.8,
        });
        // a dry high tick on the front so the hiss has an attack transient.
        this.blip(3136, 0.03, "square", 0.02 + k * 0.02);
    }

    /**
     * flammables catching (wood/oil/plant/gunpowder): a scatter of dry sparks over a
     * short noise puff. takes a seeded `rng` per the determinism convention; the
     * spark layout is {@link crackleSchedule}.
     *
     * WIRING: ignition is emergent inside `Simulation.updateFlammable` / the per-
     * material heat gates (`simulation.ts` ~lines 832–880) and emits no event. Needs
     * a new sim seam (an ignition listener alongside `setGoldLossListener`) before
     * this can fire on real ignitions.
     */
    ignite(rng: () => number = Math.random): void {
        if (this.muted || !this.ctx) return;
        this.noiseBurst({
            duration: 0.12,
            gain: 0.035,
            type: "highpass",
            freq: 1800,
        });
        for (const s of crackleSchedule(rng)) {
            this.blip(s.freq, 0.02, "square", s.gain, s.delay);
        }
    }

    /**
     * a solid-gold cell settling. pitch is quantized to a pentatonic scale by
     * log(value) ({@link goldTickFreq}) so a cascade arpeggiates instead of smearing,
     * and the call self-throttles via {@link stepGoldTick} — safe to call at tens of
     * hertz.
     *
     * WIRING: MOLTEN_GOLD freezes to GOLD in `Simulation.updateMoltenGold`
     * (`simulation.ts:1276`), which emits no event. Needs a settle listener on the
     * sim (same shape as the gold-loss seam) carrying the cell's carried value.
     */
    goldLand(value: number): void {
        if (this.muted || !this.ctx) return;
        const { state, play } = stepGoldTick(this.goldTick, this.ctx.currentTime);
        this.goldTick = state;
        if (!play) return;
        this.blip(goldTickFreq(value), 0.07, "triangle", 0.05);
    }

    /**
     * the live-surge drone: a continuous two-voice hum whose pitch and loudness rise
     * with `coreLoad` in [0,1] ({@link surgeDroneFreq} / {@link surgeDroneGain}).
     * idempotent and cheap — repeat calls RETUNE the existing voices rather than
     * respawning them. `coreLoad = 0` stops and disposes the drone.
     *
     * WIRING: the frame loop in `src/app.tsx`, right beside
     * `engine.applyTells(surge.active ? surge.coreLoad : 0)` (~app.tsx:435) — pass
     * the same expression so an idle surge silences the drone.
     */
    surgeDrone(coreLoad: number): void {
        const load = clamp(coreLoad, 0, 1);
        if (load <= 0 || this.muted || !this.ctx) {
            this.stopDrone();
            return;
        }
        const ctx = this.ctx;
        const freq = surgeDroneFreq(load);
        const gain = surgeDroneGain(load);
        if (!this.drone) {
            const osc = ctx.createOscillator();
            const sub = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = "square";
            sub.type = "triangle";
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            osc.connect(g);
            sub.connect(g);
            g.connect(ctx.destination);
            osc.start();
            sub.start();
            this.drone = { osc, sub, gain: g };
        }
        const d = this.drone;
        // short ramps, not steps: this runs every frame, and setValueAtTime spam
        // would zipper. the glide is intentional here (design language allows it
        // inside the drone only).
        const t = ctx.currentTime;
        d.osc.frequency.setTargetAtTime(freq, t, 0.05);
        d.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.05);
        d.gain.gain.setTargetAtTime(gain, t, 0.05);
    }

    /** tear down the surge drone if one is running. */
    private stopDrone(): void {
        const d = this.drone;
        if (!d || !this.ctx) return;
        this.drone = null;
        const t = this.ctx.currentTime;
        d.gain.gain.setTargetAtTime(0.0001, t, 0.03);
        d.osc.stop(t + 0.2);
        d.sub.stop(t + 0.2);
    }

    /**
     * a lightning strike (design §2: high tiers spray lava droplets and lightning):
     * crack then rumble. a bright in-key transient ({@link lightningCrackSchedule})
     * over a short highpassed noise crack, then a brief low tail — sharper and
     * louder than {@link ignite}, and deliberately over in ~0.4 s so it never reads
     * as the long {@link bust} detonation. takes a seeded `rng` per the determinism
     * convention.
     *
     * self-throttling via {@link LIGHTNING_LIMITS}, so calling it once per strike
     * inside a multi-strike loop collapses to a single crack instead of a clipped
     * pile-up.
     *
     * WIRING: `src/app.tsx` — the rod loop at ~line 442
     * (`for (let i = 0; i < rodStrikes; i++) runLightningRodStrike()`), and the
     * strike callback at ~line 306 where `attack(result.tier)` fires, gated on
     * `result.tier === MAX_TIER`.
     */
    lightning(rng: () => number = Math.random): void {
        if (this.muted || !this.ctx) return;
        const { state, play } = stepThrottle(
            this.lightningThrottle,
            this.ctx.currentTime,
            LIGHTNING_LIMITS
        );
        this.lightningThrottle = state;
        if (!play) return;
        // the snap: instantaneous, bright, in key.
        for (const s of lightningCrackSchedule(rng)) {
            this.blip(s.freq, 0.016, "square", s.gain, s.delay);
        }
        // the crack: a short highpassed noise chunk right behind the transient.
        this.noiseBurst({ duration: 0.09, gain: 0.14, type: "highpass", freq: 3000, delay: 0.005 });
        // the rumble: a brief lowpassed tail plus a low square thud. short on
        // purpose — this is a whip-crack, not the bust's detonation.
        this.noiseBurst({
            duration: 0.32,
            gain: 0.07,
            type: "lowpass",
            freq: 700,
            sweepTo: 160,
            delay: 0.06,
        });
        this.blip(98, 0.26, "square", 0.06, 0.06);
    }

    /**
     * the overheat bust (design §3): the pot burns instead of banking. a low
     * detonation rumble — sub sweep under a long lowpassed noise roar — deliberately
     * the darkest sound in the game, the negative image of {@link bank}. also kills
     * any running {@link surgeDrone}, since the surge is over.
     *
     * WIRING: `CritEngine.bust` (`src/game/crit-engine.ts:438`), the presentation-side
     * consumer of the surge machine's 'bust' exit; or the `app.tsx` onExit handler
     * (~app.tsx:209) that calls it.
     */
    bust(): void {
        this.stopDrone();
        if (this.muted || !this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        // sub detonation: a falling sine under everything.
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(28, t + 0.9);
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 1.1);
        // the roar: long lowpassed noise closing down as the fire settles.
        this.noiseBurst({
            duration: 1.0,
            gain: 0.11,
            type: "lowpass",
            freq: 900,
            sweepTo: 120,
        });
        // a dissonant square pair — the anti-fanfare.
        this.blip(73, 0.6, "square", 0.07, 0.02);
        this.blip(104, 0.5, "square", 0.05, 0.06);
    }
}
