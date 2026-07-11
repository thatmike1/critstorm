import { describe, it, expect } from "vitest";
import { spikeMidpoint, medianLowSpike, maxTierSpike, coreHeadroom } from "./surge-gauge";
import { CRIT_SPIKE_BANDS, CORE_CRITICAL_TEMP } from "./surge";

describe("spikeMidpoint", () => {
    it("is the midpoint of each tier's band", () => {
        for (let t = 0; t < CRIT_SPIKE_BANDS.length; t++) {
            const [lo, hi] = CRIT_SPIKE_BANDS[t];
            expect(spikeMidpoint(t)).toBe((lo + hi) / 2);
        }
    });

    it("clamps out-of-range and fractional tiers into the band table", () => {
        expect(spikeMidpoint(-3)).toBe(spikeMidpoint(0));
        expect(spikeMidpoint(999)).toBe(spikeMidpoint(CRIT_SPIKE_BANDS.length - 1));
        expect(spikeMidpoint(2.9)).toBe(spikeMidpoint(2));
    });
});

describe("medianLowSpike / maxTierSpike", () => {
    it("median is the mean of the tier-1 and tier-2 midpoints", () => {
        expect(medianLowSpike()).toBe((spikeMidpoint(1) + spikeMidpoint(2)) / 2);
        // tier1 [60,90]->75, tier2 [130,150]->140, mean 107.5
        expect(medianLowSpike()).toBeCloseTo(107.5, 10);
    });

    it("max-tier is the midpoint of the top band", () => {
        expect(maxTierSpike()).toBe(spikeMidpoint(CRIT_SPIKE_BANDS.length - 1));
        expect(maxTierSpike()).toBeCloseTo(650, 10);
    });
});

describe("coreHeadroom", () => {
    it("reports full headroom and zero load on a cold core", () => {
        const h = coreHeadroom(0, 490);
        expect(h.headroom).toBe(490);
        expect(h.load).toBe(0);
        expect(h.medianFits).toBe(true);
        expect(h.medianCritsLeft).toBe(Math.floor(490 / medianLowSpike()));
    });

    it("clamps load to [0,1] and headroom to >= 0 past critical", () => {
        const h = coreHeadroom(600, 490);
        expect(h.load).toBe(1);
        expect(h.headroom).toBe(0);
        expect(h.medianFits).toBe(false);
        expect(h.medianCritsLeft).toBe(0);
    });

    it("treats negative core temp as cold", () => {
        const h = coreHeadroom(-50, 490);
        expect(h.headroom).toBe(490);
        expect(h.load).toBe(0);
    });

    it("a median tick sits where one more median spike would reach critical", () => {
        const h = coreHeadroom(0, 490);
        expect(h.medianTick).toBeCloseTo((490 - h.medianSpike) / 490, 10);
        expect(h.maxTick).toBeCloseTo(Math.max(0, (490 - h.maxSpike) / 490), 10);
    });

    it("median stops fitting once the core passes the median tick", () => {
        const crit = 490;
        const spike = medianLowSpike();
        // exactly at the edge: headroom == spike still fits
        const atEdge = coreHeadroom(crit - spike, crit);
        expect(atEdge.medianFits).toBe(true);
        expect(atEdge.medianCritsLeft).toBe(1);
        // one degree hotter: it no longer fits
        const overEdge = coreHeadroom(crit - spike + 1, crit);
        expect(overEdge.medianFits).toBe(false);
        expect(overEdge.medianCritsLeft).toBe(0);
    });

    it("a max-tier spike never fits from cold at the base critical temp", () => {
        // base ceiling 490 < max spike 650: a max-tier crit is an instant bust
        const h = coreHeadroom(0, CORE_CRITICAL_TEMP);
        expect(h.maxFits).toBe(false);
        expect(h.maxTick).toBe(0);
    });

    it("a raised (Aegis) ceiling can make a max-tier spike fit again", () => {
        const h = coreHeadroom(0, 900);
        expect(h.maxFits).toBe(true);
        expect(h.maxTick).toBeCloseTo((900 - maxTierSpike()) / 900, 10);
    });

    it("defaults the ceiling to CORE_CRITICAL_TEMP", () => {
        expect(coreHeadroom(0).headroom).toBe(CORE_CRITICAL_TEMP);
    });

    it("guards a non-positive ceiling against divide-by-zero", () => {
        const h = coreHeadroom(0, 0);
        expect(Number.isFinite(h.load)).toBe(true);
        expect(Number.isFinite(h.medianTick)).toBe(true);
    });
});
