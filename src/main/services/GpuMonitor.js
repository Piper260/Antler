const { execFile } = require('child_process');

// Thresholds for "something else is using the GPU heavily": the next
// GPU-heavy item waits while either holds.
const BUSY_UTILIZATION = 80;   // percent
const MIN_FREE_MEMORY_MB = 2048;
const SAMPLES = 5;
const SAMPLE_GAP_MS = 300;

/**
 * Reads overall GPU load through nvidia-smi, which ships with the NVIDIA
 * driver. Per-process figures are not available under Windows' display
 * driver model, so callers sample between their own jobs, when their own
 * share is zero. Without nvidia-smi (AMD or Intel graphics) the GPU is
 * reported as unknown and nothing waits.
 */
class GpuMonitor {
  constructor() {
    this.unavailable = false;
  }

  _query() {
    return new Promise((resolve) => {
      if (this.unavailable) {
        resolve(null);
        return;
      }
      execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
        { timeout: 3000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            // Missing binary won't appear later; other errors may be passing.
            if (error.code === 'ENOENT') this.unavailable = true;
            resolve(null);
            return;
          }
          const [name, utilization, used, total] = stdout.trim().split('\n')[0].split(',').map(part => part.trim());
          resolve({ name, utilization: Number(utilization), memoryUsed: Number(used), memoryTotal: Number(total) });
        });
    });
  }

  /**
   * A few quick samples, averaged: nvidia-smi's utilisation is a short
   * window that swings between 0 and 100 under bursty load, so a single
   * reading (or the lowest) says little.
   * @returns {Promise<{available: boolean, busy?: boolean, reason?: string, name?: string, utilization?: number, memoryFree?: number}>}
   */
  async status() {
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
      const sample = await this._query();
      if (!sample) return { available: false };
      samples.push(sample);
      if (i < SAMPLES - 1) await new Promise(resolve => setTimeout(resolve, SAMPLE_GAP_MS));
    }

    const average = (values) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    const utilization = average(samples.map(sample => sample.utilization));
    const memoryUsed = average(samples.map(sample => sample.memoryUsed));
    const memoryFree = samples[0].memoryTotal - memoryUsed;
    let reason = '';
    if (utilization >= BUSY_UTILIZATION) reason = `GPU ${utilization}% busy`;
    else if (memoryFree < MIN_FREE_MEMORY_MB) reason = `GPU memory nearly full (${(memoryFree / 1024).toFixed(1)} GB free)`;

    // cause: 'load' or 'memory', for callers whose own model already sits in
    // GPU memory and only need to wait out a busy GPU.
    const cause = utilization >= BUSY_UTILIZATION ? 'load' : reason ? 'memory' : '';
    return { available: true, busy: Boolean(reason), reason, cause, name: samples[0].name, utilization, memoryFree };
  }
}

module.exports = GpuMonitor;
