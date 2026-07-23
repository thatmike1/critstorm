import type { StormEventType } from "./storm-events";

// storm fronts (design §4.5): meta-selected arenas defined as plain data —
// terrain composition hooks, the storm-event mix, and payout/risk multipliers.
// v1 ships the flats (tutorial) and the bog; the eye and glacier are
// finale/post-v1 and intentionally absent here.

/** identifiers for the meta-selected storm fronts (design §4.5). */
export type FrontId = "flats" | "bog";

/** relative pick weights per storm event type, consumed by the event scheduler. */
export type StormEventWeights = Readonly<Record<StormEventType, number>>;

/** tuning for buried oil pockets carved into the stone floor body. */
export interface OilPocketConfig {
    /** how many pockets to attempt across the map width. */
    readonly count: number;
    /** smallest pocket radius in cells. */
    readonly minRadius: number;
    /** largest pocket radius in cells. */
    readonly maxRadius: number;
    /** solid rows kept between the sand cap and a pocket's topmost oil cell. */
    readonly minCover: number;
}

/** tuning for plant tufts grown on the terrain surface. */
export interface PlantPatchConfig {
    /** how many patches to attempt across the map width. */
    readonly count: number;
    /** narrowest patch in columns. */
    readonly minWidth: number;
    /** widest patch in columns. */
    readonly maxWidth: number;
    /** tallest tuft in cells above the surface. */
    readonly maxHeight: number;
}

/** terrain composition hooks a front applies on top of the base floor. */
export interface FrontTerrain {
    readonly oilPockets: OilPocketConfig | null;
    readonly plantPatches: PlantPatchConfig | null;
}

/** risk x reward knobs (design §4.5) as typed multipliers the economy consumes. */
export interface FrontModifiers {
    /** scales gold payouts earned on this front; see {@link applyPayoutModifier}. */
    readonly payoutMult: number;
    /** scales hazard pressure: the event scheduler divides its cadence by this. */
    readonly riskMult: number;
}

/** one storm front (arena): terrain hooks, event mix, and payout/risk knobs. */
export interface FrontDef {
    readonly id: FrontId;
    readonly name: string;
    readonly terrain: FrontTerrain;
    readonly eventWeights: StormEventWeights;
    readonly modifiers: FrontModifiers;
}

// the flats — tutorial front. open ground, mild events. the event weights
// reproduce the pre-front scheduler mix exactly so the default storm is
// byte-for-byte unchanged.
const FLATS: FrontDef = {
    id: "flats",
    name: "The Flats",
    terrain: { oilPockets: null, plantPatches: null },
    eventWeights: {
        "gold-rain": 0.28,
        "acid-drizzle": 0.4,
        "lava-fissure": 0.26,
        "lightning-front": 0.06,
    },
    modifiers: { payoutMult: 1, riskMult: 1 },
};

// the bog — oil pockets buried in the floor and plant tufts on the surface make
// every lava fissure a fire hazard; gold rain is markedly more frequent and the
// event cadence runs hotter (riskMult), paying out more for surviving it.
const BOG: FrontDef = {
    id: "bog",
    name: "The Bog",
    terrain: {
        oilPockets: { count: 9, minRadius: 2, maxRadius: 4, minCover: 2 },
        plantPatches: { count: 12, minWidth: 4, maxWidth: 10, maxHeight: 2 },
    },
    eventWeights: {
        "gold-rain": 0.4,
        "acid-drizzle": 0.24,
        "lava-fissure": 0.3,
        "lightning-front": 0.06,
    },
    modifiers: { payoutMult: 1.25, riskMult: 1.25 },
};

/** every shippable front, keyed by id. */
export const FRONTS: Readonly<Record<FrontId, FrontDef>> = { flats: FLATS, bog: BOG };

const FRONT_IDS: readonly FrontId[] = ["flats", "bog"];

/**
 * scale a gold payout by the front's reward knob. the economy calls this at
 * its payout seam so front selection is a pure multiplier, not a fork.
 */
export function applyPayoutModifier(front: FrontDef, value: number): number {
    return value * front.modifiers.payoutMult;
}

// front selection seam: the between-storms flow (workshop Front track, results
// flow) sets the front for the next storm; createWorld reads it as its default.
// module-level state is deliberate — selection is meta, outside any one world.
let selectedFrontId: FrontId = "flats";

/** the front the next created world uses unless one is passed explicitly. */
export function getSelectedFront(): FrontDef {
    return FRONTS[selectedFrontId];
}

/** select the front for the next storm. */
export function setSelectedFront(id: FrontId): void {
    selectedFrontId = id;
}

/**
 * parse the debug `?front=<id>` query param (this wave's only selection ui).
 *
 * @param search a location search string, e.g. `"?front=bog"`.
 * @returns the named front id, or null when absent or unknown.
 */
export function frontFromQuery(search: string): FrontId | null {
    const value = new URLSearchParams(search).get("front");
    return FRONT_IDS.find((id) => id === value) ?? null;
}
