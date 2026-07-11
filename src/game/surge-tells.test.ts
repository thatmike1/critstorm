import { describe, expect, it } from "vitest";
import { boilPoint, ignitionPoint, Mat, meltPoint } from "../sim/materials";
import {
    ambientHeatForLoad,
    GOLD_SHIMMER_FULL,
    GOLD_SHIMMER_START,
    goldShimmerForLoad,
    TELL_LADDER,
    tellRungForLoad,
    tellsForLoad,
} from "./surge-tells";

describe("tell ladder ordering", () => {
    it("is strictly ordered by ascending minLoad and heatTarget", () => {
        for (let i = 1; i < TELL_LADDER.length; i++) {
            expect(TELL_LADDER[i].minLoad).toBeGreaterThan(TELL_LADDER[i - 1].minLoad);
            expect(TELL_LADDER[i].heatTarget).toBeGreaterThan(TELL_LADDER[i - 1].heatTarget);
        }
    });

    it("starts calm at load 0 with no heat stamp", () => {
        expect(TELL_LADDER[0].minLoad).toBe(0);
        expect(TELL_LADDER[0].heatTarget).toBe(0);
    });

    it("keeps every rung's heat target strictly below GOLD's melt point (render-only gold tell)", () => {
        for (const rung of TELL_LADDER) {
            expect(rung.heatTarget).toBeLessThan(meltPoint[Mat.GOLD]);
        }
    });
});

describe("tellRungForLoad", () => {
    it("is monotonic non-decreasing as load climbs (no hysteresis)", () => {
        let prev = 0;
        for (let load = 0; load <= 1.0001; load += 0.01) {
            const rung = tellRungForLoad(load);
            expect(rung).toBeGreaterThanOrEqual(prev);
            prev = rung;
        }
    });

    it("is a pure step function: same load always yields the same rung", () => {
        for (const load of [0, 0.11, 0.12, 0.4, 0.83, 1]) {
            expect(tellRungForLoad(load)).toBe(tellRungForLoad(load));
        }
    });

    it("selects the highest rung whose threshold the load has reached", () => {
        expect(tellRungForLoad(0)).toBe(0); // calm
        expect(tellRungForLoad(0.119)).toBe(0); // just below ice-sweat
        expect(tellRungForLoad(0.12)).toBe(1); // ice-sweat, inclusive
        expect(tellRungForLoad(0.31)).toBe(2); // water-steam
        expect(tellRungForLoad(0.55)).toBe(3); // plant-smoke
        expect(tellRungForLoad(0.7)).toBe(4); // oil-flash
        expect(tellRungForLoad(0.9)).toBe(5); // gold-shimmer
    });

    it("clamps out-of-range load into [0,1]", () => {
        expect(tellRungForLoad(-5)).toBe(0);
        expect(tellRungForLoad(99)).toBe(TELL_LADDER.length - 1);
    });
});

describe("ambientHeatForLoad", () => {
    it("stamps nothing while calm", () => {
        expect(ambientHeatForLoad(0)).toBe(0);
        expect(ambientHeatForLoad(0.05)).toBe(0);
    });

    it("crosses the named material thresholds in ladder order", () => {
        // ice-sweat clears ICE melt, water-steam clears WATER boil, plant-smoke clears
        // PLANT ignite — the physics reactions the ladder is anchored to (design §3).
        expect(ambientHeatForLoad(0.12)).toBeGreaterThan(meltPoint[Mat.ICE]);
        expect(ambientHeatForLoad(0.3)).toBeGreaterThan(boilPoint[Mat.WATER]);
        expect(ambientHeatForLoad(0.5)).toBeGreaterThan(ignitionPoint[Mat.PLANT]);
    });

    it("is monotonic non-decreasing in load", () => {
        let prev = -1;
        for (let load = 0; load <= 1.0001; load += 0.02) {
            const heat = ambientHeatForLoad(load);
            expect(heat).toBeGreaterThanOrEqual(prev);
            prev = heat;
        }
    });
});

describe("goldShimmerForLoad", () => {
    it("is 0 below the shimmer start", () => {
        expect(goldShimmerForLoad(0)).toBe(0);
        expect(goldShimmerForLoad(GOLD_SHIMMER_START)).toBe(0);
        expect(goldShimmerForLoad(GOLD_SHIMMER_START - 0.1)).toBe(0);
    });

    it("reaches full intensity at the melt edge", () => {
        expect(goldShimmerForLoad(GOLD_SHIMMER_FULL)).toBe(1);
        expect(goldShimmerForLoad(2)).toBe(1); // clamped
    });

    it("ramps linearly between start and full", () => {
        const mid = (GOLD_SHIMMER_START + GOLD_SHIMMER_FULL) / 2;
        expect(goldShimmerForLoad(mid)).toBeCloseTo(0.5, 5);
    });

    it("is monotonic non-decreasing in load", () => {
        let prev = -1;
        for (let load = 0; load <= 1.0001; load += 0.02) {
            const s = goldShimmerForLoad(load);
            expect(s).toBeGreaterThanOrEqual(prev);
            prev = s;
        }
    });
});

describe("tellsForLoad", () => {
    it("bundles the active rung, its heat target, and the shimmer coherently", () => {
        const tell = tellsForLoad(0.9);
        expect(tell.rung).toBe(tellRungForLoad(0.9));
        expect(tell.stage).toBe(TELL_LADDER[tell.rung]);
        expect(tell.heatTarget).toBe(ambientHeatForLoad(0.9));
        expect(tell.goldShimmer).toBe(goldShimmerForLoad(0.9));
    });

    it("clears the tell at idle load 0", () => {
        const tell = tellsForLoad(0);
        expect(tell.rung).toBe(0);
        expect(tell.heatTarget).toBe(0);
        expect(tell.goldShimmer).toBe(0);
    });
});
