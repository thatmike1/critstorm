import type { Simulation } from "./simulation";

/**
 * canvas/DOM render adapter for the headless {@link Simulation} core. Owns the
 * offscreen canvases and ImageData buffers and the glow/blur/light passes — all
 * the browser-only machinery split out of the core so the sim itself stays
 * steppable under plain Node. render() pulls the freshly-written pixel buffers
 * (`buf32` scene, `glow32` emissive) off the sim and blits them scaled.
 *
 * this is the *canvas2D* consumer of the buffers; the game's Pixi layer is a
 * separate consumer that uploads `buf32` into a texture and never touches this
 * file. the core imports neither.
 */
export class SimulationRenderer {
    private readonly sim: Simulation;

    // Offscreen pixel buffers (1px per cell), blitted scaled to the visible
    // canvas. The core owns the raw Uint32 pixel data and never reallocates it,
    // so these ImageData objects are zero-copy views over the core's buffers —
    // putImageData uploads straight from sim memory with no per-frame copy.
    private imageData: ImageData;
    private glowData: ImageData;
    private off: HTMLCanvasElement;
    private offCtx: CanvasRenderingContext2D;
    private glowCanvas: HTMLCanvasElement;
    private glowCtx: CanvasRenderingContext2D;
    // Scratch canvas (1px per cell) for blurring the glow in SOURCE space.
    private blurCanvas: HTMLCanvasElement;
    private blurCtx: CanvasRenderingContext2D;

    constructor(sim: Simulation) {
        this.sim = sim;
        const { W, H } = sim;

        this.imageData = new ImageData(new Uint8ClampedArray(sim.buf32.buffer), W, H);
        this.glowData = new ImageData(new Uint8ClampedArray(sim.glow32.buffer), W, H);

        this.off = document.createElement("canvas");
        this.off.width = W;
        this.off.height = H;
        const offCtx = this.off.getContext("2d");
        if (!offCtx) throw new Error("2d context unavailable for offscreen canvas");
        this.offCtx = offCtx;
        this.glowCanvas = document.createElement("canvas");
        this.glowCanvas.width = W;
        this.glowCanvas.height = H;
        const glowCtx = this.glowCanvas.getContext("2d");
        if (!glowCtx) throw new Error("2d context unavailable for glow canvas");
        this.glowCtx = glowCtx;
        this.blurCanvas = document.createElement("canvas");
        this.blurCanvas.width = W;
        this.blurCanvas.height = H;
        const blurCtx = this.blurCanvas.getContext("2d");
        if (!blurCtx) throw new Error("2d context unavailable for blur canvas");
        this.blurCtx = blurCtx;
    }

    /**
     * blur the emissive buffer in SOURCE space (the small W×H glow canvas) and
     * composite it onto `ctx` upscaled. blurring 200×150 at radius/scale is ~16×
     * fewer pixels with a ¼-size kernel versus blurring the full-res canvas, and
     * matters because Firefox's canvas2D blur runs on the CPU (Chrome's is GPU).
     * the upscale uses bilinear smoothing so the small blur reads as a smooth
     * gradient rather than blocky cells.
     */
    private glowPass(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number,
        scale: number,
        screenBlur: number,
        alpha: number
    ): void {
        const { blurCtx, blurCanvas, glowCanvas } = this;
        const { W, H } = this.sim;
        const radius = Math.max(0.5, screenBlur / scale);
        blurCtx.clearRect(0, 0, W, H);
        blurCtx.filter = `blur(${radius}px)`;
        blurCtx.drawImage(glowCanvas, 0, 0);
        blurCtx.filter = "none";
        ctx.globalAlpha = alpha;
        ctx.drawImage(blurCanvas, 0, 0, w, h);
    }

    render(
        ctx: CanvasRenderingContext2D,
        scale: number,
        glow: boolean,
        light: boolean,
        darkness: number
    ): void {
        const { sim } = this;
        // fill the core-owned pixel buffers; imageData views them directly.
        sim.writeImage();
        this.offCtx.putImageData(this.imageData, 0, 0);
        ctx.imageSmoothingEnabled = false;
        const w = sim.W * scale,
            h = sim.H * scale;
        ctx.drawImage(this.off, 0, 0, w, h);

        // the additive glow passes draw from the emissive (fire/lava) buffer; with
        // nothing emissive there's nothing to flood, so skip uploading it entirely.
        const hasLight = sim.emissive > 0;
        if ((glow || light) && hasLight) {
            this.glowCtx.putImageData(this.glowData, 0, 0);
        }

        // dynamic lighting: dim the whole scene toward black, then flood additive
        // radiance from emissive cells so light sources reveal their surroundings.
        if (light) {
            if (darkness > 0) {
                ctx.save();
                ctx.globalCompositeOperation = "multiply";
                const v = Math.round(255 * (1 - darkness));
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect(0, 0, w, h);
                ctx.restore();
            }
            // stacked blur radii approximate a long-tailed falloff: a tight hot core
            // (also keeps sources bright after the multiply-darken when bloom is off),
            // a mid spread, and a far reach. radii are screen-space; glowPass scales
            // them down to source space.
            if (hasLight) {
                ctx.save();
                ctx.globalCompositeOperation = "lighter";
                ctx.imageSmoothingEnabled = true;
                this.glowPass(ctx, w, h, scale, Math.max(2, scale), 0.9);
                this.glowPass(ctx, w, h, scale, scale * 6, 0.6);
                this.glowPass(ctx, w, h, scale, scale * 12, 0.4);
                ctx.restore();
            }
        }

        // bloom: tight additive halo on the source cores (independent of lighting).
        if (glow && hasLight) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.imageSmoothingEnabled = true;
            this.glowPass(ctx, w, h, scale, Math.max(2, scale), 0.85);
            ctx.restore();
        }
    }
}
