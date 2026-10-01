import { runSurge } from "./surge-harness";
import { bankAtN } from "./bot-strategy";

/** pair ordinary and bell banks on the same rolls, cadence and core ceiling. */
export function runGreedBalance(): void {
    for (const criticalTemp of [620, 1000]) {
        for (const crits of [4, 5, 6]) {
            for (const greedBell of [false, true]) {
                let value = 0, busts = 0, won = 0, heat = 0;
                for (let seed = 0; seed < 256; seed++) {
                    const result = runSurge({ strategy: bankAtN(crits), seed, criticalTemp, greedBell, strikesPerSec: 2.5 });
                    value += result.bankedEssence; busts += result.reason === "bust" ? 1 : 0;
                    won += result.bellWon ? 1 : 0; heat += result.bellHeat ?? 0;
                }
                console.log(`ceiling ${criticalTemp} / bank-at-${crits} / ${greedBell ? "bell" : "ordinary"}: mean ${(value / 256).toFixed(2)} essence, ${(busts / 256 * 100).toFixed(1)}% busts, ${won} bell wins, ${(heat / 256).toFixed(1)} added heat`);
            }
        }
    }
}
