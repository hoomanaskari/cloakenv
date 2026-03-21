import type { Display } from "electrobun/bun";
import type { WindowFrameState } from "./window-state";

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ClampWindowFrameOptions {
  minWidth: number;
  minHeight: number;
}

export function normalizeWindowFrame(
  frame: WindowFrameState,
  options: ClampWindowFrameOptions,
): WindowFrameState {
  return {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(Math.round(frame.width), options.minWidth),
    height: Math.max(Math.round(frame.height), options.minHeight),
  };
}

export function constrainWindowFrameForOpen(
  frame: WindowFrameState,
  displays: Display[],
  options: ClampWindowFrameOptions,
): WindowFrameState {
  const normalizedFrame = normalizeWindowFrame(frame, options);
  const targetDisplay = pickDisplayForFrame(normalizedFrame, displays);

  if (!targetDisplay) {
    return normalizedFrame;
  }

  const resizedFrame = clampWindowSizeToRect(normalizedFrame, targetDisplay.workArea, options);
  if (hasVisibleIntersection(resizedFrame, displays)) {
    return clampWindowTopToRect(resizedFrame, targetDisplay.workArea);
  }

  return centerWindowFrameInRect(resizedFrame, targetDisplay.workArea);
}

export function constrainWindowFrameForResize(
  frame: WindowFrameState,
  displays: Display[],
  options: ClampWindowFrameOptions,
): WindowFrameState {
  const normalizedFrame = normalizeWindowFrame(frame, options);
  const targetDisplay = pickDisplayForFrame(normalizedFrame, displays);

  if (!targetDisplay) {
    return normalizedFrame;
  }

  return clampWindowTopToRect(
    clampWindowSizeToRect(normalizedFrame, targetDisplay.workArea, options),
    targetDisplay.workArea,
  );
}

export function constrainWindowFrameForMove(
  frame: WindowFrameState,
  displays: Display[],
  options: ClampWindowFrameOptions,
): WindowFrameState {
  const normalizedFrame = normalizeWindowFrame(frame, options);
  const targetDisplay = pickDisplayForFrame(normalizedFrame, displays);

  if (!targetDisplay) {
    return normalizedFrame;
  }

  return clampWindowTopToRect(normalizedFrame, targetDisplay.workArea);
}

export function framesEqual(a: WindowFrameState, b: WindowFrameState): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function clampWindowSizeToRect(
  frame: WindowFrameState,
  rect: Rectangle,
  options: ClampWindowFrameOptions,
): WindowFrameState {
  const width = clampWindowDimension(frame.width, options.minWidth, rect.width);
  const height = clampWindowDimension(frame.height, options.minHeight, rect.height);

  return {
    x: frame.x,
    y: frame.y,
    width,
    height,
  };
}

function clampWindowTopToRect(frame: WindowFrameState, rect: Rectangle): WindowFrameState {
  return {
    x: frame.x,
    y: Math.max(frame.y, rect.y),
    width: frame.width,
    height: frame.height,
  };
}

function centerWindowFrameInRect(frame: WindowFrameState, rect: Rectangle): WindowFrameState {
  return {
    x: Math.round(rect.x + (rect.width - frame.width) / 2),
    y: Math.round(rect.y + (rect.height - frame.height) / 2),
    width: frame.width,
    height: frame.height,
  };
}

function clampWindowDimension(value: number, minValue: number, maxValue: number): number {
  const rounded = Math.round(value);
  const roundedMin = Math.max(1, Math.round(minValue));
  const roundedMax = Math.max(1, Math.round(maxValue));

  if (roundedMax <= roundedMin) {
    return roundedMax;
  }

  return clamp(rounded, roundedMin, roundedMax);
}

function pickDisplayForFrame(frame: WindowFrameState, displays: Display[]): Display | null {
  if (displays.length === 0) {
    return null;
  }

  let bestDisplay: Display | null = null;
  let bestArea = -1;

  for (const display of displays) {
    const area = getIntersectionArea(frame, display.workArea);
    if (area > bestArea) {
      bestArea = area;
      bestDisplay = display;
    }
  }

  if (bestArea > 0 && bestDisplay) {
    return bestDisplay;
  }

  return displays.find((display) => display.isPrimary) ?? displays[0] ?? null;
}

function hasVisibleIntersection(frame: WindowFrameState, displays: Display[]): boolean {
  return displays.some((display) => getIntersectionArea(frame, display.workArea) > 0);
}

function getIntersectionArea(a: Rectangle, b: Rectangle): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue);
}
