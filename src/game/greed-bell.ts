import type { PotState, Surge, SurgeEndReason } from "./surge";

export const BELL_RING_HEAT = 95;
export const BELL_HEAT_PER_SEC = 6;
export const BELL_EXTRA_CRITS = 2;
export const BELL_PAYOUT_MULTIPLIER = 2;
export interface GreedBell { armed: boolean; targetCrits: number; heatAdded: number }

/** start each surge with a fresh, optional wager. */
export function createGreedBell(): GreedBell { return { armed: false, targetCrits: 0, heatAdded: 0 }; }

/** offer the wager only after the player has already ridden two crits. */
export function canRingBell(surge: Surge, bell: GreedBell): boolean {
    return surge.active && surge.pot.crits >= 2 && !bell.armed;
}

/** take immediate heat in exchange for a promise to survive two more crits. */
export function ringBell(surge: Surge, bell: GreedBell): boolean {
    if (!canRingBell(surge, bell)) return false;
    bell.armed = true; bell.targetCrits = surge.pot.crits + BELL_EXTRA_CRITS;
    bell.heatAdded += BELL_RING_HEAT;
    surge.addExternalCoreHeat(BELL_RING_HEAT);
    return true;
}

/** keep the bell hot until the bank; the heat toll never switches off when the target is reached. */
export function tickBell(surge: Surge, bell: GreedBell, dtSec: number): void {
    if (!surge.active || !bell.armed || !(dtSec > 0) || !Number.isFinite(dtSec)) return;
    const heat = BELL_HEAT_PER_SEC * dtSec;
    bell.heatAdded += heat; surge.addExternalCoreHeat(heat);
}

/** create the earned extra gold only at a successful bank; it still has to land and be collected. */
export function bellReward(bell: GreedBell, pot: PotState, reason: SurgeEndReason): { multiplier: number; won: boolean } {
    const won = reason === "bank" && bell.armed && pot.crits >= bell.targetCrits;
    return { multiplier: won ? BELL_PAYOUT_MULTIPLIER : 1, won };
}
