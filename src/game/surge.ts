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

/**
 * a random source in `[0, 1)`, the same shape as `Math.random`. the surge machine
 * takes one so a host can seed the per-crit heat-spike lottery deterministically
 * (the §6 tier-temperature bands are ranges, not points — the roll within a tier is
 * where the gamble lives) while production defaults to real randomness.
 */
export type SurgeRng = () => number;

/**
 * tier floor for surge crits (design §3): every crit landed inside a surge counts
 * as tier ≥ 1, so its heat spike is drawn from at least the tier-1 band. a real
 * crit already carries `tier ≥ 1`; this is the load-bearing clamp for the spike math.
 */
export const SURGE_TIER_FLOOR = 1;

/**
 * core critical temperature (design §3/§6): the moment the surge core crosses this,
 * the surge detonates and the exit seam fires with reason `bust`. a named constant
 * on purpose — the Aegis meta track raises it later so deep rides become survivable;
 * a host can override it per-surge through {@link SurgeOptions.criticalTemp}.
 */
// tuned to 620 for the wave-5b pacing pass (critstorm-4cz.3): with the base 490 the
// undefended full-ride EV crossover sat at n=4, short of the §3 target of n≈6. raising
// the ceiling gives the extra headroom the ride needs to reach ~6 crits before the
// hazard cliff, without changing any surge mechanic. still below lava's 700 emit temp
// (§6), so the thermal anchoring holds, and Aegis raises it further from here.
export const CORE_CRITICAL_TEMP = 620;

/**
 * ambient-ramp coefficient `q` (design §3/§6): surge time adds `+q·n²` heat per
 * second, where `n` is the crit count. this is the deterministic anti-stall clock —
 * heat only ever climbs, so a player cannot wait out a hot core; the quadratic in
 * `n` means the longer/deeper you have ridden, the faster sitting still cooks you.
 */
// tuned 0.15 -> 0.10 for the wave-5b pacing pass (critstorm-4cz.3): at the base 0.15 the
// quadratic ambient wait-toll dominated the low-crit fresh-economy ride and cooked the
// core before n≈6 (the "slow drag" a deep ride felt like). trimming it 33% keeps the
// deterministic anti-stall clock — ~46% of undefended busts are still ambient — while the
// bust becomes a sharp hazard cliff around n=6 rather than a slow cook.
export const AMBIENT_HEAT_COEFF = 0.1;

/**
 * per-tier crit heat-spike bands `[min, max]`, indexed by crit tier and anchored to
 * the design §6 eruption-temperature table (tier 1 → 60–90, tier 2–3 → 130–170,
 * tier 4–5 → 210–260, tier 6–7 → 330–450, tier 8 → 600+). index 0 is the non-crit
 * placeholder (no spike). a crit's spike is drawn uniformly inside its tier's band,
 * so the same roll that pumps the pot is the one that can overheat the core (§3).
 */
export const CRIT_SPIKE_BANDS: readonly (readonly [number, number])[] = [
    [0, 0], // tier 0 — non-crit, never spikes
    [60, 90], // tier 1
    [130, 150], // tier 2
    [150, 170], // tier 3
    [210, 235], // tier 4
    [235, 260], // tier 5
    [330, 390], // tier 6
    [390, 450], // tier 7
    [600, 700], // tier 8
];

/**
 * the heat a single surge crit injects into the core (design §3/§6). the tier is
 * clamped to `[SURGE_TIER_FLOOR, maxTier]` and the spike is drawn uniformly from
 * that tier's {@link CRIT_SPIKE_BANDS} band, so it is random-but-tier-scaled — a
 * high tier both fattens the pot and risks the bust.
 * @param tier the crit's tier; floored to {@link SURGE_TIER_FLOOR}.
 * @param rng a `[0,1)` source for the intra-band draw.
 */
export function critHeatSpike(tier: number, rng: SurgeRng): number {
    const maxTier = CRIT_SPIKE_BANDS.length - 1;
    const t = Math.min(Math.max(tier, SURGE_TIER_FLOOR), maxTier);
    const [lo, hi] = CRIT_SPIKE_BANDS[t];
    return lo + rng() * (hi - lo);
}

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
    /**
     * fired whenever the core temperature changes (a crit spike or an ambient tick)
     * — the instrument seam behind the design §3 core-temp gauge. carries the new
     * temp and the critical ceiling so a host can render headroom without reaching
     * into the machine.
     */
    onCoreTempChange?(coreTemp: number, criticalTemp: number): void;
}

/**
 * construction knobs for the surge machine. both are optional; production leaves
 * them default (real randomness, the base {@link CORE_CRITICAL_TEMP}) while tests
 * and the tuning harness seed the spike lottery and vary the ceiling.
 */
export interface SurgeOptions {
    /** `[0,1)` source for the per-crit heat-spike lottery; defaults to `Math.random`. */
    rng?: SurgeRng;
    /** core critical temperature; defaults to {@link CORE_CRITICAL_TEMP} (Aegis raises it). */
    criticalTemp?: number;
    /** ambient-ramp coefficient `q`; defaults to {@link AMBIENT_HEAT_COEFF}. */
    ambientCoeff?: number;
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
    private _coreTemp = 0;
    private readonly listeners: SurgeListeners;
    private readonly rng: SurgeRng;
    private readonly _criticalTemp: number;
    private readonly ambientCoeff: number;

    constructor(listeners: SurgeListeners = {}, options: SurgeOptions = {}) {
        this.listeners = listeners;
        this.rng = options.rng ?? Math.random;
        this._criticalTemp = options.criticalTemp ?? CORE_CRITICAL_TEMP;
        this.ambientCoeff = options.ambientCoeff ?? AMBIENT_HEAT_COEFF;
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

    /** current core temperature (design §3); 0 while idle, climbs across a surge. */
    get coreTemp(): number {
        return this._coreTemp;
    }

    /** the temperature at which the core busts (design §3/§6); Aegis-tunable per surge. */
    get criticalTemp(): number {
        return this._criticalTemp;
    }

    /**
     * core temperature as a fraction of critical, clamped to `[0, 1]` (design §3 —
     * the gauge's fill; `1` is the overheat edge). the bot harness reads this as
     * `coreLoad`.
     */
    get coreLoad(): number {
        return Math.min(1, Math.max(0, this._coreTemp / this._criticalTemp));
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
     * dead clicks inside the centerpiece); a crit adds its full `payout`, bumps the
     * crit count so the multiplier `M = 1.5^n` climbs, AND injects a tier-scaled core
     * heat spike ({@link critHeatSpike}) — the gamble: the same crit that fattens the
     * pot can overheat the core. if the spike pushes the core past critical the surge
     * busts immediately (the exit seam fires with reason `bust`, capturing this crit
     * in the pot — you rode it, it pumped, then it burned). a no-op outside a surge.
     * @param result the rolled attack; `tier > 0` marks it a crit.
     * @param base the current base damage, added for a non-crit strike.
     * @returns true iff the strike was captured by the pot. callers must use this —
     *   not {@link active} — to decide whether the strike still erupts as world gold:
     *   a crit whose own spike busts the surge flips `active` to false inside this
     *   call, but it WAS captured (and burned with the pot), so erupting it too would
     *   double-path exactly the strike that triggered the bust (critstorm-cjs).
     */
    recordStrike(result: AttackResult, base: number): boolean {
        if (this._phase !== "surging") return false;
        const isCrit = result.tier > 0;
        this._contributions += isCrit ? result.damage : base;
        if (isCrit) this._crits += 1;
        this.listeners.onPotChange?.(this.pot);
        if (isCrit) this.addCoreHeat(critHeatSpike(result.tier, this.rng));
        return true;
    }

    /**
     * advance the ambient heat ramp (design §3/§6): heat only climbs, by `q·n²` per
     * second of surge time, where `n` is the crit count — the deterministic anti-stall
     * clock, so sitting on a hot pot cannot cool it. a no-op outside a surge or for a
     * non-positive `dtSec`. crossing critical here busts the surge just as a spike does.
     * @param dtSec seconds of surge time elapsed since the last call.
     */
    tickHeat(dtSec: number): void {
        if (this._phase !== "surging" || !(dtSec > 0)) return;
        this.addCoreHeat(this.ambientCoeff * this._crits * this._crits * dtSec);
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

    /**
     * add `delta` to the core temperature, announce it, and bust the surge if it
     * crosses critical (design §3). the single choke point both heat sources — the
     * per-crit spike and the ambient tick — flow through, so the overheat exit is
     * defined in exactly one place. `delta` is clamped to non-negative: heat only
     * ever climbs during a surge.
     */
    private addCoreHeat(delta: number): void {
        this._coreTemp += Math.max(0, delta);
        this.listeners.onCoreTempChange?.(this._coreTemp, this._criticalTemp);
        if (this._coreTemp >= this._criticalTemp) this.endSurge("bust");
    }

    /** zero the heat + pot + core-temp bookkeeping without touching the phase. */
    private clearMeters(): void {
        this._heat = 0;
        this._contributions = 0;
        this._crits = 0;
        this._coreTemp = 0;
    }
}
