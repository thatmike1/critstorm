import { describe, expect, it } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { createWorld } from "./world";
import { Collector, defaultCollectorRegion } from "./collector";
import { COLLECTOR_BASE_FEE } from "./economy";
import type { AttackResult } from "./economy";
import { Surge } from "./surge";
import {
    BANK_MAX_BURSTS,
    BANK_MIN_BURSTS,
    MAX_ERUPTION_CELLS,
    MIN_ERUPTION_CELLS,
    bankBurstCount,
    bankVolleyShares,
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

// the BANK mega-eruption (design §3, hkm.3). the pixi ballistic flight is a visual
// (CritEngine.eruptBank); at the grid level a BANK is a single depositEruption of the
// whole pot value at the core, which is what these tests exercise. the de-dup choice
// (hkm.3): during a surge the per-strike gold eruption is SUPPRESSED — the pot is the
// sole payout — so banking pot.value credits the strikes exactly once, never twice.

/** a non-crit strike (tier 0). */
function normal(damage: number): AttackResult {
    return { damage, tier: 0, golden: false };
}

/** a crit strike (tier >= 1). */
function crit(damage: number, tier = 1): AttackResult {
    return { damage, tier, golden: false };
}

describe("BANK eruption — the pot erupts as one conserving gold mountain", () => {
    it("deposits exactly the pot value, mass clamped to the §6 ceiling for a big pot", () => {
        const sim = new Simulation(96, 72);
        // a fat pot: eruptionMass clamps to MAX_ERUPTION_CELLS, value pot/64 per cell.
        const potValue = 1e11;
        const m = eruptionMass(potValue);
        expect(m).toBe(MAX_ERUPTION_CELLS);
        const deposited = depositEruption(sim, 48, 30, potValue);
        expect(deposited).toBeCloseTo(potValue, 4);
        expectClose(sim.totalValue(), potValue);
        let molten = 0;
        for (let i = 0; i < sim.cells.length; i++) {
            if (sim.cells[i] === Mat.MOLTEN_GOLD) {
                molten++;
                expectClose(sim.value[i], potValue / m);
            }
        }
        expect(molten).toBe(m);
    });
});

describe("surge → bank → collect conserves value end-to-end (de-dup pin, hkm.3)", () => {
    it("banks the whole pot as physical gold that drains to pot·(1−fee) essence", () => {
        // a full surge: ignite, ride a mixed run of strikes into the pot, then BANK.
        // because per-strike gold is suppressed during a surge (the de-dup choice), the
        // ONLY gold that ever enters the world this surge is the banked pot — so
        // `total erupted === pot.value`, and it must drain to essence at exactly the
        // fee with nothing lost (no double-credit, no minting). this is the invariant
        // `sum(value) + collected + lost === total erupted` across the whole path.
        const world = createWorld({ seed: 3 });
        const base = 5;
        // an uncappable core: this test pins BANK-path value conservation, not the
        // hkm.2 heating tune — with the real critical temp the tier 3+2+4 spikes
        // below can bust the surge mid-ride and wipe the pot before the bank.
        const surge = new Surge({}, { criticalTemp: Number.POSITIVE_INFINITY });
        expect(surge.addHeat(100)).toBe(true); // ignite

        // ride: two non-crits (base each) + three crits (payout + multiplier bumps).
        surge.recordStrike(normal(0), base); // +5
        surge.recordStrike(crit(300, 3), base); // +300, n=1
        surge.recordStrike(normal(0), base); // +5
        surge.recordStrike(crit(200, 2), base); // +200, n=2
        surge.recordStrike(crit(150, 4), base); // +150, n=3

        const pot = surge.endSurge("bank");
        // contributions = 5+300+5+200+150 = 660; multiplier = 1.5^3 = 3.375.
        expect(pot.contributions).toBe(660);
        expect(pot.crits).toBe(3);
        expect(pot.value).toBeCloseTo(660 * Math.pow(1.5, 3), 6);

        // BANK: the whole pot erupts as one gold mountain at the core (grid-level of
        // CritEngine.eruptBank). nothing was erupted per-strike, so this is all of it.
        depositEruption(world.sim, world.core.x, world.core.y, pot.value);
        expectClose(world.sim.totalValue(), pot.value); // erupted == in play, 0 lost

        // let the mountain cool to solid GOLD, settle, and reach the drain band.
        for (let i = 0; i < 3000; i++) world.sim.step();

        const collector = new Collector(defaultCollectorRegion(world));
        const essence = collector.collect(world.sim);

        // conservation: collected(=essence/(1−fee)) + remaining(=0) + lost(=0) === pot.
        expectClose(essence, pot.value * (1 - COLLECTOR_BASE_FEE));
        expect(world.sim.totalValue()).toBeCloseTo(0, 4);
    });
});

// the BANK VOLLEY mass/value path (critstorm-724). the fix: banking no longer routes
// the whole pot through one per-strike eruption (mass capped at MAX_ERUPTION_CELLS,
// which read as a modest blob) — the pot is split into a volley of bursts that rain a
// mountain. CritEngine.eruptBank drives the ballistic timing (a Pixi visual); these
// tests pin the grid-truth: the burst split, and that composing the shares through
// depositEruption conserves the pot exactly while piling far more mass than a single
// eruption could. `bankVolleyDeposit` mirrors the grid side of eruptBank.

/** deposit a bank volley of `payout` around (cx,cy) the way {@link eruptBank} does at
 * the grid level: split into bursts, deposit each share as MOLTEN_GOLD near the core.
 * returns the total deposited value. scatter is deterministic here (a small ring) so
 * the conservation assertion doesn't depend on the engine's Math.random jitter. */
function bankVolleyDeposit(sim: Simulation, cx: number, cy: number, payout: number): number {
    const bursts = bankBurstCount(payout);
    const shares = bankVolleyShares(payout, bursts);
    let total = 0;
    shares.forEach((share, i) => {
        const angle = (i / bursts) * Math.PI * 2;
        const gx = Math.round(cx + Math.cos(angle) * 3);
        const gy = Math.round(cy + Math.sin(angle) * 3);
        total += depositEruption(sim, gx, gy, share);
    });
    return total;
}

describe("bankBurstCount — clamp(round(5 + 2·log10(P)), 5, 12)", () => {
    it("floors tiny pots and ceils fat pots", () => {
        expect(bankBurstCount(1)).toBe(BANK_MIN_BURSTS); // 5 + 0
        expect(bankBurstCount(10)).toBe(7); // 5 + 2
        expect(bankBurstCount(100)).toBe(9); // 5 + 4
        expect(bankBurstCount(1e9)).toBe(BANK_MAX_BURSTS); // 5 + 18 → clamp down
    });

    it("floors a non-positive pot instead of returning NaN", () => {
        expect(bankBurstCount(0)).toBe(BANK_MIN_BURSTS);
        expect(bankBurstCount(-5)).toBe(BANK_MIN_BURSTS);
    });

    it("is monotonic non-decreasing and always within [MIN, MAX]", () => {
        let prev = 0;
        for (const p of [1, 10, 100, 1_000, 1e5, 1e8, 1e11]) {
            const n = bankBurstCount(p);
            expect(n).toBeGreaterThanOrEqual(prev);
            expect(n).toBeGreaterThanOrEqual(BANK_MIN_BURSTS);
            expect(n).toBeLessThanOrEqual(BANK_MAX_BURSTS);
            prev = n;
        }
    });
});

describe("bankVolleyShares — the pot splits into shares that sum to exactly P", () => {
    it("returns `bursts` shares that sum back to the pot (no leak, no mint)", () => {
        for (const p of [1, 660, 1_234, 5e6, 9.9e9]) {
            const bursts = bankBurstCount(p);
            const shares = bankVolleyShares(p, bursts);
            expect(shares).toHaveLength(bursts);
            const sum = shares.reduce((a, s) => a + s, 0);
            expectClose(sum, p);
        }
    });

    it("gives the remainder to the last burst so equal division never drifts", () => {
        // 100 / 3 is non-terminating in binary: the last share must absorb the drift.
        const shares = bankVolleyShares(100, 3);
        expect(shares).toHaveLength(3);
        expectClose(
            shares.reduce((a, s) => a + s, 0),
            100
        );
    });

    it("is empty for a non-positive pot or burst count", () => {
        expect(bankVolleyShares(0, 8)).toHaveLength(0);
        expect(bankVolleyShares(-5, 8)).toHaveLength(0);
        expect(bankVolleyShares(1_000, 0)).toHaveLength(0);
    });
});

describe("BANK volley deposit — conserves the pot AND piles a bigger mountain", () => {
    const W = 96;
    const H = 72;

    it("deposits exactly the pot value across the whole volley (conservation)", () => {
        for (const potValue of [660, 12_345, 5e8]) {
            const sim = new Simulation(W, H);
            const deposited = bankVolleyDeposit(sim, 48, 30, potValue);
            expectClose(deposited, potValue);
            expectClose(sim.totalValue(), potValue);
        }
    });

    it("piles more molten mass than a single per-strike eruption of the same pot", () => {
        // the core of critstorm-724: a mid pot through one eruption clamps to a modest
        // blob; the volley sums many bursts' masses into a real mountain. compare the
        // molten-cell count of the volley against one eruption of the whole pot.
        const potValue = 4_000; // eruptionMass(4000) ≈ 26 cells for one eruption
        const single = new Simulation(W, H);
        depositEruption(single, 48, 30, potValue);
        const volley = new Simulation(W, H);
        bankVolleyDeposit(volley, 48, 30, potValue);
        const countMolten = (sim: Simulation): number => {
            let n = 0;
            for (let i = 0; i < sim.cells.length; i++) if (sim.cells[i] === Mat.MOLTEN_GOLD) n++;
            return n;
        };
        expect(countMolten(volley)).toBeGreaterThan(countMolten(single));
    });

    it("keeps worst-case molten mass bounded (≤ MAX_BURSTS · MAX_ERUPTION_CELLS)", () => {
        // a jackpot pot must not drown the sim: the volley's mass budget is bounded so
        // a lava-floor worst case still holds 60fps (design §6).
        const sim = new Simulation(200, 150);
        bankVolleyDeposit(sim, 100, 75, 1e11);
        let molten = 0;
        for (let i = 0; i < sim.cells.length; i++) if (sim.cells[i] === Mat.MOLTEN_GOLD) molten++;
        expect(molten).toBeLessThanOrEqual(BANK_MAX_BURSTS * MAX_ERUPTION_CELLS);
    });
});
