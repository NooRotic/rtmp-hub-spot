'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'destinations.json';
const BINDINGS_FILE = 'bindings.json';

/**
 * Creates a destination store bound to its dependencies. Keeps stream keys
 * encrypted on disk via the injected `safeStorage`. Injecting the deps keeps
 * the persistence logic unit-testable without the Electron runtime.
 *
 * @param {object} deps
 * @param {() => string} deps.getUserDataDir - resolves the dir to persist into.
 * @param {{ isEncryptionAvailable(): boolean, encryptString(s: string): Buffer,
 *           decryptString(b: Buffer): string }} deps.safeStorage
 * @returns store with load/save/add/remove/update operations.
 */
function createDestinationStore({ getUserDataDir, safeStorage }) {
  const diskPath = () => path.join(getUserDataDir(), FILE_NAME);

  function loadDestinations() {
    const file = diskPath();
    if (!fs.existsSync(file)) return [];

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    return onDisk.map((dest) => {
      if (!dest.streamKey) return dest;
      const cipher = Buffer.from(dest.streamKey, 'base64');
      return { ...dest, streamKey: safeStorage.decryptString(cipher) };
    });
  }

  function saveDestinations(list) {
    const needsEncryption = list.some((dest) => dest.streamKey);
    if (needsEncryption && !safeStorage.isEncryptionAvailable()) {
      // Non-negotiable: never fall back to writing stream keys in plaintext.
      throw new Error(
        'Cannot persist destinations: OS encryption (safeStorage) is unavailable.',
      );
    }

    const toSave = list.map((dest) => {
      if (!dest.streamKey) return { ...dest };
      const cipher = safeStorage.encryptString(dest.streamKey);
      return { ...dest, streamKey: cipher.toString('base64') };
    });
    fs.writeFileSync(diskPath(), JSON.stringify(toSave, null, 2), 'utf8');
  }

  function addDestination(dest) {
    saveDestinations([...loadDestinations(), dest]);
  }

  function removeDestination(id) {
    saveDestinations(loadDestinations().filter((dest) => dest.id !== id));
  }

  function updateDestination(updated) {
    saveDestinations(
      loadDestinations().map((dest) => (dest.id === updated.id ? updated : dest)),
    );
  }

  const bindingsPath = () => path.join(getUserDataDir(), BINDINGS_FILE);

  function loadBindings() {
    const file = bindingsPath();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function saveBindings(list) {
    fs.writeFileSync(bindingsPath(), JSON.stringify(list, null, 2), 'utf8');
  }

  function setBinding(binding) {
    const list = loadBindings();
    const i = list.findIndex(
      (b) => b.sourceKey === binding.sourceKey && b.destinationId === binding.destinationId,
    );
    if (i >= 0) list[i] = binding;
    else list.push(binding);
    saveBindings(list);
  }

  return {
    loadDestinations,
    saveDestinations,
    addDestination,
    removeDestination,
    updateDestination,
    loadBindings,
    saveBindings,
    setBinding,
  };
}

// Lazily-wired production singleton. We require('electron') only on first use so
// that importing this module outside the Electron runtime (tooling, tests that
// only touch createDestinationStore) never crashes.
let defaultStore = null;
function getDefaultStore() {
  if (!defaultStore) {
    const { app, safeStorage } = require('electron');
    defaultStore = createDestinationStore({
      getUserDataDir: () => app.getPath('userData'),
      safeStorage,
    });
  }
  return defaultStore;
}

module.exports = {
  createDestinationStore,
  loadDestinations: (...args) => getDefaultStore().loadDestinations(...args),
  saveDestinations: (...args) => getDefaultStore().saveDestinations(...args),
  addDestination: (...args) => getDefaultStore().addDestination(...args),
  removeDestination: (...args) => getDefaultStore().removeDestination(...args),
  updateDestination: (...args) => getDefaultStore().updateDestination(...args),
  loadBindings: (...args) => getDefaultStore().loadBindings(...args),
  saveBindings: (...args) => getDefaultStore().saveBindings(...args),
  setBinding: (...args) => getDefaultStore().setBinding(...args),
};
