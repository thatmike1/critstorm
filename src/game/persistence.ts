/**
 * the save system (design §7): storm cores + workshop only — storms are
 * ephemeral and no in-storm state is ever persisted. the whole profile is one
 * versioned JSON blob in localStorage, written on every mutation (the surface
 * is tiny, so no debounce). corrupted or missing data always falls back to a
 * fresh profile without crashing.
 *
 * the store does NOT import the domains it persists. each domain plugs in via
 * {@link ProfileStore.register} with a (serialize, hydrate) pair keyed by its
 * profile section, so the workshop state module can connect at merge time
 * without this file knowing about it.
 */

/** localStorage key holding the whole profile blob. */
export const PROFILE_KEY = "critstorm-profile";

/** current profile schema version; any other version loads as a fresh profile. */
export const PROFILE_VERSION = 1;

/** the value type each profile section persists, keyed by section name. */
interface SectionValues {
    /** permanent storm-cores balance (design §5). */
    cores: number;
    /** purchased workshop node ids. */
    nodes: string[];
}

/** persisted profile payload, schema version 1: the version tag plus every section. */
export interface ProfileV1 extends SectionValues {
    v: typeof PROFILE_VERSION;
}

/** a profile section a domain can register for. */
export type SectionKey = keyof SectionValues;

/** every section key, in profile order — the iteration source for load/save. */
const SECTION_KEYS: readonly SectionKey[] = ["cores", "nodes"];

/** a registered domain hook: how to read its current value and how to apply a loaded one. */
interface Section<K extends SectionKey> {
    serialize: () => SectionValues[K];
    hydrate: (value: SectionValues[K]) => void;
}

/** the store's section registry: each key optionally holds ITS OWN section type. */
type Sections = { [K in SectionKey]?: Section<K> };

/** a brand-new profile with nothing earned or purchased. */
export function freshProfile(): ProfileV1 {
    return { v: PROFILE_VERSION, cores: 0, nodes: [] };
}

/** narrow an unknown parsed payload to a valid v1 profile, rejecting bad shapes. */
function isProfileV1(value: unknown): value is ProfileV1 {
    if (typeof value !== "object" || value === null) return false;
    const p = value as Record<string, unknown>;
    return (
        p.v === PROFILE_VERSION &&
        typeof p.cores === "number" &&
        Number.isFinite(p.cores) &&
        p.cores >= 0 &&
        Array.isArray(p.nodes) &&
        p.nodes.every((n) => typeof n === "string")
    );
}

/** the default backing storage; null under node (headless harness, tests without dom). */
function defaultStorage(): Storage | null {
    return typeof localStorage === "undefined" ? null : localStorage;
}

/**
 * the versioned localStorage-backed profile store. domains register their
 * sections, then {@link load} hydrates them from disk and every mutation calls
 * {@link save}. sections without a registered owner keep their last-loaded
 * value on save, so a build where only some domains are wired never wipes the
 * others' data.
 */
export class ProfileStore {
    private readonly storage: Storage | null;
    private readonly sections: Sections = {};
    /** last known profile, used to carry unregistered sections through a save. */
    private current: ProfileV1 = freshProfile();

    constructor(storage: Storage | null = defaultStorage()) {
        this.storage = storage;
    }

    /**
     * plug a domain into a profile section. call before {@link load} so the
     * domain gets hydrated; the store never imports the domain itself.
     */
    register<K extends SectionKey>(
        key: K,
        serialize: () => SectionValues[K],
        hydrate: (value: SectionValues[K]) => void
    ): void {
        // assertion (not `any`): TS cannot correlate a generic-keyed write into a
        // mapped type; the pair is built from the same K as the key, so it cannot
        // mis-pair a section with another key's value type.
        this.sections[key] = { serialize, hydrate } as Sections[K];
    }

    /**
     * read the profile from storage and hydrate every registered section.
     * missing, corrupted, or wrong-version payloads yield a fresh profile.
     */
    load(): ProfileV1 {
        this.current = this.read();
        for (const key of SECTION_KEYS) {
            this.hydrateSection(key);
        }
        return this.current;
    }

    /** feed one section's loaded value into its registered hydrate hook, if any. */
    private hydrateSection<K extends SectionKey>(key: K): void {
        this.sections[key]?.hydrate(this.current[key]);
    }

    /**
     * serialize every registered section and write the whole profile. call
     * after every mutation. a write failure (quota, private mode) is swallowed
     * — losing a save must never crash the game.
     */
    save(): void {
        const profile: ProfileV1 = {
            v: PROFILE_VERSION,
            cores: this.sections.cores?.serialize() ?? this.current.cores,
            nodes: this.sections.nodes?.serialize() ?? this.current.nodes,
        };
        this.current = profile;
        if (!this.storage) return;
        try {
            this.storage.setItem(PROFILE_KEY, JSON.stringify(profile));
        } catch {
            // storage unavailable or full — the in-memory profile stays authoritative
        }
    }

    /** parse the stored blob, falling back to a fresh profile on any defect. */
    private read(): ProfileV1 {
        if (!this.storage) return freshProfile();
        try {
            const raw = this.storage.getItem(PROFILE_KEY);
            if (raw === null) return freshProfile();
            const parsed: unknown = JSON.parse(raw);
            return isProfileV1(parsed) ? parsed : freshProfile();
        } catch {
            return freshProfile();
        }
    }
}

/** the player's permanent storm-cores wallet, persisted across storms (design §5). */
export interface CoresWallet {
    cores: number;
}

/** a wallet with zero cores, before hydration. */
export function createCoresWallet(): CoresWallet {
    return { cores: 0 };
}

/** wire a wallet into the store's `cores` section. call before {@link ProfileStore.load}. */
export function connectCoresWallet(store: ProfileStore, wallet: CoresWallet): void {
    store.register(
        "cores",
        () => wallet.cores,
        (value) => {
            wallet.cores = value;
        }
    );
}

/** credit cores earned from a completed storm and save immediately. no-op for non-positive amounts. */
export function creditCores(store: ProfileStore, wallet: CoresWallet, amount: number): void {
    if (!(amount > 0)) return;
    wallet.cores += amount;
    store.save();
}

/**
 * spend cores if the wallet covers the amount; saves on success.
 *
 * @returns true when the amount was deducted.
 */
export function spendCores(store: ProfileStore, wallet: CoresWallet, amount: number): boolean {
    if (!(amount > 0) || wallet.cores < amount) return false;
    wallet.cores -= amount;
    store.save();
    return true;
}
