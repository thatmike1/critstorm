import { describe, expect, it } from "vitest";
import { loadJournal, rememberStorm, saveJournal, recordTitle, type StormRecord } from "./storm-journal";

const record: StormRecord = { id: "one", seed: 42, front: "eye", reason: "victory", cores: 3, collected: 2000, bestBank: 1e10, duration: 60, bellsWon: 1 };

describe("remembered storms", () => {
    it("round-trips a bounded journal independently of the old workshop save", () => {
        let raw = "";
        const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
        let records: StormRecord[] = [];
        for (let i = 0; i < 12; i++) records = rememberStorm(records, { ...record, id: String(i) });
        saveJournal(records, storage);
        expect(loadJournal(storage)).toEqual(records);
        expect(records).toHaveLength(8);
        expect(rememberStorm(records, records[0])).toHaveLength(8);
        expect(recordTitle(record)).toBe("OWNER OF THE SKY");
    });
    it("ignores corrupt records and inaccessible storage without erasing valid history", () => {
        expect(loadJournal({ getItem: () => "bad json" })).toEqual([]);
        expect(loadJournal({ getItem: () => JSON.stringify({ v: 1, records: [{ ...record, seed: -1 }, record] }) })).toEqual([record]);
        expect(loadJournal({ getItem: () => { throw Error("denied"); } })).toEqual([]);
        expect(() => saveJournal([record], { setItem: () => { throw Error("denied"); } })).not.toThrow();
    });
});
