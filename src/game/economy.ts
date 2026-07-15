/** upgrade identifiers */
export type UpgradeId = "baseDamage" | "critChance" | "critMulti" | "attackRate" | "golden";

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
        id: "baseDamage",
        name: "Sharper Digits",
        desc: "+1 base damage",
        baseCost: 8,
        costGrowth: 1.15,
        maxLevel: 500,
    },
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
    {
        id: "golden",
        name: "Golden Reels",
        desc: "+0.5% golden hit chance (×25)",
        baseCost: 500,
        costGrowth: 1.35,
        maxLevel: 30,
    },
];

export interface EconomyState {
    essence: number;
    /** cumulative essence collected during the current storm; never spent down. */
    bankedEssence: number;
    /** whether this storm has reached its first surge for the minimum-core floor. */
    reachedFirstSurge: boolean;
    totalDamage: number;
    elapsed: number;
    attackTimer: number;
    levels: Record<UpgradeId, number>;
}

export interface AttackResult {
    damage: number;
    /** number of consecutive successful crit rolls; 0 = normal hit */
    tier: number;
    /** golden hits multiply the payout and get the royal treatment on screen */
    golden: boolean;
}

/** crit chains cap out so damage stays finite even at high crit chance */
export const MAX_TIER = 8;

/** payout multiplier for golden hits */
export const GOLDEN_MULTI = 25;

export function createState(): EconomyState {
    return {
        essence: 0,
        bankedEssence: 0,
        reachedFirstSurge: false,
        totalDamage: 0,
        elapsed: 0,
        attackTimer: 0,
        levels: { baseDamage: 0, critChance: 0, critMulti: 0, attackRate: 0, golden: 0 },
    };
}

export function baseDamage(s: EconomyState): number {
    return 1 + s.levels.baseDamage;
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

export function goldenChance(s: EconomyState): number {
    return Math.min(s.levels.golden * 0.005, 0.15);
}

/**
 * roll one attack: each consecutive successful crit roll raises the tier,
 * damage = base * multi^tier — this chain is the whole spectacle arc;
 * an independent golden roll multiplies the payout again
 */
export function rollAttack(s: EconomyState, rng: () => number): AttackResult {
    let tier = 0;
    while (tier < MAX_TIER && rng() < critChance(s)) tier++;
    const golden = rng() < goldenChance(s);
    let damage = baseDamage(s) * Math.pow(critMulti(s), tier);
    if (golden) damage *= GOLDEN_MULTI;
    return { damage, tier, golden };
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

/**
 * credit essence collected during this storm to both its spendable and cumulative
 * balances. the cumulative balance is intentionally never reduced by purchases,
 * because storm-core conversion uses all essence collected (design §5).
 * @param amount collected essence to credit; non-positive and non-finite inputs are ignored.
 * @returns the amount credited, or 0 when the input was ignored.
 */
export function creditEssence(s: EconomyState, amount: number): number {
    if (!(amount > 0) || !Number.isFinite(amount)) return 0;
    s.essence += amount;
    s.bankedEssence += amount;
    return amount;
}

/**
 * apply one attack's result to the economy. essence is NOT credited here: an
 * attack erupts gold into the world, and essence is only minted when that gold
 * reaches the collector (see {@link valueToEssence} and the collector drain,
 * design §4.3). this only advances the lifetime damage ledger that drives ranks.
 */
export function applyAttack(s: EconomyState, r: AttackResult): void {
    s.totalDamage += r.damage;
}

/** the essence-per-core scale in the core formula (design §5): `cores = floor(sqrt(banked / 500))`. */
export const CORE_ESSENCE_SCALE = 500;

/**
 * storm cores earned from an amount of banked essence (design §5):
 * `cores = floor(sqrt(bankedEssence / 500))`. `bankedEssence` is the CUMULATIVE
 * essence collected this storm — spending essence on in-storm upgrades does NOT
 * reduce it, so this is always monotone in a storm's collected total. one shared
 * formula so the tuning harness and the future meta layer (critstorm-gen.1) agree
 * on the same sqrt curve; the ×1.5 bank-out bonus applies to the result of this,
 * after the sqrt (design §5), and is not modelled here.
 * @param bankedEssence cumulative essence collected this storm; negatives floor to 0.
 */
export function coresFromEssence(bankedEssence: number): number {
    if (!(bankedEssence > 0)) return 0;
    return Math.floor(Math.sqrt(bankedEssence / CORE_ESSENCE_SCALE));
}

/** base collector fee: the fraction of arriving gold value skimmed on conversion (design §4.3/§6). */
export const COLLECTOR_BASE_FEE = 0.3;

/**
 * convert an arriving gold cell's raw value into essence, skimming `fee`.
 * essence = value × (1 − fee). fee is clamped to [0,1] so an out-of-range
 * upgrade value can never mint essence (fee < 0) nor invert it (fee > 1).
 */
export function valueToEssence(value: number, fee: number = COLLECTOR_BASE_FEE): number {
    const clamped = Math.min(Math.max(fee, 0), 1);
    return value * (1 - clamped);
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
    const base = baseDamage(s);
    let total = 0;
    for (let t = 0; t < MAX_TIER; t++) {
        total += Math.pow(p, t) * (1 - p) * base * Math.pow(m, t);
    }
    total += Math.pow(p, MAX_TIER) * base * Math.pow(m, MAX_TIER);
    return total * (1 + goldenChance(s) * (GOLDEN_MULTI - 1));
}

export function expectedDps(s: EconomyState): number {
    return expectedDamagePerAttack(s) * attacksPerSec(s);
}

/** storm ranks: flavor progression by lifetime damage dealt */
export const RANKS = [
    { name: "dust", threshold: 0 },
    { name: "drizzle", threshold: 100 },
    { name: "shower", threshold: 1_000 },
    { name: "downpour", threshold: 10_000 },
    { name: "storm", threshold: 100_000 },
    { name: "tempest", threshold: 1_000_000 },
    { name: "maelstrom", threshold: 10_000_000 },
    { name: "cataclysm", threshold: 100_000_000 },
    { name: "apocalypse", threshold: 1_000_000_000 },
    { name: "CRITSTORM", threshold: 10_000_000_000 },
] as const;

export interface RankInfo {
    name: string;
    /** 0..1 progress toward the next rank, 1 at max rank */
    progress: number;
    next: string | null;
}

export function rankInfo(s: EconomyState): RankInfo {
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) {
        if (s.totalDamage >= RANKS[i].threshold) idx = i;
    }
    const current = RANKS[idx];
    const next = RANKS[idx + 1] ?? null;
    if (!next) return { name: current.name, progress: 1, next: null };
    const span = next.threshold - current.threshold;
    return {
        name: current.name,
        progress: Math.min((s.totalDamage - current.threshold) / span, 1),
        next: next.name,
    };
}
