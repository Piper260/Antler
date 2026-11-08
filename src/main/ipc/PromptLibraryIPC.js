// src/main/ipc/PromptLibraryIPC.js - prompts the user saved from the Auto Prompter
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileSafe } = require('../utils/safeWrite');

const MAX_PROMPTS = 500;
const clip = (value, max) => String(value || '').slice(0, max);

class PromptLibraryIPC {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'saved-prompts.json');

    ipcMain.handle('prompts:list', async () => ({ success: true, prompts: this.read() }));

    ipcMain.handle('prompts:save', async (event, entry = {}) => {
      try {
        const prompt = clip(entry.prompt, 20000).trim();
        if (!prompt) throw new Error('Nothing to save');
        const item = {
          id: crypto.randomUUID(),
          name: clip(entry.name, 120).trim() || prompt.slice(0, 60),
          prompt,
          negative: clip(entry.negative, 10000).trim(),
          preset: clip(entry.preset, 40),
          source: clip(entry.source, 200),
          savedAt: new Date().toISOString()
        };
        // Newest first; the oldest go once the list is full.
        const prompts = [item, ...this.read()].slice(0, MAX_PROMPTS);
        await this.write(prompts);
        return { success: true, prompt: item, prompts };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('prompts:delete', async (event, id) => {
      const prompts = this.read().filter((p) => p.id !== id);
      await this.write(prompts);
      return { success: true, prompts };
    });
  }

  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return []; // no file yet, or unreadable: start empty
    }
  }

  async write(prompts) {
    await writeFileSafe(this.file, JSON.stringify(prompts, null, 2));
  }
}

module.exports = PromptLibraryIPC;
