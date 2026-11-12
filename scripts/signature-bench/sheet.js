/**
 * Contact sheets of a bench run, for looking at many results at once:
 * each image with its finds (green), your marked boxes (orange, dashed) and
 * the text model's lettering boxes (blue, thin), tiled into PNGs under
 * bench/signatures/sheets/<run id>/.
 *
 *   node scripts/signature-bench/sheet.js [run id] [--only tagged|untagged|problems] [--crops]
 *
 * --crops makes a sheet of each find cut out and enlarged instead.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const store = require('./store');
const { scoreImage } = require('./score');

const TILE = 360;
const COLS = 5;
const PER_SHEET = 20;
const LABEL = 34;

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function tile(image, truth) {
  const src = path.join(store.IMAGES, `${image.preview.key}.jpg`);
  const scale = Math.min(TILE / image.width, (TILE - LABEL) / image.height);
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);
  const r = (b, cls) => `<rect x="${b.x * scale}" y="${b.y * scale}" width="${b.w * scale}" height="${b.h * scale}" class="${cls}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <style>.t{fill:none;stroke:#3b82f6;stroke-width:1}.f{fill:none;stroke:#22c55e;stroke-width:2.5}.m{fill:none;stroke:#f59e0b;stroke-width:2;stroke-dasharray:5 3}text{font:bold 13px sans-serif;fill:#22c55e;stroke:#000;stroke-width:3px;paint-order:stroke}</style>
    ${(image.raw?.texts || []).filter(t => t.label === 'text_free').map(t => r(t, 't')).join('')}
    ${image.candidates.map((c, n) => r(c, 'f') + `<text x="${c.x * scale + 2}" y="${Math.max(12, c.y * scale - 2)}">${n + 1}</text>`).join('')}
    ${(truth?.boxes || []).map(b => r(b, 'm')).join('')}
  </svg>`;
  const body = await sharp(src).resize(w, h).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  const sig = image.raw?.probs?.signature ?? '-';
  const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/>
    <text x="4" y="14" style="font:12px sans-serif;fill:#ddd">${esc(`${image.n}. ${image.folder} ${image.tagged ? '[tagged]' : ''}`)}</text>
    <text x="4" y="29" style="font:12px sans-serif;fill:#aaa">${esc(`hydra sig ${sig} wm ${image.raw?.probs?.watermark ?? '-'} | ${image.candidates.map(c => c.score).join(' ') || 'no finds'}`)}</text></svg>`;
  return sharp({ create: { width: TILE, height: TILE, channels: 3, background: '#222' } })
    .composite([{ input: Buffer.from(label), top: 0, left: 0 }, { input: body, top: LABEL, left: Math.round((TILE - w) / 2) }])
    .png().toBuffer();
}

async function cropTile(image, c, n) {
  const src = path.join(store.IMAGES, `${image.preview.key}.jpg`);
  const s = image.preview.w / image.width;
  const pad = Math.max(c.w, c.h) * 0.4;
  const left = Math.max(0, Math.floor((c.x - pad) * s));
  const top = Math.max(0, Math.floor((c.y - pad) * s));
  const width = Math.max(4, Math.min(image.preview.w - left, Math.ceil((c.w + pad * 2) * s)));
  const height = Math.max(4, Math.min(image.preview.h - top, Math.ceil((c.h + pad * 2) * s)));
  const body = await sharp(src).extract({ left, top, width, height }).resize(TILE, TILE - LABEL, { fit: 'contain', background: '#222' }).png().toBuffer();
  const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/>
    <text x="4" y="14" style="font:12px sans-serif;fill:#ddd">${esc(`${image.n}.${n + 1} ${image.folder} ${c.kind} ${c.score}`)}</text>
    <text x="4" y="29" style="font:11px sans-serif;fill:#aaa">${esc(Object.entries(c.why).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : v}`).join(' '))}</text></svg>`;
  return sharp({ create: { width: TILE, height: TILE, channels: 3, background: '#222' } })
    .composite([{ input: Buffer.from(label), top: 0, left: 0 }, { input: body, top: LABEL, left: 0 }]).png().toBuffer();
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const crops = argv.includes('--crops');
  const id = argv.find(a => !a.startsWith('--') && a !== only);
  const runs = store.loadRuns();
  const run = store.loadRun(id || runs[runs.length - 1]?.id);
  if (!run) throw new Error('No run');
  const truth = store.loadTruth();
  let images = run.images.map((image, i) => ({ ...image, n: i + 1 })).filter(i => !i.error && i.preview);
  if (only === 'tagged') images = images.filter(i => i.tagged);
  if (only === 'untagged') images = images.filter(i => !i.tagged);
  if (only === 'problems') images = images.filter(i => {
    const t = truth[i.path];
    if (!t?.reviewed) return false;
    const s = scoreImage(i.candidates, t);
    return s.found < s.truth || s.wrong > 0;
  });

  const tiles = crops
    ? (await Promise.all(images.flatMap(image => image.candidates.map((c, n) => cropTile(image, c, n)))))
    : await Promise.all(images.map(image => tile(image, truth[image.path])));
  const dir = path.join(store.ROOT, 'sheets', run.id);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (let s = 0; s * PER_SHEET < tiles.length; s++) {
    const part = tiles.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
    const rows = Math.ceil(part.length / COLS);
    const out = path.join(dir, `${crops ? 'crops' : 'sheet'}${only ? `-${only}` : ''}-${s + 1}.png`);
    await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: '#000' } })
      .composite(part.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE })))
      .png().toFile(out);
    written.push(out);
  }
  console.log(written.join('\n'));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
