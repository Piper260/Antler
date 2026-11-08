// src/main/services/ModelDownloadService.js
// Downloads the ONNX models listed in src/shared/models.json from Hugging Face
// into <user data>/models, where utils/modelPaths.js already looks. A file
// with a `source` comes straight from its author's repo, pinned to a commit;
// the rest come from the manifest's own repo (ONNX conversions of models
// whose authors only publish PyTorch weights). Each file
// is written to <name>.part, resumed with a Range request if a previous
// download was interrupted, checked against its size and SHA-256, and only
// then renamed into place, so a half-downloaded model is never loaded.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { findModelFile } = require('../utils/modelPaths');

const MANIFEST = require('../../shared/models.json');
const PROGRESS_INTERVAL_MS = 250;

/** Where a manifest file is downloaded from: its author's repo when it has a `source`, else the manifest's repo. */
function fileSource(manifest, entry) {
  return entry.source || { repo: manifest.repo, revision: manifest.revision, path: entry.path };
}

/** The download URL of a manifest file. */
function fileUrl(manifest, entry) {
  const { repo, revision, path: filePath } = fileSource(manifest, entry);
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${repo}/resolve/${encodeURIComponent(revision)}/${encoded}`;
}

/** Whether a manifest file is already on disk at its expected size. */
function isFilePresent(entry, find = findModelFile) {
  const found = find(entry.path.split('/').join(path.sep));
  if (!found) return false;
  if (!entry.size) return true;
  try {
    return fs.statSync(found).size === entry.size;
  } catch {
    return false;
  }
}

/** Each pack with its size and how much of it is still missing. */
function packStatus(manifest, find = findModelFile) {
  return manifest.packs.map(pack => {
    const missing = pack.files.filter(entry => !isFilePresent(entry, find));
    const size = pack.files.reduce((sum, entry) => sum + (entry.size || 0), 0);
    return {
      id: pack.id,
      name: pack.name,
      description: pack.description,
      recommended: Boolean(pack.recommended),
      credits: pack.credits || [],
      size,
      missingBytes: missing.reduce((sum, entry) => sum + (entry.size || 0), 0),
      installed: missing.length === 0
    };
  });
}

async function hashExisting(file, hash) {
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
}

class ModelDownloadService {
  /**
   * @param {{targetDir: string, manifest?: object, fetchImpl?: Function, find?: Function}} options
   */
  constructor({ targetDir, manifest = MANIFEST, fetchImpl = globalThis.fetch, find = findModelFile }) {
    this.targetDir = targetDir;
    this.manifest = manifest;
    this.fetch = fetchImpl;
    this.find = find;
    this.controller = null;
  }

  get busy() {
    return Boolean(this.controller);
  }

  status() {
    return {
      repo: this.manifest.repo,
      folder: this.targetDir,
      busy: this.busy,
      packs: packStatus(this.manifest, this.find)
    };
  }

  cancel() {
    if (this.controller) this.controller.abort();
  }

  /**
   * Downloads every missing file of the given packs, one file at a time.
   * @param {string[]} packIds
   * @param {(progress: object) => void} onProgress
   */
  async download(packIds, onProgress = () => {}) {
    if (this.busy) throw new Error('A model download is already running');
    const ids = new Set(Array.isArray(packIds) ? packIds : []);
    const packs = this.manifest.packs.filter(pack => ids.has(pack.id));
    if (packs.length === 0) throw new Error('No model packs selected');

    const jobs = [];
    for (const pack of packs) {
      for (const entry of pack.files) {
        if (!isFilePresent(entry, this.find)) jobs.push({ pack, entry });
      }
    }

    const total = jobs.reduce((sum, job) => sum + job.entry.size, 0);
    await fs.promises.mkdir(this.targetDir, { recursive: true });
    await this._checkFreeSpace(jobs);

    this.controller = new AbortController();
    const state = { done: 0, total, startedAt: Date.now(), lastSent: 0 };
    try {
      for (const job of jobs) {
        await this._downloadFile(job, state, onProgress);
      }
      onProgress({ state: 'done', done: total, total });
      return { downloaded: jobs.length };
    } catch (error) {
      if (this.controller.signal.aborted) {
        onProgress({ state: 'cancelled', done: state.done, total });
        return { cancelled: true };
      }
      onProgress({ state: 'error', message: error.message, done: state.done, total });
      throw error;
    } finally {
      this.controller = null;
    }
  }

  async _checkFreeSpace(jobs) {
    if (!fs.promises.statfs) return;
    let needed = 0;
    for (const { entry } of jobs) {
      let partial = 0;
      try {
        partial = fs.statSync(this._targetPath(entry) + '.part').size;
      } catch {
        // No partial download yet.
      }
      needed += Math.max(0, entry.size - partial);
    }
    const stats = await fs.promises.statfs(this.targetDir);
    const free = Number(stats.bavail) * Number(stats.bsize);
    // Leave some headroom so the disk isn't filled to the last byte.
    if (free < needed + 200 * 1024 * 1024) {
      throw new Error(`Not enough disk space: ${(needed / 1e9).toFixed(1)} GB needed, ${(free / 1e9).toFixed(1)} GB free`);
    }
  }

  _targetPath(entry) {
    const target = path.resolve(this.targetDir, ...entry.path.split('/'));
    // Manifest paths are fixed, but never let one escape the models folder.
    if (!target.startsWith(path.resolve(this.targetDir) + path.sep)) throw new Error(`Bad model path: ${entry.path}`);
    return target;
  }

  async _downloadFile({ pack, entry }, state, onProgress) {
    const target = this._targetPath(entry);
    const partPath = target + '.part';
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    let start = 0;
    try {
      start = (await fs.promises.stat(partPath)).size;
    } catch {
      // Fresh download.
    }
    if (start > entry.size) {
      await fs.promises.rm(partPath, { force: true });
      start = 0;
    }

    let hash = crypto.createHash('sha256');
    if (start > 0) await hashExisting(partPath, hash);

    const headers = start > 0 && start < entry.size ? { Range: `bytes=${start}-` } : {};
    let response = null;
    if (start < entry.size) {
      response = await this.fetch(fileUrl(this.manifest, entry), { headers, signal: this.controller.signal });
      if (!response.ok) throw new Error(`Download of ${entry.path} failed: HTTP ${response.status}`);
      if (start > 0 && response.status !== 206) {
        // The server ignored the range and is sending the whole file.
        start = 0;
        hash = crypto.createHash('sha256');
      }
    }

    state.done += start;
    if (response) {
      const out = fs.createWriteStream(partPath, { flags: start > 0 ? 'a' : 'w' });
      const closed = new Promise((resolve, reject) => {
        out.on('close', resolve);
        out.on('error', reject);
      });
      let fileDone = start;
      try {
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk);
          hash.update(buffer);
          if (!out.write(buffer)) await new Promise(resolve => out.once('drain', resolve));
          fileDone += buffer.length;
          state.done += buffer.length;
          const now = Date.now();
          if (now - state.lastSent >= PROGRESS_INTERVAL_MS) {
            state.lastSent = now;
            const seconds = Math.max(0.001, (now - state.startedAt) / 1000);
            onProgress({
              state: 'downloading',
              pack: pack.name,
              file: entry.path,
              fileDone,
              fileTotal: entry.size,
              done: state.done,
              total: state.total,
              bytesPerSecond: state.done / seconds
            });
          }
        }
      } finally {
        out.end();
        await closed;
      }
    }

    const size = (await fs.promises.stat(partPath)).size;
    const digest = hash.digest('hex');
    if (size !== entry.size || (entry.sha256 && digest !== entry.sha256)) {
      await fs.promises.rm(partPath, { force: true });
      throw new Error(`${entry.path} did not match its checksum; it was removed so the next try starts clean`);
    }
    await fs.promises.rm(target, { force: true });
    await fs.promises.rename(partPath, target);
  }
}

module.exports = { ModelDownloadService, packStatus, fileUrl, fileSource, isFilePresent, MANIFEST };
