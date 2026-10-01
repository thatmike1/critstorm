import { describe, expect, it } from "vitest";
import { createGreedBell, ringBell, tickBell, bellReward, BELL_RING_HEAT } from "./greed-bell";
import { Surge, potState } from "./surge";
import { createWorld } from "./world";
import { depositEruption } from "./eruption";
import { Collector, defaultCollectorRegion } from "./collector";

/** prepare a live two-crit ride with deterministic heat. */
function ride(criticalTemp = 1000): Surge {
    const surge = new Surge({}, { criticalTemp, rng: () => 0 }); surge.addHeat(100);
    for (let i = 0; i < 2; i++) surge.recordStrike({ damage: 100, tier: 1, golden: false }, 1);
    return surge;
}

describe("a voluntary greed bell", () => {
    it("requires an existing ride, charges real immediate heat and cannot be rung twice", () => {
        const surge = new Surge({}, { rng: () => 0 }), bell = createGreedBell();
        expect(ringBell(surge, bell)).toBe(false);
        surge.addHeat(100);
        expect(ringBell(surge, bell)).toBe(false);
        const live = ride(); const before = live.coreTemp;
        expect(ringBell(live, bell)).toBe(true);
        expect(live.coreTemp - before).toBe(BELL_RING_HEAT);
        expect(bell.targetCrits).toBe(4);
        expect(ringBell(live, bell)).toBe(false);
    });
    it("scales the ongoing toll by dt and can cause a rupture without another strike", () => {
        const a = ride(250), b = ride(250), one = createGreedBell(), fine = createGreedBell();
        ringBell(a, one); ringBell(b, fine);
        tickBell(a, one, 5);
        for (let i = 0; i < 10; i++) tickBell(b, fine, 0.5);
        expect(a.coreTemp).toBeCloseTo(b.coreTemp);
        expect(a.active).toBe(true);
        tickBell(a, one, 1);
        expect(a.active).toBe(false);
        expect(bellReward(one, potState(100, 4), "bust").won).toBe(false);
    });
    it("allows an early bank to forfeit the reward; a completed bank creates physical collectible gold", () => {
        const surge = ride(), bell = createGreedBell(); ringBell(surge, bell);
        expect(bellReward(bell, surge.pot, "bank").multiplier).toBe(1);
        for (let i = 0; i < 2; i++) surge.recordStrike({ damage: 100, tier: 1, golden: false }, 1);
        const pot = surge.endSurge("bank");
        const reward = bellReward(bell, pot, "bank"); expect(reward.multiplier).toBe(2);
        const world = createWorld({ seed: 3 }); let lost = 0, collected = 0;
        world.sim.setGoldLossListener(event => { lost += event.amount; });
        depositEruption(world.sim, world.core.x, world.core.y, pot.value * reward.multiplier, 1);
        const collector = new Collector(defaultCollectorRegion(world), 0);
        for (let i = 0; i < 200; i++) { world.sim.step(); collected += collector.collect(world.sim); }
        expect(collected + lost + world.sim.totalValue()).toBeCloseTo(pot.value * 2, 2);
        expect(collected).toBeGreaterThan(0);
    });
});
