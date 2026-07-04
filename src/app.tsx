import { useEffect, useRef, useState } from "react";
import { CritEngine } from "./game/crit-engine";
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
    UPGRADES,
    type EconomyState,
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
        levels: { ...s.levels },
        costs,
        affordable,
    };
}

/** dev cheat: ?lv=chance,multi,rate jumps straight to a late-game state for spectacle testing */
function createInitialState(): EconomyState {
    const s = createState();
    const lv = new URLSearchParams(window.location.search).get("lv");
    if (lv) {
        const [chance = 0, multi = 0, rate = 0] = lv.split(",").map(Number);
        s.levels = { critChance: chance, critMulti: multi, attackRate: rate };
    }
    return s;
}

export function App() {
    const hostRef = useRef<HTMLDivElement>(null);
    const stateRef = useRef<EconomyState>(createInitialState());
    const engineRef = useRef<CritEngine | null>(null);
    const [hud, setHud] = useState<HudState>(() => snapshot(stateRef.current));

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
                for (const r of results) engine!.spawn(r.damage, r.tier);
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
        const r = rollAttack(stateRef.current, Math.random);
        applyAttack(stateRef.current, r);
        engineRef.current?.spawn(r.damage, r.tier);
    };

    const buyUpgrade = (id: UpgradeId) => {
        buy(stateRef.current, id);
        setHud(snapshot(stateRef.current));
    };

    return (
        <div className="layout">
            <div ref={hostRef} className="stage" onPointerDown={manualAttack} />
            <aside className="hud">
                <h1>critstorm</h1>
                <div className="stat-big">{formatNumber(hud.essence)} essence</div>
                <div className="stat">{formatNumber(hud.dps)} dps expected</div>
                <div className="stat">
                    {(hud.critChance * 100).toFixed(1)}% crit · ×{hud.critMulti.toFixed(1)} ·{" "}
                    {hud.attacksPerSec.toFixed(2)}/s
                </div>
                <div className="upgrades">
                    {UPGRADES.map((u) => (
                        <button
                            key={u.id}
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
