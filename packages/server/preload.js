'use strict';

/**
 * Preload script — the ONLY bridge between the (now isolated, sandboxed,
 * node-integration-free) renderer and the Electron main process.
 *
 * Exposes `window.electron.ipcRenderer` with send/invoke/on/removeListener, but
 * each call is gated by an explicit channel allow-list so the renderer can only
 * reach the IPC surface the app actually uses. This is the contextBridge
 * replacement for the old `window.require('electron').ipcRenderer`.
 *
 * Runs in a sandboxed context: only `electron` (contextBridge, ipcRenderer) is
 * available here — no other Node modules.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Renderer -> main, fire-and-forget.
const SEND_CHANNELS = new Set([
  'telemetry-refresh',
  'stop-recording',
  'open-recordings-dir',
  'window-minimize',
  'window-close',
  'ffmpeg-pipe-start',
  'ffmpeg-pipe-chunk',
  'ffmpeg-pipe-stop',
]);

// Renderer -> main, request/response.
const INVOKE_CHANNELS = new Set([
  'detect-gpu-encoder',
  'start-recording',
  'get-recordings-status',
  'destinations:list',
  'destinations:add',
  'destinations:remove',
  'destinations:update',
  'bindings:list',
  'bindings:set',
  'bindings:remove',
]);

// Main -> renderer events the renderer subscribes to.
const ON_CHANNELS = new Set([
  'ffmpeg-status',
  'ffmpeg-stats',
  'ffmpeg-error',
  'relay-status',
  'relay-stats',
]);

// Maps each renderer listener to the wrapper actually registered on
// ipcRenderer, so removeListener(channel, sameFn) can find and detach it.
const wrappedListeners = new Map(); // listener -> Map<channel, wrapper>

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send(channel, ...args) {
      if (!SEND_CHANNELS.has(channel)) {
        throw new Error(`[preload] blocked ipc.send to disallowed channel: ${channel}`);
      }
      ipcRenderer.send(channel, ...args);
    },

    invoke(channel, ...args) {
      if (!INVOKE_CHANNELS.has(channel)) {
        return Promise.reject(
          new Error(`[preload] blocked ipc.invoke to disallowed channel: ${channel}`),
        );
      }
      return ipcRenderer.invoke(channel, ...args);
    },

    on(channel, listener) {
      if (!ON_CHANNELS.has(channel)) {
        throw new Error(`[preload] blocked ipc.on for disallowed channel: ${channel}`);
      }
      // Drop the (non-cloneable) IpcRendererEvent; pass null in its place so
      // existing renderer handlers keyed as (_, data) keep working unchanged.
      const wrapper = (_event, ...args) => listener(null, ...args);
      let byChannel = wrappedListeners.get(listener);
      if (!byChannel) {
        byChannel = new Map();
        wrappedListeners.set(listener, byChannel);
      }
      byChannel.set(channel, wrapper);
      ipcRenderer.on(channel, wrapper);
    },

    removeListener(channel, listener) {
      const byChannel = wrappedListeners.get(listener);
      const wrapper = byChannel && byChannel.get(channel);
      if (wrapper) {
        ipcRenderer.removeListener(channel, wrapper);
        byChannel.delete(channel);
        if (byChannel.size === 0) wrappedListeners.delete(listener);
      }
    },
  },
});
