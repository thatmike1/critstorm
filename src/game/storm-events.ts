import { Mat } from "../sim/materials";
import type { StormEventWeights } from "./fronts";
import type { StormEventModifier } from "./workshop";
import type { World } from "./world";

/** a deterministic source of random values in the half-open range [0, 1). */
export type StormEventRng = () => number;

/** world events that can occur while a storm is active (design §4.4). */
export type StormEventType = "gold-rain" | "acid-drizzle" | "lava-fissure" | "lightning-front";

/** a cell the event changed in the world simulation. */
export interface StormEventCell {
    readonly x: number;
    readonly y: number;
}

/** the observable result of one dispatched storm event. */
export interface StormEvent {
    readonly type: StormEventType;
    readonly severity: number;
    readonly elapsed: number;
    readonly cells: readonly StormEventCell[];
    /** new gold value introduced by this event; the event ledger's erupted term. */
    readonly erupted: number;
}

/** count the one semantic rod reward attached to each lightning-front event. */
export function lightningRodStrikeCount(
    events: readonly StormEvent[],
    hasRod: boolean
): number {
    if (!hasRod) return 0;
    return events.reduce((count, event) => count + (event.type === "lightning-front" ? 1 : 0), 0);
}

/** seconds between the first two events of a fresh storm. */
export const INITIAL_STORM_EVENT_CADENCE = 42;
/** lower bound on the event interval deep into a storm. */
export const MIN_STORM_EVENT_CADENCE = 12;
/** duration over which the cadence reaches its minimum. */
export const STORM_EVENT_ESCALATION_DURATION = 30 * 60;
/** highest discrete event severity. */
export const MAX_STORM_EVENT_SEVERITY = 5;

const SEVERITY_INTERVAL = 6 * 60;
const GOLD_VALUE_PER_CELL = 50;

/** clamp a number to the inclusive range `[lo, hi]`. */
function clamp(value: number, lo: number, hi: number): number {
    return value < lo ? lo : value > hi ? hi : value;
}

/** pick an integer in the inclusive range `[lo, hi]` from `rng`. */
function randomInt(rng: StormEventRng, lo: number, hi: number): number {
    return lo + Math.floor(clamp(rng(), 0, 0.9999999999999999) * (hi - lo + 1));
}

/** normalize an externally supplied event severity to the supported tuning range. */
function normalizedSeverity(severity: number): number {
    return clamp(Math.floor(severity), 1, MAX_STORM_EVENT_SEVERITY);
}

/** return a stable mulberry32 rng for one storm's scheduler. */
export function createStormEventRng(seed: number): StormEventRng {
    let state = seed >>> 0;
    return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/** return the time between events at a given storm duration. */
export function stormEventCadence(elapsed: number): number {
    const progress = clamp(elapsed / STORM_EVENT_ESCALATION_DURATION, 0, 1);
    return (
        INITIAL_STORM_EVENT_CADENCE +
        (MIN_STORM_EVENT_CADENCE - INITIAL_STORM_EVENT_CADENCE) * progress
    );
}

/** return the severity tier at a given storm duration. */
export function stormEventSeverity(elapsed: number): number {
    return clamp(
        1 + Math.floor(Math.max(0, elapsed) / SEVERITY_INTERVAL),
        1,
        MAX_STORM_EVENT_SEVERITY
    );
}

// fixed iteration order for the weighted pick, so a given rng roll always maps
// to the same event regardless of the weight object's key order.
const EVENT_TYPE_ORDER: readonly StormEventType[] = [
    "gold-rain",
    "acid-drizzle",
    "lava-fissure",
    "lightning-front",
];

/**
 * choose a storm event type from a front's event-mix weights (design §4.5).
 * weights are relative — they are normalised by their sum, so any positive
 * scale works. one rng draw per call.
 */
export function chooseStormEventType(
    rng: StormEventRng,
    weights: StormEventWeights
): StormEventType {
    let total = 0;
    for (const type of EVENT_TYPE_ORDER) total += weights[type];
    let roll = rng() * total;
    for (const type of EVENT_TYPE_ORDER) {
        roll -= weights[type];
        if (roll < 0) return type;
    }
    return EVENT_TYPE_ORDER[EVENT_TYPE_ORDER.length - 1];
}

/** return true when a cell is safe to overwrite with a new storm event particle. */
function isEmpty(world: World, x: number, y: number): boolean {
    return world.sim.cells[y * world.sim.W + x] === Mat.EMPTY;
}

/** paint value-carrying solid gold across the sky without overwriting existing value. */
function triggerGoldRain(world: World, severity: number, rng: StormEventRng): StormEvent {
    const { sim } = world;
    const width = Math.min(sim.W, Math.round(3 + severity * 2));
    const start = randomInt(rng, 0, sim.W - width);
    const cells: StormEventCell[] = [];
    for (let x = start; x < start + width; x++) {
        if (!isEmpty(world, x, 0)) continue;
        sim.paint(x, 0, 0, Mat.GOLD);
        sim.addValue(x, 0, GOLD_VALUE_PER_CELL * severity);
        cells.push({ x, y: 0 });
    }
    return {
        type: "gold-rain",
        severity,
        elapsed: 0,
        cells,
        erupted: cells.length * GOLD_VALUE_PER_CELL * severity,
    };
}

/** paint an acid band at the top of the world without overwriting gold in play. */
function triggerAcidDrizzle(world: World, severity: number, rng: StormEventRng): StormEvent {
    const { sim } = world;
    const width = Math.min(sim.W, Math.round(4 + severity * 4));
    const start = randomInt(rng, 0, sim.W - width);
    const cells: StormEventCell[] = [];
    for (let x = start; x < start + width; x++) {
        if (!isEmpty(world, x, 0)) continue;
        sim.paint(x, 0, 0, Mat.ACID);
        cells.push({ x, y: 0 });
    }
    return { type: "acid-drizzle", severity, elapsed: 0, cells, erupted: 0 };
}

/** open a hot lava crack in the terrain floor without overwriting value-carrying cells. */
function triggerLavaFissure(world: World, severity: number, rng: StormEventRng): StormEvent {
    const { sim } = world;
    const width = Math.min(sim.W, Math.round(severity * 2 + 1));
    const start = randomInt(rng, 0, sim.W - width);
    const cells: StormEventCell[] = [];
    for (let x = start; x < start + width; x++) {
        const y = world.floorHeightAt(x);
        const cell = sim.cells[y * sim.W + x];
        if (cell !== Mat.SAND && cell !== Mat.STONE) continue;
        sim.paint(x, y, 0, Mat.LAVA);
        cells.push({ x, y });
    }
    if (cells.length > 0) {
        const centre = cells[Math.floor(cells.length / 2)];
        sim.injectHeat(centre.x, centre.y, Math.ceil(severity + 1), 720 + severity * 40);
    }
    return { type: "lava-fissure", severity, elapsed: 0, cells, erupted: 0 };
}

/** trace seeded physical lightning bolts; one event remains one semantic event. */
function triggerLightningFront(world: World, severity: number, rng: StormEventRng): StormEvent {
    const bolts = Math.min(3, Math.max(1, Math.round(severity)));
    const changed = new Map<number, StormEventCell>();
    for (let i = 0; i < bolts; i++) {
        const x = randomInt(rng, 0, world.sim.W - 1);
        for (const cell of world.sim.strike(x, 0, rng).changedCells) {
            changed.set(cell.y * world.sim.W + cell.x, cell);
        }
    }
    return { type: "lightning-front", severity, elapsed: 0, cells: [...changed.values()], erupted: 0 };
}

/** apply one world event through existing simulation paint and heat primitives. */
export function triggerStormEvent(
    world: World,
    type: StormEventType,
    severity: number,
    rng: StormEventRng,
    strength = 1
): StormEvent {
    const normalized = normalizedSeverity(severity) * Math.max(0.1, Math.min(8, strength));
    switch (type) {
        case "gold-rain":
            return triggerGoldRain(world, normalized, rng);
        case "acid-drizzle":
            return triggerAcidDrizzle(world, normalized, rng);
        case "lava-fissure":
            return triggerLavaFissure(world, normalized, rng);
        case "lightning-front":
            return triggerLightningFront(world, normalized, rng);
    }
}

/** schedule deterministic storm events whose cadence and severity escalate over time. */
export class StormEvents {
    /** total gold value newly erupted by gold-rain events in this storm. */
    totalErupted = 0;
    private nextEventAt = INITIAL_STORM_EVENT_CADENCE;
    private nextType: StormEventType;
    private nextEyeLightningAt = 4;
    private readonly eyeRng: StormEventRng;

    constructor(
        private readonly world: World,
        private readonly rng: StormEventRng,
        private readonly upgrades: readonly StormEventModifier[] = []
    ) {
        this.nextType = chooseStormEventType(rng, world.front.eventWeights);
        this.eyeRng = world.front.id === "eye" ? createStormEventRng(Math.floor(rng() * 0xffff_ffff)) : rng;
    }

    /** forecast the next physical event so preparation is an actual choice. */
    get forecast(): { type: StormEventType; at: number } {
        return this.world.front.id === "eye" && this.nextEyeLightningAt < this.nextEventAt
            ? { type: "lightning-front", at: this.nextEyeLightningAt } : { type: this.nextType, at: this.nextEventAt };
    }

    /**
     * dispatch every event due at `elapsed`, returning them in scheduled order.
     * the world's front supplies the event mix and the risk multiplier: a front
     * with riskMult > 1 shortens the interval between events by that factor
     * (design §4.5 — risk x reward).
     */
    tick(elapsed: number): StormEvent[] {
        const { eventWeights, modifiers } = this.world.front;
        const events: StormEvent[] = [];
        while (elapsed >= this.nextEventAt) {
            const scheduledAt = this.nextEventAt;
            const event = triggerStormEvent(
                this.world,
                this.nextType,
                stormEventSeverity(scheduledAt),
                this.rng,
                this.upgrades.filter((upgrade) => upgrade.event === this.nextType)
                    .reduce((strength, upgrade) => strength * upgrade.severityMultiplier, 1)
            );
            this.nextType = chooseStormEventType(this.rng, eventWeights);
            const timedEvent: StormEvent = { ...event, elapsed: scheduledAt };
            events.push(timedEvent);
            this.totalErupted += timedEvent.erupted;
            this.nextEventAt += stormEventCadence(scheduledAt) / modifiers.riskMult;
        }
        if (this.world.front.id === "eye") {
            while (elapsed >= this.nextEyeLightningAt) {
                const event = triggerStormEvent(this.world, "lightning-front", 1, this.eyeRng);
                events.push({ ...event, elapsed: this.nextEyeLightningAt });
                this.nextEyeLightningAt += 6;
            }
            events.sort((a, b) => a.elapsed - b.elapsed);
        }
        return events;
    }
}
