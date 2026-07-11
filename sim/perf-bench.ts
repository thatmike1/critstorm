/**
 * headless perf benchmark for the sim core (design.md §7 perf pass, beads
 * critstorm-b4r.4). measures the WORST case for the dirty-chunk scheduler, not a
 * quiet flat: a full-width lava floor plus a heavy molten-gold pool. lava
 * re-emits (and, before this pass, self-woke) every frame, so the scheduler keeps
 * most chunks permanently active and buys almost nothing — this is the scene the
 * 60fps budget has to survive.
 *
 * reports ms/step for the sim step, writeImage(), and their sum (the "sim side"
 * of a frame: step + pixel pack; the GPU texture upload is a fixed memcpy the sim
 * does not own). run it with:
 *
 *   npx tsx sim/perf-bench.ts
 *   npx tsx sim/perf-bench.ts --w 320 --h 180 --frames 600 --warmup 120
 *
 * deterministic scene construction, but the sim itself uses Math.random for its
 * stochastic gates, so absolute numbers vary a little run to run; the ratio
 * before/after a change is the signal.
 */
import { Mat } from "../src/sim/materials";
import { Simulation } from "../src/sim/simulation";

interface BenchArgs {
    w: number;
    h: number;
    frames: number;
    warmup: number;
}

/** parse the small flag surface, falling back to the desktop-target defaults. */
function parseArgs(argv: string[]): BenchArgs {
    const args: BenchArgs = { w: 320, h: 180, frames: 600, warmup: 120 };
    for (let i = 0; i < argv.length; i++) {
        const value = Number(argv[i + 1]);
        switch (argv[i]) {
            case "--w":
                args.w = value;
                i++;
                break;
            case "--h":
                args.h = value;
                i++;
                break;
            case "--frames":
                args.frames = value;
                i++;
                break;
            case "--warmup":
                args.warmup = value;
                i++;
                break;
        }
    }
    return args;
}

/**
 * build the worst-case scene: a deep lava floor across the full width, a thin
 * indestructible wall shelf so the molten gold above is not simply devoured by
 * lava contact (design §4.1: lava absorbs adjacent molten gold), and a thick
 * molten-gold pool seeded with value on top. the result keeps nearly every chunk
 * active every frame — lava re-emits heat, the pool flows and re-emits, and the
 * heat field never settles — which is exactly where the scheduler earns nothing.
 */
function buildWorstCase(sim: Simulation): void {
    const { W, H } = sim;
    const lavaTop = Math.floor(H * 0.6); // bottom 40% is lava
    const shelfRow = lavaTop - 1; // wall shelf separating gold from lava
    const goldTop = Math.floor(H * 0.15); // gold pool fills the middle band

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (y >= lavaTop) {
                sim.paint(x, y, 0, Mat.LAVA);
            } else if (y === shelfRow) {
                sim.paint(x, y, 0, Mat.WALL);
            } else if (y >= goldTop && y < shelfRow) {
                sim.paint(x, y, 0, Mat.MOLTEN_GOLD);
                // seed the Lagrangian value field so the value carry (swap/melt)
                // work is exercised too, not just the material walk.
                sim.addValue(x, y, 1);
            }
        }
    }
}

/** median of a numeric sample (robust to the odd GC spike). */
function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function main(): void {
    const { w, h, frames, warmup } = parseArgs(process.argv.slice(2));
    const sim = new Simulation(w, h);
    buildWorstCase(sim);

    // warm the loop so JIT + heat-field transients settle before timing.
    for (let f = 0; f < warmup; f++) {
        sim.step();
        sim.writeImage();
    }

    const stepMs: number[] = [];
    const writeMs: number[] = [];
    for (let f = 0; f < frames; f++) {
        const t0 = process.hrtime.bigint();
        sim.step();
        const t1 = process.hrtime.bigint();
        sim.writeImage();
        const t2 = process.hrtime.bigint();
        stepMs.push(Number(t1 - t0) / 1e6);
        writeMs.push(Number(t2 - t1) / 1e6);
    }

    const stepMed = median(stepMs);
    const writeMed = median(writeMs);
    const stepMean = stepMs.reduce((a, b) => a + b, 0) / stepMs.length;
    const writeMean = writeMs.reduce((a, b) => a + b, 0) / writeMs.length;

    const fmt = (n: number): string => n.toFixed(3);
    const cells = w * h;
    process.stdout.write(
        [
            `sim perf bench — worst case (lava floor + heavy molten gold)`,
            `grid ${w}x${h} (${cells} cells), ${frames} frames after ${warmup} warmup`,
            `active cells this frame: ${sim.count}`,
            ``,
            `                 median     mean`,
            `step()      ${fmt(stepMed).padStart(9)} ${fmt(stepMean).padStart(8)} ms`,
            `writeImage()${fmt(writeMed).padStart(9)} ${fmt(writeMean).padStart(8)} ms`,
            `sim side    ${fmt(stepMed + writeMed).padStart(9)} ${fmt(stepMean + writeMean).padStart(8)} ms  (budget < 8ms/frame @ 60fps)`,
            ``,
        ].join("\n")
    );
}

main();
