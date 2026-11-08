console.log('🔧 ImageCleanupTool module loading...');

// Image Cleanup: mark speech bubbles, captions or signatures on dataset
// images and have Flux Fill on a ComfyUI server paint them out. Bubbles are
// found by a local model; everything else is marked by hand. Each image gets
// a few tries, and the one kept replaces the image (the original goes to
// bak/cleanup). See main/services/comfyCleanup.js.

const SETTINGS_KEY = 'piper-aio:image-cleanup:settings';
const DEFAULT_PROMPT = 'A seamless continuation of the surrounding artwork, matching its exact colors, lighting, texture, brushwork and linework, same art style and level of detail, clean area with nothing added.';
const DEFAULT_SETTINGS = {
  url: 'http://192.168.1.9:8188',
  attempts: 3,
  prompt: DEFAULT_PROMPT,
  models: { unet: 'flux1-fill-dev-Q8_0.gguf', clip1: 'clip_l.safetensors', clip2: 't5xxl_fp16.safetensors', vae: 'ae.safetensors' },
  freeText: false,
  removeTags: true,
  brush: 40,
  margin: 8,
  // Rough, fading mask edge for the repair (px); 0 sends the mask as drawn.
  edge: 16
};
const MASK_COLOR = [230, 40, 40];
const UNDO_LIMIT = 8;
const SAVE_DELAY = 600;

const STATUS = {
  none: 'Not marked',
  marked: 'Marked',
  queued: 'Queued',
  working: 'Cleaning',
  review: 'Pick a try',
  cleaned: 'Cleaned',
  error: 'Failed'
};

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class ImageCleanupTool {
  constructor() {
    this.name = 'Image Cleanup';
    this.id = 'image-cleanup';
    this.icon = 'fas fa-eraser';
    this.description = 'Paint out speech bubbles and other marks with Flux Fill on ComfyUI';
    this.version = '1.0.0';
    // Cleaning carries on while other tools are open; see App.loadToolContent.
    this.keepAlive = true;

    this.settings = this._loadSettings();
    // { name, filePath, status, tries: [path], message, progress }
    this.items = [];
    this.current = -1;
    this.mode = 'bubble';
    this.view = 'mask'; // 'mask' or the index of a try being looked at
    this.imageUrl = null;
    this.tryUrls = [];
    this.undo = [];
    this.saveTimer = null;
    this.run = null;
    this.loadToken = 0;
    console.log('🧽 Image Cleanup Tool initialized');
  }

  getMetadata() {
    return { name: this.name, id: this.id, icon: this.icon, description: this.description, version: this.version, category: 'Utility Tools' };
  }

  destroy() {
    if (this.run) this.run.stopped = true;
    this._flushMask();
    document.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('resize', this._resizeHandler);
    this._removeProgress?.();
    this._releaseUrls();
    console.log('🧹 Image Cleanup Tool cleaned up');
  }

  onShow() {
    this._fit();
  }

  getTemplate() {
    return `
      <div class="ic-tool">
        <input type="file" id="ic-file-input" accept="image/*" multiple style="display:none">

        <div class="ic-dropzone" id="ic-dropzone">
          <div class="ic-dropzone-inner">
            <i class="fas fa-eraser ic-drop-icon"></i>
            <h2 class="ic-drop-title">Drop Images to Clean</h2>
            <p class="ic-drop-sub">Speech bubbles are found for you. Check the masks, then Flux Fill on your ComfyUI server paints them out. Nothing outside a mask changes.</p>
            <div class="ic-drop-actions">
              <button class="btn btn-primary" id="ic-folder-btn"><i class="fas fa-folder-open"></i> Open Folder</button>
              <button class="btn" id="ic-browse-btn">Browse Files</button>
            </div>
          </div>
        </div>

        <div class="ic-workspace" id="ic-workspace" style="display:none">
          <div class="ic-toolbar">
            <div class="ic-settings">
              <label class="ic-setting">ComfyUI
                <input class="form-input ic-url" id="ic-url" type="text" spellcheck="false">
              </label>
              <button class="btn btn-sm" id="ic-check-btn">Check</button>
              <span class="ic-server" id="ic-server"></span>
              <label class="ic-setting">Tries
                <select class="form-input" id="ic-attempts">
                  <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
                </select>
              </label>
              <label class="ic-setting ic-check" title="Also mark lettering outside bubbles, such as sound effects">
                <input type="checkbox" id="ic-free-text"> Sound effects too
              </label>
              <label class="ic-setting ic-check" title="When a try is kept, remove dialogue, speech bubble and text tags from the image's caption">
                <input type="checkbox" id="ic-remove-tags"> Drop dialogue tags
              </label>
              <button class="btn btn-sm" id="ic-more-btn">Prompt and models</button>
            </div>
            <div class="ic-toolbar-actions">
              <button class="btn" id="ic-find-all-btn" title="Find bubbles on every image that isn't marked yet">Find Bubbles in All</button>
              <button class="btn" id="ic-clean-one-btn" title="Clean only the image shown (C)">Clean This Image</button>
              <button class="btn btn-primary" id="ic-clean-btn">Clean Marked</button>
              <button class="btn" id="ic-stop-btn" style="display:none"><i class="fas fa-stop"></i> Stop</button>
              <button class="btn" id="ic-open-btn" title="Open a different folder"><i class="fas fa-folder-open"></i> Open</button>
              <button class="btn" id="ic-clear-btn"><i class="fas fa-trash-alt"></i> Clear</button>
            </div>
          </div>

          <div class="ic-advanced" id="ic-advanced" style="display:none">
            <label class="ic-field ic-field-wide">Prompt
              <textarea class="form-input" id="ic-prompt" rows="2"></textarea>
            </label>
            <label class="ic-field">Fill model<input class="form-input" id="ic-unet" type="text" spellcheck="false"></label>
            <label class="ic-field">CLIP-L<input class="form-input" id="ic-clip1" type="text" spellcheck="false"></label>
            <label class="ic-field">T5<input class="form-input" id="ic-clip2" type="text" spellcheck="false"></label>
            <label class="ic-field">VAE<input class="form-input" id="ic-vae" type="text" spellcheck="false"></label>
            <label class="ic-field" title="How far past the mask each try's edge wobbles and fades, in pixels; it also fills thin gaps between marked areas. 0 uses the mask exactly as drawn.">Rough edge (px)<input class="form-input" id="ic-edge" type="number" min="0" max="64" step="1"></label>
            <button class="btn btn-sm" id="ic-reset-prompt">Reset prompt</button>
          </div>

          <div class="ic-body">
            <div class="ic-list" id="ic-list"></div>

            <div class="ic-editor">
              <div class="ic-editor-bar">
                <div class="ic-editor-info" id="ic-editor-info"></div>
                <div class="ic-editor-actions" id="ic-tools">
                  <button class="btn btn-sm" data-mode="bubble" title="Click a bubble to mark it (B)">Bubble</button>
                  <button class="btn btn-sm" data-mode="brush" title="Paint the mask (P)">Brush</button>
                  <button class="btn btn-sm" data-mode="erase" title="Erase part of the mask (E)">Erase</button>
                  <button class="btn btn-sm" data-mode="box" title="Drag a box to mark (X)">Box</button>
                  <button class="btn btn-sm" data-mode="remove" title="Click a marked area to remove all of it (R)">Remove Area</button>
                  <label class="ic-setting" title="Brush size ([ and ])">Size
                    <input type="range" id="ic-brush" min="4" max="200" step="2">
                  </label>
                  <button class="btn btn-sm" id="ic-find-btn" title="Find bubbles on this image (F)">Find Bubbles</button>
                  <button class="btn btn-sm" id="ic-undo-btn" title="Undo (Ctrl+Z)">Undo</button>
                  <button class="btn btn-sm" id="ic-clear-mask-btn">Clear Mask</button>
                </div>
              </div>

              <div class="ic-stage" id="ic-stage">
                <div class="ic-canvas" id="ic-canvas">
                  <img class="ic-img" id="ic-img" alt="">
                  <canvas class="ic-mask" id="ic-mask"></canvas>
                  <div class="ic-box-preview" id="ic-box-preview" style="display:none"></div>
                </div>
              </div>

              <div class="ic-working" id="ic-working" style="display:none">
                <img class="ic-preview" id="ic-preview" alt="" style="display:none">
                <div class="ic-working-info">
                  <span id="ic-working-text"></span>
                  <div class="progress-bar-container"><div class="progress-bar" id="ic-working-bar"></div></div>
                </div>
              </div>
              <div class="ic-tries" id="ic-tries" style="display:none"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async initialize(container) {
    console.log('🔧 Initializing Image Cleanup Tool...');
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this.canvas = this.$('#ic-mask');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this._setupEvents();
      this._loadStatus();
      console.log('✅ Image Cleanup Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Image Cleanup Tool:', error);
    }
  }

  $(selector) {
    return this.container.querySelector(selector);
  }

  // ---------------------------------------------------------------- setup

  _setupEvents() {
    const dropzone = this.$('#ic-dropzone');
    const workspace = this.$('#ic-workspace');
    const fileInput = this.$('#ic-file-input');

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) this._addFiles(e.target.files);
      fileInput.value = '';
    });
    this.$('#ic-folder-btn').addEventListener('click', (e) => { e.stopPropagation(); this._pickFolder(); });
    this.$('#ic-browse-btn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    this.$('#ic-open-btn').addEventListener('click', () => this._pickFolder());
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', (e) => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over'); });
    [dropzone, workspace].forEach(target => target.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) this._addFiles(e.dataTransfer.files);
    }));
    workspace.addEventListener('dragover', (e) => e.preventDefault());

    // Settings
    const s = this.settings;
    this.$('#ic-url').value = s.url;
    this.$('#ic-attempts').value = String(s.attempts);
    this.$('#ic-free-text').checked = s.freeText;
    this.$('#ic-remove-tags').checked = s.removeTags;
    this.$('#ic-prompt').value = s.prompt;
    this.$('#ic-unet').value = s.models.unet;
    this.$('#ic-clip1').value = s.models.clip1;
    this.$('#ic-clip2').value = s.models.clip2;
    this.$('#ic-vae').value = s.models.vae;
    this.$('#ic-edge').value = s.edge;
    this.$('#ic-brush').value = s.brush;
    const bind = (selector, apply) => this.$(selector).addEventListener('change', (e) => { apply(e.target); this._saveSettings(); });
    bind('#ic-url', (el) => { s.url = el.value.trim(); this.$('#ic-server').textContent = ''; });
    bind('#ic-attempts', (el) => { s.attempts = Number(el.value); });
    bind('#ic-free-text', (el) => { s.freeText = el.checked; });
    bind('#ic-remove-tags', (el) => { s.removeTags = el.checked; });
    bind('#ic-prompt', (el) => { s.prompt = el.value.trim() || DEFAULT_PROMPT; });
    bind('#ic-unet', (el) => { s.models.unet = el.value.trim(); });
    bind('#ic-clip1', (el) => { s.models.clip1 = el.value.trim(); });
    bind('#ic-clip2', (el) => { s.models.clip2 = el.value.trim(); });
    bind('#ic-vae', (el) => { s.models.vae = el.value.trim(); });
    bind('#ic-edge', (el) => { s.edge = Math.min(64, Math.max(0, Math.round(Number(el.value) || 0))); });
    this.$('#ic-brush').addEventListener('input', (e) => { s.brush = Number(e.target.value); this._saveSettings(); });
    this.$('#ic-reset-prompt').addEventListener('click', () => {
      s.prompt = DEFAULT_PROMPT;
      this.$('#ic-prompt').value = DEFAULT_PROMPT;
      this._saveSettings();
    });
    this.$('#ic-more-btn').addEventListener('click', () => {
      const panel = this.$('#ic-advanced');
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
      this.$('#ic-more-btn').classList.toggle('active', panel.style.display !== 'none');
      this._fit();
    });
    this.$('#ic-check-btn').addEventListener('click', () => this._checkServer());

    // Actions
    this.$('#ic-find-all-btn').addEventListener('click', () => this._findAll());
    this.$('#ic-clean-btn').addEventListener('click', () => this._cleanMarked());
    this.$('#ic-clean-one-btn').addEventListener('click', () => this._cleanCurrent());
    this.$('#ic-stop-btn').addEventListener('click', () => this._stop());
    this.$('#ic-clear-btn').addEventListener('click', () => this._clear());
    this.$('#ic-find-btn').addEventListener('click', () => this._findCurrent());
    this.$('#ic-undo-btn').addEventListener('click', () => this._undo());
    this.$('#ic-clear-mask-btn').addEventListener('click', () => this._clearMask());
    this.$('#ic-tools').addEventListener('click', (e) => {
      const button = e.target.closest('[data-mode]');
      if (button) this._setMode(button.dataset.mode);
    });
    this._setMode(this.mode);

    this.$('#ic-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-index]');
      if (row) this._show(Number(row.dataset.index));
    });
    this.$('#ic-tries').addEventListener('click', (e) => {
      const tile = e.target.closest('[data-view]');
      if (tile) this._setView(tile.dataset.view === 'mask' ? 'mask' : Number(tile.dataset.view));
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'keep') this._keep();
      else if (action === 'again') this._cleanOne(this.items[this.current]);
      else if (action === 'discard') this._discard();
    });

    // Drawing
    const stage = this.$('#ic-canvas');
    stage.addEventListener('pointerdown', (e) => this._pointerDown(e));
    stage.addEventListener('pointermove', (e) => this._pointerMove(e));
    stage.addEventListener('pointerup', (e) => this._pointerUp(e));
    stage.addEventListener('pointercancel', (e) => this._pointerUp(e));

    this._keyHandler = (e) => this._onKeyDown(e);
    document.addEventListener('keydown', this._keyHandler);
    this._resizeHandler = () => this._fit();
    window.addEventListener('resize', this._resizeHandler);
    this._removeProgress = window.electronAPI.cleanup.onProgress((data) => this._onProgress(data));
  }

  async _loadStatus() {
    try {
      const status = await window.electronAPI.cleanup.getStatus();
      this.bubbleModel = Boolean(status?.bubbleModel);
    } catch (error) {
      console.error('❌ Failed to read cleanup status:', error);
    }
    if (!this.bubbleModel) {
      ['#ic-find-btn', '#ic-find-all-btn'].forEach(id => {
        this.$(id).disabled = true;
        this.$(id).title = 'The bubble model (resources/models/comic/comic-bubbles.onnx) was not found';
      });
    }
  }

  _loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
      return { ...DEFAULT_SETTINGS, ...saved, models: { ...DEFAULT_SETTINGS.models, ...saved.models } };
    } catch {
      return { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models } };
    }
  }

  _saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // localStorage unavailable - settings just won't persist.
    }
  }

  async _checkServer() {
    const label = this.$('#ic-server');
    label.className = 'ic-server';
    label.textContent = 'Checking…';
    const result = await window.electronAPI.cleanup.checkServer(this.settings.url, this.settings.models);
    if (result.success && result.ok) {
      label.textContent = 'Ready';
      label.classList.add('ic-ok');
    } else {
      label.textContent = result.success ? result.problems.join(', ') : result.message;
      label.classList.add('ic-bad');
    }
    return result.success && result.ok;
  }

  // ---------------------------------------------------------------- loading

  async _pickFolder() {
    const result = await window.electronAPI.dialog.openDirectory();
    if (!result?.success || !result.path) return;
    const scan = await window.electronAPI.utils.scanImageFolder(result.path);
    if (!scan.success) {
      this.showToast(scan.message || 'Failed to scan folder', 'error');
      return;
    }
    await this._addEntries(scan.images.map(image => ({ name: image.subFolder ? `${image.subFolder}/${image.name}` : image.name, filePath: image.filePath })));
  }

  async _addFiles(fileList) {
    const entries = [...fileList]
      .filter(file => file.type.startsWith('image/'))
      .map(file => ({ name: file.name, filePath: window.electronAPI.utils.pathForFile(file) }))
      .filter(entry => entry.filePath);
    await this._addEntries(entries);
  }

  async _addEntries(entries) {
    const known = new Set(this.items.map(item => item.filePath));
    const fresh = entries.filter(entry => !known.has(entry.filePath))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (!fresh.length) {
      this.showToast(entries.length ? 'Those images are already open' : 'No images found', 'warning');
      return;
    }
    const result = await window.electronAPI.cleanup.getState(fresh.map(entry => entry.filePath));
    const states = result.success ? result.states : {};
    for (const entry of fresh) {
      const state = states[entry.filePath] || {};
      this.items.push({
        ...entry,
        tries: state.tries || [],
        status: state.tries?.length ? 'review' : state.cleaned ? 'cleaned' : state.hasMask ? 'marked' : 'none',
        message: ''
      });
    }
    this.$('#ic-dropzone').style.display = 'none';
    this.$('#ic-workspace').style.display = '';
    this._renderList();
    if (this.current < 0) await this._show(0);
  }

  _releaseUrls() {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.tryUrls.forEach(url => url && URL.revokeObjectURL(url));
    this.imageUrl = null;
    this.tryUrls = [];
  }

  async _readUrl(filePath) {
    const read = await window.electronAPI.utils.readImageFile(filePath);
    if (!read.success) throw new Error(read.message);
    return URL.createObjectURL(new Blob([new Uint8Array(read.data)], { type: read.mime || 'image/png' }));
  }

  async _show(index) {
    if (index < 0 || index >= this.items.length) return;
    this._flushMask();
    const token = ++this.loadToken;
    this.current = index;
    this.undo = [];
    this._releaseUrls();
    this._renderList();
    const item = this.items[index];
    try {
      this.imageUrl = await this._readUrl(item.filePath);
      const img = this.$('#ic-img');
      img.src = this.imageUrl;
      await img.decode();
      if (token !== this.loadToken) return;
      this.width = img.naturalWidth;
      this.height = img.naturalHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      await this._loadMask(item);
      if (token !== this.loadToken) return;
      this.tryUrls = item.tries.map(() => null);
      this.view = 'mask';
      this._fit();
      this._renderEditor();
    } catch (error) {
      console.error(`Failed to open ${item.name}:`, error);
      this.showToast(`Could not open ${item.name}`, 'error');
    }
  }

  async _loadMask(item) {
    this.ctx.clearRect(0, 0, this.width, this.height);
    const result = await window.electronAPI.cleanup.loadMask(item.filePath);
    if (!result.success || !result.data) return;
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(result.data)], { type: 'image/png' }));
    if (bitmap.width !== this.width || bitmap.height !== this.height) return;
    const scratch = document.createElement('canvas');
    scratch.width = this.width;
    scratch.height = this.height;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(bitmap, 0, 0);
    const src = sctx.getImageData(0, 0, this.width, this.height).data;
    const out = this.ctx.createImageData(this.width, this.height);
    for (let i = 0; i < src.length; i += 4) {
      if (src[i] > 127) out.data.set([...MASK_COLOR, 255], i);
    }
    this.ctx.putImageData(out, 0, 0);
  }

  /** Fits the image into the stage, keeping its shape. */
  _fit() {
    if (!this.width || !this.container?.isConnected) return;
    const stage = this.$('#ic-stage');
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.scale = Math.min(box.width / this.width, box.height / this.height, 4);
    const canvas = this.$('#ic-canvas');
    canvas.style.width = `${Math.floor(this.width * this.scale)}px`;
    canvas.style.height = `${Math.floor(this.height * this.scale)}px`;
  }

  // ---------------------------------------------------------------- render

  _renderList() {
    const list = this.$('#ic-list');
    list.innerHTML = this.items.map((item, i) => {
      const label = item.status === 'working' && item.progress ? `${STATUS.working} ${item.progress.attempt}/${item.progress.attempts}` : STATUS[item.status];
      return `<div class="ic-row${i === this.current ? ' active' : ''}" data-index="${i}" title="${escapeHtml(item.message || item.filePath)}">
        <div class="ic-row-name">${escapeHtml(item.name)}</div>
        <div class="ic-row-meta"><span class="ic-status-${item.status}">${escapeHtml(label)}</span></div>
      </div>`;
    }).join('');
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    this._updateToolbar();
  }

  _updateToolbar() {
    const marked = this.items.filter(item => this._cleanable(item)).length;
    const button = this.$('#ic-clean-btn');
    button.textContent = marked ? `Clean Marked (${marked})` : 'Clean Marked';
    button.disabled = Boolean(this.run) || marked === 0;
    this.$('#ic-clean-one-btn').disabled = !this._canCleanCurrent();
    this.$('#ic-find-all-btn').disabled = Boolean(this.run) || !this.bubbleModel;
    this.$('#ic-stop-btn').style.display = this.run ? '' : 'none';
  }

  _cleanable(item) {
    return item.status === 'marked' || item.status === 'error';
  }

  /** The image shown has a mask and nothing else is running; new tries replace any it has. */
  _canCleanCurrent() {
    const item = this.items[this.current];
    return Boolean(item) && !this.run && ['marked', 'error', 'review', 'cleaned'].includes(item.status);
  }

  async _cleanCurrent() {
    if (this._canCleanCurrent()) await this._cleanOne(this.items[this.current]);
  }

  _renderEditor() {
    const item = this.items[this.current];
    if (!item) return;
    const counts = this.items.reduce((acc, it) => ({ ...acc, [it.status]: (acc[it.status] || 0) + 1 }), {});
    this.$('#ic-editor-info').innerHTML = `<span class="ic-editor-name">${escapeHtml(item.name)}</span>
      <span>${this.width} × ${this.height}</span>
      <span>${this.current + 1} of ${this.items.length}</span>
      <span>${counts.review || 0} to pick, ${counts.cleaned || 0} cleaned</span>`;

    const editing = this.view === 'mask';
    this.$('#ic-mask').style.display = editing ? '' : 'none';
    this.$('#ic-img').src = editing ? this.imageUrl : (this.tryUrls[this.view] || this.imageUrl);
    this.$('#ic-canvas').classList.toggle('ic-viewing', !editing);
    this.$('#ic-tools').querySelectorAll('button, input').forEach(el => { el.disabled = !editing; });
    if (!this.bubbleModel) this.$('#ic-find-btn').disabled = true;

    this._renderWorking();
    const tries = this.$('#ic-tries');
    if (!item.tries.length) {
      tries.style.display = 'none';
      tries.innerHTML = '';
      this._fit();
      return;
    }
    const working = item.status === 'working';
    tries.style.display = '';
    tries.innerHTML = `
      <div class="ic-try-tabs">
        <button class="btn btn-sm${editing ? ' active' : ''}" data-view="mask">Original and mask</button>
        ${item.tries.map((_, n) => `<button class="btn btn-sm${this.view === n ? ' active' : ''}" data-view="${n}">Try ${n + 1}</button>`).join('')}
      </div>
      <span class="ic-try-hint">${editing ? 'Pick a try to look at it.' : 'Hold the mouse on the image to see the original.'}</span>
      <div class="ic-try-actions">
        <button class="btn btn-sm" data-action="discard" ${working ? 'disabled' : ''}>Discard Tries</button>
        <button class="btn btn-sm" data-action="again" ${working ? 'disabled' : ''}>Try Again</button>
        <button class="btn btn-sm btn-primary" data-action="keep" ${editing || working ? 'disabled' : ''}>Keep Try${editing ? '' : ` ${this.view + 1}`}</button>
      </div>`;
    this._fit();
  }

  /** The try being made for the image shown: its step and the sampler's preview. */
  _renderWorking() {
    const item = this.items[this.current];
    const panel = this.$('#ic-working');
    const progress = item?.status === 'working' ? item.progress : null;
    if (!progress) {
      panel.style.display = 'none';
      return;
    }
    const { attempt, attempts, stage, step, steps } = progress;
    const doing = stage === 'queued' ? 'waiting for ComfyUI'
      : steps ? (step >= steps ? 'finishing' : `step ${step} of ${steps}`)
        : 'preparing';
    panel.style.display = '';
    this.$('#ic-working-text').textContent = `Try ${attempt} of ${attempts}: ${doing}`;
    this.$('#ic-working-bar').style.width = `${steps ? Math.round((step / steps) * 100) : 0}%`;
    const preview = this.$('#ic-preview');
    preview.style.display = item.previewUrl ? '' : 'none';
    if (item.previewUrl && preview.src !== item.previewUrl) preview.src = item.previewUrl;
  }

  _clearPreview(item) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    item.previewUrl = null;
  }

  async _setView(view) {
    const item = this.items[this.current];
    if (!item) return;
    if (view !== 'mask' && !this.tryUrls[view]) {
      try {
        this.tryUrls[view] = await this._readUrl(item.tries[view]);
      } catch (error) {
        this.showToast(`Could not open try ${view + 1}`, 'error');
        return;
      }
    }
    this.view = view;
    this._renderEditor();
  }

  _setMode(mode) {
    this.mode = mode;
    this.$('#ic-tools').querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    this.$('#ic-canvas').dataset.mode = mode;
  }

  // ---------------------------------------------------------------- drawing

  _point(e) {
    const rect = this.$('#ic-canvas').getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * this.width, y: (e.clientY - rect.top) / rect.height * this.height };
  }

  _snapshot() {
    this.undo.push(this.ctx.getImageData(0, 0, this.width, this.height));
    if (this.undo.length > UNDO_LIMIT) this.undo.shift();
  }

  _undo() {
    const last = this.undo.pop();
    if (!last) return;
    this.ctx.putImageData(last, 0, 0);
    this._maskChanged();
  }

  _clearMask() {
    this._snapshot();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this._maskChanged();
  }

  _brushWidth() {
    return Math.max(1, this.settings.brush / (this.scale || 1));
  }

  _pointerDown(e) {
    if (!this.width || e.button !== 0) return;
    if (this.view !== 'mask') {
      // Holding the mouse shows the original under a try.
      this.$('#ic-img').src = this.imageUrl;
      this.peeking = true;
      return;
    }
    const p = this._point(e);
    if (this.mode === 'bubble') {
      this._markBubbleAt(p);
      return;
    }
    if (this.mode === 'remove') {
      this._removeAreaAt(p);
      return;
    }
    this.$('#ic-canvas').setPointerCapture(e.pointerId);
    this._snapshot();
    this.drag = { start: p, last: p };
    if (this.mode === 'brush' || this.mode === 'erase') this._strokeTo(p);
  }

  _pointerMove(e) {
    if (!this.drag) return;
    const p = this._point(e);
    if (this.mode === 'box') {
      const box = this._boxFrom(this.drag.start, p);
      const preview = this.$('#ic-box-preview');
      preview.style.display = '';
      Object.assign(preview.style, {
        left: `${box.x / this.width * 100}%`,
        top: `${box.y / this.height * 100}%`,
        width: `${box.w / this.width * 100}%`,
        height: `${box.h / this.height * 100}%`
      });
    } else {
      this._strokeTo(p);
    }
  }

  _pointerUp(e) {
    if (this.peeking) {
      this.peeking = false;
      this._renderEditor();
      return;
    }
    if (!this.drag) return;
    if (this.mode === 'box') {
      const box = this._boxFrom(this.drag.start, this._point(e));
      this.$('#ic-box-preview').style.display = 'none';
      if (box.w > 2 && box.h > 2) {
        this.ctx.fillStyle = `rgb(${MASK_COLOR.join(',')})`;
        this.ctx.fillRect(box.x, box.y, box.w, box.h);
      } else {
        this.undo.pop();
      }
    }
    this.drag = null;
    this._maskChanged();
  }

  _boxFrom(a, b) {
    const x = Math.max(0, Math.min(a.x, b.x));
    const y = Math.max(0, Math.min(a.y, b.y));
    return { x, y, w: Math.min(this.width, Math.max(a.x, b.x)) - x, h: Math.min(this.height, Math.max(a.y, b.y)) - y };
  }

  _strokeTo(p) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = this.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = `rgb(${MASK_COLOR.join(',')})`;
    ctx.lineWidth = this._brushWidth();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.drag.last.x, this.drag.last.y);
    ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
    ctx.restore();
    this.drag.last = p;
  }

  async _markBubbleAt(p) {
    const item = this.items[this.current];
    const result = await window.electronAPI.cleanup.bubbleAt(item.filePath, p.x, p.y, { margin: this.settings.margin });
    if (item !== this.items[this.current] || this.view !== 'mask') return;
    if (!result.success) {
      this.showToast(result.message || 'Could not read the image', 'error');
      return;
    }
    if (!result.region) {
      this.showToast('No white bubble there. Use the brush or a box instead.', 'info');
      return;
    }
    const { x, y, w, h, mask } = result.region;
    this._snapshot();
    const part = this.ctx.getImageData(x, y, w, h);
    for (let i = 0; i < w * h; i++) if (mask[i]) part.data.set([...MASK_COLOR, 255], i * 4);
    this.ctx.putImageData(part, x, y);
    this._maskChanged();
  }

  /** Clears the whole marked area under the click (a wrong find, say). */
  _removeAreaAt(p) {
    const x0 = Math.floor(p.x);
    const y0 = Math.floor(p.y);
    const { width: w, height: h } = this;
    const image = this.ctx.getImageData(0, 0, w, h);
    const d = image.data;
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h || !d[(y0 * w + x0) * 4 + 3]) return;
    this.undo.push(this.ctx.getImageData(0, 0, w, h));
    if (this.undo.length > UNDO_LIMIT) this.undo.shift();
    const stack = [y0 * w + x0];
    d[(y0 * w + x0) * 4 + 3] = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (d[k * 4 + 3]) {
          d[k * 4 + 3] = 0;
          stack.push(k);
        }
      }
    }
    this.ctx.putImageData(image, 0, 0);
    this._maskChanged();
  }

  // ---------------------------------------------------------------- saving masks

  _maskChanged() {
    const item = this.items[this.current];
    if (!item) return;
    clearTimeout(this.saveTimer);
    const pending = { item, width: this.width, height: this.height };
    this.pendingSave = pending;
    this.saveTimer = setTimeout(() => this._saveMask(pending), SAVE_DELAY);
  }

  _flushMask() {
    if (!this.pendingSave) return null;
    clearTimeout(this.saveTimer);
    return this._saveMask(this.pendingSave);
  }

  /** Saves the shown mask as black and white, the way main expects it. */
  async _saveMask(pending) {
    if (this.pendingSave === pending) this.pendingSave = null;
    if (pending.item !== this.items[this.current]) return;
    const { width, height } = pending;
    const src = this.ctx.getImageData(0, 0, width, height).data;
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const sctx = scratch.getContext('2d');
    const out = sctx.createImageData(width, height);
    for (let i = 0; i < src.length; i += 4) {
      const on = src[i + 3] ? 255 : 0;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = on;
      out.data[i + 3] = 255;
    }
    sctx.putImageData(out, 0, 0);
    const blob = await new Promise(resolve => scratch.toBlob(resolve, 'image/png'));
    const result = await window.electronAPI.cleanup.saveMask(pending.item.filePath, new Uint8Array(await blob.arrayBuffer()));
    if (!result.success) {
      this.showToast(`Could not save the mask: ${result.message}`, 'error');
      return;
    }
    const item = pending.item;
    if (['none', 'marked', 'error', 'cleaned'].includes(item.status)) {
      if (item.status !== 'cleaned' || result.marked) item.status = result.marked ? 'marked' : 'none';
      this._renderList();
    }
  }

  // ---------------------------------------------------------------- bubble finding

  async _findCurrent() {
    const item = this.items[this.current];
    if (!item || this.view !== 'mask') return;
    await this._flushMask();
    this._snapshot();
    const result = await window.electronAPI.cleanup.findBubbles(item.filePath, { freeText: this.settings.freeText, margin: this.settings.margin });
    if (!result.success) {
      this.showToast(result.message, 'error');
      return;
    }
    if (item === this.items[this.current]) await this._loadMask(item);
    if (result.found && item.status === 'none') item.status = 'marked';
    this._renderList();
    this.showToast(result.found ? `Marked ${result.found} area${result.found === 1 ? '' : 's'}` : 'No bubbles found', result.found ? 'success' : 'info');
  }

  async _findAll() {
    await this._flushMask();
    const targets = this.items.filter(item => item.status === 'none');
    if (!targets.length) {
      this.showToast('Every image is already marked or cleaned', 'info');
      return;
    }
    await this._startRun('Finding bubbles', targets.length, async (run, process) => {
      let marked = 0;
      for (let i = 0; i < targets.length && !run.stopped; i++) {
        process?.update({ done: i, detail: targets[i].name });
        const result = await window.electronAPI.cleanup.findBubbles(targets[i].filePath, { freeText: this.settings.freeText, margin: this.settings.margin });
        if (result.success && result.found) {
          targets[i].status = 'marked';
          marked++;
        }
        this._renderList();
      }
      if (this.items[this.current] && targets.includes(this.items[this.current])) await this._loadMask(this.items[this.current]);
      return { message: `${marked} of ${targets.length} marked`, toast: `Found bubbles on ${marked} of ${targets.length} images. Check each mask before cleaning.` };
    });
  }

  // ---------------------------------------------------------------- cleaning

  async _startRun(label, total, task) {
    if (this.run) return;
    const run = { stopped: false };
    this.run = run;
    this._updateToolbar();
    const process = window.app?.startProcess?.({ toolId: this.id, label, total });
    let outcome = {};
    try {
      outcome = await task(run, process) || {};
    } catch (error) {
      outcome = { message: error.message, failed: true, toast: error.message };
    }
    process?.finish({ message: run.stopped ? 'Stopped' : outcome.message, failed: outcome.failed, warning: outcome.warning });
    if (outcome.toast) this.showToast(run.stopped ? 'Stopped' : outcome.toast, outcome.failed ? 'error' : outcome.warning ? 'warning' : 'success');
    this.run = null;
    this._renderList();
    if (this.items[this.current]) this._renderEditor();
  }

  async _stop() {
    if (!this.run) return;
    this.run.stopped = true;
    await window.electronAPI.cleanup.stop();
  }

  async _cleanMarked() {
    await this._flushMask();
    const targets = this.items.filter(item => this._cleanable(item));
    if (!targets.length) return;
    if (!(await this._checkServer())) {
      this.showToast('ComfyUI isn\'t ready; see the message next to Check', 'error');
      return;
    }
    targets.forEach(item => { item.status = 'queued'; });
    this._renderList();
    await this._startRun('Cleaning images', targets.length * this.settings.attempts, async (run, process) => {
      this.progressRun = { process, attempts: this.settings.attempts, base: 0 };
      let failed = 0;
      for (let i = 0; i < targets.length; i++) {
        if (run.stopped) break;
        this.progressRun.base = i * this.settings.attempts;
        process?.update({ done: this.progressRun.base, detail: targets[i].name });
        if (!(await this._repair(targets[i]))) failed++;
      }
      targets.filter(item => item.status === 'queued').forEach(item => { item.status = 'marked'; });
      this.progressRun = null;
      const done = targets.filter(item => item.status === 'review').length;
      return { message: `${done} ready to pick${failed ? `, ${failed} failed` : ''}`, warning: failed > 0, toast: `${done} image${done === 1 ? '' : 's'} ready: pick the best try for each${failed ? `. ${failed} failed` : ''}.` };
    });
  }

  async _cleanOne(item) {
    if (!item || this.run) return;
    await this._flushMask();
    if (!(await this._checkServer())) {
      this.showToast('ComfyUI isn\'t ready; see the message next to Check', 'error');
      return;
    }
    await this._startRun('Cleaning image', this.settings.attempts, async (run, process) => {
      this.progressRun = { process, attempts: this.settings.attempts, base: 0 };
      const ok = await this._repair(item);
      this.progressRun = null;
      return { message: ok ? 'Ready to pick' : item.message, failed: !ok, toast: ok ? 'New tries ready' : item.message };
    });
  }

  /** One image's tries; true when they're ready. */
  async _repair(item) {
    item.status = 'working';
    item.progress = null;
    item.message = '';
    // Old tries are discarded first; new ones are added as each finishes.
    if (item === this.items[this.current]) this._resetTries(item, []);
    else item.tries = [];
    this._renderList();
    if (item === this.items[this.current]) this._renderEditor();
    const result = await window.electronAPI.cleanup.repair(item.filePath, {
      url: this.settings.url,
      attempts: this.settings.attempts,
      prompt: this.settings.prompt,
      models: this.settings.models,
      edge: this.settings.edge
    });
    item.progress = null;
    this._clearPreview(item);
    if (result.success) {
      item.status = 'review';
      const same = result.tries.length === item.tries.length && result.tries.every((file, n) => file === item.tries[n]);
      if (item === this.items[this.current] && !same) this._resetTries(item, result.tries);
      else item.tries = result.tries;
    } else {
      item.status = result.message === 'Stopped' ? 'marked' : 'error';
      item.message = result.message;
      item.tries = [];
    }
    this._renderList();
    if (item === this.items[this.current]) this._renderEditor();
    return result.success;
  }

  _resetTries(item, tries) {
    this.tryUrls.forEach(url => url && URL.revokeObjectURL(url));
    item.tries = tries;
    this.tryUrls = tries.map(() => null);
    this.view = 'mask';
  }

  _onProgress({ filePath, attempt, attempts, stage, step, steps, preview, previewType, tryFile }) {
    const item = this.items.find(it => it.filePath === filePath);
    if (!item || item.status !== 'working') return;
    const shown = item === this.items[this.current];
    if (stage === 'preview') {
      this._clearPreview(item);
      item.previewUrl = URL.createObjectURL(new Blob([preview], { type: previewType || 'image/jpeg' }));
      if (shown) this._renderWorking();
      return;
    }
    if (stage === 'queued') this._clearPreview(item);
    item.progress = { attempt, attempts, stage, step, steps };
    if (stage === 'done' && tryFile) {
      // Each try can be looked at while the next one is made.
      item.tries.push(tryFile);
      if (shown) this.tryUrls.push(null);
    }

    const run = this.progressRun;
    if (run) {
      run.process?.update({
        done: run.base + (stage === 'done' ? attempt : attempt - 1),
        current: stage === 'sampling' && steps ? step / steps : 0,
        detail: `${item.name}: try ${attempt} of ${attempts}${stage === 'sampling' && steps ? `, step ${step} of ${steps}` : ''}`
      });
    }
    if (stage === 'queued' || stage === 'done') this._renderList();
    if (shown) {
      if (stage === 'done') this._renderEditor();
      else this._renderWorking();
    }
  }

  async _keep() {
    const item = this.items[this.current];
    if (!item || this.view === 'mask' || item.status === 'working') return;
    const tryFile = item.tries[this.view];
    const result = await window.electronAPI.cleanup.keep(item.filePath, tryFile, { removeTags: this.settings.removeTags });
    if (!result.success) {
      this.showToast(result.message, 'error');
      return;
    }
    item.status = 'cleaned';
    this._resetTries(item, []);
    const index = this.current;
    this.current = -1;
    await this._show(index);
    this._nextToPick();
  }

  async _discard() {
    const item = this.items[this.current];
    if (!item) return;
    const result = await window.electronAPI.cleanup.discard(item.filePath);
    if (!result.success) {
      this.showToast(result.message, 'error');
      return;
    }
    this._resetTries(item, []);
    item.status = 'marked';
    this._renderList();
    this._renderEditor();
  }

  /** On to the next image waiting for a pick, if any. */
  _nextToPick() {
    const order = [...this.items.keys()].slice(this.current + 1).concat([...this.items.keys()].slice(0, this.current));
    const next = order.find(i => this.items[i].status === 'review');
    if (next !== undefined) this._show(next);
  }

  _clear() {
    if (this.run) {
      this.showToast('Stop the current run first', 'warning');
      return;
    }
    this._flushMask();
    this._releaseUrls();
    this.items = [];
    this.current = -1;
    this.width = 0;
    this.undo = [];
    this.$('#ic-workspace').style.display = 'none';
    this.$('#ic-dropzone').style.display = '';
  }

  // ---------------------------------------------------------------- keys

  _onKeyDown(e) {
    // A kept-alive tool stays in the page while hidden; only react when shown.
    if (!this.container?.isConnected || !this.container.offsetParent || this.$('#ic-workspace').style.display === 'none') return;
    if (e.target.closest('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      this._undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const modes = { b: 'bubble', p: 'brush', e: 'erase', x: 'box', r: 'remove' };
    if (modes[key] && this.view === 'mask') this._setMode(modes[key]);
    else if (key === '[' || key === ']') {
      this.settings.brush = Math.min(200, Math.max(4, this.settings.brush + (key === ']' ? 6 : -6)));
      this.$('#ic-brush').value = this.settings.brush;
      this._saveSettings();
    } else if (key === 'f') this._findCurrent();
    else if (key === 'c') this._cleanCurrent();
    else if (key === 'arrowdown' || key === 'pagedown') this._show(this.current + 1);
    else if (key === 'arrowup' || key === 'pageup') this._show(this.current - 1);
    else if (/^[0-9]$/.test(key) && this.items[this.current]?.tries.length) {
      const n = Number(key);
      if (n === 0) this._setView('mask');
      else if (n <= this.items[this.current].tries.length) this._setView(n - 1);
    } else if (key === 'enter' && this.view !== 'mask') this._keep();
    else return;
    e.preventDefault();
  }

  showToast(message, type = 'info') {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }
}

console.log('✅ ImageCleanupTool module loaded');

export default ImageCleanupTool;
window.ImageCleanupTool = ImageCleanupTool;
