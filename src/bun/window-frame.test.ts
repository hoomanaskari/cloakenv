import { describe, expect, test } from "bun:test";
import type { Display } from "electrobun/bun";
import {
  constrainWindowFrameForMove,
  constrainWindowFrameForOpen,
  constrainWindowFrameForResize,
} from "./window-frame";

const PRIMARY_DISPLAY: Display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  workArea: { x: 0, y: 25, width: 1440, height: 835 },
  scaleFactor: 2,
  isPrimary: true,
};

describe("window-frame", () => {
  test("recovers an oversized saved window on open", () => {
    expect(
      constrainWindowFrameForOpen(
        { x: -200, y: -50, width: 1800, height: 1200 },
        [PRIMARY_DISPLAY],
        { minWidth: 980, minHeight: 640 },
      ),
    ).toEqual({
      x: -200,
      y: 25,
      width: 1440,
      height: 835,
    });
  });

  test("prevents the title bar from moving above the screen during dragging", () => {
    expect(
      constrainWindowFrameForMove(
        { x: 100, y: -300, width: 1100, height: 750 },
        [PRIMARY_DISPLAY],
        {
          minWidth: 980,
          minHeight: 640,
        },
      ),
    ).toEqual({
      x: 100,
      y: 25,
      width: 1100,
      height: 750,
    });
  });

  test("falls back to the primary display when the saved frame is fully offscreen", () => {
    const secondaryDisplay: Display = {
      id: 2,
      bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
      workArea: { x: 1440, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
      isPrimary: false,
    };

    expect(
      constrainWindowFrameForOpen(
        { x: 5000, y: 5000, width: 1100, height: 750 },
        [PRIMARY_DISPLAY, secondaryDisplay],
        { minWidth: 980, minHeight: 640 },
      ),
    ).toEqual({
      x: 170,
      y: 68,
      width: 1100,
      height: 750,
    });
  });

  test("allows a smaller-than-minimum window when the display work area is smaller", () => {
    const tinyDisplay: Display = {
      id: 3,
      bounds: { x: 0, y: 0, width: 900, height: 600 },
      workArea: { x: 0, y: 0, width: 900, height: 560 },
      scaleFactor: 1,
      isPrimary: true,
    };

    expect(
      constrainWindowFrameForOpen({ x: 0, y: 0, width: 1100, height: 750 }, [tinyDisplay], {
        minWidth: 980,
        minHeight: 640,
      }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 560,
    });
  });

  test("does not pin a full-width window horizontally while dragging", () => {
    expect(
      constrainWindowFrameForMove({ x: -240, y: 25, width: 1440, height: 800 }, [PRIMARY_DISPLAY], {
        minWidth: 980,
        minHeight: 640,
      }),
    ).toEqual({
      x: -240,
      y: 25,
      width: 1440,
      height: 800,
    });
  });

  test("resize clamps size without resetting horizontal position", () => {
    expect(
      constrainWindowFrameForResize(
        { x: -180, y: -50, width: 1800, height: 1200 },
        [PRIMARY_DISPLAY],
        { minWidth: 980, minHeight: 640 },
      ),
    ).toEqual({
      x: -180,
      y: 25,
      width: 1440,
      height: 835,
    });
  });
});
