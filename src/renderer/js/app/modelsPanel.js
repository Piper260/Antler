// Model downloads: the first-run prompt and the Models section in Settings.
// Both show the same list (from window.electronAPI.models) and share one
// download, so progress shows in whichever is open.
// Mixed into AntlerApp (see utils/mixMethods.js).
const MODELS_PROMPT_DISMISSED_KEY = 'antler:models:prompt-dismissed';

function formatModelBytes(bytes) {
  if (!bytes) return '0 MB';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function escapeModelText(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

class AppModels {
  /** Called once at startup: listen for progress and offer the models if any recommended one is missing. */
  async setupModels() {
    if (!window.electronAPI?.models) return;
    this.modelDownloadRunning = false;
    window.electronAPI.models.onProgress(progress => this.showModelProgress(progress));

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(MODELS_PROMPT_DISMISSED_KEY) === '1';
    } catch {
      // Storage unavailable: just ask.
    }
    if (dismissed) return;

    const status = await window.electronAPI.models.getStatus();
    if (status?.success && status.packs.some(pack => pack.recommended && !pack.installed)) {
      this.openModelsDialog({ firstRun: true });
    }
  }

  async openModelsDialog({ firstRun = false } = {}) {
    document.getElementById('models-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'models-dialog';
    overlay.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="models-dialog-title">
        <div class="modal-header">
          <h3 id="models-dialog-title">Download models</h3>
          <button class="modal-close" data-models-close title="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-muted model-intro">
            ${firstRun ? 'Antler runs its taggers and detectors on your own machine. ' : ''}
            Choose which models to download. They are saved to your Antler data folder and can be added later from Settings.
          </p>
          <div data-models-list></div>
        </div>
        <div class="modal-footer model-footer">
          ${firstRun ? '<label class="form-checkbox model-footer-left"><input type="checkbox" data-models-dont-ask> Don\'t ask again</label>' : ''}
          <button class="btn btn-secondary" data-models-close>${firstRun ? 'Not now' : 'Close'}</button>
          <button class="btn btn-primary" data-models-download>Download</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => {
      const dontAsk = overlay.querySelector('[data-models-dont-ask]');
      if (dontAsk?.checked) {
        try {
          localStorage.setItem(MODELS_PROMPT_DISMISSED_KEY, '1');
        } catch {
          // Not remembered; the prompt shows again next launch.
        }
      }
      overlay.remove();
    };
    overlay.querySelectorAll('[data-models-close]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
    });

    await this.renderModelList(overlay);
  }

  /** The Models section on the Settings page. */
  async setupModelsSection() {
    const section = document.getElementById('models-settings');
    if (!section || !window.electronAPI?.models) return;
    await this.renderModelList(section);
    section.querySelector('[data-models-open-folder]')?.addEventListener('click', async () => {
      const result = await window.electronAPI.models.openFolder();
      if (!result?.success) this.showToast(result?.message || 'Could not open the models folder', 'error');
    });
  }

  /** Fills the [data-models-list] inside `root` and wires its Download button. */
  async renderModelList(root) {
    const list = root.querySelector('[data-models-list]');
    const downloadButton = root.querySelector('[data-models-download]');
    if (!list) return;

    const status = await window.electronAPI.models.getStatus();
    if (!status?.success) {
      list.innerHTML = '<p class="text-error">Could not read the model list.</p>';
      return;
    }

    list.innerHTML = `
      <div class="model-list">
        ${status.packs.map(pack => `
          <label class="model-row${pack.installed ? ' is-installed' : ''}">
            <input type="checkbox" value="${escapeModelText(pack.id)}"
              ${pack.installed ? 'checked disabled' : pack.recommended ? 'checked' : ''}>
            <span class="model-row-text">
              <span class="model-row-name">${escapeModelText(pack.name)}${pack.recommended ? '' : ' <span class="text-muted">(optional)</span>'}</span>
              <span class="model-row-desc">${escapeModelText(pack.description)}</span>
              ${pack.credits.map(credit => `
                <span class="model-row-credit">
                  ${escapeModelText(credit.name)}, ${escapeModelText(credit.license)}.
                  <a href="https://huggingface.co/${escapeModelText(credit.home)}" target="_blank" rel="noopener">huggingface.co/${escapeModelText(credit.home)}</a>${credit.note ? ` (${escapeModelText(credit.note)})` : ''}
                </span>`).join('')}
            </span>
            <span class="model-row-size">${pack.installed ? 'Installed' : formatModelBytes(pack.missingBytes)}</span>
          </label>`).join('')}
      </div>
      <div class="model-summary">
        <span data-models-total></span>
        <span class="text-muted">Downloaded from each model's Hugging Face page</span>
      </div>
      <div class="model-progress" data-models-progress hidden>
        <div class="progress-bar-container"><div class="progress-bar" style="width:0%"></div></div>
        <div class="model-progress-text text-muted"></div>
      </div>`;

    const selected = () => [...list.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)')].map(input => input.value);
    const updateTotal = () => {
      const ids = new Set(selected());
      const bytes = status.packs.filter(pack => ids.has(pack.id)).reduce((sum, pack) => sum + pack.missingBytes, 0);
      const allInstalled = status.packs.every(pack => pack.installed);
      list.querySelector('[data-models-total]').textContent = allInstalled
        ? 'All models are installed.'
        : `Selected: ${formatModelBytes(bytes)}`;
      if (downloadButton) downloadButton.disabled = this.modelDownloadRunning ? false : ids.size === 0;
    };
    // Replaced on every render so it always sees the latest status.
    list.onchange = updateTotal;
    updateTotal();

    if (downloadButton) {
      downloadButton.onclick = () => {
        if (this.modelDownloadRunning) window.electronAPI.models.cancel();
        else this.startModelDownload(selected());
      };
    }
    this.syncModelButtons();
  }

  async startModelDownload(packIds) {
    if (!packIds.length || this.modelDownloadRunning) return;
    this.modelDownloadRunning = true;
    this.syncModelButtons();
    this.showModelProgress({ state: 'starting', done: 0, total: 0 });

    const result = await window.electronAPI.models.download(packIds);
    this.modelDownloadRunning = false;
    this.syncModelButtons();

    if (result?.success && !result.cancelled) {
      this.showToast('Models downloaded', 'success');
    } else if (result?.cancelled) {
      this.showToast('Download stopped. It will resume where it left off.', 'info');
    } else {
      this.showToast(result?.message || 'Model download failed', 'error', 8000);
    }

    // Refresh whichever lists are on screen.
    for (const root of [document.getElementById('models-dialog'), document.getElementById('models-settings')]) {
      if (root) await this.renderModelList(root);
    }
  }

  syncModelButtons() {
    document.querySelectorAll('[data-models-download]').forEach(button => {
      button.textContent = this.modelDownloadRunning ? 'Stop' : 'Download';
      button.classList.toggle('btn-primary', !this.modelDownloadRunning);
      button.classList.toggle('btn-secondary', this.modelDownloadRunning);
      if (this.modelDownloadRunning) button.disabled = false;
    });
    document.querySelectorAll('[data-models-list] input[type="checkbox"]').forEach(input => {
      if (!input.closest('.is-installed')) input.disabled = this.modelDownloadRunning;
    });
  }

  showModelProgress(progress) {
    const percent = progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0;
    let text = '';
    if (progress.state === 'starting') text = 'Starting download...';
    else if (progress.state === 'downloading') {
      const speed = progress.bytesPerSecond ? ` at ${formatModelBytes(progress.bytesPerSecond)}/s` : '';
      text = `${progress.pack}: ${progress.file.split('/').pop()}. ${formatModelBytes(progress.done)} of ${formatModelBytes(progress.total)}${speed}`;
    } else if (progress.state === 'error') text = progress.message || 'Download failed';
    else if (progress.state === 'cancelled') text = 'Stopped';
    else if (progress.state === 'done') text = 'Done';

    document.querySelectorAll('[data-models-progress]').forEach(element => {
      element.hidden = false;
      element.querySelector('.progress-bar').style.width = `${percent.toFixed(1)}%`;
      element.querySelector('.model-progress-text').textContent = text;
    });
  }
}
