import type { Simulation } from "../sim/simulation";
import { createState, type EconomyState } from "./economy";
import { endStorm, type StormEndAccounting, type StormEndReason } from "./storm-end";

// the storm lifecycle (design §2/§5): one storm runs until it ends one of two ways —
// BANK OUT (voluntary, only between surges: keep everything, ×1.5 core bonus) or
// BLOW UP (the lose condition: banked essence still converts, no bonus). this module
// owns the per-storm running stats behind the results screen (gold lost to hazards,
// surges ridden), the interim blow-up condition, and the accounting summary; the
// storm-end cores math itself lives in storm-end.ts (the wave-6a model). it is
// presentation-free — the host (app.tsx) routes to the results screen and rebuilds
// the world for the next storm.

/**
 * INTERIM blow-up condition (critstorm-npq.2): an overheat bust ends the whole
 * storm — not just the surge — when the world still holds more unbanked gold than
 * this threshold. the intent is "busting while overexposed loses the storm";
 * measured in gold value left in the sim (`Simulation.totalValue()`), the same
 * scale as essence (500 per core, design §5). this is a placeholder escalation:
 * the real storm-ending pressure is critstorm-npq.1's storm events, which will
 * replace or absorb this check. until then it is deliberately generous — a bust
 * with a mostly-drained world only ends the surge, as today.
 */
export const BLOW_UP_UNBANKED_THRESHOLD = 2_000;

/**
 * whether an overheat bust escalates into a full storm blow-up under the interim
 * condition ({@link BLOW_UP_UNBANKED_THRESHOLD}): strictly more unbanked world
 * gold than the threshold at the moment of the bust.
 * @param unbankedGold gold value still in the world (`Simulation.totalValue()`),
 *   read AFTER the bust burned the pot — the pot never lands, so it is excluded.
 * @param threshold override seam for tests and npq.1's escalation tuning.
 */
export function bustTriggersBlowUp(
    unbankedGold: number,
    threshold: number = BLOW_UP_UNBANKED_THRESHOLD
): boolean {
    return unbankedGold > threshold;
}

/**
 * the full storm-end report behind the results screen (design §5 — the moment that
 * teaches "quitting while ahead is smart"): the wave-6a core accounting plus the
 * storm's running stats.
 */
export interface StormSummary extends StormEndAccounting {
    /** gold value lost to hazards this storm (acid, lava, erase, busted pots). */
    goldLost: number;
    /** surges ignited this storm. */
    surgeCount: number;
    /** storm duration in seconds at the moment it ended. */
    durationSec: number;
}

/**
 * permanent workshop effects applied at storm start (design §5 — Vault/Forge
 * tracks). the workshop screen itself is critstorm-gen.2; this seam only defines
 * how its outputs enter a fresh storm so the reset path is stable before it lands.
 */
export interface StormStartBonuses {
    /**
     * spendable essence granted at storm start (Vault). deliberately NOT credited
     * to `bankedEssence`: a grant never passed through collection, so it must not
     * convert to cores (design §5 — cores come from collected essence only).
     */
    startingEssence?: number;
}

/**
 * build the fresh economy for the next storm: a clean in-storm state plus the
 * permanent workshop starting bonuses. essence, upgrades, damage ledger, and the
 * first-surge flag all reset — only workshop effects carry across storms.
 */
export function createNextStormState(bonuses: StormStartBonuses = {}): EconomyState {
    const state = createState();
    const grant = bonuses.startingEssence ?? 0;
    if (grant > 0 && Number.isFinite(grant)) state.essence += grant;
    return state;
}

/**
 * per-storm stat tracker + teardown seam. one instance lives for exactly one
 * storm: {@link attach} subscribes it to the sim's gold-loss ledger, the host
 * reports surge ignitions, and {@link summarize} folds the stats into the final
 * accounting. {@link detach} is the teardown — after it, the dead storm's sim
 * holds no reference back into the app, so a reset cannot leak listeners.
 */
export class StormLifecycle {
    private _goldLost = 0;
    private _surgeCount = 0;
    private sim: Simulation | null = null;

    /** gold value lost to hazards so far this storm. */
    get goldLost(): number {
        return this._goldLost;
    }

    /** surges ignited so far this storm. */
    get surgeCount(): number {
        return this._surgeCount;
    }

    /**
     * subscribe to the sim's gold-loss ledger so every hazard loss (acid, lava,
     * erase, bust) accumulates into {@link goldLost}. the sim holds a single
     * listener slot; the lifecycle owns it for the storm, so attach replaces any
     * previous subscriber. attaching to a second sim detaches from the first.
     */
    attach(sim: Simulation): void {
        this.detach();
        this.sim = sim;
        sim.setGoldLossListener((e) => {
            this._goldLost += e.amount;
        });
    }

    /**
     * teardown: unsubscribe from the sim's gold-loss ledger. idempotent and safe
     * before any attach, so a host can call it unconditionally on cleanup.
     */
    detach(): void {
        this.sim?.setGoldLossListener(null);
        this.sim = null;
    }

    /** count one surge ignition (wired to the surge machine's start seam). */
    recordSurgeStart(): void {
        this._surgeCount += 1;
    }

    /**
     * fold the storm's stats into the final end-of-storm report. the core math —
     * sqrt conversion, ×1.5 bank-out bonus after the sqrt, first-surge floor — is
     * {@link endStorm}'s (the wave-6a model); this adds the results-screen stats.
     * pure with respect to the economy state; the lifecycle keeps counting, so a
     * host must summarize exactly once per storm.
     */
    summarize(state: EconomyState, reason: StormEndReason): StormSummary {
        return {
            ...endStorm(state, reason),
            goldLost: this._goldLost,
            surgeCount: this._surgeCount,
            durationSec: state.elapsed,
        };
    }
}
