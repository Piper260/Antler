// src/main/ipc/ModelsIPC.js - model download status, start, cancel, import
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { ModelDownloadService } = require('../services/ModelDownloadService');

class ModelsIPC {
  constructor() {
    this.service = new ModelDownloadService({ targetDir: path.join(app.getPath('userData'), 'models') });

    ipcMain.handle('models:status', () => ({ success: true, ...this.service.status() }));

    ipcMain.handle('models:download', async (event, packIds) => {
      const sender = event.sender;
      const send = (progress) => {
        if (!sender.isDestroyed()) sender.send('models:progress', progress);
      };
      try {
        const result = await this.service.download(packIds, send);
        return { success: true, ...result };
      } catch (error) {
        console.error('❌ Model download error:', error);
        return { success: false, message: error.message };
      }
    });

    // Asks for a folder the user already keeps models in, then copies the
    // matching files in. The folder comes from the system dialog here, never
    // from the renderer.
    ipcMain.handle('models:import', async (event) => {
      const sender = event.sender;
      const send = (progress) => {
        if (!sender.isDestroyed()) sender.send('models:progress', progress);
      };
      try {
        const choice = await dialog.showOpenDialog(BrowserWindow.fromWebContents(sender), {
          title: 'Choose the folder that has your Antler models',
          buttonLabel: 'Use this folder',
          properties: ['openDirectory']
        });
        if (choice.canceled || !choice.filePaths[0]) return { success: true, cancelled: true, picked: false };
        const result = await this.service.importFrom(choice.filePaths[0], send);
        return { success: true, picked: true, ...result };
      } catch (error) {
        console.error('❌ Model import error:', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('models:cancel', () => {
      this.service.cancel();
      return { success: true };
    });

    ipcMain.handle('models:open-folder', async () => {
      const folder = this.service.targetDir;
      fs.mkdirSync(folder, { recursive: true });
      const error = await shell.openPath(folder);
      return error ? { success: false, message: error } : { success: true };
    });
  }
}

module.exports = ModelsIPC;
