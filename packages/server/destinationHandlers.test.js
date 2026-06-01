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

describe('registerDestinationHandlers', () => {
  let ipc;
  let store;

  beforeEach(() => {
    ipc = makeIpc();
    store = {
      loadDestinations: vi.fn(() => [{ id: '1' }]),
      addDestination: vi.fn(),
      removeDestination: vi.fn(),
      updateDestination: vi.fn(),
    };
    registerDestinationHandlers(ipc, store);
  });

  it('registers all four destination CRUD channels', () => {
    expect(Object.keys(ipc.handlers).sort()).toEqual([
      'destinations:add',
      'destinations:list',
      'destinations:remove',
      'destinations:update',
    ]);
  });

  it('list returns the stored destinations', () => {
    expect(ipc.invoke('destinations:list')).toEqual([{ id: '1' }]);
    expect(store.loadDestinations).toHaveBeenCalledOnce();
  });

  it('add forwards the destination to the store and acknowledges', () => {
    const dest = { id: '2', name: 'X' };
    expect(ipc.invoke('destinations:add', dest)).toBe(true);
    expect(store.addDestination).toHaveBeenCalledWith(dest);
  });

  it('remove forwards the id to the store and acknowledges', () => {
    expect(ipc.invoke('destinations:remove', '2')).toBe(true);
    expect(store.removeDestination).toHaveBeenCalledWith('2');
  });

  it('update forwards the destination to the store and acknowledges', () => {
    const dest = { id: '2', name: 'Y' };
    expect(ipc.invoke('destinations:update', dest)).toBe(true);
    expect(store.updateDestination).toHaveBeenCalledWith(dest);
  });
});
