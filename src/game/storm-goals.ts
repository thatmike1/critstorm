import { endStorm } from "./storm-end";
import type { EconomyState } from "./economy";

export interface StormGoal {
    title: string;
    detail: string;
    progress: number;
}

/** choose the next useful action from actual storm accomplishments. */
export function stormGoal(state: EconomyState, autoLevel: number, bestBank: number): StormGoal {
    if (state.bankedEssence < 1) return {
        title: "Wealth has to land",
        detail: "Strike above the cyan collector. Falling gold becomes spendable essence there.",
        progress: state.bankedEssence,
    };
    if (state.levels.baseDamage === 0) return {
        title: "Give the core some teeth",
        detail: "Buy Sharper Digits. Bigger strikes mean bigger physical payouts.",
        progress: Math.min(1, state.essence / 8),
    };
    if (autoLevel === 0) return {
        title: "Build your first machine",
        detail: "Save 60 essence. Place an Auto-Striker, then spend your attention routing its gold.",
        progress: Math.min(1, state.essence / 60),
    };
    if (bestBank === 0) return {
        title: "Ride it. Then release it.",
        detail: "A surge holds your strikes in the core. Crits grow the pot AND heat. Space banks it as gold.",
        progress: state.reachedFirstSurge ? 0.6 : 0.2,
    };
    const nextCore = (Math.max(1, Math.floor(Math.sqrt(state.bankedEssence / 500))) + 1) ** 2 * 500;
    return {
        title: `Next core at ${nextCore.toLocaleString("en-US")} essence`,
        detail: "Spending essence keeps your core progress. Bank out between surges for the ×1.5 bonus.",
        progress: Math.min(1, state.bankedEssence / nextCore),
    };
}

/** show voluntary yield and the next earned-core threshold without spending the purse. */
export function coreProjection(state: EconomyState): { cores: number; nextEssence: number } {
    const accounting = endStorm(state, "bank-out");
    return { cores: accounting.cores, nextEssence: (accounting.rawCores + 1) ** 2 * 500 };
}
