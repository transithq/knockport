import { useEffect, useRef, useState } from "react";

export type ResizeAxis = "x" | "y";

export interface ResizeSpec {
  /** Current size getter (usually a store selector read). */
  getValue: () => number;
  /** Commit a new size (usually a store setter, which persists). */
  setValue: (v: number) => void;
  min: number;
  /** Upper bound resolved at drag start (e.g. container − other pane min). */
  getMax: () => number;
  /** True when dragging left/up grows the pane (right/bottom panels). */
  invert?: boolean;
  /** Size restored on double-click reset. */
  defaultSize: number;
}

/**
 * Pointer-drag panel resizing, Bruno-style: mousedown seeds the anchor,
 * document-level mousemove commits clamped sizes live, mouseup ends the
 * drag. Clamping uses a max resolved once at drag start.
 */
export function useResizer(axis: ResizeAxis) {
  const [dragging, setDragging] = useState(false);
  const specRef = useRef<ResizeSpec | null>(null);
  const anchor = useRef({ pos: 0, size: 0, max: Number.POSITIVE_INFINITY });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const spec = specRef.current;
      if (!spec) return;
      const cur = axis === "x" ? e.clientX : e.clientY;
      const delta = (cur - anchor.current.pos) * (spec.invert ? -1 : 1);
      const next = Math.min(anchor.current.max, Math.max(spec.min, anchor.current.size + delta));
      spec.setValue(next);
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.classList.add(`kp-resizing-${axis}`);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove(`kp-resizing-${axis}`);
    };
  }, [dragging, axis]);

  const start = (e: React.MouseEvent, spec: ResizeSpec) => {
    e.preventDefault();
    specRef.current = spec;
    anchor.current = {
      pos: axis === "x" ? e.clientX : e.clientY,
      size: spec.getValue(),
      max: spec.getMax(),
    };
    setDragging(true);
  };

  return { dragging, start };
}
