import { Application, Container, Text, TextStyle } from "pixi.js";
import { formatNumber } from "./format";

/** color ramp by crit tier: white trickle -> golden blizzard -> apocalyptic */
const TIER_COLORS = [
    "#9a9ab0",
    "#e8e8f0",
    "#ffd75e",
    "#ffab2e",
    "#ff6b2e",
    "#ff2e5e",
    "#c92eff",
    "#4ec9ff",
    "#ffffff",
];

interface FloatingCrit {
    text: Text;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    tier: number;
    baseScale: number;
}

const POOL_SIZE = 600;

/**
 * renders the crit-number blizzard on a full-window pixi stage;
 * pure presentation — knows nothing about the economy
 */
export class CritEngine {
    private app: Application;
    private stage: Container;
    private pool: Text[] = [];
    private active: FloatingCrit[] = [];
    private shakeTime = 0;
    private shakeStrength = 0;

    private constructor(app: Application) {
        this.app = app;
        this.stage = new Container();
        app.stage.addChild(this.stage);
        for (let i = 0; i < POOL_SIZE; i++) {
            const t = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "monospace", fontWeight: "bold" }),
            });
            t.visible = false;
            t.anchor.set(0.5);
            this.stage.addChild(t);
            this.pool.push(t);
        }
        app.ticker.add((ticker) => this.update(ticker.deltaMS));
    }

    static async create(host: HTMLElement): Promise<CritEngine> {
        const app = new Application();
        await app.init({ background: "#0a0a12", resizeTo: host, antialias: true });
        host.appendChild(app.canvas);
        return new CritEngine(app);
    }

    spawn(damage: number, tier: number): void {
        let text = this.pool.pop();
        if (!text) {
            // pool exhausted: recycle the oldest active crit
            const oldest = this.active.shift();
            if (!oldest) return;
            text = oldest.text;
        }
        const w = this.app.screen.width;
        const h = this.app.screen.height;
        const fontSize = 13 + tier * 9 + Math.min(Math.log10(damage + 1) * 2, 24);
        text.style.fontSize = fontSize;
        text.style.fill = TIER_COLORS[Math.min(tier, TIER_COLORS.length - 1)];
        text.style.stroke = { color: "#1a0a00", width: tier >= 2 ? Math.min(tier, 4) : 0 };
        text.text = formatNumber(damage);
        text.position.set(w * 0.1 + Math.random() * w * 0.8, h * 0.55 + Math.random() * h * 0.35);
        text.alpha = 1;
        text.rotation = (Math.random() - 0.5) * 0.15 * tier;
        text.visible = true;
        const baseScale = tier >= 2 ? 0.2 : 1;
        text.scale.set(baseScale);
        this.active.push({
            text,
            vx: (Math.random() - 0.5) * (20 + tier * 15),
            vy: -(60 + tier * 40 + Math.random() * 40),
            life: 0,
            maxLife: 900 + tier * 350,
            tier,
            baseScale,
        });
        if (tier >= 4) this.shake(Math.min(2 + (tier - 4) * 3, 14));
    }

    private shake(strength: number): void {
        this.shakeTime = 250;
        this.shakeStrength = Math.max(this.shakeStrength, strength);
    }

    private update(dtMs: number): void {
        const dt = dtMs / 1000;
        for (let i = this.active.length - 1; i >= 0; i--) {
            const c = this.active[i];
            c.life += dtMs;
            const p = c.life / c.maxLife;
            c.text.x += c.vx * dt;
            c.text.y += c.vy * dt;
            c.vy += 25 * dt;
            // pop-in overshoot for real crits, then settle
            if (c.tier >= 2) {
                const pop = Math.min(c.life / 120, 1);
                const overshoot = 1 + 0.4 * Math.sin(pop * Math.PI);
                c.text.scale.set(c.baseScale + (1 - c.baseScale) * pop * overshoot + c.tier * 0.08);
            }
            c.text.alpha = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
            if (p >= 1) {
                c.text.visible = false;
                this.pool.push(c.text);
                this.active.splice(i, 1);
            }
        }
        if (this.shakeTime > 0) {
            this.shakeTime -= dtMs;
            const s = this.shakeStrength * (this.shakeTime / 250);
            this.stage.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
            if (this.shakeTime <= 0) {
                this.shakeStrength = 0;
                this.stage.position.set(0, 0);
            }
        }
    }

    destroy(): void {
        this.app.destroy(true, { children: true });
    }
}
