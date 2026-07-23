import {
    createWorkshopState,
    WORKSHOP_TRACKS,
    type WorkshopState,
    type WorkshopTrackId,
} from "./workshop";

// persistence for the workshop meta state (design §5: storm cores are PERMANENT).
// the pure serialize/deserialize pair is what tests cover; the localStorage pair
// is a thin guarded shell so the model never touches browser globals directly.

/** the versioned localStorage key for the workshop meta state. */
export const WORKSHOP_STORAGE_KEY = "critstorm-workshop-v1";

/** encode a workshop state as a stable JSON string. */
export function serializeWorkshop(state: WorkshopState): string {
    return JSON.stringify({ cores: state.cores, purchased: state.purchased });
}

/**
 * decode a serialized workshop state, tolerating unknown, malformed, or
 * hand-edited input: any invalid field falls back to the fresh-state value, and
 * purchase counts are clamped to each track's ladder length so a corrupt save
 * can never index past the node tables.
 */
export function deserializeWorkshop(raw: string | null): WorkshopState {
    const state = createWorkshopState();
    if (!raw) return state;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return state;
    }
    if (typeof parsed !== "object" || parsed === null) return state;
    const record = parsed as Record<string, unknown>;
    if (typeof record.cores === "number" && Number.isFinite(record.cores) && record.cores >= 0) {
        state.cores = record.cores;
    }
    const purchased = record.purchased;
    if (typeof purchased === "object" && purchased !== null) {
        const counts = purchased as Partial<Record<WorkshopTrackId, unknown>>;
        for (const track of WORKSHOP_TRACKS) {
            const value = counts[track.id];
            if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
                state.purchased[track.id] = Math.min(value, track.nodes.length);
            }
        }
    }
    return state;
}

/** load the persisted workshop state, or a fresh one when storage is empty/unusable. */
export function loadWorkshop(): WorkshopState {
    try {
        return deserializeWorkshop(window.localStorage.getItem(WORKSHOP_STORAGE_KEY));
    } catch {
        return createWorkshopState();
    }
}

/** persist the workshop state; storage failures (private mode, quota) are swallowed. */
export function saveWorkshop(state: WorkshopState): void {
    try {
        window.localStorage.setItem(WORKSHOP_STORAGE_KEY, serializeWorkshop(state));
    } catch {
        // persistence is best-effort: a blocked localStorage must never break play.
    }
}
