import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { formatNumber } from "./format";
import { createWorld, type World } from "./world";
import { SimLayer } from "./sim-layer";
import type { Simulation } from "../sim/simulation";
import { depositEruption } from "./eruption";

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

/**
 * a gold eruption in its FLIGHT phase. the sim has no velocity (design §7), so the
 * arc from the storm core to the impact cell is a pure Pixi projectile: position is
 * a straight lerp in screen space plus a parabolic lift, landing exactly on the
 * target at u=1. on landing the payload converts to MOLTEN_GOLD grid cells via the
 * value field. screen-space endpoints are captured at launch; `gx/gy` is the
 * resolved impact grid cell the payout deposits into.
 */
interface Eruption {
    gfx: Graphics;
    sx: number;
    sy: number;
    ex: number;
    ey: number;
    /** peak parabolic lift in screen px (how high the arc bows). */
    arc: number;
    /** elapsed flight time in ms. */
    t: number;
    /** total flight time in ms. */
    dur: number;
    /** impact grid cell (already clamped in-bounds and rounded). */
    gx: number;
    gy: number;
    payout: number;
    tier: number;
}

const POOL_SIZE = 600;

/** clamp `v` into the inclusive integer range [lo, hi]. */
function clampInt(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * renders the crit-number blizzard on a full-window pixi stage;
 * pure presentation — knows nothing about the economy
 */
export class CritEngine {
    private app: Application;
    private world: World;
    private simLayer: SimLayer;
    private stage: Container;
    private eruptLayer: Container;
    private flash: Graphics;
    private flashAlpha = 0;
    private pool: Text[] = [];
    private active: FloatingCrit[] = [];
    private bonuses: FallingBonus[] = [];
    private eruptions: Eruption[] = [];
    private shakeTime = 0;
    private shakeStrength = 0;

    private constructor(app: Application) {
        this.app = app;

        // BOTTOM LAYER: the bootstrapped storm world (terrain floor + storm core),
        // added first so every crit number, effect, and flash draws on top of it
        // (design §7). It lives on app.stage (not this.stage) so screen shake never
        // jitters the world underneath. the core + strike zone are held on `world`
        // for the eruption spawner (wave 3).
        this.world = createWorld();
        this.simLayer = new SimLayer(this.world.sim);
        this.simLayer.resize(app.screen.width, app.screen.height);
        app.stage.addChild(this.simLayer.sprite);

        // eruption projectiles ride above the world but below the crit numbers +
        // flash. it lives on app.stage (not this.stage) so screen shake never
        // jitters the arcs relative to the world they land in.
        this.eruptLayer = new Container();
        app.stage.addChild(this.eruptLayer);

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

    /** the storm world, exposed read-only so the collector can drain its sim (wave 3). */
    get storm(): World {
        return this.world;
    }

    /** the headless falling-sand simulation backing the storm world. */
    get simulation(): Simulation {
        return this.world.sim;
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
     * launch a gold eruption of `payout` toward `target` (screen px; the cursor for
     * a manual strike). the sim has no velocity (design §7), so flight is a Pixi
     * ballistic arc from the storm core to the impact cell, tier-widening the
     * landing spread; on impact the payload converts to MOLTEN_GOLD grid cells that
     * carry the payout through the value field (design §6 / §4.1). without a target
     * it aims at a uniform-random point in the strike zone (auto-striker fire).
     * `payout <= 0` is a no-op.
     */
    erupt(payout: number, tier: number, target?: { x: number; y: number }): void {
        if (!(payout > 0)) return;
        const { W, H } = this.world.sim;
        const sw = this.app.screen.width;
        const sh = this.app.screen.height;
        const zone = this.world.strikeZone;

        // resolve the aim point in grid coords: the cursor if given, else a
        // uniform-random point inside the strike disc (sqrt keeps it area-uniform).
        let gx: number;
        let gy: number;
        if (target) {
            gx = (target.x / sw) * W;
            gy = (target.y / sh) * H;
        } else {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * zone.radius;
            gx = zone.x + Math.cos(a) * r;
            gy = zone.y + Math.sin(a) * r;
        }
        // tier-scaled spread: higher tiers spray gold wider around the aim point.
        const spread = 1 + tier * 1.5;
        gx += (Math.random() - 0.5) * 2 * spread;
        gy += (Math.random() - 0.5) * 2 * spread;
        const gxi = clampInt(Math.round(gx), 0, W - 1);
        const gyi = clampInt(Math.round(gy), 0, H - 1);

        // screen-space flight endpoints (grid -> stretched sprite scale).
        const sx = (this.world.core.x / W) * sw;
        const sy = (this.world.core.y / H) * sh;
        const ex = (gxi / W) * sw;
        const ey = (gyi / H) * sh;
        const dist = Math.hypot(ex - sx, ey - sy);

        const gfx = new Graphics();
        const color = TIER_COLORS[Math.min(tier, TIER_COLORS.length - 1)];
        gfx.circle(0, 0, 3 + Math.min(tier, 6)).fill(color);
        gfx.position.set(sx, sy);
        this.eruptLayer.addChild(gfx);
        this.eruptions.push({
            gfx,
            sx,
            sy,
            ex,
            ey,
            arc: Math.max(40, dist * 0.4),
            t: 0,
            dur: 240 + dist * 0.6,
            gx: gxi,
            gy: gyi,
            payout,
            tier,
        });
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

    /**
     * step every in-flight eruption along its parabolic arc. `u` runs 0→1 over the
     * flight; position is the straight core→impact lerp plus an upward sine lift that
     * returns to 0 at the target, so the projectile lands exactly on its impact cell.
     * on landing the payload is deposited as MOLTEN_GOLD (value-carrying) and the
     * projectile is torn down.
     */
    private advanceEruptions(dtMs: number): void {
        for (let i = this.eruptions.length - 1; i >= 0; i--) {
            const e = this.eruptions[i];
            e.t += dtMs;
            const u = Math.min(e.t / e.dur, 1);
            const x = e.sx + (e.ex - e.sx) * u;
            const lift = e.arc * Math.sin(Math.PI * u); // screen y grows downward
            e.gfx.position.set(x, e.sy + (e.ey - e.sy) * u - lift);
            e.gfx.scale.set(1 - u * 0.3);
            if (u < 1) continue;
            depositEruption(this.world.sim, e.gx, e.gy, e.payout);
            this.eruptLayer.removeChild(e.gfx);
            e.gfx.destroy();
            this.eruptions.splice(i, 1);
            this.flashScreen(0xffb02e, e.tier >= 6 ? 0.12 : 0.05);
            if (e.tier >= 4) this.shake(Math.min(2 + (e.tier - 4) * 2, 10));
        }
    }

    private update(dtMs: number): void {
        const dt = dtMs / 1000;
        // advance eruption arcs BEFORE stepping the sim so a projectile that lands
        // this frame deposits its molten gold in time to be stepped + re-uploaded
        // by the same simLayer.update() below (design §7 ballistic-flight phase).
        this.advanceEruptions(dtMs);
        // advance + re-upload the sim before the overlay so the world sits behind
        // this frame's crit numbers; the fixed-timestep accumulator inside decouples
        // sim speed from display refresh. keep it stretched to the (resized) stage.
        this.simLayer.update(dtMs);
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
