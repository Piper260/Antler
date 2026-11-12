/**
 * The bench's files, all under bench/signatures/ (not in git):
 *   sample.json        the images every run uses, so runs compare
 *   truth.json         what you marked in the report, by image path
 *   runs.json          every run's summary, newest last
 *   runs/<id>.json     a run's finds per image, with the raw model output
 *   images/<key>.jpg   small copies of the images for the report
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', 'bench', 'signatures');
const RUNS = path.join(ROOT, 'runs');
const IMAGES = path.join(ROOT, 'images');

const file = (name) => path.join(ROOT, name);

function ensureDirs() {
  for (const dir of [ROOT, RUNS, IMAGES]) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDirs();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, filePath);
}

const imageKey = (imagePath) => crypto.createHash('sha1').update(imagePath).digest('hex').slice(0, 16);

const loadSample = () => readJson(file('sample.json'), null);
const saveSample = (sample) => writeJson(file('sample.json'), sample);
const loadTruth = () => readJson(file('truth.json'), {});
const saveTruth = (truth) => writeJson(file('truth.json'), truth);
const loadRuns = () => readJson(file('runs.json'), []);
const saveRuns = (runs) => writeJson(file('runs.json'), runs);
const loadRun = (id) => readJson(path.join(RUNS, `${path.basename(id)}.json`), null);
const saveRun = (run) => writeJson(path.join(RUNS, `${run.id}.json`), run);

/** The newest run that ran the models (rescores reuse its raw output). */
function latestModelRun() {
  const runs = loadRuns().filter(r => r.kind === 'models');
  return runs.length ? loadRun(runs[runs.length - 1].id) : null;
}

function newRunId(kind) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  return `${stamp}-${kind}`;
}

/** Adds a run's summary to runs.json (without the per-image detail). */
function recordRun(run, summary) {
  const { perImage, ...totals } = summary;
  const runs = loadRuns().filter(r => r.id !== run.id);
  runs.push({ id: run.id, kind: run.kind, label: run.label, date: run.date, options: run.options, images: run.images.length, summary: totals });
  saveRuns(runs);
}

module.exports = {
  ROOT, RUNS, IMAGES, ensureDirs, imageKey, readJson,
  loadSample, saveSample, loadTruth, saveTruth, loadRuns, saveRuns, loadRun, saveRun, latestModelRun, newRunId, recordRun
};
