import { describe, expect, it } from "vitest";
import {
    DEFICIT_CLOSURE_FLOOR,
    OVERCLOCK_COHORT_SIZE,
    describeDistribution,
    measureDeficitCohort,
    overclockHoldoutSeeds,
    overclockSeedsAreHoldout,
    overclockTuningSeeds,
    quantile,
} from "./overclock-holdout";

// every measurement here is seeded and paired arm-for-arm, so these are
// deterministic computations rather than flaky statistics. the heavy multi-cohort
// sweep behind the numbers quoted in the comments lives in
// sim/overclock-holdout-sweep.ts and is deliberately not part of the suite.

/** one holdout cohort costs ~3.5s of cpu; well over vitest's 5s default. */
const COHORT_TIMEOUT_MS = 60_000;

let cachedCohort: ReturnType<typeof measureDeficitCohort> | null = null;

/**
 * measure holdout cohort 0 at most once per file. both assertions below read the
 * same run, so the suite pays for 129 seeds x 3 arms once rather than twice.
 */
function holdoutCohortZero(): ReturnType<typeof measureDeficitCohort> {
    cachedCohort ??= measureDeficitCohort(overclockHoldoutSeeds(0));
    return cachedCohort;
}

describe("overclock holdout seed hygiene", () => {
    it("reproduces the exact tuning seed set the pinned sweep asserts on", () => {
        const tuning = overclockTuningSeeds();
        expect(tuning).toHaveLength(OVERCLOCK_COHORT_SIZE);
        expect(tuning[0]).toBe(1000);
        expect(tuning.at(-1)).toBe(5_185_896);
        expect(new Set(tuning).size).toBe(OVERCLOCK_COHORT_SIZE);
    });

    it("mints holdout cohorts that are disjoint from the tuning seeds and each other", () => {
        const tuning = new Set(overclockTuningSeeds());
        const seen = new Set<number>();
        for (let cohort = 0; cohort < 24; cohort++) {
            const seeds = overclockHoldoutSeeds(cohort);
            expect(seeds).toHaveLength(OVERCLOCK_COHORT_SIZE);
            for (const seed of seeds) {
                // disjointness is a range fact: the largest tuning seed is 5_185_896.
                expect(seed).toBeGreaterThan(5_185_896);
                expect(tuning.has(seed)).toBe(false);
                expect(seen.has(seed)).toBe(false);
                seen.add(seed);
            }
            expect(overclockSeedsAreHoldout(seeds)).toBe(true);
        }
        expect(seen.size).toBe(24 * OVERCLOCK_COHORT_SIZE);
    });

    it("rejects cohort shapes the median statistic cannot consume", () => {
        expect(() => overclockHoldoutSeeds(-1)).toThrow(/cohortIndex/);
        expect(() => overclockHoldoutSeeds(0, 128)).toThrow(/odd/);
        expect(() => describeDistribution([])).toThrow(/empty/);
        expect(() => quantile([], 0.5)).toThrow(/empty/);
    });
});

describe("overclock deficit closure on holdout seeds (critstorm-5xo)", () => {
    /**
     * CHARACTERISATION, NOT A TARGET. the 90% deficit-closure floor was tuned on
     * the 129 seeds that sim/storm-bot.test.ts still asserts on, where it reads
     * 0.9036. on holdout seeds it does not survive: a 24-cohort sweep of 3096
     * fresh seeds put every single cohort below the floor (median -0.107,
     * stddev 0.270, best cohort 0.345), placing the tuning value ~3.8 standard
     * deviations above the holdout mean. the assertions below pin what the build
     * actually does so the failure cannot be mistaken for a passing floor; they
     * are expected to fail the day the balance genuinely changes, which is the
     * signal to revisit the floor rather than to re-pin these numbers.
     */
    it("does not meet the 90% floor on a cohort it was never tuned against", () => {
        expect(overclockSeedsAreHoldout(overclockHoldoutSeeds(0))).toBe(true);
        const result = holdoutCohortZero();

        expect(result.armMedians.overclock).toBeCloseTo(139.371428, 5);
        expect(result.armMedians.baseline).toBeCloseTo(155.685714, 5);
        expect(result.armMedians.noTurret).toBeCloseTo(237, 5);
        expect(result.cohortDeficitClosed).toBeCloseTo(-0.200632, 6);
        expect(result.cohortOverclockOverNoTurret).toBeCloseTo(0.588065, 6);

        expect(result.cohortDeficitClosed).toBeLessThan(DEFICIT_CLOSURE_FLOOR);
        // the paired ceiling guardrail (automation never beats hands-on) does hold.
        expect(result.armMedians.overclock).toBeLessThan(result.armMedians.noTurret);
    }, COHORT_TIMEOUT_MS);

    /**
     * the per-storm spread the median statistic hides. the cohort figure is a
     * ratio of differences of three separately-sorted medians, each drawn from a
     * cores/min distribution whose stddev is ~1.5x its own median; the
     * denominator is a small difference of two such medians, so the ratio is not
     * a stable estimator at n=129 in either direction.
     */
    it("shows per-storm variance far wider than the band the floor lives in", () => {
        const result = holdoutCohortZero();
        const perStorm = describeDistribution(result.perSeedDeficitClosed);

        expect(perStorm.count).toBe(87);
        expect(result.degenerateSeeds).toHaveLength(42);
        expect(perStorm.median).toBeCloseTo(0.035901, 6);
        expect(perStorm.q1).toBeCloseTo(-0.313168, 6);
        expect(perStorm.q3).toBeCloseTo(0.6318095, 6);
        expect(perStorm.min).toBeCloseTo(-34.75, 4);
        expect(perStorm.max).toBeCloseTo(63.164071, 5);

        // spread dwarfs the 0.10-wide [floor, ceiling) band the two paired
        // assertions jointly demand, which is why no constant retune can hold it.
        expect(perStorm.stdDev).toBeGreaterThan(1);
        expect(perStorm.belowFloorFraction).toBeGreaterThan(0.5);
    }, COHORT_TIMEOUT_MS);
});
