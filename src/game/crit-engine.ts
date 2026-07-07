import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { formatNumber } from "./format";
import { Simulation } from "../sim/simulation";
import { SimLayer, paintDemoScene } from "./sim-layer";

/** sim grid resolution (design §7: ~320×180, nearest-neighbor upscaled to fill). */
const SIM_W = 320;
const SIM_H = 180;

/** color ramp by crit tier: dim old-gold trickle -> gold -> fire -> neon jackpot */
const TIER_COLORS = [
    "#8a7a52",
    "#f5ead0",
    "#ffd75e",
    "#ffb02e",
    "#ff6b2e",
    "#ff2e46",
    "#ff3bd0",
    "#00e5ff",
    "#ffffff",
];

const GOLDEN_COLOR = "#ffe066";

/** heavy payout-counter face for the erupting numbers */
const CRIT_FONT = "'Arial Black', 'Franklin Gothic Bold', Impact, sans-serif";

interface FloatingCrit {
    text: Text;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    tier: number;
    baseScale: number;
    spin: number;
}

interface FallingBonus {
    text: Text;
    vy: number;
    swayPhase: number;
    elapsed: number;
}

const POOL_SIZE = 600;

/**
 * renders the crit-number blizzard on a full-window pixi stage;
 * pure presentation — knows nothing about the economy
 */
export class CritEngine {
    private app: Application;
    private sim: Simulation;
    private simLayer: SimLayer;
    private stage: Container;
    private flash: Graphics;
    private flashAlpha = 0;
    private pool: Text[] = [];
    private active: FloatingCrit[] = [];
    private bonuses: FallingBonus[] = [];
    private shakeTime = 0;
    private shakeStrength = 0;

    private constructor(app: Application) {
        this.app = app;

        // BOTTOM LAYER: the falling-sand sim, added first so every crit number,
        // effect, and flash draws on top of it (design §7). It lives on app.stage
        // (not this.stage) so screen shake never jitters the world underneath.
        this.sim = new Simulation(SIM_W, SIM_H);
        // DEMO BOOTSTRAP — temporary scene, replaced by world bootstrap (b4r.3).
        paintDemoScene(this.sim);
        this.simLayer = new SimLayer(this.sim);
        this.simLayer.resize(app.screen.width, app.screen.height);
        app.stage.addChild(this.simLayer.sprite);

        this.stage = new Container();
        app.stage.addChild(this.stage);
        this.flash = new Graphics();
        this.flash.visible = false;
        app.stage.addChild(this.flash);
        for (let i = 0; i < POOL_SIZE; i++) {
            const t = new Text({
                text: "",
                style: new TextStyle({ fontFamily: CRIT_FONT, fontWeight: "bold" }),
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
        await app.init({ background: "#080605", resizeTo: host, antialias: true });
        host.appendChild(app.canvas);
        return new CritEngine(app);
    }

    spawn(damage: number, tier: number, golden = false): void {
        const w = this.app.screen.width;
        const h = this.app.screen.height;
        const fontSize =
            13 + tier * 9 + Math.min(Math.log10(damage + 1) * 2, 24) + (golden ? 10 : 0);
        const label = golden ? `✦ ${formatNumber(damage)} ✦` : formatNumber(damage);
        const fill = golden ? GOLDEN_COLOR : TIER_COLORS[Math.min(tier, TIER_COLORS.length - 1)];
        const strokeWidth = golden ? 4 : tier >= 2 ? Math.min(tier, 4) : 0;
        const x = w * 0.1 + Math.random() * w * 0.8;
        const y = h * 0.55 + Math.random() * h * 0.35;
        this.spawnText(label, {
            x,
            y,
            fontSize,
            fill,
            strokeWidth,
            tier,
            baseScale: tier >= 2 || golden ? 0.2 : 1,
            vx: (Math.random() - 0.5) * (20 + tier * 15),
            vy: -(60 + tier * 40 + Math.random() * 40) * (golden ? 0.5 : 1),
            maxLife: (900 + tier * 350) * (golden ? 1.6 : 1),
            spin: golden ? (Math.random() - 0.5) * 0.8 : 0,
            rotation: (Math.random() - 0.5) * 0.15 * tier,
        });
        if (tier >= 4) this.shake(Math.min(2 + (tier - 4) * 3, 14));
        if (tier >= 6 || golden)
            this.flashScreen(golden ? 0xffe066 : 0xff2e5e, golden ? 0.12 : 0.2);
    }

    /**
     * drop a clickable jackpot token that falls through the play area;
     * onCatch fires if the player clicks it before it leaves the screen
     */
    spawnBonus(onCatch: () => void): void {
        const w = this.app.screen.width;
        const token = new Text({
            text: "7 7 7",
            style: new TextStyle({
                fontFamily: CRIT_FONT,
                fontWeight: "bold",
                fontSize: 34,
                fill: GOLDEN_COLOR,
                stroke: { color: "#1a0a00", width: 5 },
            }),
        });
        token.anchor.set(0.5);
        token.position.set(w * 0.15 + Math.random() * w * 0.7, -40);
        token.eventMode = "static";
        token.cursor = "pointer";
        const bonus: FallingBonus = {
            text: token,
            vy: 55 + Math.random() * 25,
            swayPhase: Math.random() * Math.PI * 2,
            elapsed: 0,
        };
        token.on("pointerdown", () => {
            this.removeBonus(bonus);
            this.flashScreen(0xffe066, 0.25);
            this.shake(8);
            onCatch();
        });
        this.stage.addChild(token);
        this.bonuses.push(bonus);
    }

    private removeBonus(bonus: FallingBonus): void {
        const idx = this.bonuses.indexOf(bonus);
        if (idx === -1) return;
        this.bonuses.splice(idx, 1);
        bonus.text.destroy();
    }

    /** celebratory burst when an upgrade is bought: plus-signs erupt near the HUD edge */
    celebrate(): void {
        const w = this.app.screen.width;
        const h = this.app.screen.height;
        for (let i = 0; i < 10; i++) {
            this.spawnText("+", {
                x: w - 30 - Math.random() * 60,
                y: h * 0.2 + Math.random() * h * 0.5,
                fontSize: 16 + Math.random() * 14,
                fill: GOLDEN_COLOR,
                strokeWidth: 0,
                tier: 0,
                baseScale: 1,
                vx: -(40 + Math.random() * 120),
                vy: -(30 + Math.random() * 90),
                maxLife: 600 + Math.random() * 300,
                spin: (Math.random() - 0.5) * 2,
                rotation: 0,
            });
        }
        this.flashScreen(0xffe066, 0.06);
    }

    private spawnText(
        label: string,
        opts: {
            x: number;
            y: number;
            fontSize: number;
            fill: string;
            strokeWidth: number;
            tier: number;
            baseScale: number;
            vx: number;
            vy: number;
            maxLife: number;
            spin: number;
            rotation: number;
        }
    ): void {
        let text = this.pool.pop();
        if (!text) {
            // pool exhausted: recycle the oldest active crit
            const oldest = this.active.shift();
            if (!oldest) return;
            text = oldest.text;
        }
        text.style.fontSize = opts.fontSize;
        text.style.fill = opts.fill;
        text.style.stroke = { color: "#1a0a00", width: opts.strokeWidth };
        text.text = label;
        text.position.set(opts.x, opts.y);
        text.alpha = 1;
        text.rotation = opts.rotation;
        text.visible = true;
        text.scale.set(opts.baseScale);
        this.active.push({
            text,
            vx: opts.vx,
            vy: opts.vy,
            life: 0,
            maxLife: opts.maxLife,
            tier: opts.tier,
            baseScale: opts.baseScale,
            spin: opts.spin,
        });
    }

    private flashScreen(color: number, alpha: number): void {
        this.flash.clear();
        this.flash.rect(0, 0, this.app.screen.width, this.app.screen.height).fill(color);
        this.flashAlpha = Math.max(this.flashAlpha, alpha);
        this.flash.alpha = this.flashAlpha;
        this.flash.visible = true;
    }

    private shake(strength: number): void {
        this.shakeTime = 250;
        this.shakeStrength = Math.max(this.shakeStrength, strength);
    }

    private update(dtMs: number): void {
        const dt = dtMs / 1000;
        // advance + re-upload the sim before the overlay so the world sits behind
        // this frame's crit numbers; keep it stretched to the (possibly resized) stage.
        this.simLayer.update();
        this.simLayer.resize(this.app.screen.width, this.app.screen.height);
        for (let i = this.active.length - 1; i >= 0; i--) {
            const c = this.active[i];
            c.life += dtMs;
            const p = c.life / c.maxLife;
            c.text.x += c.vx * dt;
            c.text.y += c.vy * dt;
            c.vy += 25 * dt;
            c.text.rotation += c.spin * dt;
            // pop-in overshoot for real crits, then settle
            if (c.baseScale < 1) {
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
        for (let i = this.bonuses.length - 1; i >= 0; i--) {
            const b = this.bonuses[i];
            b.elapsed += dt;
            b.text.y += b.vy * dt;
            b.text.x += Math.sin(b.elapsed * 2 + b.swayPhase) * 30 * dt;
            b.text.rotation = Math.sin(b.elapsed * 3 + b.swayPhase) * 0.2;
            // gentle pulse so it reads as "click me"
            b.text.scale.set(1 + Math.sin(b.elapsed * 5) * 0.12);
            if (b.text.y > this.app.screen.height + 50) this.removeBonus(b);
        }
        if (this.flashAlpha > 0) {
            this.flashAlpha = Math.max(0, this.flashAlpha - dt * 0.8);
            this.flash.alpha = this.flashAlpha;
            if (this.flashAlpha === 0) this.flash.visible = false;
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
        // app.destroy(children) tears down the sprite but leaves textures alone;
        // release the sim's reused texture + buffer source explicitly.
        this.simLayer.destroy();
    }
}
