import { describe, expect, it, vi } from "vitest";
import { Mat } from "../sim/materials";
import { Simulation } from "../sim/simulation";
import { createState, UPGRADES } from "./economy";
import { HEAT_DECAY_PER_SEC, Surge } from "./surge";
import {
    applyStrikeSpread,
    AUTO_STRIKER_COST_GROWTH,
    AUTO_STRIKER_HEAT_RATE,
    AUTO_STRIKER_PURCHASE_COST,
    autoStrikerAim,
    autoStrikerInterval,
    autoStrikerStrikeHeat,
    autoStrikerUpgradeCost,
    createAutoStrikerState,
    defaultAutoStrikerPosition,
    executeStrike,
    placeAutoStriker,
    tickAutoStriker,
    upgradeAutoStriker,
    type StrikeTarget,
} from "./auto-striker";

/** mulberry32 — tiny deterministic prng for seedable-randomness assertions. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe("auto-striker economy", () => {
    it("charges the early-mid purchase price and escalating interval-upgrade costs", () => {
        const economy = createState();
        const striker = createAutoStrikerState();
        economy.essence = AUTO_STRIKER_PURCHASE_COST - 1;

        expect(upgradeAutoStriker(economy, striker)).toBe(false);
        expect(striker.level).toBe(0);

        economy.essence += 1;
        expect(upgradeAutoStriker(economy, striker)).toBe(true);
        expect(economy.essence).toBe(0);
        expect(striker.level).toBe(1);
        expect(autoStrikerInterval(striker)).toBe(3.5);
        expect(autoStrikerUpgradeCost(striker)).toBe(90);

        economy.essence = 90;
        expect(upgradeAutoStriker(economy, striker)).toBe(true);
        expect(economy.essence).toBe(0);
        expect(striker.level).toBe(2);
        expect(autoStrikerInterval(striker)).toBe(3.3);
        expect(autoStrikerUpgradeCost(striker)).toBe(Math.ceil(90 * AUTO_STRIKER_COST_GROWTH));
    });

    it("keeps cost growth inside the design §6 band", () => {
        expect(AUTO_STRIKER_COST_GROWTH).toBeGreaterThanOrEqual(1.15);
        expect(AUTO_STRIKER_COST_GROWTH).toBeLessThanOrEqual(1.35);
    });

    it("replaces the removed attack-rate upgrade and safely clamps migrated levels", () => {
        expect(UPGRADES.map((upgrade) => upgrade.id)).not.toContain("attackRate");
        expect(createAutoStrikerState(Number.NaN).level).toBe(0);
        expect(createAutoStrikerState(99).level).toBe(12);
    });
});

describe("auto-striker timer", () => {
    it("fires by elapsed time with fixed-step remainder instead of once per frame", () => {
        const striker = createAutoStrikerState(1);
        const fire = vi.fn();

        expect(tickAutoStriker(striker, 1.75, fire)).toBe(0);
        expect(tickAutoStriker(striker, 1.75, fire)).toBe(1);
        expect(tickAutoStriker(striker, 7.2, fire)).toBe(2);
        expect(fire).toHaveBeenCalledTimes(3);
        expect(striker.timerSec).toBeCloseTo(0.2, 10);
    });

    it("does not fire before purchase", () => {
        const fire = vi.fn();
        expect(tickAutoStriker(createAutoStrikerState(), 100, fire)).toBe(0);
        expect(fire).not.toHaveBeenCalled();
    });
});

describe("shared strike path", () => {
    it("routes manual and timer strikes through the same heat and attack bookkeeping", () => {
        const economy = createState();
        const surge = new Surge();
        const targets: Array<StrikeTarget | undefined> = [];
        const captured: boolean[] = [];
        const callbacks = {
            onSurgeStart: vi.fn(),
            onStrike: (
                _result: { damage: number },
                wasCaptured: boolean,
                target?: StrikeTarget
            ) => {
                captured.push(wasCaptured);
                targets.push(target);
            },
        };
        const manualTarget = { x: 20, y: 30 };

        executeStrike(economy, surge, () => 1, callbacks, manualTarget);
        const striker = createAutoStrikerState(1);
        striker.timerSec = autoStrikerInterval(striker);
        tickAutoStriker(striker, 0.01, () => executeStrike(economy, surge, () => 1, callbacks));

        expect(economy.totalDamage).toBe(2);
        expect(surge.heat).toBe(14);
        // the manual aim gets the tier-0 spread applied game-side: rng()=1 shifts
        // the impact by +1 cell on each axis; the timer strike had no target.
        expect(targets).toEqual([{ x: 21, y: 31 }, undefined]);
        expect(captured).toEqual([false, false]);
    });

    it("lets an auto-strike ignite a surge and obey recordStrike capture semantics", () => {
        const economy = createState();
        const surge = new Surge();
        surge.addHeat(98);
        const onSurgeStart = vi.fn();
        const onStrike = vi.fn();
        const striker = createAutoStrikerState(1);
        striker.timerSec = autoStrikerInterval(striker);

        tickAutoStriker(striker, 0.01, () =>
            executeStrike(economy, surge, () => 1, { onSurgeStart, onStrike })
        );

        expect(onSurgeStart).toHaveBeenCalledOnce();
        expect(surge.active).toBe(true);
        expect(surge.pot.contributions).toBe(1);
        expect(onStrike).toHaveBeenCalledWith(
            { damage: 1, tier: 0, golden: false },
            true,
            undefined
        );
    });
});

describe("auto-striker heat cadence", () => {
    it("scales heat per strike with the interval so the gross rate is cadence-constant", () => {
        expect(autoStrikerStrikeHeat(createAutoStrikerState())).toBe(0);
        const base = createAutoStrikerState(1);
        expect(autoStrikerStrikeHeat(base)).toBeCloseTo(
            AUTO_STRIKER_HEAT_RATE * autoStrikerInterval(base)
        );
        const max = createAutoStrikerState(12);
        expect(autoStrikerStrikeHeat(max)).toBeCloseTo(
            AUTO_STRIKER_HEAT_RATE * autoStrikerInterval(max)
        );
        // the break-even property behind the ignition guarantee: the turret's gross
        // heat rate beats the pre-surge drain at every owned level.
        expect(AUTO_STRIKER_HEAT_RATE).toBeGreaterThan(HEAT_DECAY_PER_SEC);
    });

    it("ignites a surge from zero heat on sustained level-1 cadence against pre-surge decay", () => {
        // level 1 is the 60-essence base purchase — the affordable early-mid turret.
        const economy = createState();
        const surge = new Surge();
        const striker = createAutoStrikerState(1);
        const onSurgeStart = vi.fn();
        const dt = 0.05;
        let elapsed = 0;
        // mirror the app frame loop: timer strikes first, then the dt-scaled decay.
        while (!surge.active && elapsed < 30) {
            tickAutoStriker(striker, dt, () =>
                executeStrike(
                    economy,
                    surge,
                    () => 0.99,
                    { onSurgeStart, onStrike: () => undefined },
                    undefined,
                    autoStrikerStrikeHeat(striker)
                )
            );
            surge.decayHeat(HEAT_DECAY_PER_SEC * dt);
            elapsed += dt;
        }
        expect(onSurgeStart).toHaveBeenCalledOnce();
        expect(surge.active).toBe(true);
        // hands-free ignition lands mid-teens seconds — meaningful, not instant.
        expect(elapsed).toBeGreaterThan(10);
        expect(elapsed).toBeLessThan(20);
    });

    it("keeps the manual per-click heat at its default when no override is passed", () => {
        const economy = createState();
        const surge = new Surge();
        executeStrike(economy, surge, () => 0.99, {
            onSurgeStart: vi.fn(),
            onStrike: () => undefined,
        });
        expect(surge.heat).toBe(7);
    });
});

describe("auto-striker placement (design §4.3)", () => {
    it("charges the purchase price once and records the placed grid position", () => {
        const sim = new Simulation(40, 30);
        const economy = createState();
        const striker = createAutoStrikerState();
        economy.essence = AUTO_STRIKER_PURCHASE_COST;

        expect(placeAutoStriker(sim, economy, striker, 20, 10)).toBe(true);
        expect(economy.essence).toBe(0);
        expect(striker.level).toBe(1);
        expect(striker.position).toEqual({ x: 20, y: 10 });
    });

    it("rejects a second placement of the singular turret", () => {
        const sim = new Simulation(40, 30);
        const economy = createState();
        const striker = createAutoStrikerState();
        economy.essence = AUTO_STRIKER_PURCHASE_COST * 2;

        expect(placeAutoStriker(sim, economy, striker, 20, 10)).toBe(true);
        expect(placeAutoStriker(sim, economy, striker, 5, 5)).toBe(false);
        expect(striker.position).toEqual({ x: 20, y: 10 });
        expect(economy.essence).toBe(AUTO_STRIKER_PURCHASE_COST);
    });

    it("rejects occupied or out-of-bounds footprints before charging", () => {
        const sim = new Simulation(40, 30);
        const economy = createState();
        const striker = createAutoStrikerState();
        economy.essence = AUTO_STRIKER_PURCHASE_COST;
        sim.cells[10 * sim.W + 20] = Mat.STONE;

        expect(placeAutoStriker(sim, economy, striker, 20, 10)).toBe(false);
        expect(placeAutoStriker(sim, economy, striker, 0, 0)).toBe(false);
        expect(economy.essence).toBe(AUTO_STRIKER_PURCHASE_COST);
        expect(striker.level).toBe(0);
        expect(striker.position).toBeNull();
    });

    it("rejects an unaffordable placement without recording a position", () => {
        const sim = new Simulation(40, 30);
        const economy = createState();
        const striker = createAutoStrikerState();
        economy.essence = AUTO_STRIKER_PURCHASE_COST - 1;

        expect(placeAutoStriker(sim, economy, striker, 20, 10)).toBe(false);
        expect(striker.level).toBe(0);
        expect(striker.position).toBeNull();
    });

    it("keeps interval upgrades purchasable after placement", () => {
        const sim = new Simulation(40, 30);
        const economy = createState();
        const striker = createAutoStrikerState();
        economy.essence = AUTO_STRIKER_PURCHASE_COST + 90;

        expect(placeAutoStriker(sim, economy, striker, 20, 10)).toBe(true);
        expect(upgradeAutoStriker(economy, striker)).toBe(true);
        expect(striker.level).toBe(2);
        expect(autoStrikerInterval(striker)).toBe(3.3);
        expect(striker.position).toEqual({ x: 20, y: 10 });
    });

    it("derives the legacy-migration default position beside the strike zone", () => {
        const zone = { x: 160, y: 40, radius: 44, contains: () => true };
        expect(defaultAutoStrikerPosition(zone, 320, 180)).toEqual({ x: 213, y: 42 });
        // clamped into the grid on small worlds.
        expect(defaultAutoStrikerPosition(zone, 210, 40)).toEqual({ x: 202, y: 32 });
    });
});

describe("auto-striker aim (seeded rng)", () => {
    const zone = { x: 160, y: 40, radius: 44, contains: () => true };

    it("keeps every aim point inside the strike zone", () => {
        const rng = mulberry32(0xa11ce);
        for (let i = 0; i < 2000; i++) {
            const aim = autoStrikerAim(zone, rng);
            const dx = aim.x - zone.x;
            const dy = aim.y - zone.y;
            expect(dx * dx + dy * dy).toBeLessThanOrEqual(zone.radius * zone.radius + 1e-9);
        }
    });

    it("is deterministic for a fixed seed", () => {
        const a = autoStrikerAim(zone, mulberry32(7));
        const b = autoStrikerAim(zone, mulberry32(7));
        expect(a).toEqual(b);
        expect(autoStrikerAim(zone, mulberry32(8))).not.toEqual(a);
    });

    it("bounds the landing spread by the tier scale", () => {
        const target: StrikeTarget = { x: 100, y: 50 };
        const rng = mulberry32(0xbeef);
        for (const tier of [0, 4, 8]) {
            const bound = 1 + tier * 1.5;
            for (let i = 0; i < 500; i++) {
                const impact = applyStrikeSpread(target, tier, rng);
                expect(Math.abs(impact.x - target.x)).toBeLessThanOrEqual(bound);
                expect(Math.abs(impact.y - target.y)).toBeLessThanOrEqual(bound);
            }
        }
    });
});
