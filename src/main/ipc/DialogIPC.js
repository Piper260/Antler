const { ipcMain, dialog, BrowserWindow } = require('electron');

class DialogIPC {
  constructor() {
    this.setupHandlers();
    console.log('🔗 Dialog IPC handlers registered');
  }

  setupHandlers() {
    // Open directory dialog
    ipcMain.handle('dialog:open-directory', async () => {
      try {
        const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
          properties: ['openDirectory']
        });
        
        if (result.canceled) {
          return { success: false, path: null };
        }
        
        return {
          success: true,
          path: result.filePaths[0]
        };
        
      } catch (error) {
        console.error('❌ Error opening directory dialog:', error);
        return {
          success: false,
          path: null,
          error: error.message
        };
      }
    });
  }
}

module.exports = DialogIPC;
