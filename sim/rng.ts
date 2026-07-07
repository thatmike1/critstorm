/**
 * deterministic seeded rng utilities shared across the storm harness, so a
 * fixed seed reproduces an entire run bit-for-bit — economy rolls and the sim's
 * internal randomness both flow from the same seed.
 */

/** a zero-argument function returning a float in [0, 1), same shape as Math.random */
export type Rng = () => number;

/** mulberry32: tiny, fast, deterministic 32-bit prng seeded from one integer */
export function mulberry32(seed: number): Rng {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * run `fn` with `Math.random` temporarily replaced by a seeded generator, then
 * restore the original in a finally block. the ported sim core reaches for the
 * global `Math.random` internally (cell dithering, bolt jitter); swapping it here
 * makes the physics deterministic for a seed without touching the core's
 * once-allocated buffers. the seed is offset so the sim's stream is independent
 * of the economy's, keeping economy determinism stable even if the sim's random
 * call count changes across refactors.
 */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
    const original = Math.random;
    Math.random = mulberry32((seed ^ 0x9e3779b9) | 0);
    try {
        return fn();
    } finally {
        Math.random = original;
    }
}
