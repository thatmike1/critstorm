import { describe, expect, it } from "vitest";
import { Mat, meltPoint } from "../sim/materials";
import { type GoldLossEvent, Simulation } from "../sim/simulation";
import { potState } from "./surge";
import { BUST_CORE_TEMP, bustPot } from "./bust";

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
        const gx = 24;
        const gy = 12; // within the default heat radius (12) of core (24,8)
        s.paint(gx, gy, 0, Mat.GOLD);
        s.addValue(gx, gy, 900);
        expect(s.heat[idx(gx, gy)]).toBeLessThan(meltPoint[Mat.GOLD]); // sanity: starts cold
        const before = s.totalValue();

        bustPot(s, 24, 8, potState(100, 1));
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
        // seed pre-existing world gold FAR from the core so the burn/heat can't reach
        // it — its value must survive the bust untouched.
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
