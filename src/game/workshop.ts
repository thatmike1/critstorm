import type { BrushId } from "./brush";
import { COLLECTOR_BASE_FEE, type EconomyState, type UpgradeId } from "./economy";
import type { StormEventType } from "./storm-events";
import { AMBIENT_HEAT_COEFF, CORE_CRITICAL_TEMP } from "./surge";

// the workshop (design §5): the between-storms core sink. storm cores earned at
// storm end are spent across four tracks — Forge / Vault / Aegis / Front — each a
// linear ladder of nodes with ~1.6 cost growth. this module is presentation-free:
// node tables are data, effects are typed, and the aggregate `workshopEffects`
// output is what a fresh storm consumes. tuning a track is a constants edit here,
// never a UI edit.

/** the four workshop tracks (design §5). */
export type WorkshopTrackId = "forge" | "vault" | "aegis" | "front";

/** a permanent tweak to one storm event, consumed by the event scheduler once
 * npq.1 wires modifiers in. defined (and purchasable) now so the Front ladder has
 * no dead buttons; until then the effect rides along in {@link WorkshopEffects}. */
export interface StormEventModifier {
    readonly event: StormEventType;
    /** multiplier on the event's rolled severity; >1 amplifies, <1 dampens. */
    readonly severityMultiplier: number;
}

/**
 * one node's typed effect. every kind is aggregated by {@link workshopEffects};
 * kinds whose target system does not exist yet are documented as consumed later
 * on the aggregate field they feed — never a dead button, always a typed value.
 */
export type WorkshopEffect =
    | { kind: "starting-level"; upgrade: UpgradeId; amount: number }
    | { kind: "eruption-value"; multiplier: number }
    | { kind: "collector-fee"; reduction: number }
    | { kind: "collector-count"; amount: number }
    | { kind: "starting-essence"; amount: number }
    | { kind: "starting-brush"; brush: BrushId }
    | { kind: "heat-resistance"; multiplier: number }
    | { kind: "critical-temp"; bonus: number }
    | { kind: "unlock-front"; front: number }
    | { kind: "event-modifier"; modifier: StormEventModifier }
    | { kind: "surge-tier-floor"; floor: number };

/** one purchasable node on a track ladder. */
export interface WorkshopNodeDef {
    readonly name: string;
    readonly desc: string;
    readonly effect: WorkshopEffect;
}

/** one track: a strictly ordered ladder of nodes with geometric cost growth. */
export interface WorkshopTrackDef {
    readonly id: WorkshopTrackId;
    readonly name: string;
    readonly desc: string;
    /** cost of the ladder's first node, in cores. */
    readonly baseCost: number;
    /** per-node geometric cost growth (~1.6 per design §5). */
    readonly costGrowth: number;
    readonly nodes: readonly WorkshopNodeDef[];
}

/** shared cost growth for every track (design §5: ~1.6). */
export const WORKSHOP_COST_GROWTH = 1.6;

/** Forge — starting crit stats and eruption value (design §5). */
const FORGE_NODES: readonly WorkshopNodeDef[] = [
    {
        name: "Tempered Digits",
        desc: "start with +2 base damage",
        effect: { kind: "starting-level", upgrade: "baseDamage", amount: 2 },
    },
    {
        name: "Weighted Dice",
        desc: "start with +1% crit chance",
        effect: { kind: "starting-level", upgrade: "critChance", amount: 1 },
    },
    {
        name: "Hot Pour",
        desc: "eruptions carry ×1.1 value",
        effect: { kind: "eruption-value", multiplier: 1.1 },
    },
    {
        name: "Forged Digits",
        desc: "start with +3 more base damage",
        effect: { kind: "starting-level", upgrade: "baseDamage", amount: 3 },
    },
    {
        name: "Dense Alloy",
        desc: "start with +2 crit multiplier levels",
        effect: { kind: "starting-level", upgrade: "critMulti", amount: 2 },
    },
    {
        name: "Shaved Edges",
        desc: "start with +1% more crit chance",
        effect: { kind: "starting-level", upgrade: "critChance", amount: 1 },
    },
    {
        name: "Rich Vein",
        desc: "eruptions carry ×1.1 more value",
        effect: { kind: "eruption-value", multiplier: 1.1 },
    },
    {
        name: "Anvil Memory",
        desc: "start with +5 more base damage",
        effect: { kind: "starting-level", upgrade: "baseDamage", amount: 5 },
    },
    {
        name: "Pressed Ingots",
        desc: "start with +3 more crit multiplier levels",
        effect: { kind: "starting-level", upgrade: "critMulti", amount: 3 },
    },
    {
        name: "First Gild",
        desc: "start with +0.5% golden hit chance",
        effect: { kind: "starting-level", upgrade: "golden", amount: 1 },
    },
    {
        name: "Molten Core Tap",
        desc: "eruptions carry ×1.15 more value",
        effect: { kind: "eruption-value", multiplier: 1.15 },
    },
    {
        name: "Marked Cards",
        desc: "start with +2% more crit chance",
        effect: { kind: "starting-level", upgrade: "critChance", amount: 2 },
    },
    {
        name: "Star Metal",
        desc: "start with +5 more crit multiplier levels",
        effect: { kind: "starting-level", upgrade: "critMulti", amount: 5 },
    },
    {
        name: "Royal Gild",
        desc: "start with +1% more golden hit chance",
        effect: { kind: "starting-level", upgrade: "golden", amount: 2 },
    },
    {
        name: "Sunforge",
        desc: "eruptions carry ×1.25 more value",
        effect: { kind: "eruption-value", multiplier: 1.25 },
    },
];

/** Vault — collector fee/count and starting essence (design §5). */
const VAULT_NODES: readonly WorkshopNodeDef[] = [
    {
        name: "Oiled Grate",
        desc: "collector fee −2%",
        effect: { kind: "collector-fee", reduction: 0.02 },
    },
    {
        name: "Seed Purse",
        desc: "start each storm with 25 essence",
        effect: { kind: "starting-essence", amount: 25 },
    },
    {
        name: "Greased Chute",
        desc: "collector fee −2% more",
        effect: { kind: "collector-fee", reduction: 0.02 },
    },
    {
        name: "Fat Purse",
        desc: "start with 50 more essence",
        effect: { kind: "starting-essence", amount: 50 },
    },
    {
        name: "House Discount",
        desc: "collector fee −3% more",
        effect: { kind: "collector-fee", reduction: 0.03 },
    },
    {
        name: "Second Drain",
        desc: "one extra collector drain",
        effect: { kind: "collector-count", amount: 1 },
    },
    {
        name: "Strongbox",
        desc: "start with 100 more essence",
        effect: { kind: "starting-essence", amount: 100 },
    },
    {
        name: "Polished Teeth",
        desc: "collector fee −3% more",
        effect: { kind: "collector-fee", reduction: 0.03 },
    },
    {
        name: "Bullion Line",
        desc: "start with 200 more essence",
        effect: { kind: "starting-essence", amount: 200 },
    },
    {
        name: "Inside Man",
        desc: "collector fee −4% more",
        effect: { kind: "collector-fee", reduction: 0.04 },
    },
    {
        name: "Third Drain",
        desc: "one more extra collector drain",
        effect: { kind: "collector-count", amount: 1 },
    },
    {
        name: "Deep Reserves",
        desc: "start with 400 more essence",
        effect: { kind: "starting-essence", amount: 400 },
    },
    {
        name: "Frictionless Flow",
        desc: "collector fee −4% more",
        effect: { kind: "collector-fee", reduction: 0.04 },
    },
    {
        name: "Sovereign Wealth",
        desc: "start with 800 more essence",
        effect: { kind: "starting-essence", amount: 800 },
    },
    {
        name: "The House Keeps Nothing",
        desc: "collector fee −5% more",
        effect: { kind: "collector-fee", reduction: 0.05 },
    },
];

/** Aegis — defense from storm start, heat resistance, core critical temp (design §5). */
const AEGIS_NODES: readonly WorkshopNodeDef[] = [
    {
        name: "Thick Housing",
        desc: "core critical temp +30",
        effect: { kind: "critical-temp", bonus: 30 },
    },
    {
        name: "Vent Fins",
        desc: "ambient surge heating ×0.95",
        effect: { kind: "heat-resistance", multiplier: 0.95 },
    },
    {
        name: "Mason's Kit",
        desc: "stone brush ready from storm start",
        effect: { kind: "starting-brush", brush: "stone" },
    },
    {
        name: "Ceramic Liner",
        desc: "core critical temp +30 more",
        effect: { kind: "critical-temp", bonus: 30 },
    },
    {
        name: "Twin Fans",
        desc: "ambient surge heating ×0.95 more",
        effect: { kind: "heat-resistance", multiplier: 0.95 },
    },
    {
        name: "Braced Core",
        desc: "core critical temp +40 more",
        effect: { kind: "critical-temp", bonus: 40 },
    },
    {
        name: "Diviner's Kit",
        desc: "water brush ready from storm start",
        effect: { kind: "starting-brush", brush: "water" },
    },
    {
        name: "Coolant Loop",
        desc: "ambient surge heating ×0.9",
        effect: { kind: "heat-resistance", multiplier: 0.9 },
    },
    {
        name: "Tungsten Ribs",
        desc: "core critical temp +40 more",
        effect: { kind: "critical-temp", bonus: 40 },
    },
    {
        name: "Deep Shielding",
        desc: "core critical temp +50 more",
        effect: { kind: "critical-temp", bonus: 50 },
    },
    {
        name: "Cryo Manifold",
        desc: "ambient surge heating ×0.9 more",
        effect: { kind: "heat-resistance", multiplier: 0.9 },
    },
    {
        name: "Reactor Jacket",
        desc: "core critical temp +50 more",
        effect: { kind: "critical-temp", bonus: 50 },
    },
    {
        name: "Absolute Vents",
        desc: "ambient surge heating ×0.85",
        effect: { kind: "heat-resistance", multiplier: 0.85 },
    },
    {
        name: "Star Anvil Plate",
        desc: "core critical temp +60 more",
        effect: { kind: "critical-temp", bonus: 60 },
    },
    {
        name: "Unmeltable Heart",
        desc: "core critical temp +80 more",
        effect: { kind: "critical-temp", bonus: 80 },
    },
];

/** Front — storm fronts 2–4, event modifiers, surge tier floor (design §5). */
const FRONT_NODES: readonly WorkshopNodeDef[] = [
    {
        name: "Seeded Clouds",
        desc: "gold rain lands ×1.25 heavier",
        effect: {
            kind: "event-modifier",
            modifier: { event: "gold-rain", severityMultiplier: 1.25 },
        },
    },
    {
        name: "Storm Chaser",
        desc: "surge crits count as tier 2 or higher",
        effect: { kind: "surge-tier-floor", floor: 2 },
    },
    { name: "The Dunes", desc: "unlock storm front 2", effect: { kind: "unlock-front", front: 2 } },
    {
        name: "Neutral Rain",
        desc: "acid drizzle lands ×0.8 lighter",
        effect: {
            kind: "event-modifier",
            modifier: { event: "acid-drizzle", severityMultiplier: 0.8 },
        },
    },
    {
        name: "Heavy Clouds",
        desc: "gold rain lands ×1.25 heavier still",
        effect: {
            kind: "event-modifier",
            modifier: { event: "gold-rain", severityMultiplier: 1.25 },
        },
    },
    {
        name: "Eye of the Storm",
        desc: "surge crits count as tier 3 or higher",
        effect: { kind: "surge-tier-floor", floor: 3 },
    },
    {
        name: "The Glacier",
        desc: "unlock storm front 3",
        effect: { kind: "unlock-front", front: 3 },
    },
    {
        name: "Cold Seams",
        desc: "lava fissures open ×0.8 smaller",
        effect: {
            kind: "event-modifier",
            modifier: { event: "lava-fissure", severityMultiplier: 0.8 },
        },
    },
    {
        name: "Golden Monsoon",
        desc: "gold rain lands ×1.5 heavier",
        effect: {
            kind: "event-modifier",
            modifier: { event: "gold-rain", severityMultiplier: 1.5 },
        },
    },
    {
        name: "Stormheart",
        desc: "surge crits count as tier 4 or higher",
        effect: { kind: "surge-tier-floor", floor: 4 },
    },
    {
        name: "The Caldera",
        desc: "unlock storm front 4",
        effect: { kind: "unlock-front", front: 4 },
    },
    {
        name: "Inert Drizzle",
        desc: "acid drizzle lands ×0.7 lighter",
        effect: {
            kind: "event-modifier",
            modifier: { event: "acid-drizzle", severityMultiplier: 0.7 },
        },
    },
    {
        name: "Grounded Sky",
        desc: "lightning fronts strike ×0.8 softer",
        effect: {
            kind: "event-modifier",
            modifier: { event: "lightning-front", severityMultiplier: 0.8 },
        },
    },
    {
        name: "Worldrider",
        desc: "surge crits count as tier 5 or higher",
        effect: { kind: "surge-tier-floor", floor: 5 },
    },
    {
        name: "Midas Front",
        desc: "gold rain lands ×2 heavier",
        effect: { kind: "event-modifier", modifier: { event: "gold-rain", severityMultiplier: 2 } },
    },
];

/** the four track ladders (design §5): ~15 nodes each, cost growth ~1.6. */
export const WORKSHOP_TRACKS: readonly WorkshopTrackDef[] = [
    {
        id: "forge",
        name: "Forge",
        desc: "starting crit stats · eruption value",
        baseCost: 1,
        costGrowth: WORKSHOP_COST_GROWTH,
        nodes: FORGE_NODES,
    },
    {
        id: "vault",
        name: "Vault",
        desc: "collector fee & count · starting essence",
        baseCost: 1,
        costGrowth: WORKSHOP_COST_GROWTH,
        nodes: VAULT_NODES,
    },
    {
        id: "aegis",
        name: "Aegis",
        desc: "defense from start · heat resistance · critical temp",
        baseCost: 2,
        costGrowth: WORKSHOP_COST_GROWTH,
        nodes: AEGIS_NODES,
    },
    {
        id: "front",
        name: "Front",
        desc: "storm fronts 2–4 · event modifiers · surge tier floor",
        baseCost: 3,
        costGrowth: WORKSHOP_COST_GROWTH,
        nodes: FRONT_NODES,
    },
];

/** look up a track definition by id. */
export function trackById(id: WorkshopTrackId): WorkshopTrackDef {
    const def = WORKSHOP_TRACKS.find((t) => t.id === id);
    if (!def) throw new Error(`unknown workshop track: ${id}`);
    return def;
}

/**
 * the persistent meta state: the core wallet plus, per track, how many nodes of
 * its ladder have been purchased. nodes buy strictly in ladder order, so a count
 * is the whole purchase record.
 */
export interface WorkshopState {
    /** spendable storm cores; fractional because the ×1.5 bank-out bonus can mint halves. */
    cores: number;
    /** purchased node count per track; node `i` is owned iff `i < purchased[track]`. */
    purchased: Record<WorkshopTrackId, number>;
}

/** a fresh meta state: no cores, nothing purchased. */
export function createWorkshopState(): WorkshopState {
    return { cores: 0, purchased: { forge: 0, vault: 0, aegis: 0, front: 0 } };
}

/**
 * cost in cores of a track's node at ladder position `index` (0-based):
 * `ceil(baseCost × growth^index)` — the design §5 ~1.6 geometric ladder.
 */
export function nodeCost(track: WorkshopTrackDef, index: number): number {
    return Math.ceil(track.baseCost * Math.pow(track.costGrowth, index));
}

/**
 * credit cores earned at storm end into the wallet. non-positive and non-finite
 * amounts are ignored so a zero-yield storm cannot corrupt the wallet.
 * @returns the amount credited, or 0 when the input was ignored.
 */
export function creditCores(state: WorkshopState, amount: number): number {
    if (!(amount > 0) || !Number.isFinite(amount)) return 0;
    state.cores += amount;
    return amount;
}

/** true when the track's next ladder node exists and is affordable. */
export function canBuyNode(state: WorkshopState, trackId: WorkshopTrackId): boolean {
    const track = trackById(trackId);
    const next = state.purchased[trackId];
    if (next >= track.nodes.length) return false;
    return state.cores >= nodeCost(track, next);
}

/**
 * purchase the track's next ladder node, deducting its core cost in place.
 * @returns true iff a node was bought.
 */
export function buyNode(state: WorkshopState, trackId: WorkshopTrackId): boolean {
    if (!canBuyNode(state, trackId)) return false;
    const track = trackById(trackId);
    state.cores -= nodeCost(track, state.purchased[trackId]);
    state.purchased[trackId] += 1;
    return true;
}

/**
 * the aggregate of every purchased node's effect — what a fresh storm consumes.
 * fields whose target system does not exist yet are typed and populated here but
 * documented as consumed later, so their nodes are real purchases, never dead.
 */
export interface WorkshopEffects {
    /** Forge: upgrade levels a fresh storm's economy starts at. */
    startingLevels: Record<UpgradeId, number>;
    /** Forge: multiplier on the value strikes erupt into the world. */
    eruptionValueMultiplier: number;
    /** Vault: total reduction subtracted from the base collector fee. */
    collectorFeeReduction: number;
    /** Vault: extra collector drains beyond the first. CONSUMED LATER — the world
     * bootstraps a single drain today; multi-drain placement is future wiring. */
    extraCollectors: number;
    /** Vault: essence granted at storm start. granted spendable-only — it was not
     * collected this storm, so it never counts toward core conversion (design §5). */
    startingEssence: number;
    /** Aegis: brushes pre-unlocked at storm start. CONSUMED LATER — brushes are
     * essence-gated (not unlock-gated) today; this feeds the future unlock gate. */
    startingBrushes: readonly BrushId[];
    /** Aegis: multiplier on the surge ambient heat coefficient (<1 resists heat). */
    ambientHeatMultiplier: number;
    /** Aegis: degrees added to the surge core critical temperature. */
    criticalTempBonus: number;
    /** Front: highest storm front unlocked (1 = the base flats front). CONSUMED
     * LATER — only the flats front exists today (design §4.5); front selection is
     * future wiring. */
    unlockedFronts: number;
    /** Front: permanent storm event modifiers. CONSUMED LATER — the scheduler
     * takes no modifiers until npq.1 wires them in. */
    eventModifiers: readonly StormEventModifier[];
    /** Front: minimum tier a surge crit counts as. CONSUMED LATER — whether the
     * floor raises payouts alongside heat spikes is decided by the Front wiring
     * issue, so the surge machine keeps its base floor until then. */
    surgeTierFloor: number;
}

/** the no-purchases baseline: every multiplier 1, every bonus 0, front 1 only. */
export function baselineEffects(): WorkshopEffects {
    return {
        startingLevels: { baseDamage: 0, critChance: 0, critMulti: 0, golden: 0 },
        eruptionValueMultiplier: 1,
        collectorFeeReduction: 0,
        extraCollectors: 0,
        startingEssence: 0,
        startingBrushes: [],
        ambientHeatMultiplier: 1,
        criticalTempBonus: 0,
        unlockedFronts: 1,
        eventModifiers: [],
        surgeTierFloor: 1,
    };
}

/** fold every purchased node's effect into one aggregate a storm can consume. */
export function workshopEffects(state: WorkshopState): WorkshopEffects {
    const fx = baselineEffects();
    const brushes: BrushId[] = [];
    const modifiers: StormEventModifier[] = [];
    for (const track of WORKSHOP_TRACKS) {
        const owned = Math.min(state.purchased[track.id], track.nodes.length);
        for (let i = 0; i < owned; i++) {
            const effect = track.nodes[i].effect;
            switch (effect.kind) {
                case "starting-level":
                    fx.startingLevels[effect.upgrade] += effect.amount;
                    break;
                case "eruption-value":
                    fx.eruptionValueMultiplier *= effect.multiplier;
                    break;
                case "collector-fee":
                    fx.collectorFeeReduction += effect.reduction;
                    break;
                case "collector-count":
                    fx.extraCollectors += effect.amount;
                    break;
                case "starting-essence":
                    fx.startingEssence += effect.amount;
                    break;
                case "starting-brush":
                    brushes.push(effect.brush);
                    break;
                case "heat-resistance":
                    fx.ambientHeatMultiplier *= effect.multiplier;
                    break;
                case "critical-temp":
                    fx.criticalTempBonus += effect.bonus;
                    break;
                case "unlock-front":
                    fx.unlockedFronts = Math.max(fx.unlockedFronts, effect.front);
                    break;
                case "event-modifier":
                    modifiers.push(effect.modifier);
                    break;
                case "surge-tier-floor":
                    fx.surgeTierFloor = Math.max(fx.surgeTierFloor, effect.floor);
                    break;
            }
        }
    }
    fx.startingBrushes = brushes;
    fx.eventModifiers = modifiers;
    return fx;
}

/** the collector fee a fresh storm opens with: base minus Vault, floored at 0. */
export function collectorFeeWith(fx: WorkshopEffects): number {
    return Math.max(0, COLLECTOR_BASE_FEE - fx.collectorFeeReduction);
}

/** the surge core critical temperature a fresh storm opens with (Aegis raises it). */
export function criticalTempWith(fx: WorkshopEffects): number {
    return CORE_CRITICAL_TEMP + fx.criticalTempBonus;
}

/** the surge ambient heat coefficient a fresh storm opens with (Aegis lowers it). */
export function ambientCoeffWith(fx: WorkshopEffects): number {
    return AMBIENT_HEAT_COEFF * fx.ambientHeatMultiplier;
}

/**
 * apply the Forge/Vault storm-start grants to a fresh economy state: starting
 * upgrade levels and starting essence. the essence grant is spendable-only — it
 * deliberately skips `bankedEssence`, so a meta grant can never be laundered
 * straight back into cores at storm end (design §5: cores convert essence
 * COLLECTED this storm).
 */
export function applyStormStart(economy: EconomyState, fx: WorkshopEffects): void {
    for (const key of Object.keys(fx.startingLevels) as UpgradeId[]) {
        economy.levels[key] += fx.startingLevels[key];
    }
    economy.essence += fx.startingEssence;
}
