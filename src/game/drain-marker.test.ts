import { describe, it, expect } from "vitest";
import { regionToScreenRect } from "./drain-marker";
import type { CollectorRegion } from "./collector";

const region = (x: number, y: number, w: number, h: number): CollectorRegion => ({ x, y, w, h });

describe("regionToScreenRect", () => {
    it("scales a grid rect onto the stretched stage by per-axis factors", () => {
        // 320x180 grid stretched to 1280x720 => 4x on each axis.
        const r = regionToScreenRect(region(10, 20, 40, 6), 320, 180, 1280, 720);
        expect(r).toEqual({ x: 40, y: 80, w: 160, h: 24 });
    });

    it("uses independent x and y scale factors when the stage aspect differs", () => {
        // 100 wide over 1000px => 10x; 50 tall over 250px => 5x.
        const r = regionToScreenRect(region(2, 4, 5, 3), 100, 50, 1000, 250);
        expect(r).toEqual({ x: 20, y: 20, w: 50, h: 15 });
    });

    it("maps a full-grid region to the full screen", () => {
        const r = regionToScreenRect(region(0, 0, 320, 180), 320, 180, 800, 600);
        expect(r).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    });

    it("maps the identity when grid dims equal screen dims", () => {
        const r = regionToScreenRect(region(3, 7, 4, 2), 640, 480, 640, 480);
        expect(r).toEqual({ x: 3, y: 7, w: 4, h: 2 });
    });
});
