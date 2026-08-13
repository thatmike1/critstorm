import { formatNumber } from "./game/format";
import {
    availableFronts,
    FRONTS,
    type FrontDef,
    type FrontId,
} from "./game/fronts";
import type { StormEndAccounting } from "./game/storm-end";
import {
    canBuyNode,
    nodeCost,
    WORKSHOP_TRACKS,
    workshopEffects,
    type WorkshopState,
    type WorkshopTrackDef,
    type WorkshopTrackId,
} from "./game/workshop";

/** props for the between-storms workshop screen. */
export interface WorkshopViewProps {
    /** the persistent meta state: core wallet + purchased nodes. */
    workshop: WorkshopState;
    /** accounting of the storm that just ended, for the yield banner; null on a fresh session. */
    lastStorm: StormEndAccounting | null;
    /** buy the next node on a track ladder. */
    onBuyNode(track: WorkshopTrackId): void;
    /** choose the front for the next storm session. */
    selectedFront: FrontId;
    /** update the session-only front selection. */
    onSelectFront(front: FrontId): void;
    /** leave the workshop and start the next storm. */
    onEnterStorm(): void;
}

/** the implemented front choices shown by the between-storm picker. */
export interface FrontPickerOption {
    readonly front: FrontDef;
    readonly locked: boolean;
    readonly selected: boolean;
}

/** build the picker model without requiring a browser or React renderer. */
export function frontPickerOptions(
    unlockedFronts: number,
    selectedFront: FrontId
): readonly FrontPickerOption[] {
    const unlocked = new Set(availableFronts(unlockedFronts).map((front) => front.id));
    return Object.values(FRONTS)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((front) => ({
            front,
            locked: !unlocked.has(front.id),
            selected: front.id === selectedFront,
        }));
}

/** how many locked nodes past the next one each ladder previews. */
const LOCKED_PREVIEW = 2;

/** one track column: purchased nodes lit, the next node buyable, a short locked preview. */
function TrackColumn({
    track,
    workshop,
    onBuyNode,
}: {
    track: WorkshopTrackDef;
    workshop: WorkshopState;
    onBuyNode(track: WorkshopTrackId): void;
}) {
    const owned = workshop.purchased[track.id];
    const nextIndex = owned;
    const previewEnd = Math.min(nextIndex + 1 + LOCKED_PREVIEW, track.nodes.length);
    const complete = owned >= track.nodes.length;
    return (
        <section className={`track track-${track.id}`}>
            <header className="track-head">
                <h2>{track.name}</h2>
                <span className="track-desc">{track.desc}</span>
                <span className="track-count">
                    {owned}/{track.nodes.length}
                </span>
            </header>
            <div className="track-nodes">
                {track.nodes.slice(0, owned).map((node, i) => (
                    <div key={node.name} className="node owned">
                        <span className="node-pip">◆</span>
                        <span className="node-name">{node.name}</span>
                        <span className="node-desc">{node.desc}</span>
                        <span className="node-cost">{formatNumber(nodeCost(track, i))}</span>
                    </div>
                ))}
                {!complete && (
                    <button
                        className="node next"
                        disabled={!canBuyNode(workshop, track.id)}
                        onClick={() => onBuyNode(track.id)}
                    >
                        <span className="node-pip">◇</span>
                        <span className="node-name">{track.nodes[nextIndex].name}</span>
                        <span className="node-desc">{track.nodes[nextIndex].desc}</span>
                        <span className="node-cost">
                            {formatNumber(nodeCost(track, nextIndex))} ⬢
                        </span>
                    </button>
                )}
                {track.nodes.slice(nextIndex + 1, previewEnd).map((node, i) => (
                    <div key={node.name} className="node locked">
                        <span className="node-pip">·</span>
                        <span className="node-name">{node.name}</span>
                        <span className="node-desc">{node.desc}</span>
                        <span className="node-cost">
                            {formatNumber(nodeCost(track, nextIndex + 1 + i))}
                        </span>
                    </div>
                ))}
                {complete && <div className="track-complete">track complete</div>}
            </div>
        </section>
    );
}

/**
 * the between-storms workshop (design §5): a full-screen core-spending hub in the
 * casino cabinet skin — never an in-storm overlay. shows the last storm's core
 * yield, the wallet, the four track ladders, and the one exit: back into a storm.
 */
export function WorkshopView({
    workshop,
    lastStorm,
    onBuyNode,
    selectedFront,
    onSelectFront,
    onEnterStorm,
}: WorkshopViewProps) {
    const frontOptions = frontPickerOptions(
        workshopEffects(workshop).unlockedFronts,
        selectedFront
    );
    return (
        <div className="workshop">
            <header className="workshop-head">
                <h1>the workshop</h1>
                <span className="workshop-sub">between storms · spend storm cores</span>
            </header>
            {lastStorm && (
                <div className="storm-yield">
                    <span className="yield-reason">
                        {lastStorm.reason === "bank-out" ? "BANKED OUT ×1.5" : "BLOWN UP"}
                    </span>
                    <span className="yield-detail">
                        {formatNumber(lastStorm.bankedEssence)} essence collected →{" "}
                        {formatNumber(lastStorm.cores)} cores
                    </span>
                </div>
            )}
            <div className="core-wallet">
                <span className="wallet-value">⬢ {formatNumber(workshop.cores)}</span>
                <span className="wallet-label">storm cores</span>
            </div>
            <section className="front-picker" aria-labelledby="front-picker-title">
                <div className="front-picker-head">
                    <div>
                        <h2 id="front-picker-title">storm front</h2>
                        <p>choose the arena for your next storm · Flats is always available</p>
                    </div>
                    <span className="front-picker-current">
                        current: {frontOptions.find((option) => option.selected)?.front.name ??
                            "The Flats"}
                    </span>
                </div>
                <div className="front-options" role="group" aria-label="storm front choices">
                    {frontOptions.map((option) => (
                        <button
                            key={option.front.id}
                            type="button"
                            className={`front-option${option.selected ? " selected" : ""}${
                                option.locked ? " locked" : ""
                            }`}
                            aria-pressed={option.selected}
                            aria-label={`${option.front.name}${option.locked ? ", locked" : ""}`}
                            disabled={option.locked}
                            onClick={() => onSelectFront(option.front.id)}
                        >
                            <span className="front-option-name">{option.front.name}</span>
                            <span className="front-option-detail">
                                {option.locked
                                    ? "locked · buy the Front node"
                                    : option.selected
                                      ? "current"
                                      : "available"}
                            </span>
                        </button>
                    ))}
                </div>
            </section>
            <div className="tracks">
                {WORKSHOP_TRACKS.map((track) => (
                    <TrackColumn
                        key={track.id}
                        track={track}
                        workshop={workshop}
                        onBuyNode={onBuyNode}
                    />
                ))}
            </div>
            <button className="enter-storm" onClick={onEnterStorm}>
                <span className="enter-word">ENTER THE STORM</span>
                <span className="enter-hint">your workshop upgrades ride with you</span>
            </button>
        </div>
    );
}
