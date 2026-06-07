import { vi } from 'vitest';
import type { IpcBridge, IpcListener } from '../hooks/useElectronBridge';

/**
 * A fake Electron ipc bridge for hook unit tests. Captures `on` listeners so tests
 * can drive main→renderer events via `emit(channel, ...args)` (the preload delivers
 * them as `listener(null, ...args)`). Pass `invokeImpl` to script invoke() responses
 * (e.g. a stateful store for CRUD hooks); otherwise invoke() resolves undefined and
 * can be overridden per-test with `(ipc.invoke as any).mockResolvedValue(...)`.
 */
export function makeFakeIpc(invokeImpl?: (channel: string, ...args: any[]) => any) {
  const listeners: Record<string, IpcListener[]> = {};
  const ipc = {
    send: vi.fn(),
    invoke: vi.fn(invokeImpl ?? (async () => undefined)),
    on: vi.fn((ch: string, l: IpcListener) => { (listeners[ch] ??= []).push(l); }),
    removeListener: vi.fn((ch: string, l: IpcListener) => {
      listeners[ch] = (listeners[ch] ?? []).filter((x) => x !== l);
    }),
  } as unknown as IpcBridge;
  const emit = (ch: string, ...args: any[]) => (listeners[ch] ?? []).forEach((l) => l(null, ...args));
  return { ipc, emit, listeners };
}
