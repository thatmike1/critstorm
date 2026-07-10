import type { AttackResult } from "./economy";

// the surge state machine (design §3): the heart of the bank-or-ride loop that
// replaces critstorm's frenzy. clicking fills the heat meter; at 100 a surge
// begins, and from then on every strike folds into a swelling pot until an exit
// (BANK or overheat) fires. this module owns ONLY the pot + heat + phase logic and
// the render seam that lets the core visibly swell — the two real exits (the BANK
// eruption and the overheat bust) and the heating model live in sibling issues
// hkm.2/hkm.3/hkm.4 and enter through the {@link Surge.endSurge} seam.

/** heat meter value at which a surge ignites (design §3 — the existing 0..100 meter). */
export const SURGE_HEAT_THRESHOLD = 100;

/** per-crit growth factor of the pot multiplier: `M = 1.5^n` (design §3/§6). */
export const POT_MULTIPLIER_STEP = 1.5;

/** the machine is either filling heat pre-surge (`idle`) or riding a live surge. */
export type SurgePhase = "idle" | "surging";

/**
 * why a surge ended. the two design exits (§3): `bank` = voluntary cash-out (the
 * pot erupts as a gold mountain), `bust` = overheat detonation (the pot burns).
 * both payloads live in sibling issues; this machine only routes the reason out.
 */
export type SurgeEndReason = "bank" | "bust";

/**
 * a snapshot of the live pot (design §3). `value` is the full erupt-able amount —
 * the accumulated contributions scaled by the multiplier — and is what the BANK
 * eruption / overheat bust will act on. it is deliberately NOT an abstract counter:
 * {@link Surge.pot} feeds the render seam so the core can physically swell (pillar 1).
 */
export interface PotState {
    /** running sum of strike contributions this surge, BEFORE the multiplier. */
    contributions: number;
    /** crits landed this surge; the exponent `n` of the multiplier. */
    crits: number;
    /** pot multiplier `M = 1.5^n`. */
    multiplier: number;
    /** the full pot: `contributions × multiplier` — what a BANK would erupt. */
    value: number;
}

/**
 * render/audio seams (design §3, pillar 1). the machine is presentation-free; a
 * host wires these to make the surge visible — `onPotChange` is the hook that lets
 * the core swell/glow as the pot grows. all are optional so the machine is fully
 * testable with no listeners attached.
 */
export interface SurgeListeners {
    /** fired the instant heat crosses the threshold and a surge begins. */
    onStart?(): void;
    /** fired on any exit, with the reason and the final pot before it resets. */
    onEnd?(reason: SurgeEndReason, pot: PotState): void;
    /** fired whenever the pot (or its reset) changes — the visible-swell seam. */
    onPotChange?(pot: PotState): void;
}

/** `M = 1.5^n` for `n` crits landed this surge (design §3/§6). */
export function potMultiplier(crits: number): number {
    return Math.pow(POT_MULTIPLIER_STEP, crits);
}

/** derive a full {@link PotState} snapshot from the raw contributions + crit count. */
export function potState(contributions: number, crits: number): PotState {
    const multiplier = potMultiplier(crits);
    return { contributions, crits, multiplier, value: contributions * multiplier };
}

/**
 * the surge state machine. drive it with {@link addHeat}/{@link decayHeat} while
 * idle, {@link recordStrike} while surging, and {@link endSurge} to exit. the pot,
 * heat, and phase are read-only projections so a host can render them without being
 * able to corrupt the machine's internal bookkeeping.
 */
export class Surge {
    private _phase: SurgePhase = "idle";
    private _heat = 0;
    private _contributions = 0;
    private _crits = 0;
    private readonly listeners: SurgeListeners;

    constructor(listeners: SurgeListeners = {}) {
        this.listeners = listeners;
    }

    /** current phase: `idle` (filling heat) or `surging` (a pot is live). */
    get phase(): SurgePhase {
        return this._phase;
    }

    /** true while a surge is live (convenience over comparing {@link phase}). */
    get active(): boolean {
        return this._phase === "surging";
    }

    /** the pre-surge heat meter, clamped to `[0, SURGE_HEAT_THRESHOLD]`. */
    get heat(): number {
        return this._heat;
    }

    /** a fresh snapshot of the live pot (all zero while idle). */
    get pot(): PotState {
        return potState(this._contributions, this._crits);
    }

    /**
     * fill the heat meter (design §3 — a click's heat). only meaningful while idle;
     * during a surge the meter is irrelevant, so this is a no-op. when the fill
     * reaches the threshold the surge ignites immediately.
     * @param amount heat to add; negatives are ignored.
     * @returns true iff a surge began on this call.
     */
    addHeat(amount: number): boolean {
        if (this._phase !== "idle") return false;
        this._heat = Math.min(SURGE_HEAT_THRESHOLD, this._heat + Math.max(0, amount));
        if (this._heat >= SURGE_HEAT_THRESHOLD) {
            this.begin();
            return true;
        }
        return false;
    }

    /**
     * drain the heat meter when the player stops clicking (design §3 — the meter
     * decays pre-surge). a no-op during a surge, where heat no longer applies.
     * @param amount heat to remove; negatives are ignored.
     */
    decayHeat(amount: number): void {
        if (this._phase !== "idle") return;
        this._heat = Math.max(0, this._heat - Math.max(0, amount));
    }

    /**
     * fold one strike into the pot (design §3). a non-crit adds `base` damage (no
     * dead clicks inside the centerpiece); a crit adds its full `payout` AND bumps
     * the crit count, so the multiplier `M = 1.5^n` climbs. a no-op outside a surge.
     * @param result the rolled attack; `tier > 0` marks it a crit.
     * @param base the current base damage, added for a non-crit strike.
     */
    recordStrike(result: AttackResult, base: number): void {
        if (this._phase !== "surging") return;
        const isCrit = result.tier > 0;
        this._contributions += isCrit ? result.damage : base;
        if (isCrit) this._crits += 1;
        this.listeners.onPotChange?.(this.pot);
    }

    /**
     * exit seam (design §3). the two real exits — the BANK eruption (hkm.3) and the
     * overheat bust (hkm.4) — own their spectacle payloads elsewhere; this is the
     * minimal, testable placeholder that ends the surge: it captures the final pot,
     * resets to idle, and reports the reason out through {@link SurgeListeners.onEnd}
     * so a host can drive the payload. a no-op (returning a zero pot) if not surging.
     * @returns the pot as it stood at exit, before the reset.
     */
    endSurge(reason: SurgeEndReason): PotState {
        if (this._phase !== "surging") return this.pot;
        const finalPot = this.pot;
        this._phase = "idle";
        this.clearMeters();
        this.listeners.onEnd?.(reason, finalPot);
        this.listeners.onPotChange?.(this.pot);
        return finalPot;
    }

    /** ignite a surge: clear the meter, zero a fresh pot, and announce the start. */
    private begin(): void {
        this._phase = "surging";
        this.clearMeters();
        this.listeners.onStart?.();
        this.listeners.onPotChange?.(this.pot);
    }

    /** zero the heat + pot bookkeeping without touching the phase. */
    private clearMeters(): void {
        this._heat = 0;
        this._contributions = 0;
        this._crits = 0;
    }
}
