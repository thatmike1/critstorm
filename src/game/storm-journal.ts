import type { StormEndReason } from "./storm-end";
import type { FrontId } from "./fronts";

export interface StormRecord {
    id: string;
    seed: number;
    front: FrontId;
    reason: StormEndReason;
    cores: number;
    collected: number;
    bestBank: number;
    duration: number;
    bellsWon: number;
}
export const JOURNAL_LIMIT = 8;
const KEY = "critstorm-journal";

/** validate a completed storm without trusting saved JSON or unlimited history lengths. */
function validRecord(value: unknown): value is StormRecord {
    if (typeof value !== "object" || !value) return false;
    const record = value as Record<string, unknown>;
    return typeof record.id === "string" && record.id.length <= 100 &&
        ["flats", "bog", "eye"].includes(String(record.front)) &&
        ["bank-out", "blow-up", "victory"].includes(String(record.reason)) &&
        ["seed", "cores", "collected", "bestBank", "duration", "bellsWon"].every(key =>
            typeof record[key] === "number" && Number.isFinite(record[key]) && Number(record[key]) >= 0) &&
        typeof record.seed === "number" && Number.isInteger(record.seed) && record.seed <= 0xffff_ffff;
}

/** load bounded completed storm history separately from the compatible v1 workshop profile. */
export function loadJournal(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): StormRecord[] {
    try {
        const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? "null");
        if (typeof raw !== "object" || !raw) return [];
        const journal = raw as Record<string, unknown>;
        return journal.v === 1 && Array.isArray(journal.records) ? journal.records.filter(validRecord).slice(0, JOURNAL_LIMIT) : [];
    } catch { return []; }
}

/** append a storm exactly once and keep the newest eight. */
export function rememberStorm(records: readonly StormRecord[], record: StormRecord): StormRecord[] {
    return [record, ...records.filter(old => old.id !== record.id)].slice(0, JOURNAL_LIMIT);
}

/** persist the small journal without letting unavailable storage interrupt results. */
export function saveJournal(records: readonly StormRecord[], storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): void {
    try { storage?.setItem(KEY, JSON.stringify({ v: 1, records: records.slice(0, JOURNAL_LIMIT) })); } catch { /* storage may be unavailable */ }
}

/** give a run a keepsake title based on a real ending or earned wager. */
export function recordTitle(record: StormRecord): string {
    return record.reason === "victory" ? "OWNER OF THE SKY" : record.bellsWon > 0 ? "THE BELLRINGER" :
        record.reason === "blow-up" ? "A FORTUNE IN ASHES" : "QUIT WHILE AHEAD";
}
