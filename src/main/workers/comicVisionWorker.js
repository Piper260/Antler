/**
 * Comic panel worker. Runs in an Electron utility process so page analysis
 * and cropping never block the main process. Later phases (bubble detection,
 * inpainting) load their ONNX models here too, kept apart from the upscale
 * worker so the two don't keep evicting each other's GPU session.
 *
 * Panels come from the YOLOv8 panel model when `options.method` is 'model'
 * and a model path is given, or from gutter detection otherwise. If the
 * model fails to load or run, gutter detection is used instead and the
 * result says why.
 *
 * Protocol (process.parentPort):
 *   in:  { id, type: 'detect', inputPath, options, modelPath }
 *        { id, type: 'export', inputPath, panels, outputDir, baseName, format, padding, outside, gutterColor, tolerance,
 *          tagger?: { modelPath, vocabularyPath }, panelTags?: string[][], live?: boolean }
 *        { id, type: 'tags', inputPath, panels, tagger }
 *        { id, type: 'thumbs', inputPath, panels }
 *        { id, type: 'bubbles', inputPath, modelPath, freeText?, margin? }
 *        { id, type: 'bubble-at', inputPath, x, y, margin? }
 *        { id, type: 'hydra-tags', inputPath, tags, hidden?, all?, tagger }
 *        { id, type: 'hydra-heatmap', inputPath, tag, tagger }
 *
 * 'hydra-tags' and 'hydra-heatmap' serve the Tag Editor: Hydra's score for
 * each of an image's tags with the confident tags it lacks
 * (services/hydraReview.js), and where in the image Hydra found one tag.
 * Both reuse the last image's model output while its file is unchanged.
 *
 * With `tagger` and a tag file next to the page (<page>.txt, as downloads
 * write), each panel also gets a tag file merged from the page's tags and
 * what the e621 tagger sees in the panel (see services/tagMerge.js), or the
 * final lists in `panelTags` when the user reviewed them. 'tags' returns
 * each panel's facts (services/tagMerge.js panelTagFacts) without writing
 * anything; the Panel tags pane works the tags out from them.
 *
 * An image that's already exported is never replaced, as it may have been
 * upscaled since (services/panelFiles.js). `live` is an update during
 * review: only panels with an entry in `panelTags` are touched, and a panel
 * gets a tag file only if its image exists or it's marked done, which also
 * exports the missing image.
 *
 * 'bubbles' finds speech bubbles (and with `freeText`, lettering outside
 * them) for Image Cleanup, as regions in services/bubbleMask.js form;
 * 'bubble-at' finds the white bubble under a click.
 *   out: { id, type: 'done', result }
 *        { id, type: 'error', message }
 */
const fs = require('fs');
const { writeFileSafeSync } = require('../utils/safeWrite');
const path = require('path');
const sharp = require('sharp');
const { detectPanels, estimateGutterColor, sortReadingOrder, colorMask, floodFromBorder } = require('../services/panelDetect');
const { INPUT_SIZES, letterbox, decodeOutput, nonMaxSuppression, meanScore, pickMostConfident } = require('../services/panelModel');
const { parseVocabulary, parseTagFile, formatTagFile, panelTagFacts, mergePanelTags, toTaggerName } = require('../services/tagMerge');
const { findPanelImage, freePanelName } = require('../services/panelFiles');
const { grow, boxRegion, bubbleInBox, bubbleAt } = require('../services/bubbleMask');
const { PATCH, prepareHydraImage } = require('../services/hydraImage');
const { reviewImageTags } = require('../services/hydraReview');

// Pages are analysed at this long edge at most; gutters survive the shrink
// and the pixel loops stay fast on 4000px+ scans.
const ANALYSIS_EDGE = 1200;
const FORMATS = new Set(['png', 'jpg', 'webp']);
const THUMB_EDGE = 320;

// Model results below these scores are flagged for a look in the editor.
const REVIEW_MEAN_SCORE = 0.7;
const REVIEW_MIN_SCORE = 0.5;

let queue = Promise.resolve();
let model = null; // { modelPath, session }
let tagger = null; // { modelPath, kind, session, vocabulary }
let bubbleModel = null; // { modelPath, session, ort }
let bubbleImage = null; // { inputPath, mtimeMs, data, width, height }, the last image looked at
const tagCategories = new Map(); // e621 category by tag name, for tags the tagger doesn't know
let categoriesKnown = true;      // false when the last lookup couldn't reach e621

function loadPage(inputPath) {
  // Transparent pages are flattened onto white, the usual paper colour.
  return sharp(inputPath, { limitInputPixels: false }).rotate().flatten({ background: '#ffffff' });
}

// Size after EXIF rotation, which is what both the screen and the crops use.
async function pageSize(inputPath) {
  const { autoOrient } = await sharp(inputPath, { limitInputPixels: false }).metadata();
  return autoOrient;
}

// The panel model is a nano network, a few tens of milliseconds per run on
// the CPU, so it stays off the GPU the upscaler is using.
async function getModel(modelPath) {
  if (model && model.modelPath === modelPath) return model.session;
  const ort = require('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], logSeverityLevel: 3 });
  model = { modelPath, session, ort };
  return session;
}

/** Panel boxes in page pixels, from whichever input size was more confident. */
async function runModel(page, width, height, modelPath) {
  const session = await getModel(modelPath);
  const { ort } = model;
  const runs = [];

  for (const size of INPUT_SIZES) {
    const fit = letterbox(width, height, size);
    const { data } = await page.clone()
      .resize(fit.nw, fit.nh)
      .extend({ top: fit.dy, bottom: size - fit.nh - fit.dy, left: fit.dx, right: size - fit.nw - fit.dx, background: { r: 114, g: 114, b: 114 } })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const plane = size * size;
    const input = new Float32Array(3 * plane);
    for (let p = 0, i = 0; p < plane; p++, i += 3) {
      input[p] = data[i] / 255;
      input[plane + p] = data[i + 1] / 255;
      input[2 * plane + p] = data[i + 2] / 255;
    }

    const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
    const output = result[session.outputNames[0]];
    runs.push(nonMaxSuppression(decodeOutput(output.data, output.dims[2], fit, width, height)));
  }

  return pickMostConfident(runs);
}

async function detect({ inputPath, options = {}, modelPath }) {
  const page = loadPage(inputPath);
  const { width, height } = await pageSize(inputPath);

  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(width, height));
  const { data, info } = await page.clone()
    .resize({ width: Math.round(width * scale), height: Math.round(height * scale), kernel: sharp.kernel.cubic })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  let fallbackReason = '';
  if (options.method !== 'gutters' && modelPath) {
    try {
      const minArea = (Number(options.minAreaPercent) > 0 ? Number(options.minAreaPercent) / 100 : 0.015) * width * height;
      const boxes = (await runModel(page, width, height, modelPath)).filter(box => box.w * box.h >= minArea);
      const panels = sortReadingOrder(boxes.map(box => {
        const x = Math.floor(box.x);
        const y = Math.floor(box.y);
        return { x, y, w: Math.ceil(box.x + box.w) - x, h: Math.ceil(box.y + box.h) - y };
      }), Boolean(options.rtl));
      // The export step still needs a gutter colour for filling outside a
      // panel's shape; the page edge is the best guess without gutters.
      const gutterColor = options.gutter === 'white' ? [255, 255, 255]
        : options.gutter === 'black' ? [0, 0, 0]
          : estimateGutterColor(data, info.width, info.height, info.channels).color;

      return {
        width,
        height,
        panels,
        gutterColor,
        method: 'model',
        needsReview: boxes.length === 0 || meanScore(boxes) < REVIEW_MEAN_SCORE || boxes.some(box => box.score < REVIEW_MIN_SCORE)
      };
    } catch (error) {
      fallbackReason = `Panel model failed, used gutter detection: ${error?.message || error}`;
    }
  } else if (options.method !== 'gutters') {
    fallbackReason = 'Panel model not found, used gutter detection';
  }

  const gutterColor = options.gutter === 'white' ? [255, 255, 255]
    : options.gutter === 'black' ? [0, 0, 0]
      : null;
  const result = detectPanels(
    { data, width: info.width, height: info.height, channels: info.channels },
    {
      gutterColor,
      tolerance: Number(options.tolerance) || undefined,
      minAreaRatio: Number(options.minAreaPercent) > 0 ? Number(options.minAreaPercent) / 100 : undefined,
      rtl: Boolean(options.rtl)
    }
  );

  // Back to full-resolution pixels, rounding outward so no edge is lost.
  const sx = width / info.width;
  const sy = height / info.height;
  const panels = result.panels.map(box => {
    const x = Math.max(0, Math.floor(box.x * sx));
    const y = Math.max(0, Math.floor(box.y * sy));
    return {
      x,
      y,
      w: Math.min(width, Math.ceil((box.x + box.w) * sx)) - x,
      h: Math.min(height, Math.ceil((box.y + box.h) * sy)) - y
    };
  });

  return { width, height, panels, gutterColor: result.gutterColor, method: 'gutters', fallbackReason, needsReview: result.needsReview };
}

/** The e621 tagger runs on the GPU when it can: it's far heavier than the panel model. */
async function getTagger({ modelPath, vocabularyPath, kind = 'z3d' }) {
  if (tagger && tagger.modelPath === modelPath) return tagger;
  const ort = require('onnxruntime-node');
  const session = await createGpuSession(modelPath);
  tagger = { modelPath, kind, session, ort, vocabulary: parseVocabulary(fs.readFileSync(vocabularyPath, 'utf8')) };
  return tagger;
}

/**
 * e621 categories for tags the tagger doesn't know, looked up once and kept
 * for the session. If e621 can't be reached the tags simply stay unknown,
 * and the merge keeps them.
 */
async function lookupCategories(tags, vocabulary) {
  categoriesKnown = true;
  const missing = [...new Set(tags.map(toTaggerName))]
    .filter(name => !vocabulary.index.has(name) && !tagCategories.has(name));
  for (let i = 0; i < missing.length; i += 100) {
    const names = missing.slice(i, i + 100);
    try {
      const res = await fetch(`https://e621.net/tags.json?search[name]=${encodeURIComponent(names.join(','))}&limit=320`,
                { headers: { 'User-Agent': 'Antler/1.0 (panel tags)' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        categoriesKnown = false;
        continue;
      }
      const found = await res.json();
      if (Array.isArray(found)) found.forEach(tag => tagCategories.set(tag.name, tag.category));
    } catch {
      // Offline or rate limited: these tags stay unknown.
      categoriesKnown = false;
    }
  }
  return tagCategories;
}

/** Hydra's probabilities and its final tokens (for heatmaps) for an image file or encoded image. */
async function runHydra(input, { session, ort }) {
  const { data, height, width } = await prepareHydraImage(input);
  const result = await session.run({ image: new ort.Tensor('uint8', data, [height, width, 3]) });
  return { probs: result.probs.data, features: result.features, grid: { rows: height / PATCH, cols: width / PATCH } };
}

/**
 * Tagger scores for an image, prepared the way each tagger was trained:
 *  - hydra (Hydra 3.5, SigLIP2 NaFlex): see services/hydraImage.js; the
 *    model returns probabilities;
 *  - jtp (JTP PILOT2, SigLIP): fitted into 384px on mid grey, RGB scaled
 *    to -1..1, NCHW;
 *  - z3d (Z3D-E621-Convnext): padded to a white square, 448px, BGR 0-255,
 *    NHWC.
 */
async function tagScores(buffer, tagging) {
  const { session, ort, kind } = tagging;
  if (kind === 'hydra') return (await runHydra(buffer, tagging)).probs;

  if (kind === 'jtp') {
    const SIZE = 384;
    const grey = { r: 128, g: 128, b: 128 };
    const { data } = await sharp(buffer).flatten({ background: grey })
      .resize(SIZE, SIZE, { fit: 'contain', background: grey, kernel: 'lanczos3' })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const plane = SIZE * SIZE;
    const input = new Float32Array(3 * plane);
    for (let p = 0, i = 0; p < plane; p++, i += 3) {
      input[p] = data[i] / 127.5 - 1;
      input[plane + p] = data[i + 1] / 127.5 - 1;
      input[2 * plane + p] = data[i + 2] / 127.5 - 1;
    }
    const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
    return result[session.outputNames[0]].data;
  }

  const TAGGER_SIZE = 448;
  const { width, height } = await sharp(buffer).metadata();
  const side = Math.max(width, height);
  const { data } = await sharp(buffer).flatten({ background: '#ffffff' })
    .extend({
      top: Math.floor((side - height) / 2), bottom: Math.ceil((side - height) / 2),
      left: Math.floor((side - width) / 2), right: Math.ceil((side - width) / 2),
      background: '#ffffff'
    })
    .resize(TAGGER_SIZE, TAGGER_SIZE, { kernel: 'cubic' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const input = new Float32Array(TAGGER_SIZE * TAGGER_SIZE * 3);
  for (let p = 0; p < TAGGER_SIZE * TAGGER_SIZE; p++) {
    input[p * 3] = data[p * 3 + 2];
    input[p * 3 + 1] = data[p * 3 + 1];
    input[p * 3 + 2] = data[p * 3];
  }
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, TAGGER_SIZE, TAGGER_SIZE, 3]) });
  return result[session.outputNames[0]].data;
}

/**
 * The page's tag file (<page>.txt) and, when panels of it may be tagged, the
 * loaded tagger and e621 categories for tags the tagger doesn't know.
 */
async function pageTagging(inputPath, taggerFiles) {
  const parsed = path.parse(inputPath);
  const pageTagFile = path.join(parsed.dir, `${parsed.name}.txt`);
  const pageTags = taggerFiles && fs.existsSync(pageTagFile) ? parseTagFile(fs.readFileSync(pageTagFile, 'utf8')) : null;
  const tagging = pageTags ? await getTagger(taggerFiles) : null;
  const categories = tagging ? await lookupCategories(pageTags, tagging.vocabulary) : null;
  return { pageTags, tagging, categories };
}

/** Tag facts for each panel, without writing anything. */
async function previewTags(job) {
  const { pageTags, tagging, categories } = await pageTagging(job.inputPath, job.tagger);
  const result = { pageTagFile: Boolean(pageTags), categoriesKnown, panels: [] };
  if (!tagging) return result;

  const page = loadPage(job.inputPath);
  const { width, height } = await pageSize(job.inputPath);
  for (const box of job.panels) {
    const left = Math.max(0, Math.round(box.x));
    const top = Math.max(0, Math.round(box.y));
    const right = Math.min(width, Math.round(box.x + box.w));
    const bottom = Math.min(height, Math.round(box.y + box.h));
    if (right <= left || bottom <= top) {
      result.panels.push(null);
      continue;
    }
    const crop = await page.clone().extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
    result.panels.push(panelTagFacts(pageTags, await tagScores(crop, tagging), tagging.vocabulary, categories));
  }
  return result;
}

/** A small JPEG of each panel, for looking at many at once. */
async function panelThumbs(job) {
  const page = loadPage(job.inputPath);
  const { width, height } = await pageSize(job.inputPath);
  const thumbs = [];
  for (const box of job.panels) {
    const left = Math.max(0, Math.round(box.x));
    const top = Math.max(0, Math.round(box.y));
    const right = Math.min(width, Math.round(box.x + box.w));
    const bottom = Math.min(height, Math.round(box.y + box.h));
    if (right <= left || bottom <= top) {
      thumbs.push(null);
      continue;
    }
    thumbs.push(await page.clone().extract({ left, top, width: right - left, height: bottom - top })
      .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer());
  }
  return { thumbs };
}

/** Unchanged tag files are left alone, so bak/ keeps the last real version. */
function writePanelTags(filePath, tags) {
  const text = formatTagFile(tags);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === text) return;
  // Re-exporting keeps a caption edited since the last export in bak/.
  writeFileSafeSync(filePath, text, { backup: true });
}

async function exportPanels(job) {
  const format = FORMATS.has(job.format) ? job.format : 'png';
  const padding = Math.max(0, Math.round(Number(job.padding) || 0));
  const page = loadPage(job.inputPath);
  const { width, height } = await pageSize(job.inputPath);
  const files = [];
  const kept = [];
  const names = job.panels.map(() => null);
  const taken = new Set(job.panels.map(box => box.exportName).filter(Boolean));

  const { pageTags, tagging, categories } = await pageTagging(job.inputPath, job.tagger);
  const tags = { written: 0, unverified: new Set(), pageTagFile: Boolean(pageTags) };

  for (let i = 0; i < job.panels.length; i++) {
    const box = job.panels[i];
    // Reviewed tags from the Panel tags pane win over a fresh merge.
    const reviewed = Array.isArray(job.panelTags?.[i]) ? job.panelTags[i] : null;
    if (job.live && !reviewed) continue;

    const left = Math.max(0, Math.round(box.x) - padding);
    const top = Math.max(0, Math.round(box.y) - padding);
    const right = Math.min(width, Math.round(box.x + box.w) + padding);
    const bottom = Math.min(height, Math.round(box.y + box.h) + padding);
    if (right <= left || bottom <= top) continue;

    const name = box.exportName || freePanelName(job.baseName, i + 1, job.outputDir, taken);
    const existing = findPanelImage(job.outputDir, name);
    if (job.live && !existing && !box.tagEdits?.final) continue;
    fs.mkdirSync(job.outputDir, { recursive: true });
    names[i] = name;

    let crop = null;
    if (!existing || (tagging && !reviewed)) {
      crop = page.clone().extract({ left, top, width: right - left, height: bottom - top });

      // Non-rectangular panels: gutter colour reaching in from the crop's edge
      // is either repainted solid (clearing neighbouring panels' slivers) or
      // made transparent.
      if (job.outside === 'gutter' || job.outside === 'transparent') {
        const { data, info } = await crop.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const outside = floodFromBorder(
          colorMask(data, info.width, info.height, 4, job.gutterColor, Number(job.tolerance) || 40),
          info.width,
          info.height
        );
        const [r, g, b] = job.gutterColor;
        for (let p = 0; p < outside.length; p++) {
          if (!outside[p]) continue;
          if (job.outside === 'transparent') data[p * 4 + 3] = 0;
          else data.set([r, g, b, 255], p * 4);
        }
        crop = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      }
    }

    if (reviewed || tagging) {
      const merged = reviewed
        ? { tags: reviewed, unverified: [] }
        : mergePanelTags(pageTags, await tagScores(await crop.clone().png().toBuffer(), tagging), tagging.vocabulary, categories);
      writePanelTags(path.join(job.outputDir, `${name}.txt`), merged.tags);
      merged.unverified.forEach(tag => tags.unverified.add(tag));
      tags.written++;
    }

    if (existing) {
      kept.push(existing);
      continue;
    }

    const outputPath = path.join(job.outputDir, `${name}.${format}`);
    if (format === 'jpg') crop = crop.flatten({ background: '#ffffff' }).jpeg({ quality: 95, mozjpeg: true });
    else if (format === 'webp') crop = crop.webp({ quality: 95 });
    else crop = crop.png({ compressionLevel: 6 });

    await crop.toFile(outputPath);
    files.push(outputPath);
  }

  return { files, kept, names, tags: { ...tags, unverified: [...tags.unverified] } };
}

// ------------------------------------------------------------ Image Cleanup

const BUBBLE_SIZE = 640;
const BUBBLE_THRESHOLD = 0.5;
const BUBBLE_LABELS = ['bubble', 'text_bubble', 'text_free'];
const DEFAULT_MARGIN = 8;

/** The image's RGB pixels, as shown on screen (EXIF rotation applied); kept for the next click. */
async function cleanupImage(inputPath) {
  const { mtimeMs } = fs.statSync(inputPath);
  if (bubbleImage && bubbleImage.inputPath === inputPath && bubbleImage.mtimeMs === mtimeMs) return bubbleImage;
  const { data, info } = await loadPage(inputPath).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  bubbleImage = { inputPath, mtimeMs, data, width: info.width, height: info.height };
  return bubbleImage;
}

// The bubble model (RT-DETR, comic-text-and-bubble-detector) takes 640 x 640
// RGB 0-1 and returns boxes in the size it's told the image is.
async function getBubbleModel(modelPath) {
  if (bubbleModel && bubbleModel.modelPath === modelPath) return bubbleModel;
  const ort = require('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], logSeverityLevel: 3 });
  bubbleModel = { modelPath, session, ort };
  return bubbleModel;
}

const inside = (inner, outer) => inner[0] >= outer[0] - 4 && inner[1] >= outer[1] - 4 && inner[2] <= outer[2] + 4 && inner[3] <= outer[3] + 4;

async function findBubbles({ inputPath, modelPath, freeText = false, margin = DEFAULT_MARGIN }) {
  const img = await cleanupImage(inputPath);
  const { session, ort } = await getBubbleModel(modelPath);
  const resized = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(BUBBLE_SIZE, BUBBLE_SIZE, { fit: 'fill', kernel: sharp.kernel.cubic })
    .raw().toBuffer();
  const plane = BUBBLE_SIZE * BUBBLE_SIZE;
  const input = new Float32Array(3 * plane);
  for (let p = 0, i = 0; p < plane; p++, i += 3) {
    input[p] = resized[i] / 255;
    input[plane + p] = resized[i + 1] / 255;
    input[2 * plane + p] = resized[i + 2] / 255;
  }
  const result = await session.run({
    images: new ort.Tensor('float32', input, [1, 3, BUBBLE_SIZE, BUBBLE_SIZE]),
    orig_target_sizes: new ort.Tensor('int64', BigInt64Array.from([BigInt(img.width), BigInt(img.height)]), [1, 2])
  });

  const found = [];
  const scores = result.scores.data;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < BUBBLE_THRESHOLD) continue;
    found.push({ label: BUBBLE_LABELS[Number(result.labels.data[i])], score: scores[i], box: Array.from(result.boxes.data.slice(i * 4, i * 4 + 4)) });
  }

  const bubbles = found.filter(item => item.label === 'bubble');
  const regions = [];
  for (const item of found) {
    // Lettering inside a found bubble is covered by the bubble; lettering
    // the model saw without its bubble (a caption box) is masked as a box.
    if (item.label === 'text_bubble' && bubbles.some(bubble => inside(item.box, bubble.box))) continue;
    if (item.label === 'text_free' && !freeText) continue;
    const region = item.label === 'bubble' ? bubbleInBox(img, item.box) : boxRegion(img, item.box);
    if (region) regions.push({ ...grow(region, margin, img.width, img.height), label: item.label, score: Math.round(item.score * 100) / 100 });
  }
  return { width: img.width, height: img.height, regions };
}

async function regionAt({ inputPath, x, y, margin = DEFAULT_MARGIN }) {
  const img = await cleanupImage(inputPath);
  const region = bubbleAt(img, Number(x), Number(y));
  return { width: img.width, height: img.height, region: region && grow(region, margin, img.width, img.height) };
}

// ------------------------------------------------------- Tag Editor (Hydra)

let hydraCam = null;  // { modelPath, session }
let hydraLast = null; // { inputPath, mtimeMs, modelPath, probs, features, grid }, the last image tagged

async function createGpuSession(modelPath) {
  const ort = require('onnxruntime-node');
  const attempts = process.platform === 'win32' ? [[{ name: 'dml', deviceId: 0 }, 'cpu'], ['cpu']] : [['cpu']];
  let lastError;
  for (const executionProviders of attempts) {
    try {
      return await ort.InferenceSession.create(modelPath, { executionProviders, enableMemPattern: false, executionMode: 'sequential', logSeverityLevel: 3 });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Hydra's output for an image file, reused while the file is unchanged. */
async function hydraFor(inputPath, taggerFiles) {
  // Loaded first either way: callers use its vocabulary.
  const tagging = await getTagger(taggerFiles);
  const { mtimeMs } = fs.statSync(inputPath);
  if (hydraLast && hydraLast.inputPath === inputPath && hydraLast.mtimeMs === mtimeMs && hydraLast.modelPath === taggerFiles.modelPath) {
    return hydraLast;
  }
  hydraLast = { inputPath, mtimeMs, modelPath: taggerFiles.modelPath, ...await runHydra(inputPath, tagging) };
  return hydraLast;
}

/** Hydra's score for each of the image's tags, and confident tags it doesn't have. */
async function hydraTags({ inputPath, tags = [], hidden = [], all = false, tagger: taggerFiles }) {
  const { probs, grid } = await hydraFor(inputPath, taggerFiles);
  return { ...reviewImageTags(tags, probs, tagger.vocabulary, hidden, { all }), grid };
}

/**
 * Where in the image Hydra found a tag: one value per 16px patch, row by
 * row, positive where the patch supports the tag and negative where it
 * argues against it (the Hydra demo's CAM at depth 1).
 */
async function hydraHeatmap({ inputPath, tag, tagger: taggerFiles }) {
  const { features, grid } = await hydraFor(inputPath, taggerFiles);
  const index = tagger.vocabulary.index.get(toTaggerName(String(tag)));
  if (index === undefined) throw new Error(`Hydra doesn't know the tag "${tag}"`);

  if (!hydraCam || hydraCam.modelPath !== taggerFiles.camPath) {
    hydraCam = { modelPath: taggerFiles.camPath, session: await createGpuSession(taggerFiles.camPath) };
  }
  const { ort } = tagger;
  const result = await hydraCam.session.run({
    features: new ort.Tensor('float32', features.data, features.dims),
    tag: new ort.Tensor('int64', BigInt64Array.from([BigInt(index)]), [1])
  });
  return { values: Array.from(result.cam.data), grid };
}

const HANDLERS = {
  detect, export: exportPanels, tags: previewTags, thumbs: panelThumbs, bubbles: findBubbles, 'bubble-at': regionAt,
  'hydra-tags': hydraTags, 'hydra-heatmap': hydraHeatmap
};

process.parentPort.on('message', ({ data: job }) => {
  const handler = job && HANDLERS[job.type];
  if (!handler) return;

  queue = queue.then(async () => {
    try {
      const result = await handler(job);
      process.parentPort.postMessage({ id: job.id, type: 'done', result });
    } catch (error) {
      process.parentPort.postMessage({ id: job.id, type: 'error', message: error?.message || String(error) });
    }
  });
});
