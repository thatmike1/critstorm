import { describe, it, expect } from "vitest";
import {
    COLLECTOR_BASE_FEE,
    coresFromEssence,
    valueToEssence,
    applyAttack,
    createState,
    UPGRADES,
    type AttackResult,
} from "./economy";

describe("valueToEssence", () => {
    it("skims the base 30% fee by default", () => {
        expect(COLLECTOR_BASE_FEE).toBe(0.3);
        expect(valueToEssence(100)).toBeCloseTo(70, 10);
    });

    it("scales linearly with the arriving value", () => {
        expect(valueToEssence(0)).toBe(0);
        expect(valueToEssence(50, 0.3)).toBeCloseTo(35, 10);
        expect(valueToEssence(1000, 0.3)).toBeCloseTo(700, 10);
    });

    it("passes the full value through at a 0% fee (fully upgraded collector)", () => {
        expect(valueToEssence(100, 0)).toBe(100);
    });

    it("keeps nothing at a 100% fee", () => {
        expect(valueToEssence(100, 1)).toBe(0);
    });

    it("clamps a negative fee to 0 so essence can never be minted past the raw value", () => {
        expect(valueToEssence(100, -0.5)).toBe(100);
    });

    it("clamps a fee above 1 to 1 so conversion can never invert into negative essence", () => {
        expect(valueToEssence(100, 1.5)).toBe(0);
    });
});

describe("coresFromEssence (design §5)", () => {
    it("is floor(sqrt(bankedEssence / 500))", () => {
        expect(coresFromEssence(500)).toBe(1); // exactly one core at the scale
        expect(coresFromEssence(499)).toBe(0); // just under the first core
        expect(coresFromEssence(2000)).toBe(2); // sqrt(4) = 2
        expect(coresFromEssence(500 * 9)).toBe(3); // sqrt(9) = 3
        expect(coresFromEssence(4.25e12)).toBe(92195); // a deep storm's yield
    });

    it("floors non-positive input to 0 cores", () => {
        expect(coresFromEssence(0)).toBe(0);
        expect(coresFromEssence(-1000)).toBe(0);
        expect(coresFromEssence(NaN)).toBe(0);
    });

    it("is monotone non-decreasing in cumulative essence", () => {
        let prev = 0;
        for (let e = 0; e <= 50_000; e += 250) {
            const c = coresFromEssence(e);
            expect(c).toBeGreaterThanOrEqual(prev);
            prev = c;
        }
    });
});

describe("in-storm cost growth band (design §6)", () => {
    it("keeps every upgrade's cost growth inside the 1.15–1.35 band", () => {
        for (const u of UPGRADES) {
            expect(u.costGrowth).toBeGreaterThanOrEqual(1.15);
            expect(u.costGrowth).toBeLessThanOrEqual(1.35);
        }
    });
});

describe("applyAttack", () => {
    it("advances lifetime damage but no longer credits essence directly", () => {
        const s = createState();
        const r: AttackResult = { damage: 42, tier: 3, golden: false };
        applyAttack(s, r);
        expect(s.totalDamage).toBe(42);
        // essence now flows only through the collector drain, not the attack itself.
        expect(s.essence).toBe(0);
    });
});
