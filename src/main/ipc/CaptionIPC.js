// src/main/ipc/CaptionIPC.js - natural-language captions for a dataset
const { ipcMain } = require('electron');
const { fileURLToPath } = require('url');
const { CaptionService } = require('../services/CaptionService');
const { IMAGE_EXTENSIONS, requireFile } = require('../utils/pathGuard');

const MAX_ITEMS = 20000;

class CaptionIPC {
  constructor(settingsService) {
    this.service = new CaptionService(settingsService);
    this.controller = null;

    ipcMain.handle('captions:models', async () => {
      try {
        return { success: true, models: await this.service.listVisionModels(), host: this.service.host() };
      } catch (error) {
        return { success: false, message: error.message, host: this.service.host() };
      }
    });

    /**
     * items: [{ imagePath (path or file:// URL), tags: string[] }]
     * options: { model, length, mode, trigger, preview }
     * With `preview` nothing is written; the captions come back to show.
     */
    ipcMain.handle('captions:run', async (event, items, options = {}) => {
      if (this.controller) return { success: false, message: 'Captioning is already running' };
      if (!Array.isArray(items) || items.length === 0) return { success: false, message: 'No images to caption' };

      const sender = event.sender;
      const send = (progress) => {
        if (!sender.isDestroyed()) sender.send('captions:progress', progress);
      };
      const { model, length = 'medium', mode = 'sidecar', preview = false } = options;
      const trigger = String(options.trigger || '').trim().slice(0, 100);
      this.controller = new AbortController();
      const { signal } = this.controller;
      const results = [];

      try {
        const list = items.slice(0, MAX_ITEMS);
        for (let i = 0; i < list.length && !signal.aborted; i++) {
          const item = list[i];
          let imagePath;
          try {
            const raw = String(item?.imagePath || '');
            imagePath = requireFile(raw.startsWith('file:') ? fileURLToPath(raw) : raw, IMAGE_EXTENSIONS, 'image');
          } catch (error) {
            results.push({ imagePath: item?.imagePath, error: error.message });
            continue;
          }
          const tags = Array.isArray(item.tags) ? item.tags.map(String).slice(0, 500) : [];
          send({ done: i, total: list.length, current: imagePath });
          try {
            const caption = await this.service.caption({ imagePath, tags, model, length, signal });
            if (!preview) await this.service.write({ imagePath, mode, caption, tags, trigger });
            results.push({ imagePath, caption });
            send({ done: i + 1, total: list.length, current: imagePath, caption });
          } catch (error) {
            if (signal.aborted) break;
            results.push({ imagePath, error: error.message });
            // Ollama down or no model: every image would fail the same way.
            if (/can't reach ollama|not found|choose a vision model/i.test(error.message)) {
              return { success: false, message: error.message, results };
            }
          }
        }
        return { success: true, cancelled: signal.aborted, results };
      } finally {
        this.controller = null;
      }
    });

    ipcMain.handle('captions:cancel', () => {
      this.controller?.abort();
      return { success: true };
    });
  }
}

module.exports = CaptionIPC;
