/**
 * bot strategy interface for the headless storm harness (design.md §3, §6).
 *
 * a strategy watches the storm each decision tick and decides whether to keep
 * riding the surge or bank the pot. the surge mechanics themselves (pot,
 * multiplier, per-crit core spikes) land with the hkm.* issues; until then the
 * `surge` field of the view is `undefined` and every strategy degrades to a
 * no-op. the interface is shaped so the real surge logic drops in without
 * reworking the harness: strategies already read `{ economy, coreTemp, surge? }`
 * and return an action.
 */
import type { EconomyState } from "../src/game/economy";

/** lifecycle of a surge; `idle` between surges, `active` while a pot is building */
export type SurgePhase = "idle" | "active";

/**
 * placeholder surge state — the real shape is finalized by the hkm.* surge
 * mechanics. kept minimal and typed so strategies compile against it today and
 * the fields only gain meaning once the surge system feeds them.
 */
export interface SurgeState {
    phase: SurgePhase;
    /** number of crits landed this surge; drives the pot multiplier */
    critCount: number;
    /** pot value accumulated this surge, in essence */
    pot: number;
    /** pot multiplier, `1.5^critCount` per §3 */
    multiplier: number;
    /** current core temperature relative to critical, 0..1 (1 = overheat) */
    coreLoad: number;
}

/** the read-only slice of the world a strategy sees when it decides */
export interface StormView {
    /** elapsed storm time in seconds */
    time: number;
    /** live economy snapshot (essence, levels, timers) */
    economy: EconomyState;
    /** temperature of the sim's core cell — the overheat instrument (§3) */
    coreTemp: number;
    /** surge state, or `undefined` until the hkm.* surge mechanics land */
    surge?: SurgeState;
}

/** actions a strategy can request each decision tick */
export type StrategyAction =
    | { type: "none" }
    /** bank the pot now (spacebar): erupts the pot as gold, ends the surge */
    | { type: "bank" }
    /** keep riding: take the next crit's multiplier and its bust risk */
    | { type: "ride" };

/** a named bot that decides bank-or-ride from the storm view */
export interface BotStrategy {
    readonly name: string;
    decide(view: StormView): StrategyAction;
}

const NONE: StrategyAction = { type: "none" };

/**
 * never-ride: bank the instant a surge exists. the risk-free baseline — every
 * surge cashes out at multiplier 1, so its EV is the floor the other strategies
 * must beat.
 */
export const neverRide: BotStrategy = {
    name: "never-ride",
    decide(view) {
        if (view.surge?.phase === "active") return { type: "bank" };
        return NONE;
    },
};

/**
 * always-ride: never voluntarily bank — ride until overheat busts the surge.
 * the reckless ceiling; the harness measures how often greed detonates the pot.
 */
export const alwaysRide: BotStrategy = {
    name: "always-ride",
    decide(view) {
        if (view.surge?.phase === "active") return { type: "ride" };
        return NONE;
    },
};

/**
 * bank-at-n: ride until `n` crits have landed this surge, then bank. §3 targets
 * the EV crossover at n≈6 undefended, so this is the tunable the harness sweeps
 * to find where riding stops paying.
 */
export function bankAtN(n: number): BotStrategy {
    return {
        name: `bank-at-${n}`,
        decide(view) {
            const surge = view.surge;
            if (surge?.phase !== "active") return NONE;
            return surge.critCount >= n ? { type: "bank" } : { type: "ride" };
        },
    };
}

/** resolve a strategy name (as passed on the CLI) to a concrete strategy */
export function strategyByName(name: string): BotStrategy {
    switch (name) {
        case "never-ride":
            return neverRide;
        case "always-ride":
            return alwaysRide;
        default: {
            // bank-at-n accepts a suffix count, e.g. "bank-at-8"; defaults to 6
            const m = /^bank-at(?:-(\d+))?$/.exec(name);
            if (m) return bankAtN(m[1] ? Number(m[1]) : 6);
            throw new Error(`unknown strategy: ${name}`);
        }
    }
}
