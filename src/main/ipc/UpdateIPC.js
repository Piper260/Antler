const { ipcMain, shell } = require('electron');
const { requireWebUrl } = require('../utils/pathGuard');

class UpdateIPC {
  constructor(updateService) {
    this.updateService = updateService;
    this.setupHandlers();
    console.log('🔄 Update IPC handlers registered');
  }

  setupHandlers() {
    // Check for updates manually
    ipcMain.handle('update:check', async () => {
      try {
        const result = await this.updateService.checkForUpdates();
        return { success: true, update: result };
      } catch (error) {
        console.error('❌ Update check failed:', error);
        return { success: false, message: error.message };
      }
    });

    // Test update notification (simulates finding an update)
    ipcMain.handle('update:test-notification', async () => {
      console.log('🧪 Testing update notification...');
      return {
        success: true,
        update: {
          available: true,
          type: 'commit',
          shortHash: 'abc1234',
          message: 'Test update: Added new features and bug fixes',
          date: new Date().toISOString(),
          author: 'Piper260',
          url: 'https://github.com/Piper260/Antler'
        }
      };
    });

    // Open update URL in browser
    ipcMain.handle('update:open-url', async (event, url) => {
      try {
        if (url) {
                    await shell.openExternal(requireWebUrl(url));
          return { success: true };
        }
        return { success: false, message: 'No URL provided' };
      } catch (error) {
        console.error('❌ Failed to open URL:', error);
        return { success: false, message: error.message };
      }
    });
  }
}

module.exports = UpdateIPC;
