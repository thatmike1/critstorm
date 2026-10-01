import { createWorld } from "../src/game/world";
import { FRONTS } from "../src/game/fronts";
import { createState, baseDamage, critMulti, MAX_TIER } from "../src/game/economy";
import { Surge } from "../src/game/surge";
import { qualifiesForFinale, finaleBursts, FINAL_POT_THRESHOLD } from "../src/game/finale";
import { createStormEventRng, StormEvents } from "../src/game/storm-events";
import { depositEruption } from "../src/game/eruption";

/** check a real rod-sized winning strike and the bounded Eye finale's ledger and cost. */
export function runFinaleBalance(): void {
    const state = createState(); state.levels.baseDamage = 80; state.levels.critMulti = 80;
    const surge = new Surge({}, { criticalTemp: 1000, rng: createStormEventRng(42) });
    surge.addHeat(100);
    surge.recordStrike({ damage: baseDamage(state) * Math.pow(critMulti(state), MAX_TIER), tier: MAX_TIER, golden: false }, baseDamage(state));
    const pot = surge.endSurge("bank");
    console.log(`late rod bank: ${pot.value.toFixed(0)} pre-Forge pot, actual tier ${pot.maxTier}, wins ${qualifiesForFinale("eye", pot)}`);
    const world = createWorld({ seed: 42, front: FRONTS.eye });
    let loss = 0; world.sim.setGoldLossListener(event => { loss += event.amount; });
    const events = new StormEvents(world, createStormEventRng(42));
    const start = performance.now();
    for (const burst of finaleBursts(320, 180, FINAL_POT_THRESHOLD, createStormEventRng(42))) depositEruption(world.sim, burst.x, burst.y, burst.payout, 8);
    for (let step = 1; step <= 400; step++) { events.tick(step * 0.05); world.sim.step(); }
    const elapsed = performance.now() - start;
    console.log(`Eye + finale 400 steps: ${elapsed.toFixed(0)}ms total / ${(elapsed / 400).toFixed(2)}ms mean`);
    console.log(`finale ledger: ${world.sim.totalValue().toFixed(0)} exposed + ${loss.toFixed(0)} lost = ${(world.sim.totalValue() + loss).toFixed(0)} (source ${FINAL_POT_THRESHOLD})`);
}
