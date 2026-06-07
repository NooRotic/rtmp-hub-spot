'use strict';

const defaultStore = require('./destinationStore');

/**
 * Registers the RTMP destination + binding CRUD IPC handlers. Collaborators are
 * injectable so the wiring is unit-testable without the Electron runtime.
 *
 * Binding/destination mutations route through the orchestrator so relays react
 * live: activating a binding on a live source starts its relay (G1); deactivating
 * or removing a binding stops it (G2); deleting a destination cascades its
 * bindings and stops its relays across all sources (G3).
 *
 * @param {import('electron').IpcMain} ipcMain
 * @param {object} deps
 * @param {typeof defaultStore} [deps.store]
 * @param {{onBindingAdded:Function, onBindingRemoved:Function, onDestinationRemoved:Function}} deps.orchestrator
 */
function registerDestinationHandlers(ipcMain, { store = defaultStore, orchestrator } = {}) {
  ipcMain.handle('destinations:list', () => store.loadDestinations());

  ipcMain.handle('destinations:add', (_event, dest) => {
    store.addDestination(dest);
    return true;
  });

  ipcMain.handle('destinations:update', (_event, dest) => {
    store.updateDestination(dest);
    return true;
  });

  // G3 — delete cascade: drop the destination, its bindings, and stop its relays.
  ipcMain.handle('destinations:remove', (_event, id) => {
    store.removeDestination(id);
    store.removeBindingsForDestination(id);
    orchestrator.onDestinationRemoved(id);
    return true;
  });

  ipcMain.handle('bindings:list', () => store.loadBindings());

  // G1/G2 — upsert the binding, then start (active) or stop (inactive) its relay.
  ipcMain.handle('bindings:set', (_event, binding) => {
    store.setBinding(binding);
    if (binding.active) {
      const dest = store.loadDestinations().find((d) => d.id === binding.destinationId);
      if (dest) {
        orchestrator.onBindingAdded(binding.sourceKey, dest);
      } else {
        // Stale binding: destination was removed after this binding was stored. Skip
        // the relay start (the binding gets cleaned up when destinations:remove cascades).
        console.warn(
          '[destinationHandlers] bindings:set: no destination for id',
          binding.destinationId,
        );
      }
    } else {
      orchestrator.onBindingRemoved(binding.sourceKey, binding.destinationId);
    }
    return true;
  });

  // G2 — explicit unbind: drop the binding and stop its relay.
  ipcMain.handle('bindings:remove', (_event, { sourceKey, destinationId }) => {
    store.removeBinding(sourceKey, destinationId);
    orchestrator.onBindingRemoved(sourceKey, destinationId);
    return true;
  });
}

module.exports = { registerDestinationHandlers };
