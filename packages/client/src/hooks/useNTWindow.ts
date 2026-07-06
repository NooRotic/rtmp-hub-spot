import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-move + drag-to-resize behavior for the retro "NT window" tiles
 * (VideoFeed, GridView). Replaces the old CSS `resize: both` + decorative
 * `.resizable-handle` with a real, persisted, JS-driven handle and a
 * drag-by-title-bar mover.
 *
 * Design constraints (see FIX 3 brief):
 *  - RESIZE: the hatched corner handle becomes an actual drag handle. Width/height
 *    are written to the container element and clamped to the CSS minimums
 *    (200 x 150). Size persists under `hub-size-${label}` — the SAME key the old
 *    ResizeObserver used, so existing saved sizes keep loading.
 *  - MOVE: the title-bar background is a drag handle. The tile is offset with
 *    `transform: translate(dx, dy)` from its natural flex position — it STAYS in
 *    the flex-wrap flow (no position:absolute) so peers still reflow on add/remove.
 *    Offset persists under the NEW key `hub-pos-${label}`. z-index is raised while
 *    dragging / once moved so a moved tile floats above neighbours.
 *  - GUARD: a mousedown on an interactive control inside the title bar
 *    (button/select/input/label) must NOT start a move — otherwise HIDE/MUTE/
 *    BROADCAST/AMF clicks would be swallowed.
 *  - Double-click the title bar resets the position (clears `hub-pos-${label}`).
 *  - Mobile (≤768px): drag + resize are disabled so touch scrolling isn't hijacked.
 */

// ─── Pure helpers (unit-tested directly) ─────────────────────────────────────

export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 150;

export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

/** Clamp a candidate size to the CSS minimums (200 x 150). */
export function clampSize(width: number, height: number): Size {
  return {
    width: Math.max(MIN_WIDTH, Math.round(width)),
    height: Math.max(MIN_HEIGHT, Math.round(height)),
  };
}

/**
 * True when a mousedown target is (or is inside) an interactive control, in which
 * case a title-bar drag must NOT start. Guards button/select/input/label — which
 * covers the HIDE/MUTE/BROADCAST buttons and the AMF/hw-accel <select>.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return !!target.closest('button,select,input,label');
}

/** Apply an offset to a starting point during a move drag. */
export function applyOffset(start: Offset, dx: number, dy: number): Offset {
  return { x: start.x + dx, y: start.y + dy };
}

/**
 * Clamp a candidate transform offset so the tile's resulting on-screen rect stays
 * inside an arbitrary bounds box `[boundsLeft, boundsRight] x [boundsTop, boundsBottom]`.
 * `naturalLeft/naturalTop` are the tile's position WITHOUT any transform. A tile
 * larger than the box pins to the box's top-left. This is what keeps a dragged or
 * restored window inside the stage instead of under the header / off-screen.
 */
export function clampOffsetToBounds(
  naturalLeft: number,
  naturalTop: number,
  width: number,
  height: number,
  candidate: Offset,
  boundsLeft: number,
  boundsTop: number,
  boundsRight: number,
  boundsBottom: number,
): Offset {
  const maxLeft = Math.max(boundsLeft, boundsRight - width);
  const maxTop = Math.max(boundsTop, boundsBottom - height);
  const desiredLeft = naturalLeft + candidate.x;
  const desiredTop = naturalTop + candidate.y;
  const clampedLeft = Math.min(Math.max(desiredLeft, boundsLeft), maxLeft);
  const clampedTop = Math.min(Math.max(desiredTop, boundsTop), maxTop);
  return {
    x: candidate.x + (clampedLeft - desiredLeft),
    y: candidate.y + (clampedTop - desiredTop),
  };
}

/** Back-compat thin wrapper: clamp to the window viewport `[0,0]..[vw,vh]`. */
export function clampOffsetToViewport(
  naturalLeft: number,
  naturalTop: number,
  width: number,
  height: number,
  candidate: Offset,
  viewportW: number,
  viewportH: number,
): Offset {
  return clampOffsetToBounds(naturalLeft, naturalTop, width, height, candidate, 0, 0, viewportW, viewportH);
}

/**
 * Resolve the bounds a tile must stay within: the nearest `[data-nt-stage]`
 * ancestor (the admin stage area, whose top sits below the app header), intersected
 * with the visible viewport. Falls back to the bare viewport when there's no stage
 * marker (e.g. the participant ClientPortal).
 */
function getStageBounds(el: HTMLElement | null): { left: number; top: number; right: number; bottom: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const stage = el && el.closest('[data-nt-stage]');
  if (stage) {
    const r = stage.getBoundingClientRect();
    return {
      left: Math.max(0, r.left),
      top: Math.max(0, r.top),
      right: Math.min(vw, r.right),
      bottom: Math.min(vh, r.bottom),
    };
  }
  return { left: 0, top: 0, right: vw, bottom: vh };
}

const sizeKey = (label: string) => `hub-size-${label}`;
const posKey = (label: string) => `hub-pos-${label}`;

function readSize(label: string): Size | null {
  try {
    const raw = localStorage.getItem(sizeKey(label));
    if (!raw) return null;
    const { width, height } = JSON.parse(raw);
    const w = parseInt(String(width), 10);
    const h = parseInt(String(height), 10);
    if (Number.isNaN(w) || Number.isNaN(h)) return null;
    return { width: w, height: h };
  } catch {
    return null;
  }
}

function writeSize(label: string, size: Size): void {
  try {
    localStorage.setItem(
      sizeKey(label),
      JSON.stringify({ width: `${size.width}px`, height: `${size.height}px` }),
    );
  } catch {
    /* ignore quota / disabled storage */
  }
}

function readOffset(label: string): Offset | null {
  try {
    const raw = localStorage.getItem(posKey(label));
    if (!raw) return null;
    const { x, y } = JSON.parse(raw);
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return { x, y };
  } catch {
    return null;
  }
}

function writeOffset(label: string, offset: Offset): void {
  try {
    localStorage.setItem(posKey(label), JSON.stringify(offset));
  } catch {
    /* ignore */
  }
}

function clearOffset(label: string): void {
  try {
    localStorage.removeItem(posKey(label));
  } catch {
    /* ignore */
  }
}

/** Is the viewport in the mobile breakpoint where drag/resize are disabled? */
function isMobile(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(max-width: 768px)').matches;
  } catch {
    return false;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface NTWindowApi {
  /** Attach to the tile container (the `.window.resizable` div). */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Current translate offset; apply as the container's `transform`. */
  offset: Offset;
  /** True while either a move or resize drag is in progress. */
  isDragging: boolean;
  /** Spread onto the `.window-title` bar to make it a move handle. */
  titleBarProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
    style: React.CSSProperties;
  };
  /** Spread onto the `.resizable-handle` corner to make it a resize handle. */
  resizeHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
  /** Convenience style for the container (transform + z-index). */
  containerStyle: React.CSSProperties;
}

/**
 * @param label storage key suffix (e.g. the feed label or "gridview").
 */
export function useNTWindow(label: string): NTWindowApi {
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  // Synchronous mirror of `offset` for reads inside drag handlers / listeners
  // (avoids the setState-updater capture trick and stale closures).
  const offsetRef = useRef<Offset>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  // Latch true once moved/resized so the tile keeps a raised z-index.
  const [hasMoved, setHasMoved] = useState(false);

  useEffect(() => { offsetRef.current = offset; }, [offset]);

  // Load persisted size + position on mount (size FIRST, so the offset clamp below
  // measures the restored dimensions), clamping a persisted offset back into view.
  useEffect(() => {
    const el = containerRef.current;
    const savedSize = readSize(label);
    if (savedSize && el) {
      el.style.width = `${savedSize.width}px`;
      el.style.height = `${savedSize.height}px`;
    }
    const savedOffset = readOffset(label);
    if (savedOffset) {
      let next = savedOffset;
      if (el && typeof window !== 'undefined') {
        const rect = el.getBoundingClientRect(); // no transform applied yet → natural pos
        const b = getStageBounds(el);
        next = clampOffsetToBounds(rect.left, rect.top, rect.width, rect.height, savedOffset, b.left, b.top, b.right, b.bottom);
        if (next.x !== savedOffset.x || next.y !== savedOffset.y) writeOffset(label, next);
      }
      setOffset(next);
      setHasMoved(true);
    }
  }, [label]);

  // Re-clamp into view when the viewport shrinks (a moved tile must not be stranded
  // off the new edge).
  useEffect(() => {
    if (isMobile()) return;
    const onResize = () => {
      const el = containerRef.current;
      if (!el) return;
      const cur = offsetRef.current;
      if (cur.x === 0 && cur.y === 0) return;
      const rect = el.getBoundingClientRect();
      const b = getStageBounds(el);
      const next = clampOffsetToBounds(rect.left - cur.x, rect.top - cur.y, rect.width, rect.height, cur, b.left, b.top, b.right, b.bottom);
      if (next.x !== cur.x || next.y !== cur.y) {
        setOffset(next);
        writeOffset(label, next);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [label]);

  // ── Move (title-bar drag) ──────────────────────────────────────────────────
  const startMove = useCallback(
    (e: React.MouseEvent) => {
      if (isMobile()) return;
      // Guard: never start a move from an interactive control.
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const base: Offset = offsetRef.current;
      const el = containerRef.current;
      const rect = el ? el.getBoundingClientRect() : null;
      // Natural (untransformed) top-left = current rect minus the applied offset.
      const naturalLeft = rect ? rect.left - base.x : 0;
      const naturalTop = rect ? rect.top - base.y : 0;
      const width = rect ? rect.width : MIN_WIDTH;
      const height = rect ? rect.height : MIN_HEIGHT;
      const bounds = getStageBounds(el);
      setIsDragging(true);

      let next: Offset = base;
      const onMove = (ev: MouseEvent) => {
        const candidate = applyOffset(base, ev.clientX - startX, ev.clientY - startY);
        next = clampOffsetToBounds(naturalLeft, naturalTop, width, height, candidate, bounds.left, bounds.top, bounds.right, bounds.bottom);
        setOffset(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setIsDragging(false);
        setHasMoved(true);
        writeOffset(label, next);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [label],
  );

  const resetPosition = useCallback(() => {
    if (isMobile()) return;
    setOffset({ x: 0, y: 0 });
    setHasMoved(false);
    clearOffset(label);
  }, [label]);

  // ── Resize (corner-handle drag) ────────────────────────────────────────────
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (isMobile()) return;
      const el = containerRef.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = el.getBoundingClientRect();
      const startW = startRect.width;
      const startH = startRect.height;
      // Cap growth so the bottom-right handle can't push the tile past the stage.
      const b = getStageBounds(el);
      const maxW = Math.max(MIN_WIDTH, b.right - startRect.left);
      const maxH = Math.max(MIN_HEIGHT, b.bottom - startRect.top);
      setIsDragging(true);

      let last: Size = clampSize(startW, startH);
      const onMove = (ev: MouseEvent) => {
        const c = clampSize(startW + (ev.clientX - startX), startH + (ev.clientY - startY));
        last = { width: Math.min(c.width, maxW), height: Math.min(c.height, maxH) };
        if (containerRef.current) {
          containerRef.current.style.width = `${last.width}px`;
          containerRef.current.style.height = `${last.height}px`;
        }
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setIsDragging(false);
        setHasMoved(true);
        writeSize(label, last);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [label],
  );

  const containerStyle: React.CSSProperties = {
    transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
    zIndex: isDragging ? 1000 : hasMoved ? 10 : undefined,
  };

  return {
    containerRef,
    offset,
    isDragging,
    titleBarProps: {
      onMouseDown: startMove,
      onDoubleClick: resetPosition,
      style: { cursor: 'move', userSelect: 'none' },
    },
    resizeHandleProps: {
      onMouseDown: startResize,
    },
    containerStyle,
  };
}
