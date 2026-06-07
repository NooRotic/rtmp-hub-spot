# Multi-Stream UI — Plan 3.1: Dark-NT Foundation (primitives + data helpers)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested, reusable foundation for the dark-NT admin re-skin — design tokens, the `ui/` primitive components, the status→color logic, the clipboard route field, the source-list derivation, and the reserved `WatermarkConfig` type — WITHOUT changing the visible app yet.

**Architecture:** A new self-contained `packages/client/src/ui/` primitives layer (dark-NT look encoded once via `ui/dark-nt.css` + small presentational React components) plus a pure `admin/sources.ts` derivation helper. Logic-bearing pieces (status tone, clipboard copy + host toggle, source union) are TDD'd; presentational primitives get light render tests. Nothing here is wired into `App.tsx` — this is the toolkit Plan 3.2+ consumes, so the running app is byte-for-byte unchanged.

**Tech Stack:** React 18 + TypeScript, Vitest + jsdom, the in-house `test/testUtils` render harness, global CSS (matching the existing `index.css` convention).

**Source of truth:** `docs/superpowers/specs/2026-06-04-multistream-ui-redesign-design.md` §3 (visual language / palette), §5 (component architecture — the `ui/` layer), §6 (source derivation, CopyRouteField), §9 (WatermarkConfig).

**This is Plan 3.1 of 5** (see roadmap in `session-state-2026-06-04-ui-backend-g1g3` memory). It depends on the Plan 2 hooks (already merged on this branch) only at the type level; it adds NO consumer of them yet.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/ui/dark-nt.css` | Create | Dark-NT design tokens (CSS vars) + primitive classes (`.ntd-window`, `.ntd-btn`, `.ntd-field`, `.ntd-dot`, `.ntd-tag`, `.ntd-copy`). The dark look, encoded once. |
| `packages/client/src/main.tsx` | Modify | Import `./ui/dark-nt.css` (loads the tokens; harmless until consumed). |
| `packages/client/src/ui/toneFor.ts` | Create | Pure `toneFor(state) → Tone` mapping (relay/ffmpeg states → live/warn/error/idle). |
| `packages/client/src/ui/toneFor.test.ts` | Create | Mapping table. |
| `packages/client/src/ui/StatusDot.tsx` | Create | A colored status dot (`<StatusDot state>`). |
| `packages/client/src/ui/StatusTag.tsx` | Create | Dot + text label, redundant color encoding (`<StatusTag state label?>`). |
| `packages/client/src/ui/StatusTag.test.tsx` | Create | Renders label + tone class/data-tone. |
| `packages/client/src/ui/NTWindow.tsx` | Create | Dark beveled window w/ optional navy title bar. |
| `packages/client/src/ui/NTButton.tsx` | Create | Beveled button + `.go` (green) variant. |
| `packages/client/src/ui/NTField.tsx` | Create | Dark inset input w/ white highlight edge + status-colored border. |
| `packages/client/src/ui/primitives.test.tsx` | Create | Render tests for NTWindow/NTButton/NTField. |
| `packages/client/src/ui/CopyRouteField.tsx` | Create | One-click copy of `rtmp://{host}:1935/live/{key}` + `localhost ⇄ LAN` toggle + "copied!" flash. |
| `packages/client/src/ui/CopyRouteField.test.tsx` | Create | Clipboard write, URL shape, host toggle, copied feedback. |
| `packages/client/src/admin/sources.ts` | Create | Pure `deriveSources(serverStatus, bindings) → SourceRow[]` (union of live + bound). |
| `packages/client/src/admin/sources.test.ts` | Create | Union, isLive flag, offline-but-bound, empty. |
| `packages/shared/index.ts` | Modify | Reserve `WatermarkConfig` + `EncodeOverride.watermark?`. |

**Unchanged on purpose:** `App.tsx` and every existing component — this plan adds a toolkit, it does not wire it in. The running app stays identical.

---

### Task 1: Dark-NT tokens + primitive CSS

**Files:**
- Create: `packages/client/src/ui/dark-nt.css`
- Modify: `packages/client/src/main.tsx` (add the import)

There's no unit test for raw CSS; correctness is verified by the build staying clean and by the primitive render tests in later tasks asserting the class names. The visual look is eyeballed once Plan 3.2 renders these.

- [ ] **Step 1: Create the stylesheet**

Create `packages/client/src/ui/dark-nt.css` with the palette from spec §3:

```css
/* Dark-mode NT primitives. The dark look encoded once; components reference these
   classes/vars. Scoped under .ntd so it never bleeds into the legacy light theme. */
.ntd {
  --ntd-face: #2b2b2b;
  --ntd-face-2: #232323;
  --ntd-hi: #585858;        /* top-left bevel highlight */
  --ntd-sh: #0a0a0a;        /* bottom-right bevel shadow */
  --ntd-field: #141414;     /* inset field bg */
  --ntd-text: #e6e6e6;
  --ntd-text-dim: #9a9a9a;
  --ntd-navy-a: #000064;
  --ntd-navy-b: #0a59b0;
  --ntd-live: #2ee06a;
  --ntd-warn: #f0a020;
  --ntd-error: #ff4d4d;
  --ntd-idle: #555555;
  --ntd-go: #1f7a3f;
  --ntd-go-hi: #2ee06a;
  --ntd-font: "Tahoma", "MS Sans Serif", sans-serif;

  background: var(--ntd-face);
  color: var(--ntd-text);
  font-family: var(--ntd-font);
}

/* Window: light top-left highlight + dark bottom-right shadow + drop shadow. */
.ntd-window {
  background: var(--ntd-face);
  box-shadow:
    inset 1px 1px var(--ntd-hi),
    inset -1px -1px var(--ntd-sh),
    2px 2px 6px rgba(0, 0, 0, 0.55);
  padding: 2px;
}
.ntd-window__title {
  background: linear-gradient(90deg, var(--ntd-navy-a), var(--ntd-navy-b));
  color: #fff;
  font-weight: bold;
  padding: 3px 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ntd-window__body { padding: 10px; }

/* Button: beveled. .ntd-btn--go is the green primary (copy actions). */
.ntd-btn {
  background: var(--ntd-face);
  color: var(--ntd-text);
  border-top: 2px solid var(--ntd-hi);
  border-left: 2px solid var(--ntd-hi);
  border-right: 2px solid var(--ntd-sh);
  border-bottom: 2px solid var(--ntd-sh);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  outline: none;
}
.ntd-btn:active {
  border-top: 2px solid var(--ntd-sh);
  border-left: 2px solid var(--ntd-sh);
  border-right: 2px solid var(--ntd-hi);
  border-bottom: 2px solid var(--ntd-hi);
  padding: 5px 9px 3px 11px;
}
.ntd-btn--go {
  background: var(--ntd-go);
  border-top-color: var(--ntd-go-hi);
  border-left-color: var(--ntd-go-hi);
  color: #fff;
  font-weight: bold;
}
.ntd-btn:disabled { opacity: 0.45; cursor: default; }

/* Field: dark inset, white inner highlight edge, 2px status-colored border. */
.ntd-field {
  background: var(--ntd-field);
  color: var(--ntd-text);
  box-shadow: inset 1px 1px rgba(255, 255, 255, 0.55);
  border: 2px solid var(--ntd-idle);
  padding: 4px 6px;
  font-family: var(--ntd-font);
  font-size: 12px;
}
.ntd-field--live { border-color: var(--ntd-live); }
.ntd-field--warn { border-color: var(--ntd-warn); }
.ntd-field--error { border-color: var(--ntd-error); }
.ntd-field--idle { border-color: var(--ntd-idle); }

/* Status dot + tag — redundant encoding (color + dot + text) per spec §3. */
.ntd-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: var(--ntd-idle); }
.ntd-dot--live { background: var(--ntd-live); box-shadow: 0 0 4px var(--ntd-live); }
.ntd-dot--warn { background: var(--ntd-warn); }
.ntd-dot--error { background: var(--ntd-error); }
.ntd-dot--idle { background: var(--ntd-idle); }

.ntd-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: bold;
  border: 2px solid var(--ntd-idle);
  background: var(--ntd-face-2);
}
.ntd-tag--live { border-color: var(--ntd-live); color: var(--ntd-live); }
.ntd-tag--warn { border-color: var(--ntd-warn); color: var(--ntd-warn); }
.ntd-tag--error { border-color: var(--ntd-error); color: var(--ntd-error); }
.ntd-tag--idle { border-color: var(--ntd-idle); color: var(--ntd-text-dim); }

/* Copy-route field. */
.ntd-copy { display: inline-flex; align-items: center; gap: 6px; }
.ntd-copy__url {
  background: var(--ntd-field);
  color: var(--ntd-text);
  box-shadow: inset 1px 1px rgba(255, 255, 255, 0.4);
  border: 1px solid var(--ntd-sh);
  padding: 3px 6px;
  font-family: "Consolas", "Courier New", monospace;
  font-size: 12px;
  user-select: all;
}
.ntd-copy__toggle { font-size: 11px; color: var(--ntd-text-dim); cursor: pointer; }
.ntd-copy__copied { color: var(--ntd-live); font-size: 11px; font-weight: bold; }
```

- [ ] **Step 2: Import it once**

Read `packages/client/src/main.tsx` and find where `index.css` is imported (e.g. `import './index.css'`). Add directly below it:

```ts
import './ui/dark-nt.css';
```

(If `main.tsx` does not import `index.css`, search for the entry that does — likely `main.tsx` or `App.tsx` — and add the import next to it. Importing an unused stylesheet is harmless.)

- [ ] **Step 3: Build to verify the CSS is valid + bundled**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 4: Confirm the running app is unchanged**

Run: `npm run test -w client`
Expected: PASS — 0 failures (no component uses these classes yet, so nothing changed).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/dark-nt.css packages/client/src/main.tsx
git commit -m "feat(ui): dark-NT design tokens + primitive stylesheet (unused toolkit)"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: `toneFor` status mapping

**Files:**
- Create: `packages/client/src/ui/toneFor.ts`
- Create: `packages/client/src/ui/toneFor.test.ts`

**Context:** The relay/ffmpeg/binding states (`live`, `connecting`, `starting`, `reconnecting`, `error`, `stopped`, `idle`, …) collapse to four UI tones matching the spec §3 palette: `live` (green), `warn` (amber), `error` (red), `idle` (grey). This is the single source for status→color across every primitive.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/toneFor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toneFor } from './toneFor';

describe('toneFor', () => {
  it('maps live/running to live', () => {
    expect(toneFor('live')).toBe('live');
    expect(toneFor('running')).toBe('live');
  });
  it('maps in-progress states to warn', () => {
    expect(toneFor('connecting')).toBe('warn');
    expect(toneFor('starting')).toBe('warn');
    expect(toneFor('reconnecting')).toBe('warn');
  });
  it('maps error to error', () => {
    expect(toneFor('error')).toBe('error');
  });
  it('maps idle/stopped/unknown to idle', () => {
    expect(toneFor('idle')).toBe('idle');
    expect(toneFor('stopped')).toBe('idle');
    expect(toneFor('whatever')).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- toneFor`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/client/src/ui/toneFor.ts`:

```ts
export type Tone = 'live' | 'warn' | 'error' | 'idle';

/**
 * Collapse any relay/ffmpeg/binding state string to one of four UI tones
 * (single source of status→color for the dark-NT primitives, spec §3).
 */
export function toneFor(state: string): Tone {
  switch (state) {
    case 'live':
    case 'running':
      return 'live';
    case 'connecting':
    case 'starting':
    case 'reconnecting':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return 'idle'; // idle, stopped, disabled, unknown
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- toneFor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/toneFor.ts packages/client/src/ui/toneFor.test.ts
git commit -m "feat(ui): toneFor status→tone mapping (single source of status color)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 3: `StatusDot` + `StatusTag`

**Files:**
- Create: `packages/client/src/ui/StatusDot.tsx`
- Create: `packages/client/src/ui/StatusTag.tsx`
- Create: `packages/client/src/ui/StatusTag.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/StatusTag.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '../test/testUtils';
import { StatusTag } from './StatusTag';

afterEach(cleanup);

describe('StatusTag', () => {
  it('renders the label and a live tone for a live state', () => {
    const { container } = render(<StatusTag state="live" label="On Air" />);
    expect(screen.getByText('On Air')).toBeTruthy();
    const tag = container.querySelector('.ntd-tag')!;
    expect(tag.classList.contains('ntd-tag--live')).toBe(true);
    expect(tag.getAttribute('data-tone')).toBe('live');
  });

  it('falls back to the raw state as label and maps error→error tone', () => {
    const { container } = render(<StatusTag state="error" />);
    expect(screen.getByText('error')).toBeTruthy();
    const tag = container.querySelector('.ntd-tag')!;
    expect(tag.classList.contains('ntd-tag--error')).toBe(true);
  });

  it('maps connecting→warn tone', () => {
    const { container } = render(<StatusTag state="connecting" label="Connecting" />);
    expect(container.querySelector('.ntd-tag')!.classList.contains('ntd-tag--warn')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- StatusTag`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement both**

Create `packages/client/src/ui/StatusDot.tsx`:

```tsx
import { toneFor } from './toneFor';

/** A small colored status dot. `state` is any relay/ffmpeg/binding state string. */
export function StatusDot({ state }: { state: string }) {
  const tone = toneFor(state);
  return <span className={`ntd-dot ntd-dot--${tone}`} data-tone={tone} aria-hidden="true" />;
}
```

Create `packages/client/src/ui/StatusTag.tsx`:

```tsx
import { toneFor } from './toneFor';

/**
 * Status pill with redundant encoding (border color + dot + text label) for
 * at-a-glance reading and color-vision accessibility (spec §3). Falls back to the
 * raw state string when no label is given.
 */
export function StatusTag({ state, label }: { state: string; label?: string }) {
  const tone = toneFor(state);
  return (
    <span className={`ntd-tag ntd-tag--${tone}`} data-tone={tone}>
      <span className={`ntd-dot ntd-dot--${tone}`} aria-hidden="true" />
      {label ?? state}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- StatusTag`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/StatusDot.tsx packages/client/src/ui/StatusTag.tsx packages/client/src/ui/StatusTag.test.tsx
git commit -m "feat(ui): StatusDot + StatusTag (redundant status encoding)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: `NTWindow` + `NTButton` + `NTField`

**Files:**
- Create: `packages/client/src/ui/NTWindow.tsx`
- Create: `packages/client/src/ui/NTButton.tsx`
- Create: `packages/client/src/ui/NTField.tsx`
- Create: `packages/client/src/ui/primitives.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/primitives.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { NTWindow } from './NTWindow';
import { NTButton } from './NTButton';
import { NTField } from './NTField';

afterEach(cleanup);

describe('NTWindow', () => {
  it('renders a title bar when title is given and always renders children', () => {
    const { container } = render(<NTWindow title="Sources">body text</NTWindow>);
    expect(container.querySelector('.ntd-window__title')!.textContent).toContain('Sources');
    expect(screen.getByText('body text')).toBeTruthy();
  });
  it('omits the title bar when no title', () => {
    const { container } = render(<NTWindow>only body</NTWindow>);
    expect(container.querySelector('.ntd-window__title')).toBeNull();
  });
});

describe('NTButton', () => {
  it('fires onClick and adds the go class for the primary variant', () => {
    const onClick = vi.fn();
    const { container } = render(<NTButton go onClick={onClick}>Copy</NTButton>);
    const btn = container.querySelector('button')!;
    expect(btn.classList.contains('ntd-btn--go')).toBe(true);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('is a plain beveled button without go', () => {
    const { container } = render(<NTButton>Plain</NTButton>);
    expect(container.querySelector('button')!.classList.contains('ntd-btn--go')).toBe(false);
  });
});

describe('NTField', () => {
  it('applies the status tone border class and forwards value', () => {
    const { container } = render(<NTField tone="error" value="bad" readOnly />);
    const input = container.querySelector('input')!;
    expect(input.classList.contains('ntd-field--error')).toBe(true);
    expect(input.value).toBe('bad');
  });
  it('defaults to idle tone', () => {
    const { container } = render(<NTField value="x" readOnly />);
    expect(container.querySelector('input')!.classList.contains('ntd-field--idle')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- primitives`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the three primitives**

Create `packages/client/src/ui/NTWindow.tsx`:

```tsx
import type { ReactNode } from 'react';

/** Dark-NT beveled window with an optional navy title bar. */
export function NTWindow({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ntd-window${className ? ` ${className}` : ''}`}>
      {title != null && <div className="ntd-window__title">{title}</div>}
      <div className="ntd-window__body">{children}</div>
    </div>
  );
}
```

Create `packages/client/src/ui/NTButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Beveled dark-NT button. `go` = green primary variant (used for copy actions). */
export function NTButton({
  go,
  children,
  className,
  ...rest
}: { go?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`ntd-btn${go ? ' ntd-btn--go' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
```

Create `packages/client/src/ui/NTField.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react';
import type { Tone } from './toneFor';

/** Dark inset input with a white highlight edge and a status-colored border. */
export function NTField({
  tone = 'idle',
  className,
  ...rest
}: { tone?: Tone } & InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ntd-field ntd-field--${tone}${className ? ` ${className}` : ''}`} {...rest} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- primitives`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/NTWindow.tsx packages/client/src/ui/NTButton.tsx packages/client/src/ui/NTField.tsx packages/client/src/ui/primitives.test.tsx
git commit -m "feat(ui): NTWindow + NTButton + NTField dark-NT primitives"
```
(+ `Co-Authored-By` trailer.)

---

### Task 5: `CopyRouteField` (the #1 priority — effortless route copy)

**Files:**
- Create: `packages/client/src/ui/CopyRouteField.tsx`
- Create: `packages/client/src/ui/CopyRouteField.test.tsx`

**Context:** Spec D3/§6 — copying the hub's own RTMP ingest route must be a first-class, one-click action. This field shows `rtmp://{host}:1935/live/{streamKey}`, copies it to the clipboard with a "copied!" flash, and has a `localhost ⇄ LAN` toggle (local OBS uses loopback; a LAN device uses the LAN IP). The pure `buildRouteUrl` is exported for reuse.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/CopyRouteField.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { CopyRouteField, buildRouteUrl } from './CopyRouteField';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe('buildRouteUrl', () => {
  it('builds the RTMP ingest URL', () => {
    expect(buildRouteUrl('127.0.0.1', 'grid')).toBe('rtmp://127.0.0.1:1935/live/grid');
    expect(buildRouteUrl('10.0.0.5', 'feed-cam', 1936)).toBe('rtmp://10.0.0.5:1936/live/feed-cam');
  });
});

describe('CopyRouteField', () => {
  it('defaults to loopback and copies that URL on click', async () => {
    const { container } = render(<CopyRouteField streamKey="grid" lanIp="10.0.0.5" />);
    expect(container.querySelector('.ntd-copy__url')!.textContent).toBe('rtmp://127.0.0.1:1935/live/grid');
    await act(async () => { fireEvent.click(screen.getByText(/copy/i)); });
    expect(writeText).toHaveBeenCalledWith('rtmp://127.0.0.1:1935/live/grid');
  });

  it('toggles to the LAN IP and copies that instead', async () => {
    const { container } = render(<CopyRouteField streamKey="grid" lanIp="10.0.0.5" />);
    await act(async () => { fireEvent.click(screen.getByText(/LAN/i)); });
    expect(container.querySelector('.ntd-copy__url')!.textContent).toBe('rtmp://10.0.0.5:1935/live/grid');
    await act(async () => { fireEvent.click(screen.getByText(/copy/i)); });
    expect(writeText).toHaveBeenCalledWith('rtmp://10.0.0.5:1935/live/grid');
  });

  it('shows a copied! flash after copying', async () => {
    render(<CopyRouteField streamKey="grid" lanIp="10.0.0.5" />);
    await act(async () => { fireEvent.click(screen.getByText(/copy/i)); });
    expect(screen.queryByText(/copied/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- CopyRouteField`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/client/src/ui/CopyRouteField.tsx`:

```tsx
import { useState } from 'react';

/** `rtmp://{host}:{port}/live/{streamKey}` — the hub's RTMP ingest route. */
export function buildRouteUrl(host: string, streamKey: string, port = 1935): string {
  return `rtmp://${host}:${port}/live/${streamKey}`;
}

type HostMode = 'local' | 'lan';

/**
 * One-click copy of the hub's RTMP ingest route (spec D3/§6). `local` resolves to
 * loopback (OBS on this machine); `lan` resolves to the provided LAN IP (a device
 * on the network). Shows a transient "copied!" confirmation.
 */
export function CopyRouteField({
  streamKey,
  lanIp,
  port = 1935,
}: {
  streamKey: string;
  lanIp?: string;
  port?: number;
}) {
  const [mode, setMode] = useState<HostMode>('local');
  const [copied, setCopied] = useState(false);

  const host = mode === 'lan' ? lanIp || '127.0.0.1' : '127.0.0.1';
  const url = buildRouteUrl(host, streamKey, port);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — no-op; the URL is selectable for manual copy */
    }
  };

  return (
    <span className="ntd-copy">
      <code className="ntd-copy__url">{url}</code>
      <button className="ntd-btn ntd-btn--go" onClick={copy}>Copy</button>
      {lanIp && (
        <button
          className="ntd-copy__toggle"
          onClick={() => setMode((m) => (m === 'local' ? 'lan' : 'local'))}
        >
          {mode === 'local' ? 'use LAN' : 'use localhost'}
        </button>
      )}
      {copied && <span className="ntd-copy__copied">copied!</span>}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- CopyRouteField`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/CopyRouteField.tsx packages/client/src/ui/CopyRouteField.test.tsx
git commit -m "feat(ui): CopyRouteField — one-click RTMP route copy + localhost/LAN toggle"
```
(+ `Co-Authored-By` trailer.)

---

### Task 6: `deriveSources` (source-list derivation)

**Files:**
- Create: `packages/client/src/admin/sources.ts`
- Create: `packages/client/src/admin/sources.test.ts`

**Context:** Spec §6 — the source list is `union(serverStatus.rtmpPublishers' keys, distinct sourceKeys in bindings)`. The union lets a source be **pre-wired while offline** (a binding exists) and still surfaces anything currently publishing. Each row carries an `isLive` flag (is it in the publisher set right now).

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/admin/sources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveSources } from './sources';
import type { DestinationBinding } from '../../../shared';

const status = (keys: string[]) => ({ rtmpPublishers: keys.map((streamKey) => ({ streamKey })) });
const binding = (sourceKey: string): DestinationBinding => ({ sourceKey, destinationId: 'd', active: true });

describe('deriveSources', () => {
  it('unions live publishers and bound sources, flagging liveness', () => {
    const rows = deriveSources(status(['grid']), [binding('grid'), binding('feed-cam')]);
    const byKey = Object.fromEntries(rows.map((r) => [r.sourceKey, r.isLive]));
    expect(Object.keys(byKey).sort()).toEqual(['feed-cam', 'grid']);
    expect(byKey['grid']).toBe(true);      // publishing now
    expect(byKey['feed-cam']).toBe(false); // pre-wired, offline
  });

  it('includes a publishing source with no binding', () => {
    const rows = deriveSources(status(['grid']), []);
    expect(rows).toEqual([{ sourceKey: 'grid', isLive: true }]);
  });

  it('deduplicates a source that is both live and bound', () => {
    const rows = deriveSources(status(['grid']), [binding('grid'), binding('grid')]);
    expect(rows).toEqual([{ sourceKey: 'grid', isLive: true }]);
  });

  it('returns [] for null status and no bindings', () => {
    expect(deriveSources(null, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- admin/sources`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/client/src/admin/sources.ts`:

```ts
import type { DestinationBinding } from '../../../shared';

/** Minimal shape this helper needs from serverStatus (avoids importing the full type). */
export interface ServerStatusLike {
  rtmpPublishers?: { streamKey: string }[];
}

export interface SourceRow {
  sourceKey: string;
  isLive: boolean;
}

/**
 * Union of currently-publishing source keys and any source referenced by a binding
 * (spec §6). isLive = present in the publisher set right now. The union surfaces
 * pre-wired-but-offline sources alongside live ones.
 */
export function deriveSources(
  serverStatus: ServerStatusLike | null,
  bindings: DestinationBinding[],
): SourceRow[] {
  const live = new Set((serverStatus?.rtmpPublishers ?? []).map((p) => p.streamKey));
  const keys = new Set<string>([...live, ...bindings.map((b) => b.sourceKey)]);
  return [...keys].map((sourceKey) => ({ sourceKey, isLive: live.has(sourceKey) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- admin/sources`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/sources.ts packages/client/src/admin/sources.test.ts
git commit -m "feat(admin): deriveSources — union of live publishers + bound sources"
```
(+ `Co-Authored-By` trailer.)

---

### Task 7: Reserve `WatermarkConfig` in shared types

**Files:**
- Modify: `packages/shared/index.ts`

**Context:** Spec §9 (R2 resolved) — the MVP only *reserves* the watermark data model; rendering is deferred to the Pro transcode milestone. Add `WatermarkConfig` and an optional `watermark` on `EncodeOverride`. No logic consumes it yet (Plan 3.4 ships the locked Pro toggle; actual render is a later Pro milestone).

- [ ] **Step 1: Add the types**

In `packages/shared/index.ts`, add `WatermarkConfig` immediately above the existing `EncodeOverride` interface:

```ts
/**
 * PRO (later): a per-destination brand/logo overlay. Reserved now (R2); rendering
 * requires decode→overlay→re-encode, so it ships with the Pro transcode milestone,
 * not under the Free `-c copy` relay.
 */
export interface WatermarkConfig {
  /** Text mark (e.g. "RTMP Hub"); used when logoPath is absent. */
  text?: string;
  /** Path to a logo image to overlay. */
  logoPath?: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** 0..1; defaults applied at render time. */
  opacity?: number;
}
```

Then add a `watermark?` field to the existing `EncodeOverride` interface (it currently has `bitrate?`, `resolution?`, `fps?`):

```ts
export interface EncodeOverride {
  bitrate?: string;
  resolution?: string;
  fps?: number;
  /** PRO: per-destination watermark overlay. Reserved; not rendered under Free -c copy. */
  watermark?: WatermarkConfig;
}
```

- [ ] **Step 2: Verify nothing broke (types are additive)**

Run: `npm run test -w server`
Expected: PASS — server suite still green (the new optional fields are additive; existing code is unaffected).

Run: `npm run build`
Expected: completes without error (client + shared type-check clean).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/index.ts
git commit -m "feat(shared): reserve WatermarkConfig + EncodeOverride.watermark (Pro, R2)"
```
(+ `Co-Authored-By` trailer.)

---

## Self-Review

**Spec coverage (this sub-plan's slice of §3/§5/§6/§9):**
- Dark-NT visual language / palette (§3) → Task 1 tokens + Tasks 3–5 primitives. ✅
- `ui/` primitives `NTWindow · NTField · NTButton · StatusDot · StatusTag · CopyRouteField` (§5) → Tasks 3, 4, 5. ✅
- Status redundant encoding (border + dot + text) (§3) → StatusTag (Task 3). ✅
- Copy-route first-class + `localhost ⇄ LAN` toggle (D3/§6) → CopyRouteField (Task 5). ✅
- Source-list derivation `union(publishers, bindings)` (§6) → deriveSources (Task 6). ✅
- `WatermarkConfig` reservation (§9/R2) → Task 7. ✅

**Deferred to later sub-plans (NOT gaps):** `AdminDataProvider`/`useAdminData`, `AdminWorkspace`, `ServerStatusBar`, tab routing → 3.2. `PreviewMonitor`, `ClientsPanel`, `SourcesAndRoutes`, `SourceCard`, `DestinationRow` → 3.3. Destinations/Recordings/Settings tabs + locked Pro toggle → 3.4. `ClientPortal` extraction + slim App → 3.5. Actual watermark *rendering* → Pro transcode milestone.

**Placeholder scan:** none — every step has full file content; Task 1 Step 2 flags a "find the existing CSS import" check rather than guessing the line.

**Type/name consistency:** `Tone` (Task 2) is consumed by `NTField` (Task 4) and the `.ntd-*--{tone}` classes (Task 1) — the four tone names (`live`/`warn`/`error`/`idle`) match across `toneFor.ts`, the CSS classes, and the components. `buildRouteUrl` (Task 5) signature matches its test. `SourceRow`/`deriveSources` (Task 6) match their test. `WatermarkConfig`/`EncodeOverride.watermark` (Task 7) reuse the shared contract. Every CSS class a component references (`ntd-window`, `ntd-btn`, `ntd-btn--go`, `ntd-field`, `ntd-field--{tone}`, `ntd-dot--{tone}`, `ntd-tag--{tone}`, `ntd-copy*`) is defined in Task 1's stylesheet.
