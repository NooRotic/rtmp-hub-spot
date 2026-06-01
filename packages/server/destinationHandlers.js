'use strict';

const store = require('./destinationStore');

/**
 * Registers the RTMP destination CRUD IPC handlers. Both collaborators are
 * injectable so the wiring can be unit-tested without the Electron runtime.
 *
 * @param {import('electron').IpcMain} ipcMain
 * @param {typeof store} [deps] - destination store (defaults to the real one).
 */
function registerDestinationHandlers(ipcMain, deps = store) {
  ipcMain.handle('destinations:list', () => deps.loadDestinations());

  ipcMain.handle('destinations:add', (_event, dest) => {
    deps.addDestination(dest);
    return true;
  });

  ipcMain.handle('destinations:remove', (_event, id) => {
    deps.removeDestination(id);
    return true;
  });

  ipcMain.handle('destinations:update', (_event, dest) => {
    deps.updateDestination(dest);
    return true;
  });
}

module.exports = { registerDestinationHandlers };
