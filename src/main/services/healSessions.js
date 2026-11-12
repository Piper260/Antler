/**
 * Image Cleanup's spot healing, image by image: each heal changes a working
 * copy kept in memory (in the vision worker), with an undo history, until
 * it's saved or discarded. Saving writes only the healed pixels into the
 * file as it is on disk (alpha and everything else untouched), and keeps
 * the original in bak/cleanup, as keeping a Flux try does.
 *
 * Regions are { x, y, w, h, mask } in image pixels, mask w * h with 1 = heal.
 */
const fs = require('fs');
const sharp = require('sharp');
const { heal } = require('./spotHeal');
const { cleanupDir, originalPath } = require('./comfyCleanup');
const { writeFileSafe } = require('../utils/safeWrite');

const UNDO_LIMIT = 30;

function cropOf(data, width, box, channels = 3) {
  const out = Buffer.alloc(box.w * box.h * channels);
  for (let y = 0; y < box.h; y++) {
    const start = ((box.y + y) * width + box.x) * channels;
    data.copy ? data.copy(out, y * box.w * channels, start, start + box.w * channels)
      : out.set(data.subarray(start, start + box.w * channels), y * box.w * channels);
  }
  return out;
}

function pasteInto(data, width, box, crop, channels = 3) {
  for (let y = 0; y < box.h; y++) {
    data.set(crop.subarray(y * box.w * channels, (y + 1) * box.w * channels), ((box.y + y) * width + box.x) * channels);
  }
}

class HealSessions {
  /** @param {(filePath: string) => Promise<{data, width, height}>} loadImage - RGB pixels as shown */
  constructor(loadImage) {
    this.loadImage = loadImage;
    this.sessions = new Map();
  }

  async _session(filePath) {
    const { mtimeMs } = fs.statSync(filePath);
    let s = this.sessions.get(filePath);
    // Changed on disk since (cleaned with Flux, say): the old heals no longer apply.
    if (s && s.mtimeMs !== mtimeMs) s = null;
    if (!s) {
      const img = await this.loadImage(filePath);
      s = { mtimeMs, width: img.width, height: img.height, data: Buffer.from(img.data), touched: new Uint8Array(img.width * img.height), history: [] };
      this.sessions.set(filePath, s);
    }
    return s;
  }

  async _png(s, box) {
    return sharp(cropOf(s.data, s.width, box), { raw: { width: box.w, height: box.h, channels: 3 } }).png({ compressionLevel: 3 }).toBuffer();
  }

  edits(filePath) {
    return this.sessions.get(filePath)?.history.length || 0;
  }

  /** Heals one region; returns the changed area as a PNG to draw over the image. */
  async heal(filePath, region, { seed = 1 } = {}) {
    const s = await this._session(filePath);
    const mask = new Uint8Array(s.width * s.height);
    const x0 = Math.max(0, Math.round(region.x));
    const y0 = Math.max(0, Math.round(region.y));
    let any = false;
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        if (!region.mask[y * region.w + x]) continue;
        const ix = x0 + x;
        const iy = y0 + y;
        if (ix >= s.width || iy >= s.height) continue;
        mask[iy * s.width + ix] = 1;
        any = true;
      }
    }
    if (!any) return { box: null, edits: s.history.length };

    // What heal() may change: the area around the mask it works in.
    const img = { data: s.data, width: s.width, height: s.height };
    const before = Buffer.from(s.data);
    const area = heal(img, mask, { seed });
    const beforeCrop = cropOf(before, s.width, area);
    const touchedCrop = cropOf(Buffer.from(s.touched.buffer, s.touched.byteOffset, s.touched.length), s.width, area, 1);
    for (let i = 0; i < mask.length; i++) if (mask[i]) s.touched[i] = 1;
    s.history.push({ box: area, before: beforeCrop, touched: touchedCrop });
    if (s.history.length > UNDO_LIMIT) s.history.shift();
    return { box: area, png: await this._png(s, area), edits: s.history.length };
  }

  /** Takes back the last heal; returns the restored area to draw. */
  async undo(filePath) {
    const s = this.sessions.get(filePath);
    const last = s?.history.pop();
    if (!last) return { box: null, edits: 0 };
    pasteInto(s.data, s.width, last.box, last.before);
    pasteInto(s.touched, s.width, last.box, last.touched, 1);
    return { box: last.box, png: await this._png(s, last.box), edits: s.history.length };
  }

  discard(filePath) {
    this.sessions.delete(filePath);
  }

  /** Writes the healed pixels into the image file; the original goes to bak/cleanup. */
  async save(filePath) {
    const s = this.sessions.get(filePath);
    if (!s?.history.length) return { saved: false };
    const { data, info } = await sharp(filePath, { limitInputPixels: false }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== s.width || info.height !== s.height) throw new Error('The image changed size since it was healed');
    for (let i = 0; i < s.touched.length; i++) {
      if (!s.touched[i]) continue;
      data[i * 4] = s.data[i * 3];
      data[i * 4 + 1] = s.data[i * 3 + 1];
      data[i * 4 + 2] = s.data[i * 3 + 2];
    }
    // An image without transparency stays without it.
    const { hasAlpha } = await sharp(filePath).metadata();
    let out = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
    if (!hasAlpha) out = out.removeAlpha();
    const ext = require('path').extname(filePath).toLowerCase();
    let encoded;
    if (ext === '.png') encoded = await out.png().toBuffer();
    else if (ext === '.webp') encoded = await out.webp({ lossless: true }).toBuffer();
    else if (ext === '.jpg' || ext === '.jpeg') encoded = await out.flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
    else throw new Error(`Can't save ${ext} images; convert to PNG first`);

    await fs.promises.mkdir(cleanupDir(filePath), { recursive: true });
    if (!fs.existsSync(originalPath(filePath))) await fs.promises.copyFile(filePath, originalPath(filePath));
    await writeFileSafe(filePath, encoded);
    this.sessions.delete(filePath);
    return { saved: true };
  }
}

module.exports = { HealSessions };
