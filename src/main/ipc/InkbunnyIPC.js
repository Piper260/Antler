// src/main/ipc/InkbunnyIPC.js - Inkbunny search for Artist/Character Search
const { ipcMain } = require('electron');

class InkbunnyIPC {
  constructor(inkbunnyService, settingsService) {
    this.inkbunnyService = inkbunnyService;
    this.settingsService = settingsService;
    this.setupHandlers();
  }

  setupHandlers() {
    const search = (mode) => async (event, name, options = {}) => {
      try {
        const result = await this.inkbunnyService.search(mode, String(name || ''), options || {});
        return { success: true, ...result };
      } catch (error) {
        console.error(`❌ Inkbunny ${mode} search error for ${name}:`, error);
        return { success: false, message: error.userMessage || error.message, type: error.type || 'unknown-error' };
      }
    };

    ipcMain.handle('inkbunny:search-by-artist', search('artist'));
    ipcMain.handle('inkbunny:search-by-character', search('character'));

    ipcMain.handle('inkbunny:artist-suggestions', async (event, query, limit = 10) => {
      try {
        return await this.inkbunnyService.artistSuggestions(String(query || ''), limit);
      } catch (error) {
        console.warn('⚠️ Inkbunny suggestions failed:', error.message);
        return [];
      }
    });

    // The settings form sends the password mask when the saved one is kept.
    ipcMain.handle('inkbunny:test-login', async (event, username, password) => {
      const real = this.settingsService.unmaskSecret('inkbunny.password', password);
      if (!username || !real) return { success: false, message: 'Enter both username and password' };
      return this.inkbunnyService.testLogin(String(username), String(real));
    });
  }
}

module.exports = InkbunnyIPC;
