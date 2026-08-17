/**
 * heavy holdout sweep for the overclock deficit-closure floor (critstorm-5xo).
 * kept out of the committed test suite because it runs thousands of 35-minute
 * storms; the suite commits one holdout cohort instead. emits markdown on stdout.
 *
 *   npx tsx sim/overclock-holdout-sweep.ts [cohorts]
 */
import {
    DEFICIT_CLOSURE_FLOOR,
    OVERCLOCK_COHORT_SIZE,
    describeDistribution,
    measureDeficitCohort,
    overclockHoldoutSeeds,
    overclockSeedsAreHoldout,
    overclockTuningSeeds,
    type Distribution,
} from "./overclock-holdout";

/** render a distribution as one markdown table row. */
function row(label: string, dist: Distribution, digits = 4): string {
    const f = (value: number): string => value.toFixed(digits);
    return `| ${label} | ${dist.count} | ${f(dist.min)} | ${f(dist.q1)} | ${f(dist.median)} | ${f(dist.q3)} | ${f(dist.max)} | ${f(dist.mean)} | ${f(dist.stdDev)} | ${dist.belowFloorCount} (${(dist.belowFloorFraction * 100).toFixed(2)}%) |`;
}

/** table header shared by every distribution table below. */
const HEADER = [
    "| sample | n | min | q1 | median | q3 | max | mean | stddev | < 0.90 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
].join("\n");

/** run the tuning cohort plus `cohorts` disjoint holdout cohorts and print results. */
function main(): void {
    const cohorts = Number(process.argv[2] ?? 24);
    if (!Number.isInteger(cohorts) || cohorts <= 0) throw new Error("cohorts must be a positive integer");

    const tuningSeeds = overclockTuningSeeds();
    const tuning = measureDeficitCohort(tuningSeeds);

    const lines: string[] = [];
    lines.push("## tuning cohort (reproduction)\n");
    lines.push(
        `seeds: \`(1000 + i * 40507) | 0\` for i in 0..${OVERCLOCK_COHORT_SIZE - 1} — ` +
            `[${tuningSeeds[0]} .. ${tuningSeeds[tuningSeeds.length - 1]}]\n`
    );
    lines.push(`- cohort deficit closed: **${tuning.cohortDeficitClosed.toFixed(6)}**`);
    lines.push(
        `- arm medians @35m — overclock ${tuning.armMedians.overclock}, baseline ${tuning.armMedians.baseline}, no-turret ${tuning.armMedians.noTurret}`
    );
    lines.push(
        `- overclock / no-turret: ${tuning.cohortOverclockOverNoTurret.toFixed(6)}`
    );
    lines.push(`- degenerate seeds (no-turret <= baseline): ${tuning.degenerateSeeds.length}\n`);
    lines.push("### per-storm deficit closure inside the tuning cohort\n");
    lines.push(HEADER);
    lines.push(row("tuning per-seed", describeDistribution(tuning.perSeedDeficitClosed)));
    lines.push("");

    const cohortStats: number[] = [];
    const pooledPerSeed: number[] = [];
    let pooledDegenerate = 0;
    const perCohortLines: string[] = [];

    for (let c = 0; c < cohorts; c++) {
        const seeds = overclockHoldoutSeeds(c);
        if (!overclockSeedsAreHoldout(seeds)) throw new Error(`cohort ${c} collided with tuning seeds`);
        const result = measureDeficitCohort(seeds);
        cohortStats.push(result.cohortDeficitClosed);
        pooledPerSeed.push(...result.perSeedDeficitClosed);
        pooledDegenerate += result.degenerateSeeds.length;
        perCohortLines.push(
            `| ${c} | ${seeds[0]} | ${seeds[seeds.length - 1]} | ${result.cohortDeficitClosed.toFixed(6)} | ${result.armMedians.overclock} | ${result.armMedians.baseline} | ${result.armMedians.noTurret} | ${result.cohortOverclockOverNoTurret.toFixed(6)} | ${result.degenerateSeeds.length} |`
        );
        process.stderr.write(`cohort ${c} done: ${result.cohortDeficitClosed.toFixed(6)}\n`);
    }

    lines.push(`## holdout cohorts (${cohorts} x ${OVERCLOCK_COHORT_SIZE} seeds)\n`);
    lines.push(
        "seeds: `100_000_000 + (cohort * 129 + i) * 40507`. every tuning seed is <= 5_185_896, " +
            "so the whole holdout space is disjoint from it by strict numeric range.\n"
    );
    lines.push(
        "| cohort | first seed | last seed | deficit closed | oc median | base median | noTurret median | oc/noTurret | degenerate |"
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    lines.push(...perCohortLines);
    lines.push("");

    lines.push("## distributions\n");
    lines.push(HEADER);
    lines.push(row("holdout cohort-level deficit closed", describeDistribution(cohortStats), 6));
    lines.push(row("holdout per-storm deficit closed", describeDistribution(pooledPerSeed)));
    lines.push("");
    lines.push(`degenerate per-storm observations across the pooled holdout: ${pooledDegenerate}`);
    lines.push(
        `floor: ${DEFICIT_CLOSURE_FLOOR}. cohorts below floor: ${describeDistribution(cohortStats).belowFloorCount} / ${cohortStats.length}.`
    );

    process.stdout.write(lines.join("\n") + "\n");
}

main();
