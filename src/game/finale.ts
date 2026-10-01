import { MAX_TIER, RANKS } from "./economy";
import { bankVolleyShares } from "./eruption";
import type { FrontId } from "./fronts";
import type { PotState } from "./surge";

/** the final rank is the one-pot target, measured before Forge payout bonuses. */
export const FINAL_POT_THRESHOLD = RANKS[RANKS.length - 1].threshold;
export const FINALE_DURATION_SEC = 8;
export const FINALE_BURSTS = 24;

/** qualify an actual max-tier bank in the Eye without capping the pot multiplier. */
export function qualifiesForFinale(front: FrontId, pot: PotState): boolean {
    return front === "eye" && pot.value >= FINAL_POT_THRESHOLD && (pot.maxTier ?? 0) >= MAX_TIER;
}

export interface FinaleBurst {
    x: number;
    y: number;
    payout: number;
    delayMs: number;
}

/** scatter one conserved pot across the sky with a bounded physical cell budget. */
export function finaleBursts(width: number, height: number, payout: number, rng: () => number): FinaleBurst[] {
    return bankVolleyShares(payout, FINALE_BURSTS).map((share, index) => ({
        x: Math.floor((index + 0.2 + rng() * 0.6) / FINALE_BURSTS * width),
        y: Math.floor(height * (0.08 + rng() * 0.35)),
        payout: share,
        delayMs: index / FINALE_BURSTS * 3000,
    }));
}
