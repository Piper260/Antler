const { utilityProcess } = require('electron');
const path = require('path');

const WORKER_PATH = path.join(__dirname, '..', 'workers', 'onnxUpscaleWorker.js');

/**
 * Owns the ONNX upscale utility process. The worker is started on first use
 * and kept alive afterwards so the loaded model stays in GPU memory between
 * images; it is restarted transparently if it ever exits.
 */
class OnnxUpscaleService {
  constructor() {
    this.child = null;
    this.jobs = new Map();
    this.nextId = 1;
  }

  isAvailable() {
    try {
      require.resolve('onnxruntime-node');
      require.resolve('sharp');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {object} job - modelPath, inputPath, outputPath, format, scale, modelScale, tileSize, deviceId
   * @param {(percent: number) => void} [onProgress]
   * @returns {Promise<{width: number, height: number, provider: string}>}
   */
  upscale(job, onProgress = null) {
    const child = this._ensureWorker();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, onProgress });
      child.postMessage({ ...job, id, type: 'upscale' });
    });
  }

  dispose() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  _ensureWorker() {
    if (this.child) return this.child;

    const child = utilityProcess.fork(WORKER_PATH, [], { serviceName: 'Antler ONNX Upscaler', stdio: 'pipe' });
    let stderrTail = '';
    child.stderr?.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
    });

    child.on('message', (message) => {
      const job = this.jobs.get(message?.id);
      if (!job) return;

      if (message.type === 'progress') {
        if (job.onProgress) job.onProgress(message.percent);
        return;
      }

      this.jobs.delete(message.id);
      if (message.type === 'done') {
        job.resolve({ width: message.width, height: message.height, provider: message.provider });
      } else {
        job.reject(new Error(message.message || 'ONNX upscale failed'));
      }
    });

    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      const detail = stderrTail.trim().split('\n').pop() || '';
      for (const job of this.jobs.values()) {
        job.reject(new Error(`ONNX upscaler exited unexpectedly (code ${code})${detail ? `: ${detail}` : ''}`));
      }
      this.jobs.clear();
    });

    this.child = child;
    return child;
  }
}

module.exports = OnnxUpscaleService;
