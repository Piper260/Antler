/**
 * Re-runs the signature finder on the raw model output of the last model
 * run, with the finder's current code and any settings given, and scores
 * it. Plain Node and fast, for tuning services/signatureFind.js.
 *
 *   node scripts/signature-bench/rescore.js                      current code and defaults
 *   node scripts/signature-bench/rescore.js camShare=0.5 minScore=0.4
 *   node scripts/signature-bench/rescore.js --label "edge bonus" --from <run id>
 *   node scripts/signature-bench/rescore.js --list               the runs so far
 */
const store = require('./store');
const { scoreRun, summaryLine } = require('./score');

function parseArgs(argv) {
  const options = {};
  let label = '';
  let from = null;
  let list = false;
  let save = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--label') label = argv[++i] || '';
    else if (arg === '--from') from = argv[++i];
    else if (arg === '--list') list = true;
    else if (arg === '--dry') save = false;
    else if (arg.includes('=')) {
      const [key, value] = arg.split('=');
      options[key] = Number(value);
    }
  }
  return { options, label, from, list, save };
}

function printRuns() {
  const runs = store.loadRuns();
  if (!runs.length) return console.log('No runs yet.');
  for (const r of runs) {
    const opts = Object.keys(r.options || {}).length ? ` ${JSON.stringify(r.options)}` : '';
    console.log(`${r.id}${r.label ? ` "${r.label}"` : ''}${opts}\n  ${summaryLine(r.summary)}`);
  }
}

function main() {
  const { options, label, from, list, save } = parseArgs(process.argv.slice(2));
  if (list) return printRuns();
  // Fresh each time, so edits to the finder are picked up.
  const { findSignatures } = require('../../src/main/services/signatureFind');
  const base = from ? store.loadRun(from) : store.latestModelRun();
  if (!base) {
    console.error('No model run yet. Run `npm run bench:signatures` first.');
    process.exit(1);
  }
  const images = base.images.map(image => ({
    ...image,
    candidates: image.raw ? findSignatures({ width: image.width, height: image.height, ...image.raw }, options) : image.candidates
  }));
  const run = { id: store.newRunId('rescore'), kind: 'rescore', label, date: new Date().toISOString(), from: base.id, options, images };
  const summary = scoreRun(images, store.loadTruth());
  if (save) {
    store.saveRun(run);
    store.recordRun(run, summary);
  }
  console.log(`${save ? run.id : '(not saved)'} from ${base.id}${label ? ` "${label}"` : ''}`);
  console.log(summaryLine(summary));
}

main();
