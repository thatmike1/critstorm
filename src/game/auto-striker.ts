import { Container, Graphics } from "pixi.js";
import {
    applyAttack,
    baseDamage,
    rollAttack,
    type AttackResult,
    type EconomyState,
} from "./economy";
import type { Surge } from "./surge";
import type { World } from "./world";

/** essence price of the first auto-striker, affordable in the early-mid storm. */
export const AUTO_STRIKER_PURCHASE_COST = 60;

/** essence price of the first interval upgrade. */
export const AUTO_STRIKER_UPGRADE_BASE_COST = 90;

/** interval-upgrade cost growth, inside the design §6 1.15–1.35 band. */
export const AUTO_STRIKER_COST_GROWTH = 1.25;

/** maximum purchasable auto-striker level. */
export const AUTO_STRIKER_MAX_LEVEL = 12;

/** heat added by every strike source before a surge begins. */
export const HEAT_PER_STRIKE = 7;

const BASE_INTERVAL_SEC = 3.5;
const INTERVAL_REDUCTION_SEC = 0.2;
const MIN_INTERVAL_SEC = 1;
const FIRE_TELL_SEC = 0.16;

export interface AutoStrikerState {
    /** level 0 is unowned; level 1 is the purchased base turret. */
    level: number;
    /** elapsed time carried between fixed-timestep updates. */
    timerSec: number;
}

export interface StrikeTarget {
    x: number;
    y: number;
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
 */
export function executeStrike(
    economy: EconomyState,
    surge: Surge,
    rng: () => number,
    callbacks: StrikePathCallbacks,
    target?: StrikeTarget
): AttackResult {
    if (surge.addHeat(HEAT_PER_STRIKE)) callbacks.onSurgeStart();
    const result = rollAttack(economy, rng);
    applyAttack(economy, result);
    const captured = surge.recordStrike(result, baseDamage(economy));
    callbacks.onStrike(result, captured, target);
    return result;
}

/** render the fixed turret beside the strike zone with a brief muzzle tell on fire. */
export class AutoStrikerRenderer {
    readonly gfx: Graphics;
    private readonly world: World;
    private owned = false;
    private fireTell = 0;

    constructor(stage: Container, world: World) {
        this.world = world;
        this.gfx = new Graphics();
        this.gfx.visible = false;
        stage.addChild(this.gfx);
    }

    /** show or hide the turret when ownership changes. */
    setOwned(owned: boolean): void {
        this.owned = owned;
        this.gfx.visible = owned;
    }

    /** start the short muzzle-flash tell for an automatic strike. */
    fire(): void {
        if (this.owned) this.fireTell = FIRE_TELL_SEC;
    }

    /** redraw at the current screen scale and decay the firing tell by elapsed seconds. */
    update(dtSec: number, screenWidth: number, screenHeight: number): void {
        if (!this.owned) return;
        this.fireTell = Math.max(0, this.fireTell - dtSec);
        const { W, H } = this.world.sim;
        const zone = this.world.strikeZone;
        const unit = Math.max(2, Math.floor(Math.min(screenWidth / W, screenHeight / H) * 2));
        const gx = Math.min(zone.x + zone.radius + 9, W - 8);
        const gy = Math.min(zone.y + 2, H - 8);
        const x = Math.round((gx / W) * screenWidth);
        const y = Math.round((gy / H) * screenHeight);

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
