/**
 * headless storm simulator CLI (design.md §6). runs the economy + sim core
 * under a bot strategy and prints a per-minute progression table plus a storm
 * summary. deterministic for a fixed seed.
 *
 *   npm run sim                          # default storm (bank-at-6, 45 min, seed 42)
 *   npm run sim -- --duration 20 --strategy always-ride --seed 7
 *   npm run sim -- --strategy bank-at-8
 *   npm run sim -- --mode economy        # legacy greedy-economy table
 *   npm run sim 20                       # legacy: economy table, 20 minutes
 *
 * flags: --duration <minutes> --strategy <never-ride|always-ride|bank-at-n>
 *        --seed <int> --mode <storm|economy>
 */
import { buy, createState, critChance, critMulti, expectedDps, tick } from "../src/game/economy";
import { formatNumber } from "../src/game/format";
import { strategyByName } from "./bot-strategy";
import { mulberry32 } from "./rng";
import { greedyBuy, StormSimulator, type StormSummary } from "./storm-simulator";

interface CliArgs {
    mode: "storm" | "economy";
    durationMin: number;
    strategy: string;
    seed: number;
}

/** parse argv into typed options, preserving the legacy `sim <minutes>` form */
function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = { mode: "storm", durationMin: 45, strategy: "bank-at-6", seed: 42 };

    // legacy positional: a single bare number means "economy table, N minutes".
    if (argv.length === 1 && /^\d+(\.\d+)?$/.test(argv[0])) {
        return { ...args, mode: "economy", durationMin: Number(argv[0]) };
    }

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        switch (flag) {
            case "--mode":
                if (value !== "storm" && value !== "economy") {
                    throw new Error(`--mode must be storm|economy, got ${value}`);
                }
                args.mode = value;
                i++;
                break;
            case "--duration": {
                const duration = Number(value);
                if (!Number.isFinite(duration) || duration <= 0) {
                    throw new Error(`--duration must be a positive number, got ${value}`);
                }
                args.durationMin = duration;
                i++;
                break;
            }
            case "--strategy":
                args.strategy = value;
                i++;
                break;
            case "--seed": {
                const seed = Number(value);
                if (!Number.isFinite(seed)) {
                    throw new Error(`--seed must be a number, got ${value}`);
                }
                args.seed = seed;
                i++;
                break;
            }
            default:
                throw new Error(`unknown argument: ${flag}`);
        }
    }
    return args;
}

/**
 * legacy greedy-economy progression table (the original `npm run sim` output).
 * preserved verbatim so balance snapshots taken against it still line up.
 */
function runEconomyMode(minutes: number, seed: number): void {
    const step = 0.05;
    const rng = mulberry32(seed);
    const s = createState();

    console.log("min | essence   | dps       | crit%  | multi | levels (chance/multi/rate)");
    console.log("----|-----------|-----------|--------|-------|---------------------------");

    let nextLog = 0;
    for (let t = 0; t < minutes * 60; t += step) {
        tick(s, step, rng);
        const id = greedyBuy(s);
        if (id) buy(s, id);
        if (s.elapsed >= nextLog) {
            const l = s.levels;
            console.log(
                `${String(Math.round(nextLog / 60)).padStart(3)} | ${formatNumber(s.essence).padStart(9)} | ${formatNumber(expectedDps(s)).padStart(9)} | ${(critChance(s) * 100).toFixed(1).padStart(5)}% | ${critMulti(s).toFixed(1).padStart(5)} | ${l.critChance}/${l.critMulti}/${l.attackRate}`
            );
            nextLog += 60;
        }
    }

    console.log(`\ntotal damage dealt: ${formatNumber(s.totalDamage)}`);
}

/** render the storm per-minute table and end-of-storm summary */
function printStorm(summary: StormSummary): void {
    console.log(
        `storm  strategy=${summary.strategy}  seed=${summary.seed}  duration=${summary.durationSec}s`
    );
    console.log(
        "min | cumEssence| cores | dps       | crit%  | multi | core°  | rank      | levels (c/m/r/g)"
    );
    console.log(
        "----|-----------|-------|-----------|--------|-------|--------|-----------|------------------"
    );
    for (const s of summary.samples) {
        const l = s.levels;
        const levels = `${l.critChance}/${l.critMulti}/${l.attackRate}/${l.golden}`;
        console.log(
            `${String(s.minute).padStart(3)} | ${formatNumber(s.cumulativeEssence).padStart(9)} | ${String(s.cores).padStart(5)} | ${formatNumber(s.dps).padStart(9)} | ${s.critPct.toFixed(1).padStart(5)}% | ${s.multi.toFixed(1).padStart(5)} | ${s.coreTemp.toFixed(0).padStart(6)} | ${s.rank.padEnd(9)} | ${levels}`
        );
    }

    console.log("\n--- storm summary ---");
    console.log(`rank           : ${summary.rank}`);
    console.log(`total damage   : ${formatNumber(summary.totalDamage)}`);
    console.log(`cum essence    : ${formatNumber(summary.cumulativeEssence)}`);
    console.log(`storm cores    : ${summary.cores}`);
    console.log(`final essence  : ${formatNumber(summary.finalEssence)}`);
    console.log(`final dps      : ${formatNumber(summary.finalDps)}`);
    console.log(`attacks        : ${summary.attacks}`);
    console.log(`crits          : ${summary.crits}`);
    console.log(`golden hits    : ${summary.goldenHits}`);
    console.log(`banks          : ${summary.banks}  (0 until surge mechanics land)`);
    console.log(`busts          : ${summary.busts}  (0 until surge mechanics land)`);
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (args.mode === "economy") {
        runEconomyMode(args.durationMin, args.seed);
        return;
    }
    const summary = new StormSimulator({
        durationSec: args.durationMin * 60,
        strategy: strategyByName(args.strategy),
        seed: args.seed,
    }).run();
    printStorm(summary);
}

main();
