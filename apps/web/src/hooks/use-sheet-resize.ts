import { useCallback, useEffect, useRef, useState } from "react";

const KEYBOARD_RESIZE_STEP = 24;
type ResizeSide = "left" | "right";

export function useSheetResize(
  storageKey: string,
  defaultWidth: number,
  {
    min = 400,
    max,
    side = "right",
  }: { min?: number; max?: number | (() => number); side?: ResizeSide } = {},
) {
  const persistedWidthKey = `sheet-width:${storageKey}`;
  const resolveMaxWidth = useCallback(() => {
    const viewportCeiling =
      typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth * 0.96;
    const configuredMax = typeof max === "function" ? max() : max;
    const ceiling = configuredMax == null ? viewportCeiling : Math.min(configuredMax, viewportCeiling);
    return Math.max(min, ceiling);
  }, [max, min]);
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(persistedWidthKey);
      if (stored) {
        const v = Number(stored);
        if (Number.isFinite(v)) return Math.max(min, v);
      }
    } catch {
      /* ignore */
    }
    return defaultWidth;
  });

  const widthRef = useRef(width);
  widthRef.current = width;

  const dragState = useRef<{ startX: number; startW: number } | null>(null);
  const clampWidth = useCallback(
    (nextWidth: number) => {
      return Math.max(min, Math.min(resolveMaxWidth(), nextWidth));
    },
    [min, resolveMaxWidth],
  );

  const updateWidth = useCallback((nextWidth: number) => {
    widthRef.current = nextWidth;
    setWidth(nextWidth);
  }, []);

  const persistWidth = useCallback(
    (nextWidth: number) => {
      try {
        localStorage.setItem(persistedWidthKey, String(nextWidth));
      } catch {
        /* ignore */
      }
    },
    [persistedWidthKey],
  );
  const clampWidthRef = useRef(clampWidth);
  clampWidthRef.current = clampWidth;
  const updateWidthRef = useRef(updateWidth);
  updateWidthRef.current = updateWidth;
  const persistWidthRef = useRef(persistWidth);
  persistWidthRef.current = persistWidth;
  const sideRef = useRef(side);
  sideRef.current = side;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      e.preventDefault();
      const delta =
        sideRef.current === "left"
          ? e.clientX - dragState.current.startX
          : dragState.current.startX - e.clientX;
      const next = clampWidthRef.current(dragState.current.startW + delta);
      updateWidthRef.current(next);
    };

    const onUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistWidthRef.current(widthRef.current);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragState.current) {
        dragState.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  useEffect(() => {
    const syncWidthToViewport = () => {
      const nextWidth = clampWidthRef.current(widthRef.current);
      if (nextWidth !== widthRef.current) {
        updateWidthRef.current(nextWidth);
        persistWidthRef.current(nextWidth);
      }
    };

    syncWidthToViewport();
    window.addEventListener("resize", syncWidthToViewport);
    return () => window.removeEventListener("resize", syncWidthToViewport);
  }, []);

  useEffect(() => {
    const nextWidth = clampWidth(widthRef.current);
    if (nextWidth !== widthRef.current) {
      updateWidth(nextWidth);
      persistWidth(nextWidth);
    }
  }, [clampWidth, persistWidth, updateWidth]);

  const onResizeStart = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startW: widthRef.current };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const delta =
        e.key === "ArrowLeft"
          ? (side === "left" ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP)
          : e.key === "ArrowRight"
            ? (side === "left" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP)
            : 0;
      if (delta === 0) {
        return;
      }

      e.preventDefault();
      const nextWidth = clampWidth(widthRef.current + delta);
      updateWidth(nextWidth);
      persistWidth(nextWidth);
    },
    [clampWidth, persistWidth, side, updateWidth],
  );

  return { width, onResizeKeyDown, onResizeStart };
}
