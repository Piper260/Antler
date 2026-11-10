// src/main/ipc/PawchiveIPC.js - Pawchive search and the e621 upgrade finder for Artist/Character Search
const { ipcMain } = require('electron');

const failed = (error) => ({ success: false, message: error.userMessage || error.message, type: error.type || 'unknown-error' });

class PawchiveIPC {
  constructor(pawchiveService, upgradeFinder) {
    this.pawchive = pawchiveService;
    this.finder = upgradeFinder;
    this.setupHandlers();
  }

  setupHandlers() {
    const search = (mode) => async (event, name, options = {}) => {
      try {
        const result = await this.pawchive.search(mode, String(name || ''), options || {});
        return { success: true, ...result };
      } catch (error) {
        console.error(`❌ Pawchive ${mode} search error for ${name}:`, error);
        return failed(error);
      }
    };
    ipcMain.handle('pawchive:search-by-artist', search('artist'));
    ipcMain.handle('pawchive:search-by-character', search('character'));

    ipcMain.handle('pawchive:artist-suggestions', async (event, query, limit = 10) => {
      try {
        return await this.pawchive.artistSuggestions(String(query || ''), limit);
      } catch (error) {
        console.warn('⚠️ Pawchive suggestions failed:', error.message);
        return [];
      }
    });

    ipcMain.handle('pawchive:find-creators', async (event, name, limit = 8) => {
      try {
        return { success: true, creators: await this.pawchive.findCreators(String(name || ''), limit) };
      } catch (error) {
        return failed(error);
      }
    });

    ipcMain.handle('pawchive:get-link', (event, artist) => ({ success: true, link: this.finder.getLink(artist), stats: this.finder.stats() }));
    ipcMain.handle('pawchive:set-link', (event, artist, creator) => ({ success: true, link: this.finder.setLink(artist, creator) }));

    // One run at a time per window; progress goes back on pawchive:upgrade-progress.
    ipcMain.handle('pawchive:find-upgrades', async (event, args = {}) => {
      if (this.finder.running) return { success: false, message: 'Already looking for upgrades', type: 'busy' };
      const send = (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('pawchive:upgrade-progress', progress);
      };
      this.finder.running = this.finder.find({ artist: args.artist, posts: args.posts || [], pages: args.pages }, send);
      try {
        return { success: true, ...(await this.finder.running) };
      } catch (error) {
        console.error('❌ Pawchive upgrade search failed:', error);
        return failed(error);
      } finally {
        this.finder.running = null;
      }
    });

    ipcMain.handle('pawchive:record-decision', (event, postId, hash, answer, distance) => {
      try {
        return { success: true, ...this.finder.recordDecision(String(postId), String(hash), answer, distance), stats: this.finder.stats() };
      } catch (error) {
        return failed(error);
      }
    });
  }
}

module.exports = PawchiveIPC;
