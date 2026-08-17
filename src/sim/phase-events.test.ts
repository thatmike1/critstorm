import { afterEach, describe, expect, it, vi } from "vitest";
import { Mat } from "./materials";
import {
    type GoldSettleEvent,
    type PhaseChangeEvent,
    type PhaseChangeKind,
    Simulation,
} from "./simulation";

// spec for the two positive feedback seams that sit beside the gold-loss one:
// gold SETTLING (MOLTEN_GOLD -> GOLD, value carried) and the heat-driven phase
// changes (boil / quench / ignite). the sim stays presentation-free — it only
// reports the transition; the audio layer decides the tell.

const W = 20;
const H = 15;
const idx = (x: number, y: number) => y * W + x;
const fresh = () => new Simulation(W, H);

/** attach a capturing gold-settle listener and return the array it fills. */
function captureSettle(s: Simulation): GoldSettleEvent[] {
    const events: GoldSettleEvent[] = [];
    s.setGoldSettleListener((e) => events.push(e));
    return events;
}

/** attach a capturing phase-change listener and return the array it fills. */
function capturePhase(s: Simulation): PhaseChangeEvent[] {
    const events: PhaseChangeEvent[] = [];
    s.setPhaseChangeListener((e) => events.push(e));
    return events;
}

/** the captured events of one kind — the other transitions are noise for a case. */
function ofKind(events: PhaseChangeEvent[], kind: PhaseChangeKind): PhaseChangeEvent[] {
    return events.filter((e) => e.kind === kind);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("gold-settle seam", () => {
    it("fires with the carried value when molten gold freezes to GOLD", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1; // bottom row so the pool can't flow away before it freezes
        s.paint(x, y, 0, Mat.MOLTEN_GOLD);
        s.addValue(x, y, 250);
        s.heat[idx(x, y)] = 0; // cooled well under the 150 freeze gate
        const events = captureSettle(s);

        s.step();

        expect(s.cells[idx(x, y)]).toBe(Mat.GOLD);
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ x, y, amount: 250 });
        // conservation: the settle carries value, it does not mint or destroy it.
        expect(s.getValue(x, y)).toBe(250);
    });

    it("still fires for a valueless (player-painted) pool settling", () => {
        const s = fresh();
        const x = 8;
        const y = H - 1;
        s.paint(x, y, 0, Mat.MOLTEN_GOLD);
        s.heat[idx(x, y)] = 0;
        const events = captureSettle(s);

        s.step();

        expect(events).toHaveLength(1);
        expect(events[0].amount).toBe(0);
    });

    it("stays quiet while the gold is still molten", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.MOLTEN_GOLD); // spawns at emitTemp 400, far above the gate
        s.addValue(x, y, 250);
        const events = captureSettle(s);

        s.step();

        // it may have flowed a cell sideways, but it is still liquid and silent.
        expect(s.cells).toContain(Mat.MOLTEN_GOLD);
        expect(events).toHaveLength(0);
    });

    it("clears with null and runs headless without a listener", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.MOLTEN_GOLD);
        s.heat[idx(x, y)] = 0;
        const events = captureSettle(s);
        s.setGoldSettleListener(null);

        expect(() => s.step()).not.toThrow();
        expect(s.cells[idx(x, y)]).toBe(Mat.GOLD);
        expect(events).toHaveLength(0);
    });
});

describe("phase-change seam — boil", () => {
    it("fires 'boil' with the pre-change material when water flashes to steam", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.WATER);
        s.heat[idx(x, y)] = 600; // far above the 100 boil point
        const events = capturePhase(s);

        vi.spyOn(Math, "random").mockReturnValue(0.1); // pass the 0.4 boil gate
        s.step();

        expect(s.cells[idx(x, y)]).toBe(Mat.STEAM);
        expect(ofKind(events, "boil")).toEqual([{ x, y, kind: "boil", material: Mat.WATER }]);
    });

    it("stays quiet for water sitting below its boil point", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.WATER);
        const events = capturePhase(s);

        vi.spyOn(Math, "random").mockReturnValue(0.1);
        s.step();

        expect(ofKind(events, "boil")).toHaveLength(0);
    });
});

describe("phase-change seam — quench", () => {
    it("fires 'quench' when coolant-touched lava crusts to stone", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.LAVA);
        s.paint(x - 1, y, 0, Mat.ICE); // a coolant that stays put for the step
        s.heat[idx(x, y)] = 300; // under emitTemp(700) - LAVA_QUENCH_DELTA(50)
        const events = capturePhase(s);

        s.step();

        expect(s.cells[idx(x, y)]).toBe(Mat.STONE);
        expect(ofKind(events, "quench")).toEqual([{ x, y, kind: "quench", material: Mat.LAVA }]);
    });

    it("stays quiet for lava cooling in open air (no coolant, no crust)", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.LAVA);
        s.heat[idx(x, y)] = 300;
        const events = capturePhase(s);

        s.step();

        // it may have crept a cell, but with no coolant it never crusts.
        expect(s.cells).toContain(Mat.LAVA);
        expect(s.cells).not.toContain(Mat.STONE);
        expect(ofKind(events, "quench")).toHaveLength(0);
    });
});

describe("phase-change seam — ignite", () => {
    // every flammable gate must report, and each must name the material that
    // caught, so a tell can read a gunpowder pop differently from a plant catching.
    const cases: { mat: number; name: string; roll: number }[] = [
        { mat: Mat.WOOD, name: "wood", roll: 0.05 },
        { mat: Mat.PLANT, name: "plant", roll: 0.05 },
        { mat: Mat.OIL, name: "oil", roll: 0.05 },
        { mat: Mat.GUNPOWDER, name: "gunpowder", roll: 0.05 },
    ];

    for (const c of cases) {
        it(`fires 'ignite' carrying ${c.name} as the pre-change material`, () => {
            const s = fresh();
            const x = 6;
            const y = H - 1;
            s.paint(x, y, 0, c.mat);
            s.heat[idx(x, y)] = 900; // above every ignition point
            const events = capturePhase(s);

            vi.spyOn(Math, "random").mockReturnValue(c.roll);
            s.step();

            const ignitions = ofKind(events, "ignite");
            expect(ignitions).toHaveLength(1);
            expect(ignitions[0]).toEqual({ x, y, kind: "ignite", material: c.mat });
            expect(s.cells[idx(x, y)]).not.toBe(c.mat);
        });
    }

    it("stays quiet for a flammable below its ignition point", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.WOOD);
        const events = capturePhase(s);

        vi.spyOn(Math, "random").mockReturnValue(0.05);
        s.step();

        expect(s.cells[idx(x, y)]).toBe(Mat.WOOD);
        expect(ofKind(events, "ignite")).toHaveLength(0);
    });

    it("does not fire for wet gunpowder (the water shield holds)", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.GUNPOWDER);
        s.paint(x, y - 1, 0, Mat.WATER); // sitting on top, walled in so it can't drain
        s.paint(x - 1, y - 1, 0, Mat.WALL);
        s.paint(x + 1, y - 1, 0, Mat.WALL);
        s.heat[idx(x, y)] = 900;
        const events = capturePhase(s);

        vi.spyOn(Math, "random").mockReturnValue(0.05);
        s.step();

        expect(s.cells[idx(x, y)]).toBe(Mat.GUNPOWDER);
        expect(ofKind(events, "ignite")).toHaveLength(0);
    });
});

describe("phase-change seam — registration", () => {
    it("clears with null and runs headless without a listener", () => {
        const s = fresh();
        const x = 6;
        const y = H - 1;
        s.paint(x, y, 0, Mat.WATER);
        s.heat[idx(x, y)] = 600;
        const events = capturePhase(s);
        s.setPhaseChangeListener(null);

        vi.spyOn(Math, "random").mockReturnValue(0.1);
        expect(() => s.step()).not.toThrow();
        expect(s.cells[idx(x, y)]).toBe(Mat.STEAM);
        expect(events).toHaveLength(0);
    });

    it("is independent of the gold-loss seam (separate listener slots)", () => {
        const s = fresh();
        const x = 6;
        const y = 6;
        s.paint(x, y, 0, Mat.MOLTEN_GOLD);
        s.addValue(x, y, 200);
        s.paint(x + 1, y, 0, Mat.LAVA);
        const losses: number[] = [];
        s.setGoldLossListener((e) => losses.push(e.amount));
        const settles = captureSettle(s);
        const phases = capturePhase(s);

        s.step();

        // the loss seam still fires, and absorption is not a settle.
        expect(losses).toEqual([200]);
        expect(settles).toHaveLength(0);
        expect(phases.some((e) => e.x === x && e.y === y)).toBe(false);
    });
});
