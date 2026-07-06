import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { render, cleanup } from '../test/testUtils';
import {
  useNTWindow,
  clampSize,
  clampOffsetToViewport,
  clampOffsetToBounds,
  isInteractiveTarget,
  applyOffset,
  MIN_WIDTH,
  MIN_HEIGHT,
} from './useNTWindow';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** Dispatch a raw MouseEvent — the custom fireEvent has no mouse-drag support. */
function mouse(el: EventTarget, type: 'mousedown' | 'mousemove' | 'mouseup', clientX: number, clientY: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
  });
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

describe('useNTWindow pure helpers', () => {
  it('clampSize floors to the CSS minimums (200 x 150)', () => {
    expect(clampSize(10, 10)).toEqual({ width: MIN_WIDTH, height: MIN_HEIGHT });
    expect(clampSize(199, 149)).toEqual({ width: 200, height: 150 });
    expect(clampSize(640, 480)).toEqual({ width: 640, height: 480 });
    // rounds fractional sizes
    expect(clampSize(640.6, 480.2)).toEqual({ width: 641, height: 480 });
  });

  it('applyOffset adds the delta to the start point', () => {
    expect(applyOffset({ x: 5, y: 7 }, 10, -3)).toEqual({ x: 15, y: 4 });
    expect(applyOffset({ x: 0, y: 0 }, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('clampOffsetToViewport keeps the tile rect inside the viewport', () => {
    // On-screen candidate is unchanged.
    expect(clampOffsetToViewport(0, 0, 200, 150, { x: 50, y: 60 }, 1024, 768)).toEqual({ x: 50, y: 60 });
    // Pushed off the right/bottom: clamp so the right/bottom edge fits.
    // maxLeft = 1024-200 = 824, maxTop = 768-150 = 618.
    expect(clampOffsetToViewport(900, 700, 200, 150, { x: 300, y: 300 }, 1024, 768))
      .toEqual({ x: 824 - 900, y: 618 - 700 });
    // Pushed off the top/left: pin to 0.
    expect(clampOffsetToViewport(10, 10, 200, 150, { x: -50, y: -50 }, 1024, 768)).toEqual({ x: -10, y: -10 });
    // Tile larger than the viewport pins to the top-left corner (offset back to 0).
    expect(clampOffsetToViewport(0, 0, 2000, 1500, { x: 40, y: 40 }, 1024, 768)).toEqual({ x: 0, y: 0 });
  });

  it('clampOffsetToBounds keeps the tile inside a non-origin stage box (below the header)', () => {
    // Reproduces the real bug: gridview natural at (24, 622), 947x602, dragged with
    // offset (1046, -622) to top-right under the header. Stage box is [14,102]..[1989,700].
    const out = clampOffsetToBounds(24, 622, 947, 602, { x: 1046, y: -622 }, 14, 102, 1989, 700);
    // maxLeft = 1989-947 = 1042 → desiredLeft 24+1046=1070 → clamp 1042 → x = 1046 + (1042-1070) = 1018
    // maxTop  = max(102, 700-602=98) = 102 → desiredTop 0 → clamp to 102 → y = -622 + (102-0) = -520
    expect(out).toEqual({ x: 1018, y: -520 });
    // a candidate already inside the box is unchanged
    expect(clampOffsetToBounds(100, 200, 300, 200, { x: 0, y: 0 }, 14, 102, 1989, 700)).toEqual({ x: 0, y: 0 });
    // cannot be dragged above the box top (header)
    expect(clampOffsetToBounds(100, 200, 300, 200, { x: 0, y: -500 }, 14, 102, 1989, 700)).toEqual({ x: 0, y: 102 - 200 });
  });

  it('isInteractiveTarget detects controls (the title-bar drag guard)', () => {
    const btn = document.createElement('button');
    const sel = document.createElement('select');
    const inp = document.createElement('input');
    const lbl = document.createElement('label');
    const span = document.createElement('span');
    // child inside a button still counts (closest)
    const inner = document.createElement('em');
    btn.appendChild(inner);

    expect(isInteractiveTarget(btn)).toBe(true);
    expect(isInteractiveTarget(sel)).toBe(true);
    expect(isInteractiveTarget(inp)).toBe(true);
    expect(isInteractiveTarget(lbl)).toBe(true);
    expect(isInteractiveTarget(inner)).toBe(true);
    expect(isInteractiveTarget(span)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});

// ─── Title-bar move drag ────────────────────────────────────────────────────────

/** Test harness wiring the hook onto a window + title bar + a button + handle. */
function Harness({ label }: { label: string }) {
  const { containerRef, titleBarProps, resizeHandleProps, containerStyle } = useNTWindow(label);
  return (
    <div ref={containerRef} className="window resizable" data-testid="win" style={containerStyle}>
      <div
        className="window-title"
        data-testid="title"
        onMouseDown={titleBarProps.onMouseDown}
        onDoubleClick={titleBarProps.onDoubleClick}
        style={titleBarProps.style}
      >
        <span>Label</span>
        <button data-testid="title-btn">HIDE</button>
      </div>
      <div className="resizable-handle" data-testid="handle" onMouseDown={resizeHandleProps.onMouseDown}></div>
    </div>
  );
}

describe('useNTWindow drag-to-move', () => {
  it('a title-bar background drag sets a transform offset and persists hub-pos', () => {
    const { container } = render(<Harness label="alice" />);
    const title = container.querySelector('[data-testid="title"]') as HTMLElement;
    const win = container.querySelector('[data-testid="win"]') as HTMLElement;

    mouse(title, 'mousedown', 100, 100);
    mouse(window, 'mousemove', 140, 130);
    mouse(window, 'mouseup', 140, 130);

    // transform reflects dx=40, dy=30
    expect(win.style.transform).toContain('translate(40px, 30px)');
    // persisted under the NEW key
    const saved = JSON.parse(localStorage.getItem('hub-pos-alice') || 'null');
    expect(saved).toEqual({ x: 40, y: 30 });
  });

  it('a mousedown on a title-bar BUTTON does NOT start a drag (guard)', () => {
    const { container } = render(<Harness label="bob" />);
    const btn = container.querySelector('[data-testid="title-btn"]') as HTMLElement;
    const win = container.querySelector('[data-testid="win"]') as HTMLElement;

    mouse(btn, 'mousedown', 100, 100);
    mouse(window, 'mousemove', 200, 200);
    mouse(window, 'mouseup', 200, 200);

    // No move happened — no transform, nothing persisted.
    expect(win.style.transform).toBe('');
    expect(localStorage.getItem('hub-pos-bob')).toBeNull();
  });

  it('double-click on the title bar resets the position (clears hub-pos)', () => {
    localStorage.setItem('hub-pos-carol', JSON.stringify({ x: 50, y: 60 }));
    const { container } = render(<Harness label="carol" />);
    const title = container.querySelector('[data-testid="title"]') as HTMLElement;
    const win = container.querySelector('[data-testid="win"]') as HTMLElement;

    // restored from storage on mount
    expect(win.style.transform).toContain('translate(50px, 60px)');

    act(() => {
      title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(win.style.transform).toBe('');
    expect(localStorage.getItem('hub-pos-carol')).toBeNull();
  });
});

describe('useNTWindow drag-to-resize', () => {
  it('a handle drag updates the container size and persists hub-size, clamped to the min', () => {
    const { container } = render(<Harness label="dave" />);
    const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
    const win = container.querySelector('[data-testid="win"]') as HTMLElement;

    // jsdom getBoundingClientRect is 0x0, so startW=startH=0; dragging +300/+200
    // gives clamp(300, 200) = (300, 200) — both above the 200x150 floor.
    mouse(handle, 'mousedown', 0, 0);
    mouse(window, 'mousemove', 300, 200);
    mouse(window, 'mouseup', 300, 200);

    expect(win.style.width).toBe('300px');
    expect(win.style.height).toBe('200px');
    const saved = JSON.parse(localStorage.getItem('hub-size-dave') || 'null');
    expect(saved).toEqual({ width: '300px', height: '200px' });
  });

  it('a handle drag that shrinks below the minimum clamps to 200 x 150', () => {
    const { container } = render(<Harness label="erin" />);
    const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
    const win = container.querySelector('[data-testid="win"]') as HTMLElement;

    mouse(handle, 'mousedown', 0, 0);
    mouse(window, 'mousemove', -500, -500);
    mouse(window, 'mouseup', -500, -500);

    expect(win.style.width).toBe(`${MIN_WIDTH}px`);
    expect(win.style.height).toBe(`${MIN_HEIGHT}px`);
    const saved = JSON.parse(localStorage.getItem('hub-size-erin') || 'null');
    expect(saved).toEqual({ width: `${MIN_WIDTH}px`, height: `${MIN_HEIGHT}px` });
  });

  it('restores a persisted size on mount', () => {
    localStorage.setItem('hub-size-frank', JSON.stringify({ width: '420px', height: '300px' }));
    const { container } = render(<Harness label="frank" />);
    const win = container.querySelector('[data-testid="win"]') as HTMLElement;
    expect(win.style.width).toBe('420px');
    expect(win.style.height).toBe('300px');
  });
});
