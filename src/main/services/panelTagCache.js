/**
 * What the tagger saw in each panel (tagMerge.js panelTagFacts), kept in a
 * folder's panel-tag-facts.json so a page is only tagged once. An entry stops
 * counting when the page, its tag file, the tagger or the facts' format
 * change, which `stamp` covers. It's only a cache: unreadable or lost, the
 * panels are simply tagged again.
 */
const fs = require('fs').promises;
const path = require('path');
const { writeFileSafe } = require('../utils/safeWrite');

const CACHE_FILE = 'panel-tag-facts.json';
const FACTS_VERSION = 1;
const SAVE_DELAY = 2000;

const boxKey = (box) => [box.x, box.y, box.w, box.h].map(Math.round).join(',');

async function modified(filePath) {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

class PanelTagCache {
  constructor() {
    this.folders = new Map(); // folder -> Promise<{ pages, timer }>
  }

  _folder(folder) {
    if (!this.folders.has(folder)) {
      this.folders.set(folder, (async () => {
        let pages = {};
        try {
          pages = JSON.parse(await fs.readFile(path.join(folder, CACHE_FILE), 'utf8')).pages || {};
        } catch (error) {
          if (error.code !== 'ENOENT') console.error('❌ Panel tag cache load error:', error);
        }
        return { pages, timer: null };
      })());
    }
    return this.folders.get(folder);
  }

  async _stamp(filePath, taggerKind) {
    const parsed = path.parse(filePath);
    const [page, tagFile] = await Promise.all([modified(filePath), modified(path.join(parsed.dir, `${parsed.name}.txt`))]);
    return `${FACTS_VERSION}:${taggerKind}:${page}:${tagFile}`;
  }

  /** Facts for each box, or null for those not known yet. */
  async get(filePath, taggerKind, boxes) {
    const entry = (await this._folder(path.dirname(filePath))).pages[path.basename(filePath)];
    if (entry?.stamp !== await this._stamp(filePath, taggerKind)) return boxes.map(() => null);
    return boxes.map(box => entry.panels[boxKey(box)] || null);
  }

  /** Remembers `facts[i]` for `boxes[i]`, skipping nulls. */
  async set(filePath, taggerKind, boxes, facts) {
    const folder = await this._folder(path.dirname(filePath));
    const name = path.basename(filePath);
    const stamp = await this._stamp(filePath, taggerKind);
    if (folder.pages[name]?.stamp !== stamp) folder.pages[name] = { stamp, panels: {} };
    boxes.forEach((box, i) => {
      if (facts[i]) folder.pages[name].panels[boxKey(box)] = facts[i];
    });

    clearTimeout(folder.timer);
    folder.timer = setTimeout(() => this._save(path.dirname(filePath), folder), SAVE_DELAY);
    folder.timer.unref?.();
  }

  async _save(folderPath, folder) {
    try {
      await writeFileSafe(path.join(folderPath, CACHE_FILE), JSON.stringify({ version: FACTS_VERSION, pages: folder.pages }));
    } catch (error) {
      console.error('❌ Panel tag cache save error:', error);
    }
  }

  /** Writes anything still waiting on its timer. */
  async flush() {
    for (const [folderPath, loading] of this.folders) {
      const folder = await loading;
      if (!folder.timer) continue;
      clearTimeout(folder.timer);
      folder.timer = null;
      await this._save(folderPath, folder);
    }
  }
}

module.exports = PanelTagCache;
