// src/main/ipc/UpdateIPC.js - update status, check, install, release page
const { BrowserWindow, ipcMain, shell } = require('electron');
const { RELEASES_URL } = require('../services/UpdateService');

class UpdateIPC {
  constructor(updateService) {
    this.updateService = updateService;

    // Every status change goes to every open window.
    updateService.onStatus((status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('update:status', status);
      }
    });

    ipcMain.handle('update:get-status', () => ({ success: true, status: this.updateService.status }));

    ipcMain.handle('update:check', async () => {
      try {
        return { success: true, status: await this.updateService.check() };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('update:install', () => ({ success: this.updateService.install() }));

    // Only ever opens Antler's own releases page.
    ipcMain.handle('update:open-release', async () => {
      const url = this.updateService.status.releaseUrl || RELEASES_URL;
      await shell.openExternal(url.startsWith('https://github.com/Piper260/Antler/') ? url : RELEASES_URL);
      return { success: true };
    });
  }
}

module.exports = UpdateIPC;
