import { BufferImageSource, Sprite, Texture } from "pixi.js";
import { Mat } from "../sim/materials";
import type { Simulation } from "../sim/simulation";

/**
 * reinterpret the sim's packed-RGBA `Uint32` scene buffer as the byte view a GPU
 * texture uploads. the sim packs each cell as little-endian `0xAABBGGRR`, so the
 * underlying bytes are already in R,G,B,A order — i.e. `rgba8unorm`. this is a
 * ZERO-COPY view over the same `ArrayBuffer`: `writeImage()` writes `buf32` and
 * these bytes change in lockstep, so the texture never needs a per-frame copy.
 */
export function bytesOf(buf32: Uint32Array<ArrayBuffer>): Uint8Array {
    return new Uint8Array(buf32.buffer);
}

/**
 * DEMO BOOTSTRAP — TEMPORARY. paints a small sand pile + water pocket so the sim
 * layer is visibly alive the instant the stage mounts. nothing here is
 * load-bearing; REPLACE wholesale with the real world bootstrap (critstorm-b4r.3).
 */
export function paintDemoScene(sim: Simulation): void {
    const { W, H } = sim;
    // a mound of sand resting on the floor (the lower half of the circle is
    // clipped away, leaving a dome that reads as a pile).
    sim.paint((W * 0.5) | 0, H - 2, 22, Mat.SAND);
    // a water pocket up and to the left that falls, spreads, and pools against
    // the sand — instant motion so the layer never looks static.
    sim.paint((W * 0.26) | 0, (H * 0.32) | 0, 12, Mat.WATER);
    // a second sand blob raining from the top-right for extra visible churn.
    sim.paint((W * 0.72) | 0, (H * 0.18) | 0, 9, Mat.SAND);
}

/**
 * renders a headless {@link Simulation}'s pixel buffer as a nearest-neighbor
 * upscaled Pixi sprite — the bottom layer of the CritEngine stage. owns exactly
 * one texture backed by the sim's `buf32` and reuses it forever: `update()` steps
 * the sim, refills the buffer, and re-uploads in place (the texture is never
 * recreated). the sim core stays untouched; this is a pure presentation adapter,
 * the Pixi-side sibling of the canvas `SimulationRenderer`.
 */
export class SimLayer {
    readonly sim: Simulation;
    readonly sprite: Sprite;
    private readonly source: BufferImageSource;
    private readonly texture: Texture;

    constructor(sim: Simulation) {
        this.sim = sim;
        // one texture over the sim's own buffer bytes; `format` is forced because
        // BufferImageSource would otherwise infer `bgra8unorm` from a Uint8Array
        // and swap the red/blue channels of every cell.
        this.source = new BufferImageSource({
            resource: bytesOf(sim.buf32),
            width: sim.W,
            height: sim.H,
            format: "rgba8unorm",
            scaleMode: "nearest",
        });
        this.texture = new Texture({ source: this.source });
        this.sprite = new Sprite(this.texture);
    }

    /** stretch the layer to fill (w,h) screen px; nearest upscaling keeps cells crisp. */
    resize(w: number, h: number): void {
        this.sprite.width = w;
        this.sprite.height = h;
    }

    /**
     * advance the sim one frame and re-upload its pixel buffer into the texture.
     * order matters: step mutates the grid, writeImage() packs it into `buf32`
     * (which the texture bytes alias), then source.update() flags the GPU upload.
     */
    update(): void {
        this.sim.step();
        this.sim.writeImage();
        this.source.update();
    }

    /** release the reused texture + its buffer source (the sprite is owned by the stage). */
    destroy(): void {
        this.texture.destroy(true);
    }
}
