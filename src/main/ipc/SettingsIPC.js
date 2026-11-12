// src/main/ipc/SettingsIPC.js - Settings IPC handlers
const { ipcMain } = require('electron');

class SettingsIPC {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.setupHandlers();
    console.log('🔗 Settings IPC handlers registered');
  }

  setupHandlers() {
    // Get all settings
    ipcMain.handle('settings:get-all', async () => {
      try {
                const settings = this.settingsService.redactSecrets(this.settingsService.getAllSettings());
        console.log('📋 Settings requested');
        return { success: true, settings };
      } catch (error) {
        console.error('❌ Error getting settings:', error);
        return { success: false, message: error.message };
      }
    });

    // Get specific setting by path
    ipcMain.handle('settings:get', async (event, path) => {
      try {
                // Read through a redacted copy so a secret, or an object holding one, comes back masked.
        const all = this.settingsService.redactSecrets(this.settingsService.getAllSettings());
        const value = typeof path === 'string' && path ? path.split('.').reduce((obj, key) => obj && obj[key], all) : all;
        console.log(`📋 Setting requested: ${path}`);
        return { success: true, value };
      } catch (error) {
        console.error(`❌ Error getting setting '${path}':`, error);
        return { success: false, message: error.message };
      }
    });

    // Set specific setting by path
    ipcMain.handle('settings:set', async (event, path, value) => {
      try {
                const result = await this.settingsService.set(path, this.settingsService.unmaskSecret(path, value));

        if (!result?.success) {
          throw new Error(result?.message || 'Failed to save setting');
        }

        console.log(`💾 Setting updated: ${path}`);
        return { success: true };
      } catch (error) {
        console.error(`❌ Error setting '${path}':`, error);
        return { success: false, message: error.message };
      }
    });

    // Get E621 credentials
    ipcMain.handle('settings:get-e621-credentials', async () => {
      try {
                const credentials = this.settingsService.getE621Credentials();
        if (credentials.apiKey) credentials.apiKey = this.settingsService.redactSecrets({ e621: { apiKey: credentials.apiKey } }).e621.apiKey;
        // console.log('🔐 E621 credentials requested');
        return { success: true, credentials };
      } catch (error) {
        console.error('❌ Error getting E621 credentials:', error);
        return { success: false, message: error.message };
      }
    });

    // Set E621 credentials
    ipcMain.handle('settings:set-e621-credentials', async (event, username, apiKey) => {
      try {
        const result = await this.settingsService.setE621Credentials(username, apiKey);
        console.log('🔐 E621 credentials updated via IPC');
        return result;
      } catch (error) {
        console.error('❌ Error setting E621 credentials:', error);
        return { success: false, message: error.message };
      }
    });

    // Test E621 credentials
    ipcMain.handle('settings:test-e621-credentials', async (event, username, apiKey) => {
      try {
        console.log('🧪 Testing E621 credentials...');
        const result = await this.settingsService.testE621Credentials(username, apiKey);
        console.log('🧪 E621 credentials test completed:', result.success ? '✅' : '❌');
        return result;
      } catch (error) {
        console.error('❌ Error testing E621 credentials:', error);
        return { success: false, message: error.message };
      }
    });

    // Remove a saved key or password (a blank field keeps it, see unmaskSecrets)
    ipcMain.handle('settings:clear-secret', async (event, secretPath) => {
      try {
        return await this.settingsService.clearSecret(secretPath);
      } catch (error) {
        console.error(`❌ Error clearing '${secretPath}':`, error);
        return { success: false, message: error.message };
      }
    });

    // Save all settings
    ipcMain.handle('settings:save', async (event, newSettings) => {
      try {
                const result = await this.settingsService.saveSettings(this.settingsService.unmaskSecrets(newSettings));
        console.log('💾 Settings saved via IPC');
        return result;
      } catch (error) {
        console.error('❌ Error saving settings:', error);
        return { success: false, message: error.message };
      }
    });

    // Reset settings
    ipcMain.handle('settings:reset', async () => {
      try {
        const result = await this.settingsService.resetSettings();
        console.log('🔄 Settings reset via IPC');
        return result;
      } catch (error) {
        console.error('❌ Error resetting settings:', error);
        return { success: false, message: error.message };
      }
    });

    // Export settings
    ipcMain.handle('settings:export', async () => {
      try {
                // Exports leave secrets out; importing one keeps the saved secrets.
        const exportData = this.settingsService.exportSettings();
        exportData.settings = this.settingsService.redactSecrets(exportData.settings);
        console.log('📤 Settings exported');
        return { success: true, data: exportData };
      } catch (error) {
        console.error('❌ Error exporting settings:', error);
        return { success: false, message: error.message };
      }
    });

    // Import settings
    ipcMain.handle('settings:import', async (event, importData) => {
      try {
                const result = await this.settingsService.importSettings(importData?.settings
          ? { ...importData, settings: this.settingsService.unmaskSecrets(importData.settings) }
          : importData);
        console.log('📥 Settings imported via IPC');
        return result;
      } catch (error) {
        console.error('❌ Error importing settings:', error);
        return { success: false, message: error.message };
      }
    });
  }
}

module.exports = SettingsIPC;