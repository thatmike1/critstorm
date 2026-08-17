/**
 * holdout-cohort validation for the auto-striker overclock deficit-closure floor
 * (critstorm-5xo).
 *
 * the committed floor asserts that turret overclock closes at least 90% of the
 * cores/min deficit the plain turret opens against no-turret play at minute 35 —
 * the design §2 identity guardrail in numbers: automation may route wealth, so it
 * must not cost the player most of their throughput, but it must also stay short
 * of the no-turret ceiling (automation never strictly dominates hands-on play).
 *
 * the original tuning used the same 129 seeds that the assertion reads, so the
 * 90.36% result could not distinguish "tuned correctly" from "fitted to these
 * seeds". this module separates the two: it names the exact tuning seed set,
 * mints holdout cohorts that are provably disjoint from it by strict numeric
 * range, and reports the full distribution rather than a single median.
 */
import { bankAtN } from "./bot-strategy";
import {
    competentPacingProfile,
    LATE_PACING_SAMPLE_MINUTES,
    runStormBot,
    type StormBotSummary,
} from "./storm-bot";

/** first seed of the original tuning cohort, as written in the pinned sweep. */
export const OVERCLOCK_TUNING_SEED_BASE = 1000;

/** arithmetic stride between consecutive tuning seeds. */
export const OVERCLOCK_TUNING_SEED_STRIDE = 40507;

/** odd cohort size the median-based late-pacing summary requires. */
export const OVERCLOCK_COHORT_SIZE = 129;

/**
 * first seed of holdout space. every tuning seed is at most
 * `1000 + 40507 * 128 = 5_185_896`, so any seed at or above this base is outside
 * the tuning set by strict numeric separation — disjointness is a range fact, not
 * a coincidence of the generator. `overclockSeedsAreHoldout` re-checks it.
 */
export const OVERCLOCK_HOLDOUT_SEED_BASE = 100_000_000;

/** minute at which the deficit-closure floor is evaluated. */
export const DEFICIT_SAMPLE_MINUTE = 35;

/** design-intent floor: overclock must recover at least this share of the deficit. */
export const DEFICIT_CLOSURE_FLOOR = 0.9;

/**
 * the exact seed set the overclock constants were tuned against and that the
 * pinned 129-seed sweep still asserts on. reproduced from the same expression so
 * the two can never silently drift apart.
 */
export function overclockTuningSeeds(): number[] {
    return Array.from(
        { length: OVERCLOCK_COHORT_SIZE },
        (_, i) => (OVERCLOCK_TUNING_SEED_BASE + i * OVERCLOCK_TUNING_SEED_STRIDE) | 0
    );
}

/**
 * mint one holdout cohort. cohorts are consecutive, non-overlapping blocks of the
 * same stride starting at {@link OVERCLOCK_HOLDOUT_SEED_BASE}, so cohort `n` shares
 * no seed with cohort `m !== n` nor with the tuning set. the largest seed reachable
 * here stays well inside int32, so the `| 0` never wraps two indices onto one seed.
 */
export function overclockHoldoutSeeds(
    cohortIndex: number,
    size: number = OVERCLOCK_COHORT_SIZE
): number[] {
    if (!Number.isInteger(cohortIndex) || cohortIndex < 0) {
        throw new Error("cohortIndex must be a non-negative integer");
    }
    if (!Number.isInteger(size) || size <= 0 || size % 2 === 0) {
        throw new Error("size must be a positive odd integer (median needs an odd cohort)");
    }
    const start = cohortIndex * size;
    return Array.from({ length: size }, (_, i) => {
        const seed = OVERCLOCK_HOLDOUT_SEED_BASE + (start + i) * OVERCLOCK_TUNING_SEED_STRIDE;
        if (seed > 0x7fff_ffff) throw new Error("holdout seed left the int32 range");
        return seed;
    });
}

/** true when no seed in `seeds` appears in the tuning cohort. */
export function overclockSeedsAreHoldout(seeds: readonly number[]): boolean {
    const tuning = new Set(overclockTuningSeeds());
    return seeds.every((seed) => !tuning.has(seed));
}

/** the three ablation arms of the deficit measurement, sampled seed for seed. */
export interface DeficitArms {
    /** turret placed, bank-earned overclock active. */
    overclock: number[];
    /** turret placed, overclock suppressed — the deficit this measurement closes. */
    baseline: number[];
    /** no turret at all — the hands-on ceiling the deficit is measured against. */
    noTurret: number[];
}

/** a summarised sample of one arm on one seed. */
interface ArmRun {
    seed: number;
    coresPerMin: number;
}

/** nearest-rank quantile, matching the convention the pinned sweep already uses. */
export function quantile(values: readonly number[], p: number): number {
    if (values.length === 0) throw new Error("quantile of an empty sample");
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * p)];
}

/** the shape reported for every measured statistic — never a bare median. */
export interface Distribution {
    count: number;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    mean: number;
    stdDev: number;
    /** share of observations strictly below the floor the statistic is judged against. */
    belowFloorFraction: number;
    belowFloorCount: number;
}

/** reduce a sample to median plus spread, plus how much of it sits under `floor`. */
export function describeDistribution(
    values: readonly number[],
    floor: number = DEFICIT_CLOSURE_FLOOR
): Distribution {
    if (values.length === 0) throw new Error("cannot describe an empty sample");
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const belowFloorCount = values.filter((value) => value < floor).length;
    return {
        count: values.length,
        min: Math.min(...values),
        q1: quantile(values, 0.25),
        median: quantile(values, 0.5),
        q3: quantile(values, 0.75),
        max: Math.max(...values),
        mean,
        stdDev: Math.sqrt(variance),
        belowFloorFraction: belowFloorCount / values.length,
        belowFloorCount,
    };
}

/** run one seed through one ablation arm and read its minute-35 cores/min. */
function runArm(seed: number, allowTurret: boolean, allowOverclock: boolean): ArmRun {
    const summary: StormBotSummary = runStormBot({
        durationSec: DEFICIT_SAMPLE_MINUTE * 60,
        seed,
        profile: competentPacingProfile(allowTurret, allowOverclock),
        strategy: bankAtN(6),
        sampleAtMinutes: LATE_PACING_SAMPLE_MINUTES,
    });
    const sample = summary.samples.find(
        (candidate) => candidate.minute === DEFICIT_SAMPLE_MINUTE
    );
    if (!sample) throw new Error(`missing ${DEFICIT_SAMPLE_MINUTE}m sample for seed ${seed}`);
    return { seed, coresPerMin: sample.coresPerMin };
}

/** the measured result of one cohort, at both cohort and per-storm resolution. */
export interface DeficitCohortResult {
    seeds: number[];
    arms: DeficitArms;
    /** arm medians at minute 35, the inputs to the committed statistic. */
    armMedians: { overclock: number; baseline: number; noTurret: number };
    /**
     * the committed statistic: deficit closure computed from the three cohort
     * medians, exactly as the pinned sweep computes it.
     */
    cohortDeficitClosed: number;
    /** overclock relative to the no-turret ceiling, on cohort medians. */
    cohortOverclockOverNoTurret: number;
    /**
     * per-storm deficit closure, one value per seed with a positive denominator.
     * this is the variance the median statistic hides.
     */
    perSeedDeficitClosed: number[];
    /**
     * seeds where the plain turret already matched or beat no-turret play, so the
     * deficit ratio has a non-positive denominator and is undefined. reported
     * rather than dropped silently, because dropping them would bias the spread.
     */
    degenerateSeeds: number[];
}

/**
 * measure one cohort across all three ablation arms. every arm sees the identical
 * seed list, so per-seed pairing is valid and the deficit ratio can be evaluated
 * storm by storm rather than only on cohort medians.
 */
export function measureDeficitCohort(seeds: readonly number[]): DeficitCohortResult {
    const overclock = seeds.map((seed) => runArm(seed, true, true));
    const baseline = seeds.map((seed) => runArm(seed, true, false));
    const noTurret = seeds.map((seed) => runArm(seed, false, false));

    const arms: DeficitArms = {
        overclock: overclock.map((run) => run.coresPerMin),
        baseline: baseline.map((run) => run.coresPerMin),
        noTurret: noTurret.map((run) => run.coresPerMin),
    };
    const armMedians = {
        overclock: quantile(arms.overclock, 0.5),
        baseline: quantile(arms.baseline, 0.5),
        noTurret: quantile(arms.noTurret, 0.5),
    };

    const perSeedDeficitClosed: number[] = [];
    const degenerateSeeds: number[] = [];
    for (let i = 0; i < seeds.length; i++) {
        const denominator = arms.noTurret[i] - arms.baseline[i];
        if (denominator > 0) {
            perSeedDeficitClosed.push((arms.overclock[i] - arms.baseline[i]) / denominator);
        } else {
            degenerateSeeds.push(seeds[i]);
        }
    }

    return {
        seeds: [...seeds],
        arms,
        armMedians,
        cohortDeficitClosed:
            (armMedians.overclock - armMedians.baseline) /
            (armMedians.noTurret - armMedians.baseline),
        cohortOverclockOverNoTurret: armMedians.overclock / armMedians.noTurret,
        perSeedDeficitClosed,
        degenerateSeeds,
    };
}
