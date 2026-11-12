/**
 * Serves the signature bench report on http://127.0.0.1:47621 and saves
 * what you mark in it to bench/signatures/truth.json. Plain Node; run it
 * with `npm run bench:signatures:report`, or it starts after a bench run.
 * Only listens on this computer.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const { scoreRun } = require('./score');

const PORT = 47621;
const REPORT = path.join(__dirname, 'report.html');

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('Too large'));
    });
    req.on('end', () => resolve(data));
  });
}

const cleanBox = (b) => ({
  x: Math.round(Number(b.x) || 0), y: Math.round(Number(b.y) || 0),
  w: Math.max(1, Math.round(Number(b.w) || 0)), h: Math.max(1, Math.round(Number(b.h) || 0))
});

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(REPORT), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
    const name = path.basename(url.pathname);
    if (!/^[0-9a-f]{16}\.jpg$/.test(name)) return send(res, 404, 'Not found', 'text/plain');
    try {
      return send(res, 200, fs.readFileSync(path.join(store.IMAGES, name)), 'image/jpeg');
    } catch {
      return send(res, 404, 'Not found', 'text/plain');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/runs') return send(res, 200, store.loadRuns());
  if (req.method === 'GET' && url.pathname === '/api/run') {
    const runs = store.loadRuns();
    const id = url.searchParams.get('id') || runs[runs.length - 1]?.id;
    const run = id && store.loadRun(id);
    if (!run) return send(res, 404, { message: 'No runs yet' });
    const truth = store.loadTruth();
    return send(res, 200, { ...run, score: scoreRun(run.images, truth), truth });
  }
  if (req.method === 'POST' && url.pathname === '/api/truth') {
    // { path, reviewed, boxes }: replaces that image's truth.
    const body = JSON.parse(await readBody(req));
    const sample = store.loadSample() || [];
    if (!sample.some(s => s.path === body.path)) return send(res, 400, { message: 'Not a bench image' });
    const truth = store.loadTruth();
    truth[body.path] = { reviewed: Boolean(body.reviewed), boxes: (body.boxes || []).slice(0, 20).map(cleanBox), note: String(body.note || '').slice(0, 300) };
    store.saveTruth(truth);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { message: 'Not found' });
}

function serve({ open = true } = {}) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => send(res, 500, { message: error.message }));
  });
  return new Promise((resolve) => {
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`The report is already being served at http://127.0.0.1:${PORT}`);
        resolve(null);
      } else throw error;
    });
    server.listen(PORT, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${PORT}`;
      console.log(`Report: ${url}  (Ctrl+C to stop)`);
      if (open) {
        const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
        spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
      }
      resolve(server);
    });
  });
}

module.exports = { serve, PORT };

if (require.main === module) serve({ open: !process.argv.includes('--no-open') });
