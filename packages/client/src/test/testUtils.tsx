/**
 * Minimal test utilities built on React 18 (client-local) + react-dom/client.
 *
 * Purpose: @testing-library/react lives in the root node_modules (React 19) while
 * the client uses React 18, causing a dual-React-instance error at test time.
 * These helpers replicate the essential render/screen/fireEvent surface without
 * pulling in @testing-library/react at all.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';

// ─── Render ──────────────────────────────────────────────────────────────────

interface RenderResult {
  container: HTMLElement;
  unmount: () => void;
}

const mountedRoots: Array<{ root: Root; el: HTMLElement }> = [];

export function render(ui: ReactElement): RenderResult {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => { root.render(ui); });
  mountedRoots.push({ root, el });
  return {
    container: el,
    unmount() {
      act(() => root.unmount());
      el.remove();
    },
  };
}

/** Call between tests to clean up rendered trees. */
export function cleanup() {
  for (const { root, el } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    el.remove();
  }
}

// ─── DOM query helpers ────────────────────────────────────────────────────────

type Matcher = string | RegExp;

function matchText(text: string, m: Matcher): boolean {
  return typeof m === 'string' ? text.toLowerCase().includes(m.toLowerCase()) : m.test(text);
}

/** All leaf-ish text in a node (trims whitespace). */
function nodeText(el: Element): string {
  return (el.textContent ?? '').trim();
}

function queryAll(selector: string, within: Element = document.body): Element[] {
  return Array.from(within.querySelectorAll(selector));
}

function getByTextImpl(matcher: Matcher, within: Element = document.body): Element | null {
  // Prefer leaf nodes (no element children) whose full textContent matches
  const all = queryAll('*', within);
  const leaf = all.find(el => el.children.length === 0 && matchText(nodeText(el), matcher));
  if (leaf) return leaf;
  // Fall back to any node
  return all.find(el => matchText(nodeText(el), matcher)) ?? null;
}

// ─── screen ──────────────────────────────────────────────────────────────────

function throwNotFound(desc: string): never {
  throw new Error(`Unable to find element: ${desc}`);
}

export const screen = {
  getByText(matcher: Matcher): Element {
    return getByTextImpl(matcher) ?? throwNotFound(`text=${matcher}`);
  },
  queryByText(matcher: Matcher): Element | null {
    return getByTextImpl(matcher);
  },
  getByPlaceholderText(matcher: Matcher): HTMLInputElement {
    const inputs = queryAll('input,textarea') as HTMLInputElement[];
    const found = inputs.find(el => matchText(el.placeholder, matcher));
    if (!found) throwNotFound(`placeholder=${matcher}`);
    return found!;
  },
  getByDisplayValue(value: string): HTMLInputElement {
    const inputs = queryAll('input,textarea,select') as HTMLInputElement[];
    const found = inputs.find(el => el.value === value);
    if (!found) throwNotFound(`display value="${value}"`);
    return found!;
  },
  getByRole(role: string, opts?: { name?: Matcher; hidden?: boolean }): Element {
    let candidates: Element[];
    if (role === 'button') {
      candidates = queryAll('button,[role=button]');
    } else if (role === 'img') {
      candidates = queryAll('img,[role=img],canvas');
    } else {
      candidates = queryAll(`[role=${role}]`);
    }
    if (opts?.name) {
      const name = opts.name;
      candidates = candidates.filter(el => matchText(nodeText(el), name));
    }
    if (!candidates.length) throwNotFound(`role=${role} name=${opts?.name}`);
    return candidates[0];
  },
  queryByRole(role: string, opts?: { name?: Matcher; hidden?: boolean }): Element | null {
    try { return screen.getByRole(role, opts); } catch { return null; }
  },
};

// ─── fireEvent ───────────────────────────────────────────────────────────────

export const fireEvent = {
  click(el: Element) {
    act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  },
  change(el: HTMLElement, eventInit: { target: { value: string } }) {
    act(() => {
      Object.defineProperty(el, 'value', { configurable: true, value: eventInit.target.value });
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  },
  keyDown(el: HTMLElement, eventInit: { key: string }) {
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: eventInit.key, bubbles: true }));
    });
  },
};
