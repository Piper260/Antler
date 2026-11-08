/**
 * Puts a comic page's exported panel images (cleaned in Image Cleanup or
 * anywhere else) back into the page: each panel's image, found by its
 * name, is resized to the panel's place and pasted over it whole.
 *
 * The export's padding isn't saved, and the panel may since have been
 * upscaled, so its place is found again: every padding that gives the
 * panel image's shape is tried, and the one where the page matches most of
 * the image wins. Boxes are in the page's size when they were saved; a page
 * resized since has them scaled to fit.
 */
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { writeFileSafe } = require('../utils/safeWrite');
const { findPanelImage } = require('./panelFiles');
const comfy = require('./comfyCleanup');

const MAX_PADDING = 200;
// Shapes within this share of each other count as the same crop, resized.
const SHAPE_TOLERANCE = 0.02;
// Samples across a crop when comparing it with the page.
const GRID = 64;
// The page must match most of the image this closely (median difference) to be its place.
const MATCH_LIMIT = 12;
// A page already this close to the image (mean difference; resampling and
// JPG leave a little) has it.
const SAME = 3;

/** Crops the export could have made of `box` for each padding, whose shape matches w x h. */
function cropCandidates(box, w, h, pageW, pageH, maxPadding = MAX_PADDING) {
  const seen = new Set();
  const crops = [];
  for (let padding = 0; padding <= maxPadding; padding++) {
    const left = Math.max(0, Math.round(box.x) - padding);
    const top = Math.max(0, Math.round(box.y) - padding);
    const right = Math.min(pageW, Math.round(box.x + box.w) + padding);
    const bottom = Math.min(pageH, Math.round(box.y + box.h) + padding);
    const key = `${left},${top},${right},${bottom}`;
    if (right <= left || bottom <= top || seen.has(key)) continue;
    seen.add(key);
    const sx = w / (right - left);
    const sy = h / (bottom - top);
    if (Math.abs(sx - sy) <= SHAPE_TOLERANCE * Math.max(sx, sy)) crops.push({ left, top, width: right - left, height: bottom - top });
  }
  return crops;
}

/** A crop in the saved page's size (savedW x savedH), in the page as it is now. */
function scaleCrop(crop, savedW, savedH, page) {
  const sx = page.width / savedW;
  const sy = page.height / savedH;
  const left = Math.round(crop.left * sx);
  const top = Math.round(crop.top * sy);
  return {
    left,
    top,
    width: Math.min(page.width, Math.round((crop.left + crop.width) * sx)) - left,
    height: Math.min(page.height, Math.round((crop.top + crop.height) * sy)) - top
  };
}

/**
 * The median (or with `mean`, mean) difference between the page (RGBA)
 * under `crop` and `image` (w x h RGBA), on a GRID x GRID sample.
 */
function cropDifference(page, crop, image, w, h, { mean = false } = {}) {
  const differences = [];
  for (let gy = 0; gy < GRID; gy++) {
    const v = (gy + 0.5) / GRID;
    const iy = Math.floor(v * h);
    const py = crop.top + Math.floor(v * crop.height);
    for (let gx = 0; gx < GRID; gx++) {
      const u = (gx + 0.5) / GRID;
      const pp = (py * page.width + crop.left + Math.floor(u * crop.width)) * 4;
      const ip = (iy * w + Math.floor(u * w)) * 4;
      differences.push((Math.abs(page.data[pp] - image[ip]) + Math.abs(page.data[pp + 1] - image[ip + 1]) + Math.abs(page.data[pp + 2] - image[ip + 2])) / 3);
    }
  }
  if (mean) return differences.reduce((sum, d) => sum + d, 0) / differences.length;
  differences.sort((a, b) => a - b);
  return differences[differences.length >> 1];
}

const readRaw = async (input, width, height) => {
  let image = sharp(input).ensureAlpha();
  if (width) image = image.resize(width, height, { fit: 'fill', kernel: 'lanczos3' });
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** Where `box`'s exported image (w x h RGBA) sits on the page, or null if it doesn't match. */
function placePanel(page, box, image, w, h, saved) {
  let best = null;
  for (const savedCrop of cropCandidates(box, w, h, saved.width, saved.height)) {
    const crop = scaleCrop(savedCrop, saved.width, saved.height, page);
    if (crop.width <= 0 || crop.height <= 0) continue;
    const difference = cropDifference(page, crop, image, w, h);
    if (!best || difference < best.difference) best = { crop, difference };
  }
  return best && best.difference <= MATCH_LIMIT ? best : null;
}

/** Pastes `patch` (crop-sized RGBA) over the page under `crop`; transparent pixels leave the page. */
function pasteInto(page, crop, patch) {
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const i = (y * crop.width + x) * 4;
      const a = patch[i + 3];
      if (!a) continue;
      const pp = ((crop.top + y) * page.width + crop.left + x) * 4;
      for (let c = 0; c < 3; c++) page.data[pp + c] = Math.round(page.data[pp + c] + (patch[i + c] - page.data[pp + c]) * a / 255);
    }
  }
}

/**
 * Pastes one panel image into `page` (RGBA, changed in place); `saved` is
 * the page's size when its boxes were saved.
 * Returns 'applied', 'already' (the page has it) or 'unplaced'.
 */
async function mergePanel(page, box, imageFile, saved = page) {
  const image = await readRaw(imageFile);
  const place = placePanel(page, box, image.data, image.width, image.height, saved);
  if (!place) return 'unplaced';
  const patch = (await readRaw(imageFile, place.crop.width, place.crop.height)).data;
  if (cropDifference(page, place.crop, patch, place.crop.width, place.crop.height, { mean: true }) <= SAME) return 'already';
  pasteInto(page, place.crop, patch);
  return 'applied';
}

async function encodeLike(filePath, page) {
  let image = sharp(page.data, { raw: { width: page.width, height: page.height, channels: 4 } });
  if (!(await sharp(filePath).metadata()).hasAlpha) image = image.removeAlpha();
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return image.png().toBuffer();
  if (ext === '.webp') return image.webp({ lossless: true }).toBuffer();
  if (ext === '.jpg' || ext === '.jpeg') return image.flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  if (ext === '.tif' || ext === '.tiff') return image.tiff({ compression: 'lzw' }).toBuffer();
  throw new Error(`Can't save ${ext} pages; convert to PNG first`);
}

/**
 * Pastes every panel image of a page (boxes with an exportName, exported
 * into `folder`) into the page. The first original page is kept in the
 * page's bak/cleanup folder. `width` and `height` are the page's size when
 * the boxes were saved, if known.
 */
async function applyPanels({ filePath, panels, folder, width, height }) {
  const counts = { applied: 0, already: 0, unplaced: 0 };
  const exported = panels
    .map(box => ({ box, image: box.exportName && findPanelImage(folder, box.exportName) }))
    .filter(entry => entry.image);
  if (!exported.length) return counts;

  const page = await readRaw(filePath);
  const saved = width > 0 && height > 0 ? { width, height } : page;
  for (const { box, image } of exported) counts[await mergePanel(page, box, image, saved)]++;
  if (!counts.applied) return counts;

  const encoded = await encodeLike(filePath, page);
  const backup = comfy.originalPath(filePath);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  try {
    await fs.access(backup);
  } catch {
    await fs.copyFile(filePath, backup);
  }
  await writeFileSafe(filePath, encoded);
  return counts;
}

module.exports = { cropCandidates, cropDifference, mergePanel, applyPanels };
