import { useState } from "react";
import { FRONTS } from "./game/fronts";
import { formatNumber } from "./game/format";
import { recordTitle, type StormRecord } from "./game/storm-journal";

/** build a link to the same sky; workshop unlocks and the next player's actions still apply. */
export function stormLink(record: Pick<StormRecord, "seed" | "front">): string {
    const link = new URL(window.location.href);
    link.search = ""; link.hash = "";
    link.searchParams.set("seed", String(record.seed)); link.searchParams.set("sky", record.front);
    return link.href;
}

/** offer a copyable keepsake without sending anything to an external service. */
export function ShareStorm({ record }: { record: StormRecord }) {
    const [copied, setCopied] = useState(false);
    const copy = async (): Promise<void> => {
        try { await navigator.clipboard.writeText(stormLink(record)); setCopied(true); }
        catch { setCopied(false); }
    };
    return <button className="share-storm" onClick={() => { void copy(); }}>
        {copied ? "SKY LINK COPIED" : `COPY THIS SKY · SEED ${record.seed}`}
    </button>;
}

/** remember the largest fortunes and the newest eight endings between storms. */
export function StormJournal({ records, onReplay }: { records: readonly StormRecord[]; onReplay(record: StormRecord): void }) {
    if (records.length === 0) return <div className="journal-intro">YOUR STORM JOURNAL IS EMPTY.<span>Every ending leaves a receipt. Your first fortune is waiting.</span></div>;
    const biggest = Math.max(...records.map(record => record.bestBank));
    return <section className="storm-journal" aria-labelledby="journal-title">
        <div className="journal-head"><h2 id="journal-title">STORMS WORTH REMEMBERING</h2><span>best bank in your last eight · {formatNumber(biggest)}</span></div>
        <p>Same terrain and weather. Your current workshop. A new decision.</p>
        <div className="journal-records">{records.map(record => <article className={`storm-record ${record.reason}`} key={record.id}>
            <strong>{recordTitle(record)}</strong>
            <span>{FRONTS[record.front].name} · {Math.floor(record.duration / 60)}:{String(Math.floor(record.duration % 60)).padStart(2, "0")}</span>
            <div className="record-take">{formatNumber(record.bestBank)}<small>BEST BANK</small></div>
            <span>{formatNumber(record.collected)} collected → {formatNumber(record.cores)} cores</span>
            {record.bellsWon > 0 && <span className="bell-stamp">BELL PAID ×{record.bellsWon}</span>}
            <button className="replay-storm" onClick={() => onReplay(record)}>RIDE THIS SKY AGAIN</button>
            <ShareStorm record={record} />
        </article>)}</div>
    </section>;
}
