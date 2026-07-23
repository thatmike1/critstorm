import { formatNumber } from "./game/format";
import type { StormSummary } from "./game/storm-lifecycle";

// the end-of-storm results screen (design §5): the moment that teaches "quitting
// while ahead is smart". a BANK OUT celebrates the ×1.5 core bonus in gold; a BLOW
// UP shows the same conversion without the bonus in red, with the bonus you missed
// called out — the lesson is the delta, not a scolding. the NEXT STORM button hands
// control back to the host, which tears the dead world down and builds a fresh one.

/** format a storm duration in seconds as `m:ss` for the results readout. */
function formatDuration(sec: number): string {
    const whole = Math.max(0, Math.floor(sec));
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface ResultsScreenProps {
    /** the finished storm's accounting + stats. */
    summary: StormSummary;
    /** start the next storm: the host resets world, economy, and surge machine. */
    onNextStorm: () => void;
}

/** the pixel-native storm results screen: how it ended, what it paid, what's next. */
export function ResultsScreen({ summary, onNextStorm }: ResultsScreenProps) {
    const banked = summary.reason === "bank-out";
    const flooredCores = summary.rawCores === 0 && summary.cores > 0;
    return (
        <div className="results">
            <div className={banked ? "results-panel" : "results-panel bust"}>
                <h1 className={banked ? "results-title" : "results-title bust"}>
                    {banked ? "BANKED OUT" : "BLOWN UP"}
                </h1>
                <p className="results-lesson">
                    {banked
                        ? "you quit while ahead — the storm pays a ×1.5 core bonus for it."
                        : "the storm ate your unbanked gold. banking out keeps a ×1.5 core bonus."}
                </p>
                <div className="results-cores">
                    <span className="results-cores-value">{formatNumber(summary.cores)}</span>
                    <span className="results-cores-label">
                        storm core{summary.cores === 1 ? "" : "s"}
                    </span>
                    <span className="results-cores-detail">
                        {flooredCores
                            ? "first-surge minimum — every surge pays something"
                            : banked
                              ? `${formatNumber(summary.rawCores)} × 1.5 bank-out bonus`
                              : `${formatNumber(summary.rawCores)} × 1 — no bank-out bonus`}
                    </span>
                </div>
                <div className="results-grid">
                    <div className="results-row">
                        <span className="results-key">essence collected</span>
                        <span className="results-val">{formatNumber(summary.bankedEssence)}</span>
                    </div>
                    <div className="results-row">
                        <span className="results-key">gold lost to hazards</span>
                        <span className="results-val loss">{formatNumber(summary.goldLost)}</span>
                    </div>
                    <div className="results-row">
                        <span className="results-key">surges ridden</span>
                        <span className="results-val">{summary.surgeCount}</span>
                    </div>
                    <div className="results-row">
                        <span className="results-key">storm duration</span>
                        <span className="results-val">{formatDuration(summary.durationSec)}</span>
                    </div>
                </div>
                <button className="next-storm-btn" onClick={onNextStorm}>
                    NEXT STORM
                </button>
            </div>
        </div>
    );
}
