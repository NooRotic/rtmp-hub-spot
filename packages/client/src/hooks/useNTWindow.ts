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
  const [isDragging, setIsDragging] = useState(false);
  // Latch true once moved/resized so the tile keeps a raised z-index.
  const [hasMoved, setHasMoved] = useState(false);

  // Load persisted size + position on mount.
  useEffect(() => {
    const savedOffset = readOffset(label);
    if (savedOffset) {
      setOffset(savedOffset);
      setHasMoved(true);
    }
    const savedSize = readSize(label);
    if (savedSize && containerRef.current) {
      containerRef.current.style.width = `${savedSize.width}px`;
      containerRef.current.style.height = `${savedSize.height}px`;
    }
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
      let base: Offset = { x: 0, y: 0 };
      setOffset((cur) => {
        base = cur;
        return cur;
      });
      setIsDragging(true);

      let next: Offset = base;
      const onMove = (ev: MouseEvent) => {
        next = applyOffset(base, ev.clientX - startX, ev.clientY - startY);
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
      const startW = el.getBoundingClientRect().width;
      const startH = el.getBoundingClientRect().height;
      setIsDragging(true);

      let last: Size = clampSize(startW, startH);
      const onMove = (ev: MouseEvent) => {
        last = clampSize(startW + (ev.clientX - startX), startH + (ev.clientY - startY));
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
