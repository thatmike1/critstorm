import { describe, expect, it } from "vitest";
import { Mat, meltPoint } from "../sim/materials";
import { type GoldLossEvent, Simulation } from "../sim/simulation";
import { potState } from "./surge";
import { BUST_CORE_TEMP, BUST_FALLOUT_SPREAD, BUST_HEAT_RADIUS, bustPot } from "./bust";
import { createWorld, type World } from "./world";
import { Collector, defaultCollectorRegion } from "./collector";
import { depositEruption } from "./eruption";
import { withSeededRandom } from "../../sim/rng";

// the overheat-bust payload (design §3 / §4.1). the surge pot detonates instead of
// banking: it burns as lava+fire, its value is accounted LOST through the gold-loss
// ledger, and pooled world gold near the core melts into risk. these tests pin the
// value bookkeeping — the ballistic flash/shake is a Pixi visual verified elsewhere.

const W = 48;
const H = 36;
const idx = (x: number, y: number) => y * W + x;
const fresh = () => new Simulation(W, H);

const expectClose = (actual: number, expected: number): void => {
    const tol = Math.max(1, Math.abs(expected)) * 1e-5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

/** attach a capturing gold-loss listener and return the array it fills. */
function capture(s: Simulation): GoldLossEvent[] {
    const events: GoldLossEvent[] = [];
    s.setGoldLossListener((e) => events.push(e));
    return events;
}

describe("bustPot — the pot burns as lost value", () => {
    it("accounts the whole pot as lost through the ledger with a 'bust' cause", () => {
        const s = fresh();
        const events = capture(s);
        const pot = potState(1000, 3); // value = 1000 · 1.5^3 = 3375
        const result = bustPot(s, 24, 8, pot);

        expect(result.lost).toBe(pot.value);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ x: 24, y: 8, amount: pot.value, cause: "bust" });
    });

    it("never mints value into the field — the pot never lands as gold", () => {
        const s = fresh();
        const pot = potState(500, 2);
        bustPot(s, 24, 8, pot);
        // the burn is lava/fire, which carry no value; the field stays empty.
        expect(s.totalValue()).toBe(0);
    });

    it("converts the core to a lava/fire burn, not gold", () => {
        const s = fresh();
        const pot = potState(2000, 4);
        const result = bustPot(s, 24, 8, pot);

        let lava = 0;
        let fire = 0;
        let gold = 0;
        for (let i = 0; i < s.cells.length; i++) {
            if (s.cells[i] === Mat.LAVA) lava++;
            else if (s.cells[i] === Mat.FIRE) fire++;
            else if (s.cells[i] === Mat.GOLD || s.cells[i] === Mat.MOLTEN_GOLD) gold++;
        }
        expect(result.burnCells).toBeGreaterThan(0);
        expect(lava + fire).toBe(result.burnCells);
        expect(lava).toBeGreaterThan(0);
        expect(fire).toBeGreaterThan(0); // every third burn cell is flame
        expect(gold).toBe(0); // the pot did NOT become collectable gold
    });

    it("is headless-safe with no listener attached", () => {
        const s = fresh();
        const pot = potState(300, 1);
        expect(() => bustPot(s, 24, 8, pot)).not.toThrow();
    });

    it("fires nothing for a zero pot but still detonates the core", () => {
        const s = fresh();
        const events = capture(s);
        const pot = potState(0, 0); // value 0
        const result = bustPot(s, 24, 8, pot);
        expect(events).toHaveLength(0); // nothing to lose
        expect(result.lost).toBe(0);
        expect(result.burnCells).toBeGreaterThan(0); // the burn is spectacle regardless
    });
});

describe("bustPot — pooled world gold near the core is put at risk", () => {
    it("injects heat above gold's melt point so nearby world gold liquefies", () => {
        const s = fresh();
        // a solid gold cell a few cells from the core, seeded with value, resting cold.
        const gx = 26;
        const gy = 12; // within the default heat radius (12) of core (24,8)
        s.paint(gx, gy, 0, Mat.GOLD);
        s.addValue(gx, gy, 900);
        expect(s.heat[idx(gx, gy)]).toBeLessThan(meltPoint[Mat.GOLD]); // sanity: starts cold
        const before = s.totalValue();

        // spread 0 pins the fallout curtain to the core column so this test isolates
        // the HEAT path: no splash lands on the sample cell to devour it directly.
        bustPot(s, 24, 8, potState(100, 1), BUST_HEAT_RADIUS, BUST_CORE_TEMP, 0);
        // heat is injected but the phase change happens on the next step.
        expect(s.heat[idx(gx, gy)]).toBeGreaterThanOrEqual(BUST_CORE_TEMP);
        s.step();

        expect(s.cells[idx(gx, gy)]).toBe(Mat.MOLTEN_GOLD); // melted, now at risk
        // melting is value-preserving (design §4.1): the gold is molten, not lost.
        expectClose(s.totalValue(), before);
    });
});

describe("bustPot — value conservation holds", () => {
    it("balances the ledger: field value is untouched and lost == pot value", () => {
        const s = fresh();
        const events = capture(s);
        // seed pre-existing world gold in the grid's bottom corner. the fallout curtain
        // reaches its column but can never paint OVER a valued gold cell (it stacks on
        // top instead), so with no stepping its value must survive the bust untouched.
        const worldGold = 4200;
        s.paint(2, H - 1, 0, Mat.GOLD);
        s.addValue(2, H - 1, worldGold);

        const pot = potState(1500, 5); // value = 1500 · 1.5^5
        bustPot(s, 24, 8, pot);

        // introduced value = worldGold (in field) + pot (lost).
        // after the bust, with no stepping: field == worldGold, lost == pot.value.
        const lost = events.reduce((sum, e) => sum + e.amount, 0);
        expectClose(s.totalValue(), worldGold);
        expectClose(lost, pot.value);
        // conservation: field + collected(0) + lost == everything introduced.
        expectClose(s.totalValue() + lost, worldGold + pot.value);
    });

    it("routes melted-then-devoured gold through the ledger too (still balanced)", () => {
        const s = fresh();
        const events = capture(s);
        // a gold cell wedged between the core and lava: the bust heat melts it, and
        // the burn's lava then devours the molten gold — that loss is a 'lava' event,
        // so total introduced value == field + lost stays exact.
        const gx = 24;
        const gy = 9; // one cell below the core, inside the burn blob AND heat disc
        s.paint(gx, gy, 0, Mat.GOLD);
        s.addValue(gx, gy, 700);
        const introduced = s.totalValue(); // world gold; the pot below adds its own

        const pot = potState(200, 2);
        bustPot(s, 24, 8, pot);
        // step a handful of frames so the molten gold meets lava and is consumed.
        for (let i = 0; i < 20; i++) s.step();

        const lost = events.reduce((sum, e) => sum + e.amount, 0);
        // conservation across the whole episode: whatever left the field is in `lost`.
        expectClose(s.totalValue() + lost, introduced + pot.value);
    });
});

// ---------------------------------------------------------------------------
// the aftermath (critstorm-ak0). a bust used to drop its molten rock as one
// compact blob at the core: it fell in a narrow stream, settled in a single
// column, and a player who kept striking their usual collector-adjacent spot
// collected as if nothing had happened. the punishment has to be SPATIAL — the
// fallout now floods the ground under the core, right across the drain approach,
// so the same strike keeps paying for the bust until the lava is quenched or the
// gold is routed elsewhere. these tests run the real world + collector, seeded, so
// the claim is measured (essence collected) and not just "lava exists somewhere".

/** a small storm world with the default drain, sized for a fast headless run. */
function stormWorld(): World {
    return createWorld({ seed: 7, width: 120, height: 90, coreAboveFloor: 26 });
}

const SIM_SEED = 0x5eed;
const STRIKES = 12;
const STEPS_PER_STRIKE = 25;
const PAYOUT = 1500;

interface RunResult {
    /** essence banked over the whole series (fee 0, so essence == value collected). */
    essence: number;
    /** value the lava devoured, booked through the gold-loss ledger. */
    lavaLoss: number;
    /** value still lying in the world when the series ended. */
    field: number;
}

/**
 * strike the same spot `STRIKES` times and report what was banked. `bust` detonates
 * a fat pot at the core first; everything else — seed, terrain, strike column,
 * step count — is identical between the two, so the difference IS the aftermath.
 * `dx` offsets the strike column from the core (the drain spans ±20 around it).
 */
function strikeSeries(bust: boolean, dx = 0): RunResult {
    return withSeededRandom(SIM_SEED, () => {
        const world = stormWorld();
        const sim = world.sim;
        const collector = new Collector(defaultCollectorRegion(world), 0);
        let lavaLoss = 0;
        sim.setGoldLossListener((e) => {
            if (e.cause === "lava") lavaLoss += e.amount;
        });
        if (bust) bustPot(sim, world.core.x, world.core.y, potState(4000, 6));
        const sx = world.core.x + dx;
        const sy = world.floorHeightAt(sx) - 12; // in the air above the drain
        let essence = 0;
        for (let i = 0; i < STRIKES; i++) {
            depositEruption(sim, sx, sy, PAYOUT);
            for (let j = 0; j < STEPS_PER_STRIKE; j++) {
                sim.step();
                essence += collector.collect(sim);
            }
        }
        return { essence, lavaLoss, field: sim.totalValue() };
    });
}

describe("bustPot — the fallout lands on the gold route", () => {
    it("floods the ground under the core, inside the collector's drain region", () => {
        const world = stormWorld();
        const sim = world.sim;
        const drain = defaultCollectorRegion(world);
        bustPot(sim, world.core.x, world.core.y, potState(4000, 6));

        let inDrain = 0;
        let airborne = 0;
        for (let y = 0; y < sim.H; y++) {
            for (let x = 0; x < sim.W; x++) {
                if (sim.cells[y * sim.W + x] !== Mat.LAVA) continue;
                if (
                    x >= drain.x &&
                    x < drain.x + drain.w &&
                    y >= drain.y &&
                    y < drain.y + drain.h
                ) {
                    inDrain++;
                } else if (y < drain.y) {
                    airborne++; // the core detonation, still falling
                }
            }
        }
        // the hazard is ON the drain, and the drain-side share is the bulk of it: the
        // core blob (the part that merely falls) is the minority now.
        expect(inDrain).toBeGreaterThan(airborne);
        expect(inDrain).toBeGreaterThan(20);
    });

    it("keeps the flood inside the drain's middle so the flanks stay open (fun-floor)", () => {
        const world = stormWorld();
        const sim = world.sim;
        bustPot(sim, world.core.x, world.core.y, potState(4000, 6));
        for (let y = 0; y < sim.H; y++) {
            for (let x = 0; x < sim.W; x++) {
                if (sim.cells[y * sim.W + x] !== Mat.LAVA) continue;
                if (y < world.core.y + 8) continue; // the airborne core blob
                expect(Math.abs(x - world.core.x)).toBeLessThanOrEqual(BUST_FALLOUT_SPREAD);
            }
        }
    });
});

describe("bustPot — striking the same spot after a bust is measurably worse", () => {
    it("costs a large share of the take at the habitual spot under the core", () => {
        const clean = strikeSeries(false);
        const busted = strikeSeries(true);

        // the clean run banks everything it deposits — the spot is a good one.
        expectClose(clean.essence, STRIKES * PAYOUT);
        expect(clean.lavaLoss).toBe(0);
        // after a bust the SAME spot bleeds: measured 10696 vs 18000 (59%). the gate
        // is loose enough to survive sim tuning but far outside noise.
        expect(busted.essence).toBeLessThan(clean.essence * 0.8);
        expect(busted.lavaLoss).toBeGreaterThan(clean.essence * 0.2);
        // and it is the LAVA doing it, through the ledger — not value going missing.
        expectClose(busted.essence + busted.lavaLoss + busted.field, STRIKES * PAYOUT);
    });

    it("also reaches the drain columns the old core-blob bust never touched", () => {
        // the playtest complaint: the player just kept clicking beside the pool. these
        // offsets are inside the drain (±20) but well clear of the core column.
        for (const dx of [12, 16]) {
            const clean = strikeSeries(false, dx);
            const busted = strikeSeries(true, dx);
            expect(busted.essence).toBeLessThan(clean.essence * 0.8);
        }
    });

    it("is deterministic for a seed, so the gap is a fact and not a dice roll", () => {
        expect(strikeSeries(true).essence).toBe(strikeSeries(true).essence);
    });
});
