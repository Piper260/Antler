/**
 * Small JPEG thumbnails of dataset images, for the Tag Editor's grid, kept
 * in <user data>/thumbnails so a folder opened again shows at once. The
 * grid would otherwise decode every full-size image (often 2000px and up)
 * just to show it at 170px.
 *
 * A thumbnail is named after the image's path, size and modified time, so
 * an edited, replaced or upscaled image gets a new one. A few are made at a
 * time, so opening a large folder doesn't hold up everything else. Once the
 * folder grows past MAX_BYTES, the least recently used thumbnails go.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const EDGE = 384;
const QUALITY = 80;
const CONCURRENCY = 3;
const MAX_BYTES = 512 * 1024 * 1024;

class ThumbnailCache {
  /** @param {string} folder - where thumbnails are kept */
  constructor(folder) {
    this.folder = folder;
    this.active = 0;
    this.waiting = [];
    this.pending = new Map(); // name -> Promise, so a thumbnail asked for twice is made once
    this.pruned = false;
  }

  /** The thumbnail's name for an image as it is now. */
  static nameFor(filePath, stat) {
    const key = `${path.resolve(filePath).toLowerCase()}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
    return `${crypto.createHash('sha1').update(key).digest('hex')}.jpg`;
  }

  /** @returns {Promise<string>} the thumbnail's path, made if needed */
  async get(filePath) {
    const stat = await fs.promises.stat(filePath);
    const name = ThumbnailCache.nameFor(filePath, stat);
    const target = path.join(this.folder, name);

    try {
      // Touched, so pruning keeps the ones in use.
      const now = new Date();
      await fs.promises.utimes(target, now, now);
      return target;
    } catch {
      // Not made yet.
    }

    if (!this.pending.has(name)) {
      const job = this._limit(() => this._make(filePath, target)).finally(() => this.pending.delete(name));
      this.pending.set(name, job);
    }
    await this.pending.get(name);
    if (!this.pruned) {
      this.pruned = true;
      this.prune().catch(error => console.warn('Thumbnail cache prune failed:', error.message));
    }
    return target;
  }

  async _make(filePath, target) {
    await fs.promises.mkdir(this.folder, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await sharp(filePath, { limitInputPixels: false, animated: false })
      .rotate()
      .resize(EDGE, EDGE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toFile(temp);
    await fs.promises.rename(temp, target);
  }

  _limit(task) {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        task().then(resolve, reject).finally(() => {
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (this.active < CONCURRENCY) start();
      else this.waiting.push(start);
    });
  }

  /** Removes the least recently used thumbnails while the folder is over MAX_BYTES. */
  async prune(maxBytes = MAX_BYTES) {
    let entries;
    try {
      entries = await fs.promises.readdir(this.folder);
    } catch {
      return 0;
    }
    const files = [];
    let total = 0;
    for (const name of entries) {
      if (!name.endsWith('.jpg')) continue;
      try {
        const stat = await fs.promises.stat(path.join(this.folder, name));
        files.push({ name, size: stat.size, used: stat.mtimeMs });
        total += stat.size;
      } catch {
        // Gone already.
      }
    }
    if (total <= maxBytes) return 0;
    files.sort((a, b) => a.used - b.used);
    let removed = 0;
    for (const file of files) {
      if (total <= maxBytes * 0.8) break;
      try {
        await fs.promises.unlink(path.join(this.folder, file.name));
        total -= file.size;
        removed++;
      } catch {
        // In use or gone; skip it.
      }
    }
    return removed;
  }
}

module.exports = { ThumbnailCache, EDGE };
