const { ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const ComicVisionService = require('../services/ComicVisionService');
const PanelTagCache = require('../services/panelTagCache');
const { writeFileSafe } = require('../utils/safeWrite');
const { findModelFile } = require('../utils/modelPaths');
const { findTagger } = require('../utils/taggers');
const { panelFileName, findPanelImage } = require('../services/panelFiles');
const { applyPanels } = require('../services/pageMerge');

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp']);
const LAYOUT_VERSION = 1;
// What the Panel tags pane learned from corrections, shared by every page in a folder.
const LEARNING_FILE = 'panel-tag-learning.json';
const MAX_LEARNING_BYTES = 20 * 1024 * 1024;
const PANEL_MODEL_FILE = path.join('comic', 'inkwell-panels.onnx');
const findPanelModel = () => findModelFile(PANEL_MODEL_FILE);

/**
 * Hand-checked panel boxes are kept next to the page as
 * `<page>.panels.json`, so reopening a page restores the corrections
 * instead of detecting again.
 */
function layoutPath(filePath) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.panels.json`);
}

function validatePage(filePath) {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Invalid file path');
  }
  if (!ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error('Unsupported file type');
  }
}

/** Exported panels go in a "panels" folder next to the page unless told otherwise. */
function exportFolder(filePath, outputDir) {
  return typeof outputDir === 'string' && path.isAbsolute(outputDir) ? outputDir : path.join(path.dirname(filePath), 'panels');
}

const cleanExportName = (name) => (typeof name === 'string' && name && !name.includes('..') && path.basename(name) === name ? name : null);

const cleanTagList = (list) => (Array.isArray(list) ? list.map(tag => String(tag).trim()).filter(Boolean).slice(0, 500) : []);

/** Panel boxes, each with its exported file name and the user's tag edits ({ add, remove, checked, final }) if any. */
function cleanPanels(panels) {
  if (!Array.isArray(panels)) throw new Error('Invalid panel list');
  return panels
    .map(box => {
      const clean = { x: Number(box.x), y: Number(box.y), w: Number(box.w), h: Number(box.h) };
      const exportName = cleanExportName(box.exportName);
      if (exportName) clean.exportName = exportName;
      if (box.tagEdits) {
        clean.tagEdits = { add: cleanTagList(box.tagEdits.add), remove: cleanTagList(box.tagEdits.remove), checked: cleanTagList(box.tagEdits.checked) };
        if (Array.isArray(box.tagEdits.final)) clean.tagEdits.final = cleanTagList(box.tagEdits.final);
      }
      return clean;
    })
    .filter(box => [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0);
}

class ComicPanelIPC {
  constructor() {
    // Shared with the Tag Editor, so the tagger is only loaded once.
    this.vision = ComicVisionService.shared();
    this.tagCache = new PanelTagCache();
    this._setupHandlers();
    console.log('🔗 Comic Panel IPC handlers registered');
  }

  _setupHandlers() {
    ipcMain.handle('comic-panels:status', async () => ({
      success: true,
      modelAvailable: Boolean(findPanelModel()),
      taggerAvailable: Boolean(findTagger())
    }));

    ipcMain.handle('comic-panels:detect', async (event, filePath, options = {}) => {
      try {
        validatePage(filePath);
        const modelPath = findPanelModel();
        return { success: true, ...await this.vision.run('detect', { inputPath: filePath, options, modelPath }) };
      } catch (error) {
        console.error('❌ Panel detection error:', error);
        return { success: false, message: error.message || 'Panel detection failed' };
      }
    });

    // Merged tags for each panel, for review before export.
    ipcMain.handle('comic-panels:tags', async (event, filePath, panels) => {
      try {
        validatePage(filePath);
        const tagger = findTagger();
        if (!tagger) return { success: true, available: false };
        const boxes = cleanPanels(panels);
        const facts = await this.tagCache.get(filePath, tagger.kind, boxes);
        const missing = boxes.filter((box, i) => !facts[i]);
        if (!missing.length) return { success: true, available: true, pageTagFile: true, panels: facts };

        const result = await this.vision.run('tags', { inputPath: filePath, panels: missing, tagger });
        // Facts missing e621's categories would stay worse than a fresh run.
        if (result.pageTagFile && result.categoriesKnown) await this.tagCache.set(filePath, tagger.kind, missing, result.panels);
        const fresh = [...result.panels];
        return { success: true, available: true, pageTagFile: result.pageTagFile, panels: facts.map(known => known || fresh.shift() || null) };
      } catch (error) {
        console.error('❌ Panel tag preview error:', error);
        return { success: false, message: error.message };
      }
    });

    // Small crops of panels, for the tag grid.
    ipcMain.handle('comic-panels:thumbs', async (event, filePath, panels) => {
      try {
        validatePage(filePath);
        return { success: true, ...await this.vision.run('thumbs', { inputPath: filePath, panels: cleanPanels(panels) }) };
      } catch (error) {
        console.error('❌ Panel thumbnail error:', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('comic-panels:load-learning', async (event, folder) => {
      try {
        if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Invalid folder');
        return { success: true, learning: JSON.parse(await fs.readFile(path.join(folder, LEARNING_FILE), 'utf8')) };
      } catch (error) {
        if (error.code === 'ENOENT') return { success: true, learning: null };
        console.error('❌ Panel tag learning load error:', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('comic-panels:save-learning', async (event, folder, learning) => {
      try {
        if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Invalid folder');
        if (!learning || typeof learning !== 'object') throw new Error('Invalid learning data');
        const text = JSON.stringify({ keep: learning.keep || {}, add: learning.add || {}, examples: learning.examples || {}, profiles: learning.profiles || {} });
        if (text.length > MAX_LEARNING_BYTES) throw new Error('Learning data too large');
                await writeFileSafe(path.join(folder, LEARNING_FILE), text);
        return { success: true };
      } catch (error) {
        console.error('❌ Panel tag learning save error:', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('comic-panels:load-layout', async (event, filePath) => {
      try {
        validatePage(filePath);
        const layout = JSON.parse(await fs.readFile(layoutPath(filePath), 'utf8'));
        return { success: true, layout: { ...layout, panels: cleanPanels(layout.panels) } };
      } catch (error) {
        if (error.code === 'ENOENT') return { success: true, layout: null };
        console.error('❌ Panel layout load error:', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('comic-panels:save-layout', async (event, filePath, layout = {}) => {
      try {
        validatePage(filePath);
        const data = {
          version: LAYOUT_VERSION,
          width: Number(layout.width) || 0,
          height: Number(layout.height) || 0,
          gutterColor: Array.isArray(layout.gutterColor) ? layout.gutterColor.slice(0, 3).map(Number) : null,
          exportDir: typeof layout.exportDir === 'string' && path.isAbsolute(layout.exportDir) ? layout.exportDir : null,
          panels: cleanPanels(layout.panels)
        };
                await writeFileSafe(layoutPath(filePath), JSON.stringify(data, null, 2));
        return { success: true };
      } catch (error) {
        console.error('❌ Panel layout save error:', error);
        return { success: false, message: error.message };
      }
    });

    // Which of a page's panels, by number, already have an exported image,
    // and where. Without a known folder, panels exported beside the page count too.
    ipcMain.handle('comic-panels:exported-names', async (event, filePath, count, outputDir) => {
      try {
        validatePage(filePath);
        const baseName = path.parse(filePath).name;
        const names = Array.from({ length: Math.min(Number(count) || 0, 500) }, (_, i) => panelFileName(baseName, i + 1));
        const folders = outputDir ? [exportFolder(filePath, outputDir)] : [exportFolder(filePath), path.dirname(filePath)];
        for (const folder of folders) {
          const found = names.map(name => (findPanelImage(folder, name) ? name : null));
          if (found.some(Boolean)) return { success: true, folder, names: found };
        }
        return { success: true, folder: null, names: [] };
      } catch (error) {
        console.error('❌ Exported panel lookup error:', error);
        return { success: false, message: error.message };
      }
    });

    // The exported panel images (cleaned since) go back into the page.
    ipcMain.handle('comic-panels:apply-cleaned', async (event, filePath, panels, outputDir) => {
      try {
        validatePage(filePath);
        // The boxes are in the page's size when they were saved, which a resize since changes.
        const saved = await fs.readFile(layoutPath(filePath), 'utf8').then(JSON.parse, () => ({}));
        const counts = await applyPanels({
          filePath,
          panels: cleanPanels(panels),
          folder: exportFolder(filePath, outputDir),
          width: Number(saved.width) || 0,
          height: Number(saved.height) || 0
        });
        return { success: true, ...counts };
      } catch (error) {
        console.error('❌ Apply cleaned panels error:', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('comic-panels:export', async (event, filePath, panels, options = {}) => {
      try {
        validatePage(filePath);
        const outputDir = exportFolder(filePath, options.outputDir);
        const gutterColor = Array.isArray(options.gutterColor) ? options.gutterColor.slice(0, 3).map(Number) : [255, 255, 255];
        const result = await this.vision.run('export', {
          inputPath: filePath,
          panels: cleanPanels(panels),
          outputDir,
          baseName: path.parse(filePath).name,
          format: options.format,
          padding: options.padding,
          outside: options.outside,
          gutterColor,
          tolerance: options.tolerance,
          tagger: options.writeTags ? findTagger() : null,
          panelTags: Array.isArray(options.panelTags) ? options.panelTags.map(list => (Array.isArray(list) ? cleanTagList(list) : null)) : null,
          live: Boolean(options.live)
        });
        return { success: true, outputDir, ...result };
      } catch (error) {
        console.error('❌ Panel export error:', error);
        return { success: false, message: error.message || 'Export failed' };
      }
    });
  }
}

module.exports = ComicPanelIPC;
