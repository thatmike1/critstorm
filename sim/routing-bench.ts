import { createWorld } from "../src/game/world";
import { createRouting, placeCollector, buyEfficiency, coolantHeadroom } from "../src/game/routing";
import { createState } from "../src/game/economy";
import { depositEruption } from "../src/game/eruption";
import { Mat } from "../src/sim/materials";
import { runSurge } from "./surge-harness";
import { createWorkshopState, workshopEffects, criticalTempWith, ambientCoeffWith } from "../src/game/workshop";
import { bankAtN } from "./bot-strategy";

/** measure route placement, efficiency and paid coolant with production seams. */
export function runRoutingBalance(): void {
    for (const extra of [false, true]) {
        const world = createWorld({ seed: 3 });
        const routing = createRouting(world, 0.3, 0);
        const state = createState(); state.essence = 1000;
        if (extra) placeCollector(world, state, routing, 60);
        depositEruption(world.sim, 60, world.core.y, 1000);
        let essence = 0;
        for (let step = 0; step < 400; step++) {
            world.sim.step();
            for (const collector of routing.collectors) essence += collector.collect(world.sim);
        }
        console.log(`side route ${extra ? "installed" : "absent"}: ${essence.toFixed(2)} essence, ${world.sim.totalValue().toFixed(2)} exposed gold`);
    }
    const world = createWorld({ seed: 3 });
    const routing = createRouting(world, 0.3, 0);
    const state = createState(); state.essence = 1000;
    buyEfficiency(state, routing);
    console.log(`fee upgrade: 120 essence, ${(routing.collectors[0].fee * 100).toFixed(0)}% fee, pays back after 4000 raw gold`);
    world.sim.paint(world.core.x + 8, world.core.y, 4, Mat.ICE);
    const capacity = coolantHeadroom(world);
    console.log(`paid ice layout: ${capacity} temporary headroom, ${capacity / 10 * 14} minimum essence for counted ice`);
    const workshop = createWorkshopState(); workshop.purchased.aegis = 15;
    const effects = workshopEffects(workshop);
    for (const { criticalTemp, ambientCoeff } of [
        { criticalTemp: 620, ambientCoeff: 0.1 },
        { criticalTemp: 620 + capacity, ambientCoeff: 0.1 },
        { criticalTemp: criticalTempWith(effects) + capacity, ambientCoeff: ambientCoeffWith(effects) },
    ]) {
        const means: number[] = [];
        for (let n = 1; n <= 14; n++) {
            let value = 0;
            for (let seed = 0; seed < 128; seed++) value += runSurge({ strategy: bankAtN(n), seed, criticalTemp, ambientCoeff }).bankedEssence;
            means.push(value / 128);
        }
        const peak = means.indexOf(Math.max(...means)) + 1;
        console.log(`surge ${criticalTemp} ceiling / ${ambientCoeff.toFixed(4)} ambient: EV peak bank-at-${peak}; mean ${means[peak - 1].toFixed(2)} essence (static intact coolant comparison)`);
    }
}
