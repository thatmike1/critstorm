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

/** clicking heat: each manual click adds this much (0-100 scale) */
const HEAT_PER_CLICK = 7;

/** heat decay per second — stop clicking and the meter drains (pre-surge only) */
const HEAT_DECAY = 16;

/** how long the placeholder surge rides before its exit seam fires (design §3 —
 * the real BANK/overheat exits live in hkm.3/hkm.4; this keeps the machine loopable). */
const SURGE_PLACEHOLDER_SECONDS = 8;

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
    const surgeRef = useRef(new Surge());
    const surgeTimerRef = useRef(0);
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
            const frame = (now: number) => {
                const dt = Math.min((now - last) / 1000, 0.1);
                last = now;
                const s = stateRef.current;
                const surge = surgeRef.current;
                const results = tick(s, dt, Math.random);
                s.essence += collector.collect(e.simulation);
                for (const r of results) {
                    // erupt this hit's gold into the world; it falls, cools, and
                    // settles into the collector band, which mints the essence.
                    engine!.spawn(r.damage, r.tier, r.golden);
                    // auto-strikes have no cursor: erupt at a random strike-zone point.
                    engine!.erupt(r.damage, r.tier);
                    // inside a surge, every strike also folds into the pot (design §3).
                    surge.recordStrike(r, baseDamage(s));
                    audioRef.current.attack(r.tier);
                    if (r.golden) audioRef.current.golden();
                }
                // heat drains only pre-surge; during a surge the machine ignores it.
                surge.decayHeat(HEAT_DECAY * dt);
                // placeholder exit seam (design §3): the real BANK/overheat exits are
                // hkm.3/hkm.4. until then, ride a fixed time then BANK so the machine
                // loops and the pot glow does not hang on forever.
                if (surge.active) {
                    surgeTimerRef.current += dt;
                    if (surgeTimerRef.current >= SURGE_PLACEHOLDER_SECONDS) {
                        surge.endSurge("bank");
                        surgeTimerRef.current = 0;
                    }
                }
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
        // during a surge the click's strike also folds into the pot (design §3).
        surge.recordStrike(r, baseDamage(s));
        // a manual hit erupts gold too, so clicking feeds the collector like the
        // auto-loop does — essence flows only through the drain, never here. the
        // ballistic eruption arcs from the core to the click (target) and deposits
        // molten gold that falls, cools, and settles into the collector band.
        engineRef.current?.spawn(r.damage, r.tier, r.golden);
        engineRef.current?.erupt(r.damage, r.tier, target);
        audioRef.current.attack(Math.max(r.tier, 1));
        if (r.golden) audioRef.current.golden();
    };

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

    const surging = surgeHud.active;

    return (
        <div className="layout">
            <div
                ref={hostRef}
                className={surging ? "stage frenzy" : "stage"}
                onPointerDown={manualAttack}
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
                <p className="hint">click anywhere to attack manually · catch falling 7 7 7</p>
            </aside>
        </div>
    );
}
