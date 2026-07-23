import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CritEngine } from "./game/crit-engine";
import { AudioEngine } from "./game/audio";
import {
    createState,
    creditEssence,
    buy,
    canBuy,
    upgradeCost,
    expectedDamagePerAttack,
    critChance,
    critMulti,
    goldenChance,
    rankInfo,
    UPGRADES,
    type EconomyState,
    type RankInfo,
    type UpgradeId,
} from "./game/economy";
import { endStorm, markFirstSurge, type StormEndAccounting } from "./game/storm-end";
import { formatNumber } from "./game/format";
import { Collector, defaultCollectorRegion } from "./game/collector";
import { HEAT_DECAY_PER_SEC, Surge } from "./game/surge";
import { coreHeadroom } from "./game/surge-gauge";
import { BRUSHES, paintBrush, canPaint, type BrushId, type BrushDef } from "./game/brush";
import { StormEvents, createStormEventRng } from "./game/storm-events";
import { STRUCTURES, canPlaceStructure, placeMagnet, type StructureId } from "./game/structures";
import {
    AUTO_STRIKER_MAX_LEVEL,
    autoStrikerAim,
    autoStrikerInterval,
    autoStrikerStrikeHeat,
    autoStrikerUpgradeCost,
    canUpgradeAutoStriker,
    createAutoStrikerState,
    defaultAutoStrikerPosition,
    executeStrike,
    placeAutoStriker,
    tickAutoStriker,
    upgradeAutoStriker,
    type AutoStrikerState,
    type StrikeTarget,
} from "./game/auto-striker";
import {
    ambientCoeffWith,
    applyStormStart,
    buyNode,
    creditCores,
    collectorFeeWith,
    criticalTempWith,
    workshopEffects,
    type WorkshopEffects,
    type WorkshopState,
    type WorkshopTrackId,
} from "./game/workshop";
import { loadWorkshop, saveWorkshop } from "./game/workshop-storage";
import { WorkshopView } from "./workshop-view";

/** rolling window for the clicks-per-second readout */
const CPS_WINDOW = 2;

/** snapshot of economy and auto-striker values the HUD renders each frame. */
interface HudState {
    essence: number;
    dps: number;
    critChance: number;
    critMulti: number;
    goldenChance: number;
    rank: RankInfo;
    levels: Record<UpgradeId, number>;
    costs: Record<UpgradeId, number>;
    affordable: Record<UpgradeId, boolean>;
    autoStrikerLevel: number;
    autoStrikerInterval: number;
    autoStrikerCost: number;
    autoStrikerAffordable: boolean;
}

interface InitialGameState {
    economy: EconomyState;
    autoStriker: AutoStrikerState;
}

/** build the render snapshot from the mutable game-state refs. */
function snapshot(s: EconomyState, autoStriker: AutoStrikerState): HudState {
    const costs = {} as Record<UpgradeId, number>;
    const affordable = {} as Record<UpgradeId, boolean>;
    for (const u of UPGRADES) {
        costs[u.id] = upgradeCost(s, u.id);
        affordable[u.id] = canBuy(s, u.id);
    }
    const interval = autoStrikerInterval(autoStriker);
    return {
        essence: s.essence,
        dps: autoStriker.level > 0 ? expectedDamagePerAttack(s) / interval : 0,
        critChance: critChance(s),
        critMulti: critMulti(s),
        goldenChance: goldenChance(s),
        rank: rankInfo(s),
        levels: { ...s.levels },
        costs,
        affordable,
        autoStrikerLevel: autoStriker.level,
        autoStrikerInterval: interval,
        autoStrikerCost: autoStrikerUpgradeCost(autoStriker),
        autoStrikerAffordable: canUpgradeAutoStriker(s, autoStriker),
    };
}

/**
 * migrate the legacy ?lv=base,chance,multi,rate,golden cheat by mapping its removed
 * rate slot onto the auto-striker level while preserving the remaining upgrades,
 * then apply the workshop's storm-start grants (Forge levels, Vault essence) on top.
 */
function createInitialState(effects: WorkshopEffects): InitialGameState {
    const economy = createState();
    let autoStriker = createAutoStrikerState();
    const lv = new URLSearchParams(window.location.search).get("lv");
    if (lv) {
        const [base = 0, chance = 0, multi = 0, legacyRate = 0, golden = 0] = lv
            .split(",")
            .map(Number);
        economy.levels = {
            baseDamage: base,
            critChance: chance,
            critMulti: multi,
            golden,
        };
        autoStriker = createAutoStrikerState(legacyRate);
    }
    applyStormStart(economy, effects);
    return { economy, autoStriker };
}

/** props for one storm run; a fresh mount consumes a fresh workshop-effects snapshot. */
interface StormViewProps {
    /** the aggregate workshop effects this storm opens with (design §5). */
    effects: WorkshopEffects;
    /** fired when the player banks out of the storm, with its core accounting. */
    onStormEnd(accounting: StormEndAccounting): void;
}

function StormView({ effects, onStormEnd }: StormViewProps) {
    const [initialState] = useState(() => createInitialState(effects));
    const hostRef = useRef<HTMLDivElement>(null);
    const stateRef = useRef<EconomyState>(initialState.economy);
    const autoStrikerRef = useRef<AutoStrikerState>(initialState.autoStriker);
    const engineRef = useRef<CritEngine | null>(null);
    const audioRef = useRef<AudioEngine>(new AudioEngine());
    const clickTimesRef = useRef<number[]>([]);
    // the surge state machine replaces frenzy (design §3): it owns the heat meter,
    // the swelling pot, and the exit seam. lives in a ref so its state survives
    // re-renders; the HUD mirrors it through `heat` + `surgeHud` each frame.
    const surgeRef = useRef(
        new Surge(
            {
                // the overheat bust (design §3, hkm.4): the machine ends itself when the
                // core crosses critical (hkm.2), so the lava payload hangs off the exit
                // seam, covering every machine-initiated exit. BANK stays at its own call
                // site (bankSurge) because only the player triggers it.
                onEnd: (reason, pot) => {
                    if (reason === "bust") engineRef.current?.bust(pot);
                },
            },
            // aegis wiring (design §5): the workshop raises the core's critical temp
            // and dampens the ambient ramp, so deep rides become survivable.
            {
                criticalTemp: criticalTempWith(effects),
                ambientCoeff: ambientCoeffWith(effects),
            }
        )
    );
    const stormEventsRef = useRef<StormEvents | null>(null);
    const [hud, setHud] = useState<HudState>(() =>
        snapshot(stateRef.current, autoStrikerRef.current)
    );
    const [muted, setMuted] = useState(false);
    const [cps, setCps] = useState(0);
    const [heat, setHeat] = useState(0);
    const [surgeHud, setSurgeHud] = useState({
        active: false,
        potValue: 0,
        multiplier: 1,
        crits: 0,
        coreTemp: 0,
        criticalTemp: surgeRef.current.criticalTemp,
        // bumped every time the pot captures a strike, so the readout replays its
        // land animation — proof each strike went SOMEWHERE (the pot), not nowhere.
        captureSeq: 0,
        // true for a beat right after a surge ignites, to fire the unmissable
        // "SURGE" ignition flash (design pillar 4 — a real mode change, loudly).
        igniting: false,
    });
    const [pulsing, setPulsing] = useState<Partial<Record<UpgradeId, boolean>>>({});
    // the selected defense brush (design §4.2). null = attack mode: clicking the
    // stage fires a manual strike. when a brush is picked the stage becomes a
    // paint surface instead, and pointer drags paint that material for essence.
    const [selectedBrush, setSelectedBrush] = useState<BrushId | null>(null);
    // structures use the same purchase flow as brushes but place once on click;
    // they are never painted as a drag stroke.
    const [selectedStructure, setSelectedStructure] = useState<StructureId | null>(null);
    const paintingRef = useRef(false);
    // surge-HUD edge trackers (design §3 legibility): the pot readout replays its
    // land animation only when the pot actually grows, and the ignition flash fires
    // only on the idle→surging edge — both read from the 10Hz frame loop.
    const prevPotRef = useRef(0);
    const prevSurgingRef = useRef(false);
    const captureSeqRef = useRef(0);
    const igniteUntilRef = useRef(0);

    /**
     * run manual and turret attacks through one heat, roll, capture, and eruption
     * path. `target` is the aim point in grid cells; `heat` defaults to the manual
     * per-click fill and turret fires pass their cadence-scaled heat instead.
     */
    const runStrike = (target?: StrikeTarget, heat?: number): void => {
        executeStrike(
            stateRef.current,
            surgeRef.current,
            Math.random,
            {
                onSurgeStart: () => {
                    markFirstSurge(stateRef.current);
                    audioRef.current.frenzy();
                },
                onStrike: (result, captured, strikeTarget) => {
                    engineRef.current?.spawn(result.damage, result.tier, result.golden);
                    if (!captured) {
                        // forge wiring (design §5): eruption-value nodes fatten the
                        // gold a strike erupts into the world, at the source seam.
                        engineRef.current?.erupt(
                            result.damage * effects.eruptionValueMultiplier,
                            result.tier,
                            strikeTarget
                        );
                    }
                    audioRef.current.attack(Math.max(result.tier, 1));
                    if (result.golden) audioRef.current.golden();
                },
            },
            target,
            heat
        );
    };

    useEffect(() => {
        let engine: CritEngine | null = null;
        let raf = 0;
        let last = performance.now();
        let hudTimer = 0;
        let cancelled = false;

        CritEngine.create(hostRef.current!).then((e) => {
            if (cancelled) {
                e.destroy();
                return;
            }
            engine = e;
            engineRef.current = e;
            // legacy ?lv dev-cheat migration: levels granted without a placement
            // click get the historical fixed spot beside the strike zone.
            const striker = autoStrikerRef.current;
            if (striker.level > 0 && !striker.position) {
                striker.position = defaultAutoStrikerPosition(
                    e.storm.strikeZone,
                    e.simulation.W,
                    e.simulation.H
                );
            }
            e.setAutoStrikerPlacement(striker.position);
            // storm events replace the old falling-777 bonus with deterministic
            // in-world pressure (design §4.4). its rng is isolated from combat rolls
            // so the same storm duration always schedules the same world events.
            stormEventsRef.current = new StormEvents(e.storm, createStormEventRng(0x5700_7001));
            // the drain: solid gold settling in this band becomes essence at
            // (1 - fee). essence now flows ONLY through here (applyAttack no longer
            // credits it), so an attack pays out only once its gold reaches home.
            // vault wiring (design §5): the workshop drives the skim fee down from
            // its 30% base, so more of each arriving gold cell mints as essence.
            const collector = new Collector(
                defaultCollectorRegion(e.storm),
                collectorFeeWith(effects)
            );
            // show the drain on screen (design pillar 4): the marker grate marks the
            // catchment so gold reaching it reads as banked, not silently vanished.
            e.setDrainRegion(collector.region);
            const frame = (now: number) => {
                const dt = Math.min((now - last) / 1000, 0.1);
                last = now;
                const s = stateRef.current;
                const surge = surgeRef.current;
                s.elapsed += dt;
                tickAutoStriker(autoStrikerRef.current, dt, () => {
                    engine!.pulseAutoStriker();
                    // aim + heat are game-code decisions: an area-uniform strike-zone
                    // point (seedable rng seam) and the cadence-scaled heat fill.
                    runStrike(
                        autoStrikerAim(engine!.storm.strikeZone, Math.random),
                        autoStrikerStrikeHeat(autoStrikerRef.current)
                    );
                });
                const drained = collector.collect(e.simulation);
                creditEssence(s, drained);
                // pulse the drain grate the frame it converts gold, so essence income
                // visibly originates FROM the drain rather than appearing on the HUD.
                if (drained > 0) engine!.pulseDrain();
                // heat drains only pre-surge; during a surge the machine ignores it.
                surge.decayHeat(HEAT_DECAY_PER_SEC * dt);
                // drive the surge core-heat model (design §3, hkm.2): the ambient ramp
                // climbs with surge time and the per-crit spikes land inside
                // recordStrike above; when the core crosses critical temp the machine
                // busts itself through its own exit seam (a no-op while idle). the bust
                // spectacle — lava eruption — is hkm.4.
                surge.tickHeat(dt);
                // the surge now ends on the player's terms: BANK (spacebar or the HUD
                // button) erupts the pot as one gold mega-mountain (design §3, hkm.3).
                // the overheat bust is the other exit (hkm.4, not yet wired).
                engine!.renderSurge(surge.active ? surge.pot : null);
                // drive the staged physical-tell ladder (design §3): the world near the
                // core reacts in a fixed order as the core heats toward critical, so the
                // ride reads. consumes coreLoad only; 0 while idle clears the tells.
                engine!.applyTells(surge.active ? surge.coreLoad : 0);
                stormEventsRef.current?.tick(s.elapsed);
                hudTimer += dt;
                if (hudTimer >= 0.1) {
                    hudTimer = 0;
                    const cutoff = performance.now() - CPS_WINDOW * 1000;
                    clickTimesRef.current = clickTimesRef.current.filter((t) => t > cutoff);
                    setCps(clickTimesRef.current.length / CPS_WINDOW);
                    setHeat(surge.heat);
                    const pot = surge.pot;
                    // ignition edge: the frame heat crosses the threshold and the
                    // surge goes live — latch a short window for the loud flash.
                    if (surge.active && !prevSurgingRef.current) {
                        igniteUntilRef.current = now + 1200;
                    }
                    prevSurgingRef.current = surge.active;
                    // capture edge: bump the sequence whenever the pot grew, so the
                    // readout replays its land animation for every strike absorbed.
                    if (pot.value > prevPotRef.current) captureSeqRef.current += 1;
                    prevPotRef.current = pot.value;
                    setSurgeHud({
                        active: surge.active,
                        potValue: pot.value,
                        multiplier: pot.multiplier,
                        crits: pot.crits,
                        coreTemp: surge.coreTemp,
                        criticalTemp: surge.criticalTemp,
                        captureSeq: captureSeqRef.current,
                        igniting: surge.active && now < igniteUntilRef.current,
                    });
                    setHud(snapshot(s, autoStrikerRef.current));
                }
                raf = requestAnimationFrame(frame);
            };
            raf = requestAnimationFrame(frame);
        });

        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
            stormEventsRef.current = null;
            engine?.destroy();
            engineRef.current = null;
        };
    }, []);

    /**
     * paint the active brush at a screen position (design §4.2). maps host-local
     * px to a grid cell over the stretched sim sprite, then charges essence per
     * cell painted via {@link paintBrush} — which skips gold/molten-gold/wall so
     * value is never destroyed. no-op when the stroke paints nothing (unaffordable
     * or every target cell protected). refreshes the HUD so essence updates live.
     */
    const paintAt = (clientX: number, clientY: number): void => {
        const brushId = selectedBrush;
        const engine = engineRef.current;
        const rect = hostRef.current?.getBoundingClientRect();
        if (!brushId || !engine || !rect || rect.width === 0 || rect.height === 0) return;
        const brush = BRUSHES.find((b) => b.id === brushId);
        if (!brush) return;
        const sim = engine.simulation;
        const gx = Math.floor(((clientX - rect.left) / rect.width) * sim.W);
        const gy = Math.floor(((clientY - rect.top) / rect.height) * sim.H);
        const painted = paintBrush(sim, stateRef.current, brush, gx, gy);
        if (painted > 0) setHud(snapshot(stateRef.current, autoStrikerRef.current));
    };

    /** place the selected one-click structure at a screen position. */
    const placeStructureAt = (clientX: number, clientY: number): void => {
        const structureId = selectedStructure;
        const engine = engineRef.current;
        const rect = hostRef.current?.getBoundingClientRect();
        if (!structureId || !engine || !rect || rect.width === 0 || rect.height === 0) return;
        const sim = engine.simulation;
        const gx = Math.floor(((clientX - rect.left) / rect.width) * sim.W);
        const gy = Math.floor(((clientY - rect.top) / rect.height) * sim.H);
        if (structureId === "magnet" && placeMagnet(sim, stateRef.current, gx, gy)) {
            audioRef.current.buy();
            setHud(snapshot(stateRef.current, autoStrikerRef.current));
        }
        if (
            structureId === "auto-striker" &&
            placeAutoStriker(sim, stateRef.current, autoStrikerRef.current, gx, gy)
        ) {
            engine.setAutoStrikerPlacement(autoStrikerRef.current.position);
            engine.celebrate();
            audioRef.current.buy();
            // the turret is singular: leave placement mode once it stands.
            setSelectedStructure(null);
            setHud(snapshot(stateRef.current, autoStrikerRef.current));
        }
    };

    const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        audioRef.current.unlock();
        if (selectedStructure) {
            placeStructureAt(e.clientX, e.clientY);
            return;
        }
        if (selectedBrush) {
            paintingRef.current = true;
            audioRef.current.buy();
            paintAt(e.clientX, e.clientY);
            return;
        }
        manualAttack(e);
    };

    const onStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!selectedBrush || !paintingRef.current) return;
        paintAt(e.clientX, e.clientY);
    };

    const stopPainting = () => {
        paintingRef.current = false;
    };

    const manualAttack = (e: ReactPointerEvent<HTMLDivElement>) => {
        audioRef.current.unlock();
        clickTimesRef.current.push(performance.now());
        // aim the eruption at the click position, mapped to grid cells — the
        // coordinate space every strike target uses (see StrikeTarget).
        const rect = hostRef.current?.getBoundingClientRect();
        const sim = engineRef.current?.simulation;
        const target =
            rect && sim && rect.width > 0 && rect.height > 0
                ? {
                      x: ((e.clientX - rect.left) / rect.width) * sim.W,
                      y: ((e.clientY - rect.top) / rect.height) * sim.H,
                  }
                : undefined;
        runStrike(target);
    };

    /**
     * BANK the surge (design §3): end the surge via the exit seam with reason
     * `bank` and erupt the whole pot at once as a single gold mega-mountain at the
     * current multiplier. the banked gold is physical — it must still cool, settle,
     * and be collected, it does not convert straight to essence. a no-op when no
     * surge is live. wired to both the spacebar and the HUD BANK button.
     */
    const bankSurge = () => {
        const surge = surgeRef.current;
        if (!surge.active) return;
        audioRef.current.unlock();
        const pot = surge.endSurge("bank");
        if (pot.value > 0) {
            engineRef.current?.eruptBank(pot.value);
            audioRef.current.bank(pot.value);
        }
    };

    /**
     * bank OUT of the whole storm (design §5): the voluntary storm exit that
     * converts this storm's collected essence into permanent cores at ×1.5. any
     * live surge is closed through its bank seam first (the run is over, so its
     * pot is not erupted — there is nobody left to collect it), then the storm's
     * accounting is handed to the meta layer, which routes back to the workshop.
     */
    const bankOut = () => {
        audioRef.current.unlock();
        const surge = surgeRef.current;
        if (surge.active) surge.endSurge("bank");
        onStormEnd(endStorm(stateRef.current, "bank-out"));
    };

    // spacebar banks a live surge (design §3). preventDefault stops the space from
    // scrolling or re-triggering a focused button; the guard inside bankSurge makes
    // it harmless pre-surge. refs keep the handler stable across renders.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.code !== "Space") return;
            e.preventDefault();
            bankSurge();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const buyUpgrade = (id: UpgradeId) => {
        audioRef.current.unlock();
        if (!buy(stateRef.current, id)) return;
        setHud(snapshot(stateRef.current, autoStrikerRef.current));
        engineRef.current?.celebrate();
        audioRef.current.buy();
        setPulsing((p) => ({ ...p, [id]: true }));
        setTimeout(() => setPulsing((p) => ({ ...p, [id]: false })), 350);
    };

    /** shorten the placed turret's strike interval by one level (placement buys it). */
    const buyAutoStrikerUpgrade = (): void => {
        audioRef.current.unlock();
        if (autoStrikerRef.current.level === 0) return;
        if (!upgradeAutoStriker(stateRef.current, autoStrikerRef.current)) return;
        engineRef.current?.celebrate();
        audioRef.current.buy();
        setHud(snapshot(stateRef.current, autoStrikerRef.current));
    };

    const toggleMute = () => {
        audioRef.current.unlock();
        audioRef.current.muted = !audioRef.current.muted;
        setMuted(audioRef.current.muted);
    };

    /** pick a defense brush, or deselect it (back to attack mode) if re-clicked. */
    const toggleBrush = (id: BrushId) => {
        audioRef.current.unlock();
        setSelectedStructure(null);
        setSelectedBrush((cur) => (cur === id ? null : id));
    };

    /** pick a one-click structure, or deselect it to return to attack mode. */
    const toggleStructure = (id: StructureId) => {
        audioRef.current.unlock();
        setSelectedBrush(null);
        setSelectedStructure((cur) => (cur === id ? null : id));
    };

    const surging = surgeHud.active;
    // core-temp headroom for the gauge (design §3): the two ticks + "one more crit"
    // readout come straight from the pure helper, no HUD-side math.
    const headroom = coreHeadroom(surgeHud.coreTemp, surgeHud.criticalTemp);
    // a brush is "buyable" while at least one cell of it is affordable — the same
    // essence gate paintBrush enforces per cell (design §4.2).
    const affordBrush = (b: BrushDef): boolean => canPaint(stateRef.current, b);

    return (
        <div className="layout">
            <div
                ref={hostRef}
                className={[
                    "stage",
                    surging ? "frenzy" : "",
                    surgeHud.igniting ? "igniting" : "",
                    selectedBrush || selectedStructure ? "painting" : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
                onPointerDown={onStagePointerDown}
                onPointerMove={onStagePointerMove}
                onPointerUp={stopPainting}
                onPointerLeave={stopPainting}
            />
            <aside className="hud">
                <div className="title-row">
                    <h1>critstorm</h1>
                    <button className="mute" onClick={toggleMute}>
                        {muted ? "unmute" : "mute"}
                    </button>
                </div>
                <div className="payout">
                    <span className="payout-value">{formatNumber(hud.essence)}</span>
                    <span className="payout-label">essence</span>
                </div>
                <div className="dps">
                    <span className="stat-val">{formatNumber(hud.dps)}</span>
                    <span className="stat-key">turret dps expected</span>
                </div>
                <div className="statgrid">
                    <div className="chip">
                        <span className="chip-k">crit</span>
                        <span className="chip-v">{(hud.critChance * 100).toFixed(1)}%</span>
                    </div>
                    <div className="chip">
                        <span className="chip-k">mult</span>
                        <span className="chip-v">×{hud.critMulti.toFixed(1)}</span>
                    </div>
                    {hud.goldenChance > 0 && (
                        <div className="chip gold">
                            <span className="chip-k">gold</span>
                            <span className="chip-v">✦{(hud.goldenChance * 100).toFixed(1)}%</span>
                        </div>
                    )}
                </div>
                {surging ? (
                    <div className={surgeHud.igniting ? "surge-panel igniting" : "surge-panel"}>
                        <div className="surge-banner">
                            <span className="surge-word">SURGE</span>
                            <span className="surge-mult">×{surgeHud.multiplier.toFixed(2)}</span>
                            <span className="surge-feed">strikes feed the pot</span>
                        </div>
                        <div className="pot-window">
                            <span className="pot-value" key={surgeHud.captureSeq}>
                                {formatNumber(surgeHud.potValue)}
                            </span>
                            <span className="pot-label">
                                pot · {surgeHud.crits} crit{surgeHud.crits === 1 ? "" : "s"}
                            </span>
                        </div>
                        <div className="core-gauge">
                            <div className="core-gauge-label">
                                <span>core temp</span>
                                <span
                                    className={headroom.medianFits ? "core-room" : "core-room hot"}
                                >
                                    {headroom.medianCritsLeft > 0
                                        ? `~${headroom.medianCritsLeft} more crit${
                                              headroom.medianCritsLeft === 1 ? "" : "s"
                                          }`
                                        : "one crit could bust"}
                                </span>
                            </div>
                            <div className="core-bar">
                                <div
                                    className="core-fill"
                                    style={{ transform: `scaleX(${headroom.load.toFixed(3)})` }}
                                />
                                <div
                                    className={
                                        headroom.medianFits
                                            ? "core-tick median"
                                            : "core-tick median passed"
                                    }
                                    style={{ left: `${(headroom.medianTick * 100).toFixed(1)}%` }}
                                    title="a typical crit still fits left of here"
                                />
                                <div
                                    className={
                                        headroom.maxFits ? "core-tick max" : "core-tick max passed"
                                    }
                                    style={{ left: `${(headroom.maxTick * 100).toFixed(1)}%` }}
                                    title="the hottest crit still fits left of here"
                                />
                            </div>
                            <div className="core-legend">
                                <span className={headroom.medianFits ? "" : "off"}>
                                    ◆ median crit {headroom.medianFits ? "fits" : "busts"}
                                </span>
                                <span className={headroom.maxFits ? "" : "off"}>
                                    ▲ max crit {headroom.maxFits ? "fits" : "busts"}
                                </span>
                            </div>
                        </div>
                        <button className="bank-btn wide" onClick={bankSurge}>
                            <span className="bank-word">BANK</span>
                            <span className="bank-take">{formatNumber(surgeHud.potValue)}</span>
                            <em>space</em>
                        </button>
                    </div>
                ) : (
                    <div className="heat">
                        <div className="heat-label">
                            <span>{cps.toFixed(1)} clicks/s</span>
                            <span className="heat-hint">click fast → surge</span>
                        </div>
                        <div className="heat-bar">
                            <div
                                className="heat-fill"
                                style={{ transform: `scaleX(${(heat / 100).toFixed(3)})` }}
                            />
                        </div>
                    </div>
                )}
                <div className="rank">
                    <div className="rank-label">
                        rank: <strong>{hud.rank.name}</strong>
                        {hud.rank.next && <span className="rank-next"> → {hud.rank.next}</span>}
                    </div>
                    <div className="rank-bar">
                        <div
                            className="rank-fill"
                            style={{ transform: `scaleX(${hud.rank.progress.toFixed(4)})` }}
                        />
                    </div>
                </div>
                <div className="upgrades">
                    {UPGRADES.map((u) => (
                        <button
                            key={u.id}
                            className={pulsing[u.id] ? "bought" : undefined}
                            disabled={!hud.affordable[u.id]}
                            onClick={() => buyUpgrade(u.id)}
                        >
                            <span className="upgrade-name">
                                {u.name} <em>lv{hud.levels[u.id]}</em>
                            </span>
                            <span className="upgrade-desc">{u.desc}</span>
                            <span className="upgrade-cost">{formatNumber(hud.costs[u.id])}</span>
                        </button>
                    ))}
                </div>
                <div className="brushes">
                    <div className="brushes-label">defense brushes</div>
                    {BRUSHES.map((b) => (
                        <button
                            key={b.id}
                            className={selectedBrush === b.id ? "brush selected" : "brush"}
                            disabled={selectedBrush !== b.id && !affordBrush(b)}
                            onClick={() => toggleBrush(b.id)}
                        >
                            <span className="upgrade-name">{b.name}</span>
                            <span className="upgrade-desc">{b.desc}</span>
                            <span className="upgrade-cost">{formatNumber(b.costPerCell)}/cell</span>
                        </button>
                    ))}
                </div>
                <div className="brushes">
                    <div className="brushes-label">routing structures</div>
                    {hud.autoStrikerLevel > 0 && (
                        <button
                            className="brush"
                            disabled={
                                hud.autoStrikerLevel >= AUTO_STRIKER_MAX_LEVEL ||
                                !hud.autoStrikerAffordable
                            }
                            onClick={buyAutoStrikerUpgrade}
                        >
                            <span className="upgrade-name">
                                Auto-Striker <em>lv{hud.autoStrikerLevel}</em>
                            </span>
                            <span className="upgrade-desc">
                                fires every {hud.autoStrikerInterval.toFixed(1)}s
                            </span>
                            <span className="upgrade-cost">
                                {hud.autoStrikerLevel >= AUTO_STRIKER_MAX_LEVEL
                                    ? "max"
                                    : formatNumber(hud.autoStrikerCost)}
                            </span>
                        </button>
                    )}
                    {STRUCTURES.filter(
                        (structure) => structure.id !== "auto-striker" || hud.autoStrikerLevel === 0
                    ).map((structure) => (
                        <button
                            key={structure.id}
                            className={
                                selectedStructure === structure.id ? "brush selected" : "brush"
                            }
                            disabled={
                                selectedStructure !== structure.id &&
                                !canPlaceStructure(stateRef.current, structure)
                            }
                            onClick={() => toggleStructure(structure.id)}
                        >
                            <span className="upgrade-name">{structure.name}</span>
                            <span className="upgrade-desc">{structure.desc}</span>
                            <span className="upgrade-cost">{formatNumber(structure.cost)}</span>
                        </button>
                    ))}
                </div>
                <p className="hint">
                    {selectedStructure
                        ? "click clear air to place · click the structure again to attack"
                        : selectedBrush
                          ? "drag on the storm to paint · click the brush again to attack"
                          : "click anywhere to attack manually · catch falling 7 7 7"}
                </p>
                <button className="bank-out" onClick={bankOut}>
                    <span className="bank-out-word">BANK OUT</span>
                    <span className="bank-out-hint">end storm · ×1.5 cores</span>
                </button>
            </aside>
        </div>
    );
}

/**
 * root router (design §5): the game alternates between a storm run and the
 * full-screen between-storms workshop. the workshop owns the permanent meta
 * state (cores + purchased nodes, persisted to localStorage); each storm mounts
 * a fresh {@link StormView} keyed by run number so its refs and sim state reset,
 * consuming a snapshot of the workshop's aggregate effects.
 */
export function App() {
    const [workshop, setWorkshop] = useState<WorkshopState>(loadWorkshop);
    const [mode, setMode] = useState<"workshop" | "storm">("workshop");
    const [lastStorm, setLastStorm] = useState<StormEndAccounting | null>(null);
    const [stormSeq, setStormSeq] = useState(0);

    /** buy the next node on a track, persisting on success. */
    const buyTrackNode = (track: WorkshopTrackId): void => {
        setWorkshop((prev) => {
            const next: WorkshopState = { cores: prev.cores, purchased: { ...prev.purchased } };
            if (!buyNode(next, track)) return prev;
            saveWorkshop(next);
            return next;
        });
    };

    /** credit a finished storm's cores and return to the workshop. */
    const handleStormEnd = (accounting: StormEndAccounting): void => {
        setWorkshop((prev) => {
            const next: WorkshopState = { cores: prev.cores, purchased: { ...prev.purchased } };
            creditCores(next, accounting.cores);
            saveWorkshop(next);
            return next;
        });
        setLastStorm(accounting);
        setMode("workshop");
    };

    /** start the next storm run with the current workshop effects. */
    const enterStorm = (): void => {
        setStormSeq((n) => n + 1);
        setMode("storm");
    };

    if (mode === "workshop") {
        return (
            <WorkshopView
                workshop={workshop}
                lastStorm={lastStorm}
                onBuyNode={buyTrackNode}
                onEnterStorm={enterStorm}
            />
        );
    }
    return (
        <StormView key={stormSeq} effects={workshopEffects(workshop)} onStormEnd={handleStormEnd} />
    );
}
