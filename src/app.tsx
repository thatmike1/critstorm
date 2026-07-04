import { useEffect, useRef, useState } from "react";
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
    rankInfo,
    UPGRADES,
    type EconomyState,
    type RankInfo,
    type UpgradeId,
} from "./game/economy";
import { formatNumber } from "./game/format";

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

/** dev cheat: ?lv=base,chance,multi,rate,golden jumps to a late-game state for spectacle testing */
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

export function App() {
    const hostRef = useRef<HTMLDivElement>(null);
    const stateRef = useRef<EconomyState>(createInitialState());
    const engineRef = useRef<CritEngine | null>(null);
    const audioRef = useRef<AudioEngine>(new AudioEngine());
    const [hud, setHud] = useState<HudState>(() => snapshot(stateRef.current));
    const [muted, setMuted] = useState(false);
    const [pulsing, setPulsing] = useState<Partial<Record<UpgradeId, boolean>>>({});

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
            const frame = (now: number) => {
                const dt = Math.min((now - last) / 1000, 0.1);
                last = now;
                const results = tick(stateRef.current, dt, Math.random);
                for (const r of results) {
                    engine!.spawn(r.damage, r.tier, r.golden);
                    audioRef.current.attack(r.tier);
                    if (r.golden) audioRef.current.golden();
                }
                hudTimer += dt;
                if (hudTimer >= 0.1) {
                    hudTimer = 0;
                    setHud(snapshot(stateRef.current));
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

    const manualAttack = () => {
        audioRef.current.unlock();
        const r = rollAttack(stateRef.current, Math.random);
        applyAttack(stateRef.current, r);
        engineRef.current?.spawn(r.damage, r.tier, r.golden);
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

    return (
        <div className="layout">
            <div ref={hostRef} className="stage" onPointerDown={manualAttack} />
            <aside className="hud">
                <div className="title-row">
                    <h1>critstorm</h1>
                    <button className="mute" onClick={toggleMute}>
                        {muted ? "unmute" : "mute"}
                    </button>
                </div>
                <div className="stat-big">{formatNumber(hud.essence)} essence</div>
                <div className="stat">{formatNumber(hud.dps)} dps expected</div>
                <div className="stat">
                    {(hud.critChance * 100).toFixed(1)}% crit · ×{hud.critMulti.toFixed(1)} ·{" "}
                    {hud.attacksPerSec.toFixed(2)}/s
                    {hud.goldenChance > 0 && ` · ✦${(hud.goldenChance * 100).toFixed(1)}%`}
                </div>
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
                <p className="hint">click anywhere to attack manually</p>
            </aside>
        </div>
    );
}
