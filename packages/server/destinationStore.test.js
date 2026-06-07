import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createDestinationStore } from './destinationStore.js';

// A fake safeStorage that deliberately transforms its input, so the
// "no plaintext on disk" assertion below is meaningful. No electron needed.
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`SS1:${plain}`, 'utf8'),
  decryptString: (buf) => {
    const s = Buffer.from(buf).toString('utf8');
    if (!s.startsWith('SS1:')) throw new Error('bad ciphertext');
    return s.slice(4);
  },
});

const env = { dir: '' };
const newStore = (encryptionAvailable = true) =>
  createDestinationStore({
    getUserDataDir: () => env.dir,
    safeStorage: fakeSafeStorage(encryptionAvailable),
  });

const makeDest = (n, over = {}) => ({
  id: String(n),
  name: `Dest ${n}`,
  url: `rtmp://example/${n}`,
  streamKey: `secret_key_${n}`,
  enabled: n % 2 === 1,
  encoder: 'nvenc',
  ...over,
});

const diskFile = () => path.join(env.dir, 'destinations.json');

describe('destinationStore', () => {
  beforeEach(() => {
    env.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-store-'));
  });

  afterEach(() => {
    fs.rmSync(env.dir, { recursive: true, force: true });
  });

  it('returns [] when nothing has been persisted yet', () => {
    expect(newStore().loadDestinations()).toEqual([]);
  });

  it('persists destinations and reloads them with stream keys decrypted', () => {
    const dests = [makeDest(1), makeDest(2), makeDest(3)];
    const store = newStore();

    store.saveDestinations(dests);

    expect(store.loadDestinations()).toEqual(dests);
  });

  it('never writes stream keys in plaintext to disk', () => {
    const store = newStore();
    store.saveDestinations([makeDest(1), makeDest(2), makeDest(3)]);

    const raw = fs.readFileSync(diskFile(), 'utf8');
    expect(raw).not.toContain('secret_key_1');
    expect(raw).not.toContain('secret_key_2');
    expect(raw).not.toContain('secret_key_3');
  });

  it('refuses to persist (throws) when encryption is unavailable, leaving no file', () => {
    const store = newStore(false);

    expect(() => store.saveDestinations([makeDest(1)])).toThrow(/encryption/i);
    expect(fs.existsSync(diskFile())).toBe(false);
  });

  it('addDestination appends to the persisted list', () => {
    const store = newStore();
    store.saveDestinations([makeDest(1)]);

    store.addDestination(makeDest(2));

    expect(store.loadDestinations().map((d) => d.id)).toEqual(['1', '2']);
  });

  it('removeDestination drops the matching id', () => {
    const store = newStore();
    store.saveDestinations([makeDest(1), makeDest(2), makeDest(3)]);

    store.removeDestination('2');

    expect(store.loadDestinations().map((d) => d.id)).toEqual(['1', '3']);
  });

  it('updateDestination replaces the matching id in place', () => {
    const store = newStore();
    store.saveDestinations([makeDest(1), makeDest(2)]);

    store.updateDestination(makeDest(2, { name: 'Renamed', streamKey: 'new_secret' }));

    const loaded = store.loadDestinations();
    expect(loaded[1].name).toBe('Renamed');
    expect(loaded[1].streamKey).toBe('new_secret');
    expect(loaded.map((d) => d.id)).toEqual(['1', '2']);
  });
});

describe('destinationStore bindings', () => {
  function tmpStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-store-'));
    const store = createDestinationStore({
      getUserDataDir: () => dir,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
    });
    return { store, dir };
  }

  it('returns [] when no bindings file exists', () => {
    const { store } = tmpStore();
    expect(store.loadBindings()).toEqual([]);
  });

  it('upserts a binding by (sourceKey, destinationId)', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: false }); // update
    store.setBinding({ sourceKey: 'grid', destinationId: 'kick', active: true });
    const list = store.loadBindings();
    expect(list).toHaveLength(2);
    expect(list.find((b) => b.destinationId === 'yt').active).toBe(false);
  });

  it('removeBinding drops only the matching (sourceKey, destinationId)', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.setBinding({ sourceKey: 'grid', destinationId: 'kick', active: true });
    store.setBinding({ sourceKey: 'feed-cam', destinationId: 'yt', active: true });

    store.removeBinding('grid', 'yt');

    const ids = store.loadBindings().map((b) => `${b.sourceKey}:${b.destinationId}`).sort();
    expect(ids).toEqual(['feed-cam:yt', 'grid:kick']);
  });

  it('removeBinding is a no-op when nothing matches', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.removeBinding('grid', 'ghost');
    expect(store.loadBindings()).toHaveLength(1);
  });

  it('removeBindingsForDestination drops every binding for that destination across sources', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.setBinding({ sourceKey: 'feed-cam', destinationId: 'yt', active: false });
    store.setBinding({ sourceKey: 'grid', destinationId: 'kick', active: true });

    store.removeBindingsForDestination('yt');

    const list = store.loadBindings();
    expect(list).toEqual([{ sourceKey: 'grid', destinationId: 'kick', active: true }]);
  });
});
