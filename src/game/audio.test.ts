import { describe, expect, it } from "vitest";
import {
    crackleSchedule,
    GOLD_TICK_MAX_DEGREE,
    GOLD_TICK_MIN_INTERVAL,
    GOLD_TICK_ROOT_HZ,
    GOLD_TICK_WINDOW,
    GOLD_TICK_WINDOW_CAP,
    goldTickDegree,
    goldTickFreq,
    LIGHTNING_LIMITS,
    lightningCrackSchedule,
    newGoldTickState,
    newThrottleState,
    PHASE_LIMITS,
    pentatonicFreq,
    stepGoldTick,
    stepThrottle,
    SURGE_DRONE_BASE_HZ,
    surgeDroneFreq,
    surgeDroneGain,
} from "./audio";

/** deterministic stand-in rng: cycles a fixed ladder of values in [0,1). */
function seededRng(seed = 1): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

describe("pentatonicFreq", () => {
    it("puts degree 0 on the root and degree 5 an octave up", () => {
        expect(pentatonicFreq(0)).toBeCloseTo(GOLD_TICK_ROOT_HZ, 5);
        expect(pentatonicFreq(5)).toBeCloseTo(GOLD_TICK_ROOT_HZ * 2, 5);
        expect(pentatonicFreq(10)).toBeCloseTo(GOLD_TICK_ROOT_HZ * 4, 5);
    });

    it("is strictly rising and clamps negative degrees to the root", () => {
        for (let d = 0; d < GOLD_TICK_MAX_DEGREE; d++) {
            expect(pentatonicFreq(d + 1)).toBeGreaterThan(pentatonicFreq(d));
        }
        expect(pentatonicFreq(-3)).toBeCloseTo(GOLD_TICK_ROOT_HZ, 5);
    });

    it("emits only pentatonic scale degrees, never a chromatic step", () => {
        const allowed = new Set([0, 2, 4, 7, 9]);
        for (let d = 0; d <= GOLD_TICK_MAX_DEGREE; d++) {
            const semis = Math.round(12 * Math.log2(pentatonicFreq(d) / GOLD_TICK_ROOT_HZ));
            expect(allowed.has(((semis % 12) + 12) % 12)).toBe(true);
        }
    });
});

describe("goldTickDegree", () => {
    it("clamps to the scale range for junk and jackpot values", () => {
        expect(goldTickDegree(0)).toBe(0);
        expect(goldTickDegree(-5)).toBe(0);
        expect(goldTickDegree(NaN)).toBe(0);
        expect(goldTickDegree(1e30)).toBe(GOLD_TICK_MAX_DEGREE);
    });

    it("never falls as value rises", () => {
        let prev = -1;
        for (const v of [0, 1, 5, 20, 100, 1e3, 1e5, 1e8, 1e12]) {
            const d = goldTickDegree(v);
            expect(d).toBeGreaterThanOrEqual(prev);
            prev = d;
        }
    });

    it("quantizes similar values to the same degree so a cascade arpeggiates", () => {
        expect(goldTickDegree(100)).toBe(goldTickDegree(105));
    });

    it("climbs about four degrees per order of magnitude", () => {
        expect(goldTickDegree(1e4) - goldTickDegree(1e3)).toBe(4);
    });

    it("goldTickFreq is the degree mapped onto the scale", () => {
        expect(goldTickFreq(1234)).toBeCloseTo(pentatonicFreq(goldTickDegree(1234)), 5);
    });
});

describe("stepGoldTick", () => {
    it("plays the first tick", () => {
        const { play } = stepGoldTick(newGoldTickState(), 0);
        expect(play).toBe(true);
    });

    it("rejects a second tick inside the minimum interval", () => {
        const first = stepGoldTick(newGoldTickState(), 10);
        const second = stepGoldTick(first.state, 10 + GOLD_TICK_MIN_INTERVAL / 2);
        expect(second.play).toBe(false);
        expect(second.state.lastAt).toBe(first.state.lastAt);
    });

    it("allows a tick once the minimum interval has passed", () => {
        const first = stepGoldTick(newGoldTickState(), 10);
        const at = 10 + GOLD_TICK_MIN_INTERVAL * 1.01;
        const second = stepGoldTick(first.state, at);
        expect(second.play).toBe(true);
        expect(second.state.lastAt).toBe(at);
    });

    it("caps a dense cascade at the per-window voice budget", () => {
        let state = newGoldTickState();
        let played = 0;
        // 200 settle events over half a second — a big cascade.
        for (let i = 0; i < 200; i++) {
            const r = stepGoldTick(state, i * (GOLD_TICK_WINDOW / 200));
            state = r.state;
            if (r.play) played++;
        }
        expect(played).toBe(GOLD_TICK_WINDOW_CAP);
    });

    it("refills the budget on the next window", () => {
        let state = newGoldTickState();
        for (let i = 0; i < 200; i++) state = stepGoldTick(state, i * 0.001).state;
        const next = stepGoldTick(state, GOLD_TICK_WINDOW + 0.001);
        expect(next.play).toBe(true);
        expect(next.state.windowCount).toBe(1);
    });

    it("is pure — the input state is never mutated", () => {
        const state = newGoldTickState();
        stepGoldTick(state, 5);
        expect(state).toEqual(newGoldTickState());
    });
});

describe("surge drone mapping", () => {
    it("sits at the base pitch and near-silent at zero load", () => {
        expect(surgeDroneFreq(0)).toBeCloseTo(SURGE_DRONE_BASE_HZ, 5);
        expect(surgeDroneGain(0)).toBeLessThan(0.02);
    });

    it("rises monotonically in pitch and loudness with core load", () => {
        for (let i = 0; i < 20; i++) {
            const a = i / 20;
            const b = (i + 1) / 20;
            expect(surgeDroneFreq(b)).toBeGreaterThan(surgeDroneFreq(a));
            expect(surgeDroneGain(b)).toBeGreaterThan(surgeDroneGain(a));
        }
    });

    it("accelerates near the top of the gauge", () => {
        const low = surgeDroneFreq(0.25) - surgeDroneFreq(0);
        const high = surgeDroneFreq(1) - surgeDroneFreq(0.75);
        expect(high).toBeGreaterThan(low);
    });

    it("clamps out-of-range loads instead of running away", () => {
        expect(surgeDroneFreq(-1)).toBe(surgeDroneFreq(0));
        expect(surgeDroneFreq(5)).toBe(surgeDroneFreq(1));
        expect(surgeDroneGain(5)).toBe(surgeDroneGain(1));
    });

    it("stays quieter than the bank payoff at full load", () => {
        expect(surgeDroneGain(1)).toBeLessThan(0.12);
    });
});

describe("lightning throttle", () => {
    it("collapses a multi-strike frame into one crack", () => {
        let state = newThrottleState();
        let played = 0;
        // a rod firing five strikes inside a single frame, all at the same clock.
        for (let i = 0; i < 5; i++) {
            const r = stepThrottle(state, 12, LIGHTNING_LIMITS);
            state = r.state;
            if (r.play) played++;
        }
        expect(played).toBe(1);
    });

    it("lets a second strike through once the minimum interval passes", () => {
        const first = stepThrottle(newThrottleState(), 0, LIGHTNING_LIMITS);
        const at = LIGHTNING_LIMITS.minInterval * 1.01;
        const second = stepThrottle(first.state, at, LIGHTNING_LIMITS);
        expect(second.play).toBe(true);
    });

    it("caps a sustained lightning front at the per-window budget", () => {
        let state = newThrottleState();
        let played = 0;
        for (let i = 0; i < 60; i++) {
            const r = stepThrottle(state, i * (LIGHTNING_LIMITS.window / 60), LIGHTNING_LIMITS);
            state = r.state;
            if (r.play) played++;
        }
        expect(played).toBe(LIGHTNING_LIMITS.cap);
    });

    it("is sharper than the gold tick and never stacks more than a pair", () => {
        expect(LIGHTNING_LIMITS.minInterval).toBeGreaterThan(GOLD_TICK_MIN_INTERVAL);
        expect(LIGHTNING_LIMITS.cap).toBeLessThanOrEqual(2);
    });
});

describe("phase-tell throttle", () => {
    it("collapses a whole boiling front inside one step to a handful of hisses", () => {
        let state = newThrottleState();
        let played = 0;
        // the sim fires the phase seam per CELL: 40 cells flashing at one clock.
        for (let i = 0; i < 40; i++) {
            const r = stepThrottle(state, 3, PHASE_LIMITS);
            state = r.state;
            if (r.play) played++;
        }
        expect(played).toBe(1);
    });

    it("caps a sustained front at the per-window budget", () => {
        let state = newThrottleState();
        let played = 0;
        for (let i = 0; i < 200; i++) {
            const r = stepThrottle(state, i * (PHASE_LIMITS.window / 200), PHASE_LIMITS);
            state = r.state;
            if (r.play) played++;
        }
        expect(played).toBe(PHASE_LIMITS.cap);
    });

    it("is looser than the lightning gate — steam is texture, not an event", () => {
        expect(PHASE_LIMITS.cap).toBeGreaterThan(LIGHTNING_LIMITS.cap);
        expect(PHASE_LIMITS.minInterval).toBeLessThan(LIGHTNING_LIMITS.minInterval);
    });
});

describe("lightningCrackSchedule", () => {
    it("is deterministic for a given seeded rng and varies across seeds", () => {
        expect(lightningCrackSchedule(seededRng(9))).toEqual(lightningCrackSchedule(seededRng(9)));
        expect(lightningCrackSchedule(seededRng(9))).not.toEqual(
            lightningCrackSchedule(seededRng(10))
        );
    });

    it("fits the whole snap inside ~30 ms", () => {
        for (const s of lightningCrackSchedule(seededRng(11))) {
            expect(s.delay).toBeGreaterThanOrEqual(0);
            expect(s.delay).toBeLessThanOrEqual(0.03);
        }
    });

    it("stays in key at the top of the pentatonic ladder", () => {
        const top = new Set<number>();
        for (let d = GOLD_TICK_MAX_DEGREE - 4; d <= GOLD_TICK_MAX_DEGREE; d++) {
            top.add(pentatonicFreq(d));
        }
        for (let seed = 1; seed <= 20; seed++) {
            for (const s of lightningCrackSchedule(seededRng(seed))) {
                expect(top.has(s.freq)).toBe(true);
            }
        }
    });

    it("hits harder than an ignition spark and decays across the snap", () => {
        const sparks = lightningCrackSchedule(seededRng(12));
        const loudestIgnite = Math.max(...crackleSchedule(seededRng(12)).map((s) => s.gain));
        expect(sparks[0].gain).toBeGreaterThan(loudestIgnite);
        expect(sparks[sparks.length - 1].gain).toBeLessThan(sparks[0].gain);
    });

    it("honours the spark count", () => {
        expect(lightningCrackSchedule(seededRng(13), 6)).toHaveLength(6);
    });
});

describe("crackleSchedule", () => {
    it("is deterministic for a given seeded rng", () => {
        expect(crackleSchedule(seededRng(7))).toEqual(crackleSchedule(seededRng(7)));
    });

    it("differs across seeds", () => {
        expect(crackleSchedule(seededRng(1))).not.toEqual(crackleSchedule(seededRng(2)));
    });

    it("keeps every spark inside the burst window with audible values", () => {
        for (const s of crackleSchedule(seededRng(3), 12)) {
            expect(s.delay).toBeGreaterThanOrEqual(0);
            expect(s.delay).toBeLessThanOrEqual(0.16);
            expect(s.freq).toBeGreaterThan(200);
            expect(s.freq).toBeLessThan(4000);
            expect(s.gain).toBeGreaterThan(0);
            expect(s.gain).toBeLessThanOrEqual(0.05);
        }
    });

    it("honours the spark count and handles the single-spark edge", () => {
        expect(crackleSchedule(seededRng(4), 12)).toHaveLength(12);
        const one = crackleSchedule(seededRng(4), 1);
        expect(one).toHaveLength(1);
        expect(Number.isFinite(one[0].freq)).toBe(true);
    });

    it("decays in gain across the burst", () => {
        const sparks = crackleSchedule(seededRng(5), 8);
        expect(sparks[sparks.length - 1].gain).toBeLessThan(sparks[0].gain);
    });
});
