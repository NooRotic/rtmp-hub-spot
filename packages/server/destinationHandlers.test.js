import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDestinationHandlers } from './destinationHandlers.js';

// Minimal fake ipcMain that records the handler registered per channel.
const makeIpc = () => {
  const handlers = {};
  return {
    handle: (channel, fn) => { handlers[channel] = fn; },
    invoke: (channel, ...args) => handlers[channel]({}, ...args),
    handlers,
  };
};

const YT = { id: 'yt', name: 'YouTube', url: 'rtmp://x', streamKey: 'k', enabled: true };

function setup({ destinations = [YT], bindings = [] } = {}) {
  const ipc = makeIpc();
  const store = {
    loadDestinations: vi.fn(() => destinations),
    addDestination: vi.fn(),
    removeDestination: vi.fn(),
    updateDestination: vi.fn(),
    loadBindings: vi.fn(() => bindings),
    setBinding: vi.fn(),
    removeBinding: vi.fn(),
    removeBindingsForDestination: vi.fn(),
  };
  const orchestrator = {
    onBindingAdded: vi.fn(),
    onBindingRemoved: vi.fn(),
    onDestinationRemoved: vi.fn(),
  };
  registerDestinationHandlers(ipc, { store, orchestrator });
  return { ipc, store, orchestrator };
}

describe('registerDestinationHandlers', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('registers all destination + bindings channels', () => {
    expect(Object.keys(ctx.ipc.handlers).sort()).toEqual([
      'bindings:list',
      'bindings:remove',
      'bindings:set',
      'destinations:add',
      'destinations:list',
      'destinations:remove',
      'destinations:update',
    ]);
  });

  it('list returns the stored destinations', () => {
    expect(ctx.ipc.invoke('destinations:list')).toEqual([YT]);
    expect(ctx.store.loadDestinations).toHaveBeenCalled();
  });

  it('add / update forward to the store and acknowledge', () => {
    const d = { id: '2', name: 'X' };
    expect(ctx.ipc.invoke('destinations:add', d)).toBe(true);
    expect(ctx.store.addDestination).toHaveBeenCalledWith(d);
    expect(ctx.ipc.invoke('destinations:update', d)).toBe(true);
    expect(ctx.store.updateDestination).toHaveBeenCalledWith(d);
  });

  it('bindings:list returns stored bindings', () => {
    const c = setup({ bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }] });
    expect(c.ipc.invoke('bindings:list')).toEqual([
      { sourceKey: 'grid', destinationId: 'yt', active: true },
    ]);
  });
});

describe('bindings:set routing (G1/G2)', () => {
  it('an ACTIVE binding persists then calls onBindingAdded with the resolved destination', () => {
    const { ipc, store, orchestrator } = setup({ destinations: [YT] });
    const binding = { sourceKey: 'grid', destinationId: 'yt', active: true };
    expect(ipc.invoke('bindings:set', binding)).toBe(true);
    expect(store.setBinding).toHaveBeenCalledWith(binding);
    expect(orchestrator.onBindingAdded).toHaveBeenCalledWith('grid', YT);
    expect(orchestrator.onBindingRemoved).not.toHaveBeenCalled();
  });

  it('an INACTIVE binding persists then calls onBindingRemoved (stops the relay)', () => {
    const { ipc, store, orchestrator } = setup({ destinations: [YT] });
    const binding = { sourceKey: 'grid', destinationId: 'yt', active: false };
    expect(ipc.invoke('bindings:set', binding)).toBe(true);
    expect(store.setBinding).toHaveBeenCalledWith(binding);
    expect(orchestrator.onBindingRemoved).toHaveBeenCalledWith('grid', 'yt');
    expect(orchestrator.onBindingAdded).not.toHaveBeenCalled();
  });
});

describe('bindings:remove routing (G2)', () => {
  it('removes the binding then stops the relay', () => {
    const { ipc, store, orchestrator } = setup();
    expect(ipc.invoke('bindings:remove', { sourceKey: 'grid', destinationId: 'yt' })).toBe(true);
    expect(store.removeBinding).toHaveBeenCalledWith('grid', 'yt');
    expect(orchestrator.onBindingRemoved).toHaveBeenCalledWith('grid', 'yt');
  });
});

describe('destinations:remove cascade (G3)', () => {
  it('removes the destination, cascades its bindings, and stops its relays', () => {
    const { ipc, store, orchestrator } = setup();
    expect(ipc.invoke('destinations:remove', 'yt')).toBe(true);
    expect(store.removeDestination).toHaveBeenCalledWith('yt');
    expect(store.removeBindingsForDestination).toHaveBeenCalledWith('yt');
    expect(orchestrator.onDestinationRemoved).toHaveBeenCalledWith('yt');
  });
});
