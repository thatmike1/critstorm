import { describe, expect, it, vi } from "vitest";
import { createState, UPGRADES } from "./economy";
import { Surge } from "./surge";
import {
    AUTO_STRIKER_COST_GROWTH,
    AUTO_STRIKER_PURCHASE_COST,
    autoStrikerInterval,
    autoStrikerUpgradeCost,
    createAutoStrikerState,
    executeStrike,
    tickAutoStriker,
    upgradeAutoStriker,
    type StrikeTarget,
} from "./auto-striker";

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
        expect(targets).toEqual([manualTarget, undefined]);
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
