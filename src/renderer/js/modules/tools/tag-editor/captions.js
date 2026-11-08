// "Caption with AI" in the Tag Editor: natural-language captions from a
// local vision model (Ollama), grounded in each image's tags. Preview a few
// first, then caption the files shown or the whole dataset. The work runs in
// the main process (services/CaptionService.js) and shows in Processes.
// Mixed into TagEditorTool (see utils/mixMethods.js).
const OPTIONS_KEY = 'antler:captions:options';
const PREVIEW_COUNT = 3;

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export default class TagEditorCaptions {
  captionOptions() {
    try {
      return { length: 'medium', mode: 'sidecar', trigger: '', model: '', scope: 'shown', ...JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}') };
    } catch {
      return { length: 'medium', mode: 'sidecar', trigger: '', model: '', scope: 'shown' };
    }
  }

  saveCaptionOptions(options) {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {
      // not remembered; the defaults come back next time
    }
  }

  async openCaptions() {
    if (!this.captionModal) this.buildCaptionModal();
    const m = this.captionModal;
    const options = this.captionOptions();
    const shown = this.visibleFiles().length;
    m.scope.innerHTML = `
      <option value="shown">Files shown (${shown.toLocaleString()})</option>
      <option value="all">All files (${this.files.length.toLocaleString()})</option>`;
    m.scope.value = options.scope;
    m.length.value = options.length;
    m.mode.value = options.mode;
    m.trigger.value = options.trigger;
    m.root.hidden = false;
    this.syncCaptionControls();
    await this.loadCaptionModels(options.model);
  }

  closeCaptions() {
    // A running job carries on in Processes.
    if (this.captionModal) this.captionModal.root.hidden = true;
  }

  buildCaptionModal() {
    const root = document.createElement('div');
    root.className = 'modal-overlay';
    root.hidden = true;
    root.innerHTML = `
      <div class="modal-content te-captions" role="dialog" aria-modal="true" aria-labelledby="te-captions-title">
        <div class="modal-header">
          <h3 id="te-captions-title">Caption with AI</h3>
          <button class="modal-close" data-close title="Close (Esc)">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-muted te-captions-intro">A vision model running in Ollama on your computer writes a caption for each image, using the image's tags as ground truth. Preview a few first to check the style.</p>
          <div class="te-captions-grid">
            <label class="form-label">Model
              <select class="form-select" data-model></select>
            </label>
            <label class="form-label">Length
              <select class="form-select" data-length>
                <option value="short">Short (one sentence)</option>
                <option value="medium">Medium (two or three)</option>
                <option value="detailed">Detailed (four to six)</option>
              </select>
            </label>
            <label class="form-label">Write to
              <select class="form-select" data-mode>
                <option value="sidecar">A separate .caption file (tags untouched)</option>
                <option value="hybrid">The .txt: sentence, then tags</option>
                <option value="replace">The .txt: sentence only</option>
              </select>
            </label>
            <label class="form-label">Trigger word <span class="text-muted">(optional)</span>
              <input type="text" class="form-input" data-trigger maxlength="100" placeholder="e.g. twangstyle">
            </label>
            <label class="form-label">Files
              <select class="form-select" data-scope></select>
            </label>
          </div>
          <p class="form-help" data-model-help></p>
          <div class="te-captions-results" data-results></div>
        </div>
        <div class="modal-footer">
          <span class="toolbar-text te-captions-progress" data-progress></span>
          <button class="btn" data-preview>Preview ${PREVIEW_COUNT}</button>
          <button class="btn" data-stop hidden>Stop</button>
          <button class="btn btn-primary" data-run>Caption files</button>
        </div>
      </div>`;
    this.root.appendChild(root);

    const q = (sel) => root.querySelector(sel);
    this.captionModal = {
      root,
      model: q('[data-model]'),
      length: q('[data-length]'),
      mode: q('[data-mode]'),
      trigger: q('[data-trigger]'),
      scope: q('[data-scope]'),
      help: q('[data-model-help]'),
      results: q('[data-results]'),
      progress: q('[data-progress]'),
      preview: q('[data-preview]'),
      stop: q('[data-stop]'),
      run: q('[data-run]')
    };
    const m = this.captionModal;
    q('[data-close]').onclick = () => this.closeCaptions();
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeCaptions();
    });
    m.preview.onclick = () => this.runCaptions({ preview: true });
    m.run.onclick = () => this.runCaptions({ preview: false });
    m.stop.onclick = () => window.electronAPI.captions.cancel();
    for (const input of [m.model, m.length, m.mode, m.trigger, m.scope]) {
      input.onchange = () => {
        this.saveCaptionOptions(this.readCaptionForm());
        this.syncCaptionControls();
      };
    }
    this.captionProgressOff = window.electronAPI.captions.onProgress((progress) => this.showCaptionProgress(progress));
  }

  readCaptionForm() {
    const m = this.captionModal;
    return { model: m.model.value, length: m.length.value, mode: m.mode.value, trigger: m.trigger.value.trim(), scope: m.scope.value };
  }

  async loadCaptionModels(preferred) {
    const m = this.captionModal;
    m.model.innerHTML = '<option value="">Looking for models...</option>';
    const result = await window.electronAPI.captions.models();
    if (!result?.success) {
      m.model.innerHTML = '<option value="">Ollama not reachable</option>';
      m.help.textContent = `${result?.message || 'Ollama is not running.'} Install Ollama from ollama.com and start it, then reopen this window.`;
      this.syncCaptionControls();
      return;
    }
    if (!result.models.length) {
      m.model.innerHTML = '<option value="">No vision models installed</option>';
      m.help.textContent = 'Ollama has no model that can see images. In a terminal, run "ollama pull gemma3:12b" (or qwen2.5vl:7b for a smaller GPU), then reopen this window.';
      this.syncCaptionControls();
      return;
    }
    m.model.innerHTML = result.models
      .map((model) => `<option value="${esc(model.name)}">${esc(model.name)} (${(model.size / 1e9).toFixed(1)} GB)</option>`)
      .join('');
    m.model.value = result.models.some((model) => model.name === preferred) ? preferred : result.models[0].name;
    m.help.textContent = 'The first caption takes a little longer while Ollama loads the model.';
    this.syncCaptionControls();
  }

  captionTargets(scope = this.captionModal.scope.value) {
    return scope === 'all' ? this.files : this.visibleFiles();
  }

  syncCaptionControls() {
    const m = this.captionModal;
    if (!m) return;
    const running = Boolean(this.captionRunning);
    const count = this.captionTargets().length;
    m.run.textContent = `Caption ${count.toLocaleString()} file${count === 1 ? '' : 's'}`;
    m.run.disabled = running || !m.model.value || count === 0;
    m.preview.disabled = running || !m.model.value || count === 0;
    m.stop.hidden = !running;
    for (const input of [m.model, m.length, m.mode, m.trigger, m.scope]) input.disabled = running;
  }

  async runCaptions({ preview }) {
    const m = this.captionModal;
    const options = this.readCaptionForm();
    const targets = this.captionTargets(options.scope);
    if (!targets.length) return;

    if (!preview && options.mode !== 'sidecar') {
      // Rewriting .txt files under unsaved edits would lose one or the other.
      if (this.files.some((file) => file.modified)) {
        this.showToast('Save or discard your tag changes first; captions rewrite the .txt files', 'warning', 6000);
        return;
      }
      // The editor's dialog sits on the same layer, so step aside while it asks.
      m.root.hidden = true;
      const ok = await this.openDialog({
        title: 'Rewrite the tag files?',
        message: `This rewrites ${targets.length.toLocaleString()} .txt file${targets.length === 1 ? '' : 's'}. Each original is kept in bak/captions the first time.`,
        okLabel: 'Caption and rewrite'
      });
      m.root.hidden = false;
      if (!ok) return;
    }

    const items = (preview ? targets.slice(0, PREVIEW_COUNT) : targets)
      .map((file) => ({ imagePath: file.imagePath, tags: file.tags }));
    this.captionRunning = true;
    this.captionShown = new Map(items.map((item) => [item.imagePath, null]));
    this.captionProcess = preview ? null : window.app?.startProcess?.({ toolId: this.id, label: `Captioning with ${options.model}`, total: items.length });
    m.results.innerHTML = '';
    m.progress.textContent = preview ? 'Previewing...' : 'Starting...';
    this.syncCaptionControls();

    const result = await window.electronAPI.captions.run(items, { ...options, preview });
    this.captionRunning = false;
    this.syncCaptionControls();

    const failed = (result.results || []).filter((r) => r.error);
    const written = (result.results || []).filter((r) => r.caption).length;
    if (!result.success) {
      m.progress.textContent = result.message;
      this.captionProcess?.finish({ message: result.message, failed: true });
      this.showToast(result.message, 'error', 8000);
    } else if (preview) {
      m.progress.textContent = failed.length ? `${failed.length} could not be captioned: ${failed[0].error}` : 'Preview only; nothing was written.';
    } else {
      const message = `${result.cancelled ? 'Stopped after' : 'Captioned'} ${written.toLocaleString()} file${written === 1 ? '' : 's'}${failed.length ? `; ${failed.length} failed` : ''}`;
      m.progress.textContent = message;
      this.captionProcess?.finish({ message, warning: failed.length > 0, failed: written === 0 && failed.length > 0 });
      this.showToast(message, failed.length ? 'warning' : 'success');
      // The .txt files changed on disk: reload so the editor shows them.
      if (options.mode !== 'sidecar' && written && this.dataset) await this.loadDataset(this.dataset);
    }
    this.captionProcess = null;
  }

  showCaptionProgress(progress) {
    const m = this.captionModal;
    if (!m || !this.captionRunning) return;
    const name = String(progress.current || '').split(/[\\/]/).pop();
    m.progress.textContent = `${Math.min(progress.done + 1, progress.total).toLocaleString()} of ${progress.total.toLocaleString()}: ${name}`;
    this.captionProcess?.update({ done: progress.done, detail: name });
    if (progress.caption) {
      const row = document.createElement('div');
      row.className = 'te-captions-row';
      row.innerHTML = `<span class="te-captions-file">${esc(name)}</span><p>${esc(progress.caption)}</p>`;
      m.results.prepend(row);
      // Keep the list short during a long run.
      while (m.results.children.length > 20) m.results.lastElementChild.remove();
    }
  }
}
