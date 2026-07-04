/**
 * headless economy simulation: plays the game with a greedy strategy at
 * high speed and prints the progression curve, so balance changes are
 * verifiable without playing. run with: npm run sim
 */
import {
    createState,
    tick,
    buy,
    canBuy,
    upgradeCost,
    expectedDps,
    critChance,
    critMulti,
    UPGRADES,
    type EconomyState,
    type UpgradeId,
} from "../src/game/economy";
import { formatNumber } from "../src/game/format";

/** deterministic seeded rng so sim runs are reproducible */
function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** buy whichever affordable upgrade gives the best dps gain per essence spent */
function greedyBuy(s: EconomyState): UpgradeId | null {
    let best: UpgradeId | null = null;
    let bestRatio = 0;
    for (const u of UPGRADES) {
        if (!canBuy(s, u.id)) continue;
        const cost = upgradeCost(s, u.id);
        const before = expectedDps(s);
        s.levels[u.id] += 1;
        const gain = expectedDps(s) - before;
        s.levels[u.id] -= 1;
        const ratio = gain / cost;
        if (ratio > bestRatio) {
            bestRatio = ratio;
            best = u.id;
        }
    }
    return best;
}

const MINUTES = Number(process.argv[2] ?? 45);
const STEP = 0.05;
const rng = mulberry32(42);
const s = createState();

console.log("min | essence   | dps       | crit%  | multi | levels (chance/multi/rate)");
console.log("----|-----------|-----------|--------|-------|---------------------------");

let nextLog = 0;
for (let t = 0; t < MINUTES * 60; t += STEP) {
    tick(s, STEP, rng);
    const id = greedyBuy(s);
    if (id) buy(s, id);
    if (s.elapsed >= nextLog) {
        const l = s.levels;
        console.log(
            `${String(Math.round(nextLog / 60)).padStart(3)} | ${formatNumber(s.essence).padStart(9)} | ${formatNumber(expectedDps(s)).padStart(9)} | ${(critChance(s) * 100).toFixed(1).padStart(5)}% | ${critMulti(s).toFixed(1).padStart(5)} | ${l.critChance}/${l.critMulti}/${l.attackRate}`
        );
        nextLog += 60;
    }
}

console.log(`\ntotal damage dealt: ${formatNumber(s.totalDamage)}`);
