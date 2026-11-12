/**
 * Dataset check: crawls dataset folders and lists what needs attention,
 * each with a quick fix (see ipc/DatasetHealthIPC.js). Nothing here changes
 * a file except moveToBak and dedupeCaption, and moves only ever go into the
 * dataset's own bak/<reason> folder, so every fix can be undone by hand.
 *
 * A dataset is a folder of images with a caption file each (<stem>.txt
 * beside <stem>.png), possibly in category subfolders; bak/ and hidden
 * folders are never looked in.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.swf', '.avi']);
const TEMP_EXTENSIONS = new Set(['.part', '.tmp', '.crdownload', '.download']);
const SKIP_DIRS = new Set(['bak', 'node_modules']);

// Every kind of finding, in the order shown, with its fix.
const KINDS = {
  'missing-caption': { title: 'Images without a caption file', fix: 'tag' },
  'empty-caption': { title: 'Empty caption files', fix: 'tag' },
  'orphan-caption': { title: 'Captions whose image is gone', fix: 'move', bak: 'orphan-captions' },
  'duplicate-tags': { title: 'Captions with a tag twice', fix: 'dedupe' },
  video: { title: 'Videos in an image dataset', fix: 'move', bak: 'videos' },
  duplicate: { title: 'The same image twice in a dataset', fix: 'move', bak: 'duplicates' },
  'low-res': { title: 'Images below the training size', fix: 'move', bak: 'low-res' },
  temp: { title: 'Unfinished downloads', fix: 'move', bak: 'temp' },
  'cross-duplicate': { title: 'The same image in more than one dataset', fix: null }
};

const stemOf = (file) => file.slice(0, file.length - path.extname(file).length);
const normalizeTag = (tag) => tag.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');

/** Every file in a dataset, by folder, skipping bak and hidden folders. */
async function listDataset(root) {
  const files = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith('.')) await walk(full);
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        // Hidden files are tools' own (.taggui_protected_tags.txt), not dataset files.
        files.push(full);
      }
    }
  };
  await walk(root);
  return files;
}

/** The tags of a caption file's text. */
function parseCaption(text) {
  return text.split(',').map(t => t.trim()).filter(Boolean);
}

/** The median number of tags in a dataset's captions, or null with none. */
function typicalLength(captions) {
  const counts = captions.map(tags => tags.length).filter(n => n > 0).sort((a, b) => a - b);
  return counts.length ? counts[counts.length >> 1] : null;
}

/**
 * The tag most captions in a dataset start with, when most of them share
 * one (a trigger word such as an artist's name), else null.
 */
function commonFirstTag(captions) {
  const counts = new Map();
  let total = 0;
  for (const tags of captions) {
    if (!tags.length) continue;
    total++;
    const key = normalizeTag(tags[0]);
    counts.set(key, { tag: tags[0], n: (counts.get(key)?.n || 0) + 1 });
  }
  let best = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best && total >= 3 && best.n / total >= 0.6 ? best.tag : null;
}

async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', d => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

/**
 * Checks one dataset.
 * @param {string} root - the dataset folder
 * @param {{minSide?: number, imageSize?: (file) => Promise<{width, height}|null>}} options
 *   imageSize reads an image's size (sharp in the app; tests pass their own)
 * @returns {Promise<{images: number, captions: number, findings: object, triggerTag: string|null, sizes: Map, files: string[]}>}
 *   findings maps a kind to the files it applies to (paths); sizes maps an image to its byte size
 */
async function checkDataset(root, { minSide = 0, imageSize = null } = {}) {
  const files = await listDataset(root);
  const byFolder = new Map();
  for (const file of files) {
    const dir = path.dirname(file);
    if (!byFolder.has(dir)) byFolder.set(dir, []);
    byFolder.get(dir).push(file);
  }

  const findings = Object.fromEntries(Object.keys(KINDS).map(k => [k, []]));
  const images = [];
  const captionTags = [];
  let captionCount = 0;

  for (const list of byFolder.values()) {
    const stems = new Map(); // stem (lower case) -> kinds present
    for (const file of list) {
      const ext = path.extname(file).toLowerCase();
      const key = stemOf(file).toLowerCase();
      if (!stems.has(key)) stems.set(key, { image: null, caption: null, video: null });
      const slot = stems.get(key);
      if (IMAGE_EXTENSIONS.has(ext)) slot.image = file;
      else if (ext === '.txt') slot.caption = file;
      else if (VIDEO_EXTENSIONS.has(ext)) slot.video = file;
      else if (TEMP_EXTENSIONS.has(ext)) findings.temp.push(file);
    }
    for (const { image, caption, video } of stems.values()) {
      if (video) findings.video.push(video);
      if (image) images.push(image);
      if (image && !caption) findings['missing-caption'].push(image);
      if (caption) {
        captionCount++;
        // A caption for a video belongs to it; it moves with the video.
        if (!image && !video) findings['orphan-caption'].push(caption);
        let text = '';
        try {
          text = await fsp.readFile(caption, 'utf8');
        } catch {
          continue;
        }
        const tags = parseCaption(text);
        if (image && !tags.length) findings['empty-caption'].push(image);
        if (tags.length) captionTags.push(tags);
        const seen = new Set();
        if (tags.some(t => (seen.has(normalizeTag(t)) ? true : (seen.add(normalizeTag(t)), false)))) findings['duplicate-tags'].push(caption);
      }
    }
  }

  // Exact duplicates: only files of the same size are hashed.
  const sizes = new Map();
  const bySize = new Map();
  for (const image of images) {
    let size = 0;
    try {
      size = (await fsp.stat(image)).size;
    } catch {
      continue;
    }
    sizes.set(image, size);
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(image);
  }
  const hashes = new Map();
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const byHash = new Map();
    for (const image of group) {
      const hash = await hashFile(image);
      hashes.set(image, hash);
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(image);
    }
    // Keep the first by name; the rest are the extra copies.
    for (const same of byHash.values()) {
      if (same.length > 1) findings.duplicate.push(...same.sort((a, b) => a.localeCompare(b)).slice(1));
    }
  }

  if (minSide > 0 && imageSize) {
    // Image headers are read a few at a time: most of a check is spent here.
    const small = new Set();
    let next = 0;
    const worker = async () => {
      while (next < images.length) {
        const image = images[next++];
        const size = await imageSize(image).catch(() => null);
        if (size && Math.min(size.width, size.height) < minSide) small.add(image);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    findings['low-res'].push(...images.filter(image => small.has(image)));
  }

  return { images: images.length, captions: captionCount, findings, triggerTag: commonFirstTag(captionTags), typicalTags: typicalLength(captionTags), sizes, hashes, files: images };
}

/**
 * The same image in more than one dataset: images of the same byte size in
 * different datasets are hashed and compared.
 * @param {Array<{name: string, sizes: Map<string, number>, hashes: Map<string, string>}>} datasets
 * @returns {Array<{hash, files: Array<{dataset, file}>}>}
 */
async function crossDuplicates(datasets) {
  const bySize = new Map();
  for (const ds of datasets) {
    for (const [file, size] of ds.sizes) {
      if (!bySize.has(size)) bySize.set(size, []);
      bySize.get(size).push({ ds, file });
    }
  }
  const groups = new Map();
  for (const list of bySize.values()) {
    if (new Set(list.map(e => e.ds)).size < 2) continue;
    for (const { ds, file } of list) {
      let hash = ds.hashes.get(file);
      if (!hash) {
        hash = await hashFile(file).catch(() => null);
        if (!hash) continue;
        ds.hashes.set(file, hash);
      }
      if (!groups.has(hash)) groups.set(hash, []);
      groups.get(hash).push({ dataset: ds.name, file });
    }
  }
  return [...groups.entries()]
    .filter(([, files]) => new Set(files.map(f => f.dataset)).size > 1)
    .map(([hash, files]) => ({ hash, files }));
}

/** A free path in `dir` for `name` (name, name-2, name-3, ...). */
function freePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem}-${n}${ext}`);
  return candidate;
}

/**
 * Moves files (with their caption, when it's a picture or video) into
 * <dataset>/bak/<reason>/, keeping their place under the dataset.
 * @returns {Promise<{moved: number, failed: Array<{file, message}>}>}
 */
async function moveToBak(datasetRoot, files, reason) {
  let moved = 0;
  const failed = [];
  for (const file of files) {
    const companions = [file];
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.txt') {
      const caption = `${stemOf(file)}.txt`;
      if (fs.existsSync(caption)) companions.push(caption);
    }
    for (const source of companions) {
      try {
        const rel = path.relative(datasetRoot, path.dirname(source));
        const dir = path.join(datasetRoot, 'bak', reason, rel);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.rename(source, freePath(dir, path.basename(source)));
        if (source === file) moved++;
      } catch (error) {
        failed.push({ file: source, message: error.message });
      }
    }
  }
  return { moved, failed };
}

/** Rewrites a caption with each tag once, keeping the first of each and the order. */
async function dedupeCaption(file, writeFile) {
  const text = await fsp.readFile(file, 'utf8');
  const seen = new Set();
  const tags = parseCaption(text).filter((t) => {
    const key = normalizeTag(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await writeFile(file, tags.join(', '));
  return tags.length;
}

/**
 * A caption for an image from Hydra's suggestions: the dataset's trigger
 * tag first when it has one, then the suggested tags of the chosen
 * categories at or above the threshold, strongest first, never a hidden tag,
 * and no more tags than maxTags (the dataset's usual caption length: Hydra is
 * sure of far more tags than a caption usually has).
 */
function buildCaption(suggestions, { triggerTag = null, threshold = 0.5, categories = ['general', 'species', 'character', 'copyright'], hidden = [], maxTags = 40 } = {}) {
  const never = new Set(hidden.map(normalizeTag));
  const wanted = new Set(categories);
  const tags = [];
  const seen = new Set();
  const add = (tag) => {
    const key = normalizeTag(tag);
    if (!key || seen.has(key) || never.has(key) || tags.length >= maxTags) return;
    seen.add(key);
    tags.push(tag.trim());
  };
  if (triggerTag) add(triggerTag);
  for (const s of [...suggestions].sort((a, b) => b.score - a.score)) {
    if (s.score >= threshold && wanted.has(s.category)) add(s.tag);
  }
  return tags.join(', ');
}

module.exports = {
  KINDS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS,
  listDataset, checkDataset, crossDuplicates, commonFirstTag, typicalLength, parseCaption, moveToBak, dedupeCaption, buildCaption, normalizeTag
};
