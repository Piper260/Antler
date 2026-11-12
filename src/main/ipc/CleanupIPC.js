const { ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const ComicVisionService = require('../services/ComicVisionService');
const comfy = require('../services/comfyCleanup');
const { paint } = require('../services/bubbleMask');
const { findModelFile } = require('../utils/modelPaths');
const { findTagger } = require('../utils/taggers');
const { IMAGE_EXTENSIONS, requireFile } = require('../utils/pathGuard');
const { writeFileSafe } = require('../utils/safeWrite');

const BUBBLE_MODEL_FILE = path.join('comic', 'comic-bubbles.onnx');
const MAX_MASK_BYTES = 64 * 1024 * 1024;

/**
 * Image Cleanup: masks over speech bubbles and the like, repaired by Flux
 * Fill on a ComfyUI server (services/comfyCleanup.js). Bubble finding runs
 * in the comic vision worker.
 */
class CleanupIPC {
  constructor() {
    this.vision = new ComicVisionService();
    this.runs = new Map(); // filePath -> AbortController
    this._setupHandlers();
    console.log('🔗 Image Cleanup IPC handlers registered');
  }

  async _size(filePath) {
    const { autoOrient } = await sharp(filePath, { limitInputPixels: false }).metadata();
    return autoOrient;
  }

  async _readMask(filePath, width, height) {
    try {
      const { data, info } = await sharp(await fs.readFile(comfy.maskPath(filePath))).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
      if (info.width === width && info.height === height) return data;
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('❌ Cleanup mask read error:', error);
    }
    return null;
  }

  async _writeMask(filePath, mask, width, height) {
    await fs.mkdir(comfy.cleanupDir(filePath), { recursive: true });
    await writeFileSafe(comfy.maskPath(filePath), await sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } }).png().toBuffer());
  }

  _setupHandlers() {
    const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
      try {
        return { success: true, ...await fn(event, ...args) };
      } catch (error) {
        console.error(`❌ ${channel} error:`, error);
        return { success: false, message: error.message || String(error) };
      }
    });

    handle('cleanup:status', async () => ({ bubbleModel: Boolean(findModelFile(BUBBLE_MODEL_FILE)) }));

    handle('cleanup:check-server', async (event, url, models) => comfy.checkServer(url, models));

    handle('cleanup:state', async (event, filePaths) => {
      if (!Array.isArray(filePaths)) throw new Error('Invalid file list');
      const states = {};
      for (const filePath of filePaths.slice(0, 20000)) states[filePath] = await comfy.imageState(requireFile(filePath, IMAGE_EXTENSIONS, 'image'));
      return { states };
    });

    handle('cleanup:load-mask', async (event, filePath) => {
      requireFile(filePath, IMAGE_EXTENSIONS, 'image');
      try {
        return { data: await fs.readFile(comfy.maskPath(filePath)) };
      } catch (error) {
        if (error.code === 'ENOENT') return { data: null };
        throw error;
      }
    });

    handle('cleanup:save-mask', async (event, filePath, png) => {
      requireFile(filePath, IMAGE_EXTENSIONS, 'image');
      if (!png || png.byteLength > MAX_MASK_BYTES) throw new Error('Invalid mask');
      const { width, height } = await this._size(filePath);
      const { data, info } = await sharp(Buffer.from(png)).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
      if (info.width !== width || info.height !== height) throw new Error('Mask size does not match the image');
      if (!data.some(v => v > 127)) {
        await fs.rm(comfy.maskPath(filePath), { force: true });
        return { marked: false };
      }
      await this._writeMask(filePath, data, width, height);
      return { marked: true };
    });

    // Adds every bubble found to the image's saved mask.
    handle('cleanup:find-bubbles', async (event, filePath, options = {}) => {
      requireFile(filePath, IMAGE_EXTENSIONS, 'image');
      const modelPath = findModelFile(BUBBLE_MODEL_FILE);
      if (!modelPath) throw new Error('The bubble model (resources/models/comic/comic-bubbles.onnx) was not found');
      const { width, height, regions } = await this.vision.run('bubbles', {
        inputPath: filePath,
        modelPath,
        freeText: Boolean(options.freeText),
        margin: Number(options.margin) >= 0 ? Number(options.margin) : undefined
      });
      if (regions.length) {
        const mask = (await this._readMask(filePath, width, height)) || new Uint8Array(width * height);
        await this._writeMask(filePath, paint(mask, width, regions), width, height);
      }
      return { found: regions.length, regions: regions.map(({ label, score, x, y, w, h }) => ({ label, score, x, y, w, h })) };
    });

    handle('cleanup:bubble-at', async (event, filePath, x, y, options = {}) => {
      requireFile(filePath, IMAGE_EXTENSIONS, 'image');
      const { region } = await this.vision.run('bubble-at', {
        inputPath: filePath,
        x: Number(x),
        y: Number(y),
        margin: Number(options.margin) >= 0 ? Number(options.margin) : undefined
      });
      return { region };
    });

    handle('cleanup:repair', async (event, filePath, options = {}) => {
      requireFile(filePath, IMAGE_EXTENSIONS, 'image');
      const controller = new AbortController();
      this.runs.set(filePath, controller);
      try {
        await comfy.discardTries(filePath);
        const tries = await comfy.repair({
          url: options.url,
          filePath,
          attempts: Math.min(6, Math.max(1, Number(options.attempts) || 3)),
          prompt: typeof options.prompt === 'string' ? options.prompt.slice(0, 2000) : undefined,
          models: options.models,
          edge: Number.isFinite(Number(options.edge)) ? Math.min(64, Math.max(0, Math.round(Number(options.edge)))) : comfy.DEFAULT_EDGE,
          signal: controller.signal,
          onProgress: (progress) => {
            if (!event.sender.isDestroyed()) event.sender.send('cleanup:progress', { filePath, ...progress });
          }
        });
        return { tries };
      } finally {
        this.runs.delete(filePath);
      }
    });

    // Signatures and watermarks, each with the ink to heal (services/signatureFind.js).
    handle('cleanup:find-signatures', async (event, filePath) => {
      requireFile(filePath, IMAGE_EXTENSIONS, 'image');
      const modelPath = findModelFile(BUBBLE_MODEL_FILE);
      if (!modelPath) throw new Error('The text model (resources/models/comic/comic-bubbles.onnx) was not found');
      const { width, height, candidates } = await this.vision.run('signatures', { inputPath: filePath, modelPath, tagger: findTagger({ kinds: ['hydra'] }) });
      return { width, height, finds: candidates };
    });

    // Adds areas (signature finds better repaired by Flux) to the image's saved mask.
    handle('cleanup:mark-regions', async (event, filePath, list) => {
      requireFile(filePath, IMAGE_EXTENSIONS, 'image');
      if (!Array.isArray(list) || !list.length) throw new Error('Nothing to mark');
      const { width, height } = await this._size(filePath);
      const regions = list.slice(0, 50).map(region);
      const mask = (await this._readMask(filePath, width, height)) || new Uint8Array(width * height);
      await this._writeMask(filePath, paint(mask, width, regions), width, height);
      return { marked: true };
    });

    // Spot healing: heal, undo, save or discard the image's working copy.
    const region = (r) => {
      const w = Math.round(Number(r?.w));
      const h = Math.round(Number(r?.h));
      if (!(w > 0 && h > 0) || w * h > 64 * 1024 * 1024 || !r.mask || r.mask.length !== w * h) throw new Error('Invalid area');
      return { x: Math.round(Number(r.x) || 0), y: Math.round(Number(r.y) || 0), w, h, mask: Uint8Array.from(r.mask) };
    };
    handle('cleanup:heal', async (event, filePath, area, options = {}) =>
      this.vision.run('heal', { inputPath: requireFile(filePath, IMAGE_EXTENSIONS, 'image'), region: region(area), seed: Number(options.seed) || 1 }));
    handle('cleanup:heal-undo', async (event, filePath) => this.vision.run('heal-undo', { inputPath: requireFile(filePath, IMAGE_EXTENSIONS, 'image') }));
    handle('cleanup:heal-save', async (event, filePath) => this.vision.run('heal-save', { inputPath: requireFile(filePath, IMAGE_EXTENSIONS, 'image') }));
    handle('cleanup:heal-discard', async (event, filePath) => this.vision.run('heal-discard', { inputPath: requireFile(filePath, IMAGE_EXTENSIONS, 'image') }));
    handle('cleanup:heal-state', async (event, filePaths) => {
      if (!Array.isArray(filePaths)) throw new Error('Invalid file list');
      return { edits: await this.vision.run('heal-state', { inputPaths: filePaths.slice(0, 20000) }) };
    });

    handle('cleanup:stop', async () => {
      for (const controller of this.runs.values()) controller.abort();
      return {};
    });

    handle('cleanup:keep', async (event, filePath, tryFile, options = {}) => comfy.keepTry({
      filePath: requireFile(filePath, IMAGE_EXTENSIONS, 'image'),
      tryFile: requireFile(tryFile, IMAGE_EXTENSIONS, 'try'),
      removeTags: Boolean(options.removeTags)
    }));

    handle('cleanup:discard', async (event, filePath) => {
      await comfy.discardTries(requireFile(filePath, IMAGE_EXTENSIONS, 'image'));
      return {};
    });
  }
}

module.exports = CleanupIPC;
