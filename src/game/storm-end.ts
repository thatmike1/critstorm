import { coresFromEssence, type EconomyState } from "./economy";

/** the reason a storm ended; distinct from the bank/bust exits of one surge. */
export type StormEndReason = "bank-out" | "blow-up";

/** voluntary storm endings multiply converted cores after the square-root formula. */
export const BANK_OUT_CORE_MULTIPLIER = 1.5;

/** presentation-free accounting snapshot produced when a storm ends. */
export interface StormEndAccounting {
    reason: StormEndReason;
    /** cumulative essence collected during the completed storm. */
    bankedEssence: number;
    /** cores from the shared square-root formula before the surge floor or bank-out bonus. */
    rawCores: number;
    /** multiplier applied after conversion; 1 for a blow-up and 1.5 for a bank-out. */
    coreMultiplier: number;
    /** permanent cores earned from this storm, including its floor and any bonus. */
    cores: number;
}

/**
 * record that a storm has reached its first surge, enabling the teaching-moment
 * minimum core payout even if it ends in a blow-up before enough essence is collected.
 */
export function markFirstSurge(state: EconomyState): void {
    state.reachedFirstSurge = true;
}

/**
 * account for a completed storm without mutating its economy state. core conversion
 * uses cumulative collected essence, not the spendable balance, and voluntary exits
 * multiply the resulting cores after the square root (design §5).
 */
export function endStorm(state: EconomyState, reason: StormEndReason): StormEndAccounting {
    const rawCores = coresFromEssence(state.bankedEssence);
    const protectedCores = state.reachedFirstSurge ? Math.max(rawCores, 1) : rawCores;
    const coreMultiplier = reason === "bank-out" ? BANK_OUT_CORE_MULTIPLIER : 1;
    return {
        reason,
        bankedEssence: state.bankedEssence,
        rawCores,
        coreMultiplier,
        cores: protectedCores * coreMultiplier,
    };
}
