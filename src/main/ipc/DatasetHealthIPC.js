// src/main/ipc/DatasetHealthIPC.js - the dataset check in Image Organizer:
// crawl every library's datasets, list what needs attention, and run the
// quick fixes (services/datasetHealth.js). Fixes are limited to files inside
// a dataset of one of the user's libraries.
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const health = require('../services/datasetHealth');
const ComicVisionService = require('../services/ComicVisionService');
const { findTagger } = require('../utils/taggers');
const { parseDatasetFolderName } = require('../utils/datasetFolders');
const { writeFileSafe } = require('../utils/safeWrite');

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

class DatasetHealthIPC {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.run = null;
    this.triggers = new Map(); // dataset path -> { triggerTag, typicalTags }, from the last scan
    this._setupHandlers();
    console.log('🔗 Dataset check IPC handlers registered');
  }

  /** Every dataset folder in the user's libraries. */
  datasets() {
    const { libraries } = this.settingsService.getLibraries();
    const out = [];
    for (const library of libraries) {
      let entries = [];
      try {
        entries = fs.readdirSync(library.path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.toLowerCase() === 'bak') continue;
        const parsed = parseDatasetFolderName(entry.name);
        const type = parsed?.type || library.type;
        if (!type) continue; // not a dataset folder (scripts, exports...)
        out.push({ path: path.join(library.path, entry.name), folder: entry.name, name: parsed?.name || entry.name, type, library: library.name });
      }
    }
    return out.sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' }));
  }

  /** A dataset path from the renderer, only if it's one of the user's datasets. */
  requireDataset(datasetPath) {
    const resolved = path.resolve(String(datasetPath || ''));
    const dataset = this.datasets().find(d => path.resolve(d.path).toLowerCase() === resolved.toLowerCase());
    if (!dataset) throw new Error('Not a dataset in your libraries');
    return dataset;
  }

  requireFiles(dataset, files) {
    if (!Array.isArray(files) || !files.length) throw new Error('No files given');
    return files.slice(0, 50000).map((file) => {
      const resolved = path.resolve(String(file));
      if (!inside(resolved, dataset.path)) throw new Error(`Not in ${dataset.folder}: ${path.basename(resolved)}`);
      return resolved;
    });
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
    const progress = (event, data) => {
      if (!event.sender.isDestroyed()) event.sender.send('dataset-health:progress', data);
    };

    handle('dataset-health:scan', async (event, options = {}) => {
      const minSide = Math.max(0, Math.min(4096, Number(options.minSide) || 0));
      const run = { stopped: false };
      this.run = run;
      const datasets = this.datasets();
      const results = [];
      const imageSize = async (file) => {
        const meta = await sharp(file, { limitInputPixels: false }).metadata();
        return meta.autoOrient || { width: meta.width, height: meta.height };
      };
      for (let i = 0; i < datasets.length && !run.stopped; i++) {
        const ds = datasets[i];
        progress(event, { phase: 'scan', done: i, total: datasets.length, detail: ds.folder });
        const result = await health.checkDataset(ds.path, { minSide, imageSize });
        this.triggers.set(path.resolve(ds.path).toLowerCase(), { triggerTag: result.triggerTag, typicalTags: result.typicalTags });
        results.push({ ...ds, ...result });
      }
      progress(event, { phase: 'cross', done: datasets.length, total: datasets.length, detail: 'Comparing datasets' });
      const cross = run.stopped ? [] : await health.crossDuplicates(results);
      this.run = null;
      return {
        stopped: run.stopped,
        hydra: Boolean(findTagger({ kinds: ['hydra'] })),
        kinds: health.KINDS,
        datasets: results.map(({ sizes, hashes, files, ...rest }) => rest),
        cross
      };
    });

    handle('dataset-health:stop', async () => {
      if (this.run) this.run.stopped = true;
      return {};
    });

    // Moves files to the dataset's bak/<reason> folder (with their captions).
    handle('dataset-health:move', async (event, datasetPath, kind, files) => {
      const dataset = this.requireDataset(datasetPath);
      const reason = health.KINDS[kind]?.bak;
      if (!reason) throw new Error(`Nothing to move for ${kind}`);
      return health.moveToBak(dataset.path, this.requireFiles(dataset, files), reason);
    });

    handle('dataset-health:dedupe', async (event, datasetPath, files) => {
      const dataset = this.requireDataset(datasetPath);
      let fixed = 0;
      for (const file of this.requireFiles(dataset, files)) {
        if (path.extname(file).toLowerCase() !== '.txt') continue;
        await health.dedupeCaption(file, (target, text) => writeFileSafe(target, text, { backup: true }));
        fixed++;
      }
      return { fixed };
    });

    // Writes a caption for each image from Hydra: the dataset's trigger tag
    // first, then what Hydra is sure of. Existing non-empty captions are kept.
    handle('dataset-health:tag', async (event, datasetPath, files, options = {}) => {
      const dataset = this.requireDataset(datasetPath);
      const tagger = findTagger({ kinds: ['hydra'] });
      if (!tagger) throw new Error('The Hydra tagger is not installed (Settings > Models)');
      const images = this.requireFiles(dataset, files).filter(f => health.IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));
      const { triggerTag = null, typicalTags = null } = this.triggers.get(path.resolve(dataset.path).toLowerCase()) || {};
      const maxTags = Math.max(10, Math.min(150, typicalTags || 40));
      const hidden = Array.isArray(options.hidden) ? options.hidden.filter(t => typeof t === 'string') : [];
      const threshold = Math.min(0.99, Math.max(0.2, Number(options.threshold) || 0.5));
      const run = { stopped: false };
      this.run = run;
      let tagged = 0;
      const failed = [];
      const done = []; // captioned now, or already had a caption
      for (let i = 0; i < images.length && !run.stopped; i++) {
        const image = images[i];
        progress(event, { phase: 'tag', done: i, total: images.length, detail: path.basename(image) });
        const caption = image.slice(0, image.length - path.extname(image).length) + '.txt';
        try {
          const existing = fs.existsSync(caption) ? fs.readFileSync(caption, 'utf8') : '';
          if (health.parseCaption(existing).length) {
            done.push(image);
            continue;
          }
          const { suggestions } = await ComicVisionService.shared().run('hydra-tags', { inputPath: image, tags: [], hidden, all: true, tagger });
          const text = health.buildCaption(suggestions || [], { triggerTag, threshold, hidden, maxTags });
          if (!text) throw new Error('Hydra found nothing it was sure of');
          await writeFileSafe(caption, text);
          tagged++;
          done.push(image);
        } catch (error) {
          failed.push({ file: image, message: error.message });
        }
      }
      this.run = null;
      return { tagged, done, failed, stopped: run.stopped, triggerTag };
    });
  }
}

module.exports = DatasetHealthIPC;
