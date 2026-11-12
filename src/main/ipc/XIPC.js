// src/main/ipc/XIPC.js - X (Twitter) sign-in and search for Artist/Character Search
const { ipcMain, BrowserWindow } = require('electron');
const { handlesFromUrls } = require('../services/xTimeline');

const failed = (error) => ({ success: false, message: error.userMessage || error.message, type: error.type || 'unknown-error' });

class XIPC {
  constructor(xService, e621Service) {
    this.x = xService;
    this.e621 = e621Service;
    this.setupHandlers();
  }

  setupHandlers() {
    const search = (mode) => async (event, name, options = {}) => {
      const sender = event.sender;
      // New posts and progress go back to the window that searched.
      const onProgress = (progress) => {
        if (!sender.isDestroyed()) sender.send('x:index-progress', progress);
      };
      try {
        const result = await this.x.search(mode, String(name || ''), options || {}, onProgress);
        return { success: true, ...result };
      } catch (error) {
        console.error(`❌ X ${mode} search error for ${name}:`, error);
        return failed(error);
      }
    };
    ipcMain.handle('x:search-by-artist', search('artist'));
    ipcMain.handle('x:search-by-character', search('character'));

    ipcMain.handle('x:status', async () => {
      try {
        return await this.x.status();
      } catch (error) {
        return { signedIn: false };
      }
    });
    ipcMain.handle('x:sign-in', (event) => this.x.signIn(BrowserWindow.fromWebContents(event.sender)));
    ipcMain.handle('x:sign-out', () => this.x.signOut());
    ipcMain.handle('x:stop-index', () => this.x.stopIndex());

    // An e621 artist's X accounts: the one saved for them, and the ones their
    // e621 artist page links to. The lookup failing still returns the saved one.
    ipcMain.handle('x:find-accounts', async (event, artist) => {
      const saved = this.x.getLink(artist);
      try {
        const found = handlesFromUrls(await this.e621.getArtistUrls(String(artist || '')));
        return { success: true, saved, found };
      } catch (error) {
        console.warn('⚠️ e621 artist links failed:', error.message);
        return { success: false, saved, found: [], message: error.userMessage || 'Could not read the artist page on e621' };
      }
    });
    ipcMain.handle('x:set-link', (event, artist, handle) => ({ success: true, link: this.x.setLink(artist, handle) }));
  }
}

module.exports = XIPC;
