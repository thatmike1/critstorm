import {
    createWorkshopState,
    WORKSHOP_TRACKS,
    type WorkshopState,
    type WorkshopTrackId,
} from "./workshop";
import type { ProfileStore } from "./persistence";

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

/** encode purchased track counts as profile node ids, one `track:index` id per bought node. */
export function encodePurchasedNodes(state: WorkshopState): string[] {
    const ids: string[] = [];
    for (const track of WORKSHOP_TRACKS) {
        for (let i = 0; i < state.purchased[track.id]; i++) {
            ids.push(`${track.id}:${i}`);
        }
    }
    return ids;
}

/**
 * apply profile node ids onto a workshop state's purchase counts, tolerating
 * unknown tracks and clamping counts to each ladder's length.
 */
export function applyPurchasedNodes(state: WorkshopState, nodes: string[]): void {
    for (const track of WORKSHOP_TRACKS) {
        const prefix = `${track.id}:`;
        const count = nodes.filter((id) => id.startsWith(prefix)).length;
        state.purchased[track.id] = Math.min(count, track.nodes.length);
    }
}

// the live workshop state the profile's cores/nodes sections read from and
// hydrate into; the app republishes it via saveWorkshopProfile on every mutation.
const holder = { state: createWorkshopState() };

/**
 * wire the workshop into the profile's `cores` and `nodes` sections, hydrate
 * from storage, and return the loaded state. call once at boot before render.
 */
export function loadWorkshopProfile(store: ProfileStore): WorkshopState {
    store.register(
        "cores",
        () => holder.state.cores,
        (value) => {
            holder.state.cores = value;
        }
    );
    store.register(
        "nodes",
        () => encodePurchasedNodes(holder.state),
        (value) => {
            applyPurchasedNodes(holder.state, value);
        }
    );
    store.load();
    return holder.state;
}

/** publish the latest workshop state and persist the whole profile. */
export function saveWorkshopProfile(store: ProfileStore, state: WorkshopState): void {
    holder.state = state;
    store.save();
}
