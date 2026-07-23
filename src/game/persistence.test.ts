// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
    PROFILE_KEY,
    PROFILE_VERSION,
    ProfileStore,
    connectCoresWallet,
    createCoresWallet,
    creditCores,
    freshProfile,
    spendCores,
    type ProfileV1,
} from "./persistence";

/** build a store with a cores wallet already registered. */
function storeWithWallet(): { store: ProfileStore; wallet: ReturnType<typeof createCoresWallet> } {
    const store = new ProfileStore();
    const wallet = createCoresWallet();
    connectCoresWallet(store, wallet);
    return { store, wallet };
}

/** read the raw persisted profile straight from jsdom's localStorage. */
function rawProfile(): ProfileV1 {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)!) as ProfileV1;
}

beforeEach(() => {
    localStorage.clear();
});

describe("round-trip", () => {
    it("persists the cores balance across store instances", () => {
        const first = storeWithWallet();
        first.store.load();
        creditCores(first.store, first.wallet, 7);

        const second = storeWithWallet();
        second.store.load();
        expect(second.wallet.cores).toBe(7);
    });

    it("round-trips a registered workshop section through the generic seam", () => {
        // stand-in for the workshop state module plugging into `nodes` at merge time
        const purchased: string[] = [];
        const store = new ProfileStore();
        store.register(
            "nodes",
            () => [...purchased],
            (value) => purchased.splice(0, purchased.length, ...value)
        );
        store.load();
        purchased.push("aegis", "magnet-2");
        store.save();

        const reloaded: string[] = [];
        const store2 = new ProfileStore();
        store2.register(
            "nodes",
            () => [...reloaded],
            (value) => reloaded.splice(0, reloaded.length, ...value)
        );
        store2.load();
        expect(reloaded).toEqual(["aegis", "magnet-2"]);
    });

    it("saves on every mutation without an explicit save call", () => {
        const { store, wallet } = storeWithWallet();
        store.load();
        creditCores(store, wallet, 3);
        expect(rawProfile().cores).toBe(3);
        expect(spendCores(store, wallet, 2)).toBe(true);
        expect(rawProfile().cores).toBe(1);
    });

    it("rejects an unaffordable or non-positive spend without saving", () => {
        const { store, wallet } = storeWithWallet();
        store.load();
        creditCores(store, wallet, 1);
        expect(spendCores(store, wallet, 5)).toBe(false);
        expect(spendCores(store, wallet, 0)).toBe(false);
        expect(wallet.cores).toBe(1);
        expect(rawProfile().cores).toBe(1);
    });

    it("hydrates a section registered after load instead of letting save wipe it", () => {
        localStorage.setItem(
            PROFILE_KEY,
            JSON.stringify({ v: PROFILE_VERSION, cores: 0, nodes: ["aegis", "magnet-2"] })
        );
        const store = new ProfileStore();
        store.load();
        // the workshop module wires in late — after load has already run
        const purchased: string[] = [];
        store.register(
            "nodes",
            () => [...purchased],
            (value) => purchased.splice(0, purchased.length, ...value)
        );
        expect(purchased).toEqual(["aegis", "magnet-2"]);
        store.save();
        expect(rawProfile().nodes).toEqual(["aegis", "magnet-2"]);
    });

    it("preserves an unregistered section across a save from another domain", () => {
        localStorage.setItem(
            PROFILE_KEY,
            JSON.stringify({ v: PROFILE_VERSION, cores: 0, nodes: ["aegis"] })
        );
        // only the cores wallet is wired — the workshop module is not merged yet
        const { store, wallet } = storeWithWallet();
        store.load();
        creditCores(store, wallet, 4);
        expect(rawProfile()).toEqual({ v: PROFILE_VERSION, cores: 4, nodes: ["aegis"] });
    });
});

describe("version fallback", () => {
    it("treats an unknown schema version as a fresh profile", () => {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ v: 2, cores: 99, nodes: ["x"] }));
        const { store, wallet } = storeWithWallet();
        expect(store.load()).toEqual(freshProfile());
        expect(wallet.cores).toBe(0);
    });

    it("starts fresh when no profile exists", () => {
        const { store, wallet } = storeWithWallet();
        expect(store.load()).toEqual(freshProfile());
        expect(wallet.cores).toBe(0);
    });
});

describe("corrupted-payload recovery", () => {
    it.each([
        ["not json", "{cores:"],
        ["wrong root type", JSON.stringify("profile")],
        ["null root", JSON.stringify(null)],
        ["missing fields", JSON.stringify({ v: 1 })],
        ["wrong cores type", JSON.stringify({ v: 1, cores: "many", nodes: [] })],
        ["negative cores", JSON.stringify({ v: 1, cores: -5, nodes: [] })],
        ["non-finite cores", JSON.stringify({ v: 1, cores: null, nodes: [] })],
        ["wrong nodes type", JSON.stringify({ v: 1, cores: 0, nodes: "aegis" })],
        ["non-string node", JSON.stringify({ v: 1, cores: 0, nodes: [7] })],
    ])("falls back to a fresh profile on %s", (_label, payload) => {
        localStorage.setItem(PROFILE_KEY, payload);
        const { store, wallet } = storeWithWallet();
        expect(store.load()).toEqual(freshProfile());
        expect(wallet.cores).toBe(0);
    });

    it("recovers by overwriting the corrupt blob on the next save", () => {
        localStorage.setItem(PROFILE_KEY, "garbage{{");
        const { store, wallet } = storeWithWallet();
        store.load();
        creditCores(store, wallet, 2);
        expect(rawProfile()).toEqual({ v: PROFILE_VERSION, cores: 2, nodes: [] });
    });
});

describe("no storage", () => {
    it("stays functional in-memory when storage is unavailable", () => {
        const store = new ProfileStore(null);
        const wallet = createCoresWallet();
        connectCoresWallet(store, wallet);
        expect(store.load()).toEqual(freshProfile());
        creditCores(store, wallet, 6);
        expect(wallet.cores).toBe(6);
        expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
    });
});
