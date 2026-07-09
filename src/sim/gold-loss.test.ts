import { afterEach, describe, expect, it, vi } from "vitest";
import { Mat } from "./materials";
import { type GoldLossEvent, Simulation } from "./simulation";

// spec for the gold-loss rules + feedback seam (design.md §4.1 conservation
// "lost" term). every non-collector path that destroys a gold cell must (1) zero
// the cell's Lagrangian value and (2) surface exactly one loss event carrying the
// destroyed amount and its cause, so risk reads instantly and the ledger balances.

const W = 20;
const H = 15;
const idx = (x: number, y: number) => y * W + x;
const fresh = () => new Simulation(W, H);

/** attach a capturing listener and return the array it fills. */
function capture(s: Simulation): GoldLossEvent[] {
    const events: GoldLossEvent[] = [];
    s.setGoldLossListener((e) => events.push(e));
    return events;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("gold loss — value zeroed + feedback tell", () => {
    it("acid dissolving gold zeroes the value and fires an 'acid' loss", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1; // bottom row: gold can't fall out from under the acid
        s.paint(x, y, 0, Mat.GOLD);
        s.addValue(x, y, 400);
        s.paint(x, y - 1, 0, Mat.ACID); // acid directly above; dir[0] is down
        const events = capture(s);

        // force the dissolve gate (0.25) and the acid-spent gate (0.4) deterministically.
        vi.spyOn(Math, "random").mockReturnValue(0.1);
        s.step();

        expect(s.cells[idx(x, y)]).not.toBe(Mat.GOLD);
        expect(s.getValue(x, y)).toBe(0);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ x, y, amount: 400, cause: "acid" });
    });

    it("lava absorbing molten gold zeroes the value and fires a 'lava' loss", () => {
        const s = fresh();
        const x = 6;
        const y = 6;
        s.paint(x, y, 0, Mat.MOLTEN_GOLD);
        s.addValue(x, y, 200);
        s.paint(x + 1, y, 0, Mat.LAVA);
        const events = capture(s);

        s.step();

        expect(s.cells[idx(x, y)]).not.toBe(Mat.MOLTEN_GOLD);
        expect(s.getValue(x, y)).toBe(0);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ x, y, amount: 200, cause: "lava" });
    });

    it("erasing a valued gold cell zeroes the value and fires an 'erase' loss", () => {
        const s = fresh();
        const x = 8;
        const y = 8;
        s.paint(x, y, 0, Mat.GOLD);
        s.addValue(x, y, 333);
        const events = capture(s);

        s.paint(x, y, 0, Mat.EMPTY); // manual erase

        expect(s.cells[idx(x, y)]).toBe(Mat.EMPTY);
        expect(s.getValue(x, y)).toBe(0);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ x, y, amount: 333, cause: "erase" });
    });
});

describe("gold loss — seam is quiet when there is nothing to lose", () => {
    it("dissolving a non-gold cell (still a loss-free dissolve) fires nothing", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.SAND); // dissolvable, but carries no value
        s.paint(x, y - 1, 0, Mat.ACID);
        const events = capture(s);

        vi.spyOn(Math, "random").mockReturnValue(0.1);
        s.step();

        expect(events).toHaveLength(0);
    });

    it("erasing a valueless gold cell fires nothing (amount is zero)", () => {
        const s = fresh();
        const x = 8;
        const y = 8;
        s.paint(x, y, 0, Mat.GOLD); // gold, but no value seeded
        const events = capture(s);

        s.paint(x, y, 0, Mat.EMPTY);

        expect(events).toHaveLength(0);
    });

    it("runs the loss paths without a listener attached (headless-safe)", () => {
        const s = fresh();
        s.paint(6, 6, 0, Mat.MOLTEN_GOLD);
        s.addValue(6, 6, 200);
        s.paint(7, 6, 0, Mat.LAVA);
        expect(() => s.step()).not.toThrow();
        expect(s.getValue(6, 6)).toBe(0);
    });
});
