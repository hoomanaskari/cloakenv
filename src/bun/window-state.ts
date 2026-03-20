import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Utils } from "electrobun/bun";

export interface WindowFrameState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PersistedWindowState {
  mainWindow?: WindowFrameState;
}

const WINDOW_STATE_PATH = join(Utils.paths.userData, "window-state.json");

export function loadMainWindowFrame(): WindowFrameState | null {
  try {
    const raw = readFileSync(WINDOW_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as PersistedWindowState;
    return isWindowFrameState(parsed.mainWindow) ? parsed.mainWindow : null;
  } catch {
    return null;
  }
}

export function saveMainWindowFrame(frame: WindowFrameState): void {
  if (!isWindowFrameState(frame)) {
    return;
  }

  mkdirSync(Utils.paths.userData, { recursive: true });
  writeFileSync(WINDOW_STATE_PATH, JSON.stringify({ mainWindow: frame }), "utf8");
}

function isWindowFrameState(value: unknown): value is WindowFrameState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const frame = value as Partial<WindowFrameState>;
  return (
    isFiniteNumber(frame.x) &&
    isFiniteNumber(frame.y) &&
    isFiniteNumber(frame.width) &&
    isFiniteNumber(frame.height)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
