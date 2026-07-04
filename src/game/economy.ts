/** upgrade identifiers */
export type UpgradeId = "critChance" | "critMulti" | "attackRate";

export interface UpgradeDef {
    id: UpgradeId;
    name: string;
    desc: string;
    baseCost: number;
    costGrowth: number;
    maxLevel: number;
}

export const UPGRADES: UpgradeDef[] = [
    {
        id: "critChance",
        name: "Loaded Dice",
        desc: "+1% crit chance",
        baseCost: 15,
        costGrowth: 1.28,
        maxLevel: 30,
    },
    {
        id: "critMulti",
        name: "Heavier Hits",
        desc: "+0.15× crit multiplier",
        baseCost: 25,
        costGrowth: 1.3,
        maxLevel: 200,
    },
    {
        id: "attackRate",
        name: "Faster Reels",
        desc: "+0.25 attacks/sec",
        baseCost: 10,
        costGrowth: 1.18,
        maxLevel: 60,
    },
];

export interface EconomyState {
    essence: number;
    totalDamage: number;
    elapsed: number;
    attackTimer: number;
    levels: Record<UpgradeId, number>;
}

export interface AttackResult {
    damage: number;
    /** number of consecutive successful crit rolls; 0 = normal hit */
    tier: number;
}

/** crit chains cap out so damage stays finite even at high crit chance */
export const MAX_TIER = 8;

export function createState(): EconomyState {
    return {
        essence: 0,
        totalDamage: 0,
        elapsed: 0,
        attackTimer: 0,
        levels: { critChance: 0, critMulti: 0, attackRate: 0 },
    };
}

export function critChance(s: EconomyState): number {
    return Math.min(0.05 + s.levels.critChance * 0.01, 0.35);
}

export function critMulti(s: EconomyState): number {
    return 2 + s.levels.critMulti * 0.15;
}

export function attacksPerSec(s: EconomyState): number {
    return 1 + s.levels.attackRate * 0.25;
}

export function baseDamage(): number {
    return 1;
}

/**
 * roll one attack: each consecutive successful crit roll raises the tier,
 * damage = base * multi^tier — this chain is the whole spectacle arc
 */
export function rollAttack(s: EconomyState, rng: () => number): AttackResult {
    let tier = 0;
    while (tier < MAX_TIER && rng() < critChance(s)) tier++;
    return { damage: baseDamage() * Math.pow(critMulti(s), tier), tier };
}

export function upgradeCost(s: EconomyState, id: UpgradeId): number {
    const def = UPGRADES.find((u) => u.id === id)!;
    return Math.ceil(def.baseCost * Math.pow(def.costGrowth, s.levels[id]));
}

export function canBuy(s: EconomyState, id: UpgradeId): boolean {
    const def = UPGRADES.find((u) => u.id === id)!;
    return s.levels[id] < def.maxLevel && s.essence >= upgradeCost(s, id);
}

export function buy(s: EconomyState, id: UpgradeId): boolean {
    if (!canBuy(s, id)) return false;
    s.essence -= upgradeCost(s, id);
    s.levels[id] += 1;
    return true;
}

/** apply one attack's result to the economy */
export function applyAttack(s: EconomyState, r: AttackResult): void {
    s.essence += r.damage;
    s.totalDamage += r.damage;
}

/** advance time, returning the attacks that fired during dt */
export function tick(s: EconomyState, dtSec: number, rng: () => number): AttackResult[] {
    s.elapsed += dtSec;
    s.attackTimer += dtSec * attacksPerSec(s);
    const results: AttackResult[] = [];
    while (s.attackTimer >= 1) {
        s.attackTimer -= 1;
        const r = rollAttack(s, rng);
        applyAttack(s, r);
        results.push(r);
    }
    return results;
}

/** analytic expected damage per attack, for dps display and sim strategy */
export function expectedDamagePerAttack(s: EconomyState): number {
    const p = critChance(s);
    const m = critMulti(s);
    let total = 0;
    for (let t = 0; t < MAX_TIER; t++) {
        total += Math.pow(p, t) * (1 - p) * baseDamage() * Math.pow(m, t);
    }
    total += Math.pow(p, MAX_TIER) * baseDamage() * Math.pow(m, MAX_TIER);
    return total;
}

export function expectedDps(s: EconomyState): number {
    return expectedDamagePerAttack(s) * attacksPerSec(s);
}
