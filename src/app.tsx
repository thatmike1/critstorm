import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CritEngine } from "./game/crit-engine";
import { AudioEngine } from "./game/audio";
import {
    createState,
    tick,
    buy,
    canBuy,
    upgradeCost,
    rollAttack,
    applyAttack,
    expectedDps,
    critChance,
    critMulti,
    attacksPerSec,
    goldenChance,
    baseDamage,
    rankInfo,
    UPGRADES,
    type EconomyState,
    type RankInfo,
    type UpgradeId,
} from "./game/economy";
import { formatNumber } from "./game/format";
import { Collector, defaultCollectorRegion } from "./game/collector";
import { Surge } from "./game/surge";
import { BRUSHES, paintBrush, canPaint, type BrushId, type BrushDef } from "./game/brush";

/** clicking heat: each manual click adds this much (0-100 scale) */
const HEAT_PER_CLICK = 7;

/** heat decay per second — stop clicking and the meter drains (pre-surge only) */
const HEAT_DECAY = 16;

/** rolling window for the clicks-per-second readout */
const CPS_WINDOW = 2;

/** jackpot token cadence: next drop lands uniformly in this range (seconds) */
const BONUS_MIN_GAP = 30;
const BONUS_MAX_GAP = 90;

/** snapshot of economy values the HUD renders each frame */
interface HudState {
    essence: number;
    dps: number;
    critChance: number;
    critMulti: number;
    attacksPerSec: number;
    goldenChance: number;
    rank: RankInfo;
    levels: Record<UpgradeId, number>;
    costs: Record<UpgradeId, number>;
    affordable: Record<UpgradeId, boolean>;
}

function snapshot(s: EconomyState): HudState {
    const costs = {} as Record<UpgradeId, number>;
    const affordable = {} as Record<UpgradeId, boolean>;
    for (const u of UPGRADES) {
        costs[u.id] = upgradeCost(s, u.id);
        affordable[u.id] = canBuy(s, u.id);
    }
    return {
        essence: s.essence,
        dps: expectedDps(s),
        critChance: critChance(s),
        critMulti: critMulti(s),
        attacksPerSec: attacksPerSec(s),
        goldenChance: goldenChance(s),
        rank: rankInfo(s),
        levels: { ...s.levels },
        costs,
        affordable,
    };
}

/**
 * dev cheats: ?lv=base,chance,multi,rate,golden jumps to a late-game state,
 * ?bonusin=SECONDS forces the first jackpot token drop
 */
function createInitialState(): EconomyState {
    const s = createState();
    const lv = new URLSearchParams(window.location.search).get("lv");
    if (lv) {
        const [base = 0, chance = 0, multi = 0, rate = 0, golden = 0] = lv.split(",").map(Number);
        s.levels = {
            baseDamage: base,
            critChance: chance,
            critMulti: multi,
            attackRate: rate,
            golden,
        };
    }
    return s;
}

function firstBonusDelay(): number {
    const forced = new URLSearchParams(window.location.search).get("bonusin");
    if (forced) return Number(forced);
    return BONUS_MIN_GAP + Math.random() * (BONUS_MAX_GAP - BONUS_MIN_GAP);
}

export function App() {
    const hostRef = useRef<HTMLDivElement>(null);
    const stateRef = useRef<EconomyState>(createInitialState());
    const engineRef = useRef<CritEngine | null>(null);
    const audioRef = useRef<AudioEngine>(new AudioEngine());
    const clickTimesRef = useRef<number[]>([]);
    // the surge state machine replaces frenzy (design §3): it owns the heat meter,
    // the swelling pot, and the exit seam. lives in a ref so its state survives
    // re-renders; the HUD mirrors it through `heat` + `surgeHud` each frame.
    const surgeRef = useRef(
        new Surge({
            // the overheat bust (design §3, hkm.4): the machine ends itself when the
            // core crosses critical (hkm.2), so the lava payload hangs off the exit
            // seam, covering every machine-initiated exit. BANK stays at its own call
            // site (bankSurge) because only the player triggers it.
            onEnd: (reason, pot) => {
                if (reason === "bust") engineRef.current?.bust(pot);
            },
        })
    );
    const nextBonusRef = useRef(firstBonusDelay());
    const [hud, setHud] = useState<HudState>(() => snapshot(stateRef.current));
    const [muted, setMuted] = useState(false);
    const [cps, setCps] = useState(0);
    const [heat, setHeat] = useState(0);
    const [surgeHud, setSurgeHud] = useState({
        active: false,
        potValue: 0,
        multiplier: 1,
        crits: 0,
    });
    const [pulsing, setPulsing] = useState<Partial<Record<UpgradeId, boolean>>>({});
    // the selected defense brush (design §4.2). null = attack mode: clicking the
    // stage fires a manual strike. when a brush is picked the stage becomes a
    // paint surface instead, and pointer drags paint that material for essence.
    const [selectedBrush, setSelectedBrush] = useState<BrushId | null>(null);
    const paintingRef = useRef(false);

    useEffect(() => {
        let engine: CritEngine | null = null;
        let raf = 0;
        let last = performance.now();
        let hudTimer = 0;
        let cancelled = false;

        const catchBonus = () => {
            const s = stateRef.current;
            audioRef.current.jackpot();
            const payout = Math.max(expectedDps(s) * 30, 100);
            // the jackpot is a direct instant grant (design §4.3 bonus), so it
            // does NOT erupt collectable gold — erupting it would double-credit
            // once the collector drained that gold back into essence.
            s.essence += payout;
            s.totalDamage += payout;
            engine?.spawn(payout, 5, true);
        };

        const scheduleBonus = (elapsed: number) => {
            nextBonusRef.current =
                elapsed + BONUS_MIN_GAP + Math.random() * (BONUS_MAX_GAP - BONUS_MIN_GAP);
        };

        CritEngine.create(hostRef.current!).then((e) => {
            if (cancelled) {
                e.destroy();
                return;
            }
            engine = e;
            engineRef.current = e;
            // the drain: solid gold settling in this band becomes essence at
            // (1 - fee). essence now flows ONLY through here (applyAttack no longer
            // credits it), so an attack pays out only once its gold reaches home.
            const collector = new Collector(defaultCollectorRegion(e.storm));
            // show the drain on screen (design pillar 4): the marker grate marks the
            // catchment so gold reaching it reads as banked, not silently vanished.
            e.setDrainRegion(collector.region);
            const frame = (now: number) => {
                const dt = Math.min((now - last) / 1000, 0.1);
                last = now;
                const s = stateRef.current;
                const surge = surgeRef.current;
                const results = tick(s, dt, Math.random);
                const drained = collector.collect(e.simulation);
                s.essence += drained;
                // pulse the drain grate the frame it converts gold, so essence income
                // visibly originates FROM the drain rather than appearing on the HUD.
                if (drained > 0) engine!.pulseDrain();
                for (const r of results) {
                    engine!.spawn(r.damage, r.tier, r.golden);
                    // inside a surge, every strike folds into the pot (design §3).
                    // de-dup (hkm.3): a captured strike must NOT also erupt as
                    // collectable world gold — that would double-credit (pot + world).
                    // the return value, not surge.active, decides: a crit that busts
                    // the surge deactivates it mid-call yet was still captured (and
                    // burned with the pot), so it must not leak out (critstorm-cjs).
                    // outside a surge it erupts normally (auto-strikes have no cursor,
                    // so they land at a random strike-zone point) and feeds the drain.
                    const captured = surge.recordStrike(r, baseDamage(s));
                    if (!captured) engine!.erupt(r.damage, r.tier);
                    audioRef.current.attack(r.tier);
                    if (r.golden) audioRef.current.golden();
                }
                // heat drains only pre-surge; during a surge the machine ignores it.
                surge.decayHeat(HEAT_DECAY * dt);
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
                if (s.elapsed >= nextBonusRef.current) {
                    engine!.spawnBonus(catchBonus);
                    scheduleBonus(s.elapsed);
                }
                hudTimer += dt;
                if (hudTimer >= 0.1) {
                    hudTimer = 0;
                    const cutoff = performance.now() - CPS_WINDOW * 1000;
                    clickTimesRef.current = clickTimesRef.current.filter((t) => t > cutoff);
                    setCps(clickTimesRef.current.length / CPS_WINDOW);
                    setHeat(surge.heat);
                    const pot = surge.pot;
                    setSurgeHud({
                        active: surge.active,
                        potValue: pot.value,
                        multiplier: pot.multiplier,
                        crits: pot.crits,
                    });
                    setHud(snapshot(s));
                }
                raf = requestAnimationFrame(frame);
            };
            raf = requestAnimationFrame(frame);
        });

        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
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
        if (painted > 0) setHud(snapshot(stateRef.current));
    };

    const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        audioRef.current.unlock();
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
        const s = stateRef.current;
        clickTimesRef.current.push(performance.now());
        // aim the eruption at the click position, in host-local (canvas) px.
        const rect = hostRef.current?.getBoundingClientRect();
        const target = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined;
        // a click fills the heat meter; when it tops out a surge ignites (design §3).
        const surge = surgeRef.current;
        if (surge.addHeat(HEAT_PER_CLICK)) audioRef.current.frenzy();
        const r = rollAttack(s, Math.random);
        applyAttack(s, r);
        // during a surge the click's strike folds into the pot (design §3).
        const captured = surge.recordStrike(r, baseDamage(s));
        engineRef.current?.spawn(r.damage, r.tier, r.golden);
        // outside a surge a manual hit erupts gold, so clicking feeds the collector
        // like the auto-loop does — essence flows only through the drain, never here.
        // the ballistic eruption arcs from the core to the click (target) and deposits
        // molten gold that falls, cools, and settles into the collector band. a strike
        // captured by the pot is instead paid out once on BANK, so erupting here too is
        // suppressed to avoid double-crediting (de-dup, hkm.3) — keyed on the capture
        // return, not surge.active, so the crit that busts the surge cannot leak out
        // as world gold on top of burning with the pot (critstorm-cjs).
        if (!captured) engineRef.current?.erupt(r.damage, r.tier, target);
        audioRef.current.attack(Math.max(r.tier, 1));
        if (r.golden) audioRef.current.golden();
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
            audioRef.current.jackpot();
        }
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
        setHud(snapshot(stateRef.current));
        engineRef.current?.celebrate();
        audioRef.current.buy();
        setPulsing((p) => ({ ...p, [id]: true }));
        setTimeout(() => setPulsing((p) => ({ ...p, [id]: false })), 350);
    };

    const toggleMute = () => {
        audioRef.current.unlock();
        audioRef.current.muted = !audioRef.current.muted;
        setMuted(audioRef.current.muted);
    };

    /** pick a defense brush, or deselect it (back to attack mode) if re-clicked. */
    const toggleBrush = (id: BrushId) => {
        audioRef.current.unlock();
        setSelectedBrush((cur) => (cur === id ? null : id));
    };

    const surging = surgeHud.active;
    // a brush is "buyable" while at least one cell of it is affordable — the same
    // essence gate paintBrush enforces per cell (design §4.2).
    const affordBrush = (b: BrushDef): boolean => canPaint(stateRef.current, b);

    return (
        <div className="layout">
            <div
                ref={hostRef}
                className={["stage", surging ? "frenzy" : "", selectedBrush ? "painting" : ""]
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
                    <span className="stat-key">dps expected</span>
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
                    <div className="chip">
                        <span className="chip-k">rate</span>
                        <span className="chip-v">{hud.attacksPerSec.toFixed(2)}/s</span>
                    </div>
                    {hud.goldenChance > 0 && (
                        <div className="chip gold">
                            <span className="chip-k">gold</span>
                            <span className="chip-v">✦{(hud.goldenChance * 100).toFixed(1)}%</span>
                        </div>
                    )}
                </div>
                {surging ? (
                    <div className="frenzy-banner">
                        <span className="frenzy-word">SURGE</span>
                        <span className="frenzy-x">×{surgeHud.multiplier.toFixed(2)}</span>
                        <span className="frenzy-time">pot {formatNumber(surgeHud.potValue)}</span>
                        <button className="bank-btn" onClick={bankSurge}>
                            BANK <em>space</em>
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
                <p className="hint">
                    {selectedBrush
                        ? "drag on the storm to paint · click the brush again to attack"
                        : "click anywhere to attack manually · catch falling 7 7 7"}
                </p>
            </aside>
        </div>
    );
}
