import { Container, Graphics } from "pixi.js";
import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";
import {
    applyAttack,
    baseDamage,
    rollAttack,
    type AttackResult,
    type EconomyState,
} from "./economy";
import type { Surge } from "./surge";
import type { StrikeZone, World } from "./world";

/** essence price of the first auto-striker, affordable in the early-mid storm. */
export const AUTO_STRIKER_PURCHASE_COST = 60;

/** essence price of the first interval upgrade. */
export const AUTO_STRIKER_UPGRADE_BASE_COST = 90;

/** interval-upgrade cost growth, inside the design §6 1.15–1.35 band. */
export const AUTO_STRIKER_COST_GROWTH = 1.25;

/** maximum purchasable auto-striker level. */
export const AUTO_STRIKER_MAX_LEVEL = 12;

/** heat added by a manual strike before a surge begins. */
export const HEAT_PER_STRIKE = 7;

/**
 * gross pre-surge heat the turret contributes per second of owned cadence. each
 * auto strike carries this rate accumulated over its interval, so the turret's
 * heat build is cadence-independent and always beats the {@link HEAT_DECAY_PER_SEC}
 * pre-surge drain: net +4 heat/s, igniting a surge hands-free in ~15–25 s. tuned
 * below sustained manual clicking (3 clicks/s nets +5/s), so forcing a surge by
 * hand stays the faster option — the turret shifts hands-on time to routing and
 * defense (design §2) without trivializing manual play.
 */
export const AUTO_STRIKER_HEAT_RATE = 20;

const BASE_INTERVAL_SEC = 3.5;
const INTERVAL_REDUCTION_SEC = 0.2;
const MIN_INTERVAL_SEC = 1;
const FIRE_TELL_SEC = 0.16;

/** an aim or impact point in grid cells. */
export interface StrikeTarget {
    x: number;
    y: number;
}

export interface AutoStrikerState {
    /** level 0 is unowned; level 1 is the placed base turret. */
    level: number;
    /** elapsed time carried between fixed-timestep updates. */
    timerSec: number;
    /** placed turret position in grid cells; null until placed (headless runs keep it null). */
    position: StrikeTarget | null;
}

export interface StrikePathCallbacks {
    /** called when this strike crosses the heat threshold into a surge. */
    onSurgeStart(): void;
    /** called after the shared attack and surge-capture bookkeeping completes. */
    onStrike(result: AttackResult, captured: boolean, target?: StrikeTarget): void;
}

/** create an auto-striker state, clamping migrated levels into the supported range. */
export function createAutoStrikerState(level = 0): AutoStrikerState {
    const migratedLevel = Number.isFinite(level) ? Math.floor(level) : 0;
    return {
        level: Math.min(Math.max(migratedLevel, 0), AUTO_STRIKER_MAX_LEVEL),
        timerSec: 0,
        position: null,
    };
}

/** return the current interval in seconds, or infinity while the turret is unowned. */
export function autoStrikerInterval(state: AutoStrikerState): number {
    if (state.level === 0) return Number.POSITIVE_INFINITY;
    return Math.max(
        BASE_INTERVAL_SEC - (state.level - 1) * INTERVAL_REDUCTION_SEC,
        MIN_INTERVAL_SEC
    );
}

/**
 * pre-surge heat one auto strike adds: {@link AUTO_STRIKER_HEAT_RATE} accumulated
 * over the current interval. scaling with cadence keeps the turret's gross heat
 * rate constant across levels, so every owned level out-builds the pre-surge
 * decay and sustained cadence always reaches the surge threshold. 0 while unowned.
 */
export function autoStrikerStrikeHeat(state: AutoStrikerState): number {
    if (state.level === 0) return 0;
    return AUTO_STRIKER_HEAT_RATE * autoStrikerInterval(state);
}

/** return the price of the next purchase or interval upgrade. */
export function autoStrikerUpgradeCost(state: AutoStrikerState): number {
    if (state.level === 0) return AUTO_STRIKER_PURCHASE_COST;
    return Math.ceil(
        AUTO_STRIKER_UPGRADE_BASE_COST * Math.pow(AUTO_STRIKER_COST_GROWTH, state.level - 1)
    );
}

/** true when the next turret purchase or interval upgrade is affordable. */
export function canUpgradeAutoStriker(economy: EconomyState, state: AutoStrikerState): boolean {
    return state.level < AUTO_STRIKER_MAX_LEVEL && economy.essence >= autoStrikerUpgradeCost(state);
}

/** purchase the turret or its next interval upgrade, charging essence exactly once. */
export function upgradeAutoStriker(economy: EconomyState, state: AutoStrikerState): boolean {
    if (!canUpgradeAutoStriker(economy, state)) return false;
    economy.essence -= autoStrikerUpgradeCost(state);
    state.level += 1;
    return true;
}

/** cells that must be empty for a turret placement, so placing destroys nothing. */
const AUTO_STRIKER_FOOTPRINT = [
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
] as const;

/** true when every footprint cell is in-bounds and empty air. */
function hasEmptyFootprint(sim: Simulation, x: number, y: number): boolean {
    return AUTO_STRIKER_FOOTPRINT.every((offset) => {
        const px = x + offset.x;
        const py = y + offset.y;
        return (
            px >= 0 &&
            py >= 0 &&
            px < sim.W &&
            py < sim.H &&
            sim.cells[py * sim.W + px] === Mat.EMPTY
        );
    });
}

/**
 * place the auto-striker turret at one grid coordinate (design §4.3 — structures
 * are placed objects). rejects a second placement, an occupied or out-of-bounds
 * footprint, and an unaffordable purchase, all before any essence is charged; on
 * success it charges the purchase price and records the turret position. interval
 * upgrades stay purchasable through {@link upgradeAutoStriker} afterwards.
 */
export function placeAutoStriker(
    sim: Simulation,
    economy: EconomyState,
    state: AutoStrikerState,
    x: number,
    y: number
): boolean {
    if (state.level > 0) return false;
    if (!hasEmptyFootprint(sim, x, y)) return false;
    if (!upgradeAutoStriker(economy, state)) return false;
    state.position = { x, y };
    return true;
}

/**
 * the pre-placement fixed spot beside the strike zone, used only to migrate the
 * legacy ?lv dev cheat (which grants levels without a placement click).
 */
export function defaultAutoStrikerPosition(zone: StrikeZone, w: number, h: number): StrikeTarget {
    return {
        x: Math.min(zone.x + zone.radius + 9, w - 8),
        y: Math.min(zone.y + 2, h - 8),
    };
}

/**
 * pick an area-uniform aim point inside the strike zone for an auto strike
 * (sqrt keeps the disc sampling area-uniform). aim is gameplay-affecting — it
 * decides where the gold lands for routing — so it lives here, on an injectable
 * rng, instead of in the renderer.
 */
export function autoStrikerAim(zone: StrikeZone, rng: () => number): StrikeTarget {
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * zone.radius;
    return { x: zone.x + Math.cos(angle) * r, y: zone.y + Math.sin(angle) * r };
}

/**
 * widen an aim point by the tier-scaled landing spread, in grid cells. moved out
 * of the renderer so every gameplay-affecting roll flows through the strike rng.
 */
export function applyStrikeSpread(
    target: StrikeTarget,
    tier: number,
    rng: () => number
): StrikeTarget {
    const spread = 1 + tier * 1.5;
    return {
        x: target.x + (rng() - 0.5) * 2 * spread,
        y: target.y + (rng() - 0.5) * 2 * spread,
    };
}

/**
 * advance the auto-striker on elapsed seconds and fire once per crossed interval.
 * the remainder is retained, so cadence is independent of frame rate and dt size.
 */
export function tickAutoStriker(
    state: AutoStrikerState,
    dtSec: number,
    onStrike: () => void
): number {
    if (state.level === 0 || !(dtSec > 0) || !Number.isFinite(dtSec)) return 0;
    state.timerSec += dtSec;
    const interval = autoStrikerInterval(state);
    let fired = 0;
    while (state.timerSec >= interval) {
        state.timerSec -= interval;
        onStrike();
        fired += 1;
    }
    return fired;
}

/**
 * run one manual or automatic strike through the same economy, heat, and surge path.
 * presentation receives the captured result so it can suppress duplicate eruptions.
 * `target` is the aim point in grid cells; the tier-scaled landing spread is applied
 * here with the strike rng, so the impact point handed to `onStrike` is final and
 * the renderer never rolls gameplay-affecting randomness. `heat` defaults to the
 * manual per-click fill; auto strikes pass {@link autoStrikerStrikeHeat}.
 */
export function executeStrike(
    economy: EconomyState,
    surge: Surge,
    rng: () => number,
    callbacks: StrikePathCallbacks,
    target?: StrikeTarget,
    heat: number = HEAT_PER_STRIKE
): AttackResult {
    if (surge.addHeat(heat)) callbacks.onSurgeStart();
    const result = rollAttack(economy, rng);
    applyAttack(economy, result);
    const captured = surge.recordStrike(result, baseDamage(economy));
    const impact = target ? applyStrikeSpread(target, result.tier, rng) : undefined;
    callbacks.onStrike(result, captured, impact);
    return result;
}

/** render the placed turret at its grid position with a brief muzzle tell on fire. */
export class AutoStrikerRenderer {
    readonly gfx: Graphics;
    private readonly world: World;
    private position: StrikeTarget | null = null;
    private fireTell = 0;

    constructor(stage: Container, world: World) {
        this.world = world;
        this.gfx = new Graphics();
        this.gfx.visible = false;
        stage.addChild(this.gfx);
    }

    /** show the turret at its placed grid position, or hide it with null. */
    setPlacement(position: StrikeTarget | null): void {
        this.position = position;
        this.gfx.visible = position !== null;
    }

    /** start the short muzzle-flash tell for an automatic strike. */
    fire(): void {
        if (this.position) this.fireTell = FIRE_TELL_SEC;
    }

    /** redraw at the current screen scale and decay the firing tell by elapsed seconds. */
    update(dtSec: number, screenWidth: number, screenHeight: number): void {
        if (!this.position) return;
        this.fireTell = Math.max(0, this.fireTell - dtSec);
        const { W, H } = this.world.sim;
        const unit = Math.max(2, Math.floor(Math.min(screenWidth / W, screenHeight / H) * 2));
        const x = Math.round((this.position.x / W) * screenWidth);
        const y = Math.round((this.position.y / H) * screenHeight);

        this.gfx.clear();
        this.gfx.rect(-unit * 2, unit * 2, unit * 4, unit).fill(0x2b251b);
        this.gfx.rect(-unit, -unit, unit * 3, unit * 3).fill(0x695f4d);
        this.gfx.rect(-unit * 4, -unit, unit * 4, unit).fill(0x9b8b68);
        this.gfx.rect(-unit, -unit * 2, unit * 2, unit).fill(0xf4cf5a);
        this.gfx.rect(0, 0, unit, unit).fill(0x17130c);
        if (this.fireTell > 0) {
            const alpha = this.fireTell / FIRE_TELL_SEC;
            this.gfx.rect(-unit * 6, -unit * 2, unit * 2, unit * 3).fill({
                color: 0xffe89a,
                alpha,
            });
        }
        this.gfx.position.set(x, y);
    }
}
