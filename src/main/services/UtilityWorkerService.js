const { utilityProcess } = require('electron');

/**
 * Owns one Electron utility process running a worker script, started on
 * first use and restarted transparently if it exits. Jobs are messages
 * { id, type, ...payload }; the worker answers { id, type: 'done', result }
 * or { id, type: 'error', message }.
 */
class UtilityWorkerService {
  constructor(workerPath, serviceName) {
    this.workerPath = workerPath;
    this.serviceName = serviceName;
    this.child = null;
    this.jobs = new Map();
    this.nextId = 1;
  }

  /** @returns {Promise<object>} the worker's result */
  run(type, payload) {
    const child = this._ensureWorker();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      child.postMessage({ ...payload, id, type });
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

    const child = utilityProcess.fork(this.workerPath, [], { serviceName: this.serviceName, stdio: 'pipe' });
    let stderrTail = '';
    child.stderr?.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
    });

    child.on('message', (message) => {
      const job = this.jobs.get(message?.id);
      if (!job) return;

      this.jobs.delete(message.id);
      if (message.type === 'done') job.resolve(message.result);
      else job.reject(new Error(message.message || `${this.serviceName} failed`));
    });

    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      const detail = stderrTail.trim().split('\n').pop() || '';
      for (const job of this.jobs.values()) {
        job.reject(new Error(`${this.serviceName} exited unexpectedly (code ${code})${detail ? `: ${detail}` : ''}`));
      }
      this.jobs.clear();
    });

    this.child = child;
    return child;
  }
}

module.exports = UtilityWorkerService;
