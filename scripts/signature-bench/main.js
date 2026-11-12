/**
 * Signature bench: runs Image Cleanup's signature finder on a fixed sample
 * of your dataset images, scores it against what you've marked, and opens
 * the report where you mark more. Runs in Electron (the models run in the
 * same worker the app uses).
 *
 *   npm run bench:signatures                              run on the saved sample (picks one the first time)
 *   npm run bench:signatures -- --root "F:\Datasets"       where to pick the sample from (default: your libraries)
 *   npm run bench:signatures -- --tagged 40 --untagged 30  sample size: images tagged signature/watermark, and not
 *   npm run bench:signatures -- --resample                 pick a new sample (your marks are kept)
 *   npm run bench:signatures -- --label "what changed" --no-open --no-serve
 *
 * Tuning without running the models again: scripts/signature-bench/rescore.js.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// The app's own data folder, so models in <user data>/models are found.
app.setName('antler');
app.setPath('userData', path.join(app.getPath('appData'), 'antler'));

const sharp = require('sharp');
const store = require('./store');
const { scoreRun, summaryLine } = require('./score');
const { findModelFile } = require('../../src/main/utils/modelPaths');
const { findTagger } = require('../../src/main/utils/taggers');

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
const MARK_TAGS = new Set(['signature', 'watermark', 'distracting_watermark', 'artist_name', 'text_watermark']);
const PREVIEW_EDGE = 1024;

function parseArgs(argv) {
  const args = { tagged: 40, untagged: 30, seed: 7, label: '', resample: false, serve: true, open: true, root: null, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--tagged') args.tagged = Number(argv[++i]);
    else if (a === '--untagged') args.untagged = Number(argv[++i]);
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--label') args.label = argv[++i] || '';
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--resample') args.resample = true;
    else if (a === '--no-serve') args.serve = false;
    else if (a === '--no-open') args.open = false;
  }
  return args;
}

/** Library folders from Antler's settings, when --root isn't given. */
function libraryRoots() {
  const settings = store.readJson(path.join(app.getPath('userData'), 'settings.json'), {});
  const roots = (settings.storage?.libraries || []).map(l => l.path).filter(Boolean);
  return roots.filter(r => fs.existsSync(r));
}

function tagsOf(txtPath) {
  try {
    return fs.readFileSync(txtPath, 'utf8').split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
  } catch {
    return null;
  }
}

/** Every image with a tag file, in each dataset folder under the roots. */
function listImages(roots) {
  const out = [];
  const scan = (dir, folder) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isFile() || !IMAGE_EXT.test(e.name)) continue;
      const imagePath = path.join(dir, e.name);
      const tags = tagsOf(imagePath.replace(/\.[^.]+$/, '.txt'));
      if (tags) out.push({ path: imagePath, folder, tagged: tags.some(t => MARK_TAGS.has(t)) });
    }
  };
  for (const root of roots) {
    scan(root, path.basename(root));
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'bak') scan(path.join(root, e.name), e.name);
    }
  }
  return out;
}

function shuffled(list, seed) {
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** `count` images spread across folders, round robin. */
function spread(list, count, seed) {
  const byFolder = new Map();
  for (const item of shuffled(list, seed)) {
    if (!byFolder.has(item.folder)) byFolder.set(item.folder, []);
    byFolder.get(item.folder).push(item);
  }
  const queues = shuffled([...byFolder.values()], seed + 1);
  const picked = [];
  while (picked.length < count && queues.some(q => q.length)) {
    for (const q of queues) if (q.length && picked.length < count) picked.push(q.shift());
  }
  return picked;
}

function pickSample(args) {
  const roots = args.root ? [args.root] : libraryRoots();
  if (!roots.length) throw new Error('No dataset folders found. Pass --root "F:\\Datasets".');
  const all = listImages(roots);
  const tagged = spread(all.filter(i => i.tagged), args.tagged, args.seed);
  const untagged = spread(all.filter(i => !i.tagged), args.untagged, args.seed + 2);
  console.log(`Picked ${tagged.length} tagged and ${untagged.length} untagged images from ${all.length} in ${roots.join(', ')}`);
  return [...tagged, ...untagged];
}

async function preview(imagePath) {
  const key = store.imageKey(imagePath);
  const out = path.join(store.IMAGES, `${key}.jpg`);
  if (!fs.existsSync(out)) {
    await sharp(imagePath, { limitInputPixels: false }).rotate().flatten({ background: '#ffffff' })
      .resize(PREVIEW_EDGE, PREVIEW_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }).toFile(out);
  }
  const { width, height } = await sharp(out).metadata();
  return { key, w: width, h: height };
}

const round = (values, places = 4) => values.map(v => Math.round(v * 10 ** places) / 10 ** places);

async function run(args) {
  store.ensureDirs();
  let sample = args.resample ? null : store.loadSample();
  if (!sample) {
    sample = pickSample(args);
    store.saveSample(sample);
  }
  if (args.limit > 0) sample = sample.slice(0, args.limit);

  const modelPath = findModelFile(path.join('comic', 'comic-bubbles.onnx'));
  if (!modelPath) throw new Error('comic-bubbles.onnx not found');
  const tagger = findTagger({ kinds: ['hydra'] });
  if (!tagger) console.warn('Hydra (with its heatmap model) not found: only the text model is used.');

  const ComicVisionService = require('../../src/main/services/ComicVisionService');
  const vision = new ComicVisionService();
  const images = [];
  const started = Date.now();
  for (let i = 0; i < sample.length; i++) {
    const item = sample[i];
    const t0 = Date.now();
    try {
      const [shot, result] = [await preview(item.path), await vision.run('signatures', { inputPath: item.path, modelPath, tagger, debug: true })];
      const { probs, texts, cams } = result.debug;
      for (const k of Object.keys(cams)) cams[k] = { values: round(cams[k].values), grid: cams[k].grid };
      images.push({ ...item, width: result.width, height: result.height, preview: shot, raw: { probs, texts, cams }, candidates: result.candidates, ms: Date.now() - t0 });
      process.stdout.write(`\r${i + 1}/${sample.length} ${path.basename(item.path).slice(0, 40).padEnd(40)} ${result.candidates.length} found`);
    } catch (error) {
      console.log(`\n${item.path}: ${error.message}`);
      images.push({ ...item, error: error.message, candidates: [] });
    }
  }
  vision.dispose();
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s`);

  const runRecord = { id: store.newRunId('models'), kind: 'models', label: args.label, date: new Date().toISOString(), options: {}, images };
  const summary = scoreRun(images, store.loadTruth());
  store.saveRun(runRecord);
  store.recordRun(runRecord, summary);
  console.log(summaryLine(summary));
}

app.whenReady().then(async () => {
  const args = parseArgs(process.argv.slice(process.defaultApp ? 2 : 1));
  try {
    await run(args);
  } catch (error) {
    console.error(error.message);
    app.exit(1);
    return;
  }
  if (!args.serve) return app.exit(0);
  const { serve } = require('./serve');
  await serve({ open: args.open });
});

// No windows: keep running for the report server until Ctrl+C.
app.on('window-all-closed', () => {});
