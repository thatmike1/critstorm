import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { createWorld } from "./world";
import { Collector, defaultCollectorRegion } from "./collector";
import { COLLECTOR_BASE_FEE } from "./economy";
import {
    MAX_ERUPTION_CELLS,
    MIN_ERUPTION_CELLS,
    blobOffsets,
    depositEruption,
    eruptionMass,
    eruptionValuePerCell,
} from "./eruption";

// the eruption spawner's grid-side math (design.md §4.1 / §6). the ballistic
// FLIGHT is a Pixi visual verified by typecheck + a manual dev-server pass (see
// PR body); these tests pin the mass/value math and the value-field conservation
// the whole gold loop rests on.

// the value field is a Float32Array, so summing many per-cell shares accumulates
// rounding; assert equality within a small RELATIVE epsilon rather than a fixed
// number of decimals (a fixed decimal tolerance would be too tight for big P).
const expectClose = (actual: number, expected: number): void => {
    const tol = Math.max(1, Math.abs(expected)) * 1e-5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

describe("eruptionMass — m = clamp(4 + 6·log10(P), 4, 64)", () => {
    it("matches the design formula across the payout range", () => {
        expect(eruptionMass(1)).toBe(4); // 4 + 6·0
        expect(eruptionMass(10)).toBe(10); // 4 + 6·1
        expect(eruptionMass(100)).toBe(16); // 4 + 6·2
        expect(eruptionMass(1_000)).toBe(22); // 4 + 6·3
        expect(eruptionMass(1e10)).toBe(MAX_ERUPTION_CELLS); // 4 + 6·10 = 64
    });

    it("clamps to the floor for tiny payouts and the ceiling for huge ones", () => {
        expect(eruptionMass(0.001)).toBe(MIN_ERUPTION_CELLS); // log10 < 0 → clamp up
        expect(eruptionMass(1e12)).toBe(MAX_ERUPTION_CELLS); // 4 + 72 → clamp down
    });

    it("floors a non-positive payout instead of returning NaN", () => {
        expect(eruptionMass(0)).toBe(MIN_ERUPTION_CELLS);
        expect(eruptionMass(-5)).toBe(MIN_ERUPTION_CELLS);
    });

    it("is monotonic non-decreasing in payout", () => {
        let prev = 0;
        for (const p of [1, 10, 50, 100, 500, 1_000, 1e5, 1e8, 1e10, 1e11]) {
            const m = eruptionMass(p);
            expect(m).toBeGreaterThanOrEqual(prev);
            prev = m;
        }
    });
});

describe("eruptionValuePerCell — payout split evenly across mass", () => {
    it("reconstructs the payout exactly (perCell · mass === P)", () => {
        for (const p of [1, 100, 1_234, 5e6, 9.9e9]) {
            expect(eruptionValuePerCell(p) * eruptionMass(p)).toBeCloseTo(p, 6);
        }
    });
});

describe("blobOffsets — compact nearest-first cluster", () => {
    it("returns exactly `count` distinct offsets", () => {
        for (const n of [1, 4, 16, 37, 64]) {
            const offs = blobOffsets(n);
            expect(offs).toHaveLength(n);
            const keys = new Set(offs.map((o) => `${o.dx},${o.dy}`));
            expect(keys.size).toBe(n);
        }
    });

    it("always includes the origin and grows outward (nearest-first)", () => {
        const offs = blobOffsets(9);
        expect(offs[0]).toEqual({ dx: 0, dy: 0 });
        const dists = offs.map((o) => o.dx * o.dx + o.dy * o.dy);
        for (let i = 1; i < dists.length; i++) {
            expect(dists[i]).toBeGreaterThanOrEqual(dists[i - 1]);
        }
    });

    it("is empty for a non-positive count", () => {
        expect(blobOffsets(0)).toHaveLength(0);
        expect(blobOffsets(-3)).toHaveLength(0);
    });
});

describe("depositEruption — lands molten gold and conserves value", () => {
    const W = 64;
    const H = 48;

    it("deposits exactly P into the value field (conservation)", () => {
        const sim = new Simulation(W, H);
        const P = 4_096;
        const deposited = depositEruption(sim, 32, 20, P);
        expect(deposited).toBeCloseTo(P, 6);
        expectClose(sim.totalValue(), P);
    });

    it("creates `eruptionMass(P)` molten-gold cells, each carrying P/m", () => {
        const sim = new Simulation(W, H);
        const P = 1_000;
        const m = eruptionMass(P);
        depositEruption(sim, 30, 24, P);
        let molten = 0;
        for (let i = 0; i < sim.cells.length; i++) {
            if (sim.cells[i] === Mat.MOLTEN_GOLD) {
                molten++;
                expectClose(sim.value[i], P / m);
            }
        }
        expect(molten).toBe(m);
    });

    it("still deposits the full payout when the impact is jammed into a corner", () => {
        // offsets clamp in-bounds and collapse onto edge cells; the ledger must
        // stay whole even though fewer than m distinct cells end up molten.
        const sim = new Simulation(W, H);
        const P = 8_000;
        depositEruption(sim, 0, 0, P);
        expectClose(sim.totalValue(), P);
    });

    it("preserves prior value when two eruptions overlap still-molten cells", () => {
        // MOLTEN_GOLD→MOLTEN_GOLD is NOT a value-preserving phase change, so a
        // naive repaint of an already-molten cell would zero its uncollected value.
        // two co-located deposits must leave sum(value) === P1 + P2 (design §4.1),
        // i.e. the second lands its whole share ON TOP of the first, losing nothing.
        const sim = new Simulation(W, H);
        const P1 = 3_000;
        const P2 = 5_000;
        depositEruption(sim, 32, 24, P1);
        expectClose(sim.totalValue(), P1);
        // second eruption on the exact same centre: its blob fully overlaps the
        // still-molten cells from the first (no cooling/stepping in between).
        depositEruption(sim, 32, 24, P2);
        expectClose(sim.totalValue(), P1 + P2);
    });

    it("conserves value landing on a valued solid GOLD cell (no minting)", () => {
        // GOLD→MOLTEN_GOLD is a value-preserving carry (simulation.ts goldPhaseCarry):
        // setCell keeps the cell's value in place, so the deposit must NOT also re-add
        // the captured prior — doing so would MINT value. a P-eruption centred on a
        // GOLD cell worth `prior` must end at exactly prior + P, not prior + P + prior.
        const sim = new Simulation(W, H);
        const prior = 1_000;
        sim.paint(32, 24, 0, Mat.GOLD);
        sim.addValue(32, 24, prior);
        expectClose(sim.totalValue(), prior);
        const P = 100;
        depositEruption(sim, 32, 24, P);
        expectClose(sim.totalValue(), prior + P);
    });

    it("survives the melt/freeze round-trip carry (value rides the phase change)", () => {
        // a single-cell eruption solidifies to GOLD as it cools, then re-melts —
        // the deposited value must ride the GOLD↔MOLTEN_GOLD pair (design §4.1).
        const sim = new Simulation(8, 8);
        const P = 4; // m = 8, but the carry is asserted on the value-field total
        depositEruption(sim, 4, 4, P);
        const before = sim.totalValue();
        // cool everything below the molten freeze point → GOLD, value intact.
        for (let i = 0; i < sim.heat.length; i++) sim.heat[i] = 20;
        sim.step();
        expectClose(sim.totalValue(), before);
    });

    it("no-ops on a non-positive payout", () => {
        const sim = new Simulation(W, H);
        expect(depositEruption(sim, 10, 10, 0)).toBe(0);
        expect(sim.totalValue()).toBe(0);
    });
});

describe("eruption → collector end-to-end (value drains to essence at the fee)", () => {
    it("an erupted payout lands, settles, and drains to P·(1−fee) essence", () => {
        // ported from the interim spawner's coverage: the gold loop must still
        // conserve value all the way to essence. deposit at the storm core, let the
        // molten gold cool to solid GOLD and fall into the collector band, then drain.
        const world = createWorld({ seed: 3 });
        const P = 1_000;
        depositEruption(world.sim, world.core.x, world.core.y, P);
        // run the sim until the molten gold cools, settles, and rests in the band.
        for (let i = 0; i < 3000; i++) world.sim.step();

        const collector = new Collector(defaultCollectorRegion(world));
        const essence = collector.collect(world.sim);

        // no value sinks (no lava/acid in the flats world), so the whole hit drains
        // (Float32 value field, so allow a small relative tolerance).
        expectClose(essence, P * (1 - COLLECTOR_BASE_FEE));
    });
});
