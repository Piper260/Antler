import { openFrameSource } from './video-frames/frameSources.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

console.log('🔧 VideoFrameTool module loading...');

const MAX_SAMPLES = 5000;
const THUMB_EDGE = 240;
const SETTINGS_KEY = 'piper-aio:video-frames:settings';
const DEFAULT_SETTINGS = { step: 0.25, difference: 5, format: 'png' };
const FORMATS = {
  png: { type: 'image/png', extension: '.png' },
  jpg: { type: 'image/jpeg', extension: '.jpg', quality: 0.95 },
  webp: { type: 'image/webp', extension: '.webp', quality: 0.95 }
};

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
};

class VideoFrameTool {
  constructor() {
    this.name = 'Video Frames';
    this.id = 'video-frames';
    this.icon = 'fas fa-film';
    this.description = 'Pull the distinct frames out of a video or animated image';
    this.version = '1.0.0';
    // Reading and saving carry on while other tools are open; see App.loadToolContent.
    this.keepAlive = true;

    this.settings = this._loadSettings();
    this.source = null;
    this.stem = '';
    this.folder = '';
    // Every frame read; { position, time, signature, sharpness, contrast, thumb }
    this.samples = [];
    this.kept = [];
    // Times of frames unticked by hand, so a new difference setting keeps them off.
    this.unticked = new Set();
    // Dataset picker (shared with Comic Panels and the image tools).
    this.datasetMode = 'artist';
    this.datasetEntries = [];
    this.run = null;
    this.status = '';

    console.log('🎞️ Video Frames Tool initialized');
  }

  getMetadata() {
    return {
      name: this.name,
      id: this.id,
      icon: this.icon,
      description: this.description,
      version: this.version,
      category: 'Utility Tools'
    };
  }

  destroy() {
    if (this.run) this.run.stopped = true;
    this._releaseSamples();
    this.source?.close();
    this.source = null;
    console.log('🧹 Video Frames Tool cleaned up');
  }

  getTemplate() {
    return `
      <div class="vf-tool">
        <input type="file" id="vf-file-input" accept="video/*,.gif,.webp,.apng" style="display:none">

        <div class="vf-dropzone" id="vf-dropzone">
          <div class="vf-dropzone-inner">
            <i class="fas fa-film vf-drop-icon"></i>
            <h2 class="vf-drop-title">Drop a Video Here</h2>
            <p class="vf-drop-sub">mp4, webm, or an animated GIF, WEBP or APNG. Near-identical frames are skipped, and you choose which of the rest to save.</p>
            <div class="vf-drop-actions">
              <button class="btn btn-primary" id="vf-browse-btn">
                <i class="fas fa-folder-open"></i> Browse Files
              </button>
            </div>

            <div class="vf-dataset-picker">
              <div class="vf-dataset-divider"><span>or load a dataset</span></div>
              <div class="search-mode-container">
                <span class="mode-label active" id="vf-label-artist">Artist</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="vf-dataset-mode-toggle">
                  <span class="slider"></span>
                </label>
                <span class="mode-label" id="vf-label-character">Character</span>
              </div>
              <select class="form-input vf-dataset-select" id="vf-dataset-select">
                <option value="">Select artist...</option>
              </select>
              <select class="form-input vf-dataset-select" id="vf-video-select" style="display:none" aria-label="Video"></select>
              <button class="btn btn-ghost btn-sm" id="vf-dataset-btn">
                <i class="fas fa-folder-open"></i> Or choose a custom folder
              </button>
            </div>
          </div>
        </div>

        <div class="vf-workspace" id="vf-workspace" style="display:none">
          <div class="vf-toolbar">
            <div class="vf-toolbar-info">
              <label class="vf-select-all-wrap" title="Select / deselect all">
                <input type="checkbox" id="vf-select-all" checked>
                <span>Select All</span>
              </label>
              <span id="vf-count-label"></span>
              <span id="vf-source-label"></span>
            </div>
            <div class="vf-toolbar-actions">
              <button class="btn" id="vf-stop-btn" style="display:none">
                <i class="fas fa-stop"></i> Stop
              </button>
              <button class="btn" id="vf-open-btn" title="Open a different video">
                <i class="fas fa-folder-open"></i> Open Another
              </button>
              <button class="btn btn-primary" id="vf-save-btn">
                <span id="vf-save-label">Save</span>
              </button>
              <button class="btn" id="vf-clear-btn">
                <i class="fas fa-trash-alt"></i> Clear
              </button>
            </div>
          </div>

          <div class="vf-options">
            <label class="vf-option" id="vf-step-option">
              <span>Check every</span>
              <select class="form-select" id="vf-step-select" title="How often to look at the video. Closer checks catch more but take longer">
                <option value="0.05">0.05 s</option>
                <option value="0.1">0.1 s</option>
                <option value="0.25">0.25 s</option>
                <option value="0.5">0.5 s</option>
                <option value="1">1 s</option>
                <option value="2">2 s</option>
              </select>
            </label>
            <label class="vf-option vf-option-wide">
              <span>Minimum difference: <span id="vf-difference-label"></span>%</span>
              <input class="form-input" id="vf-difference-range" type="range" min="1" max="50" step="1" title="How much of the picture must change for a frame to count as new. Higher keeps fewer">
            </label>
            <label class="vf-option">
              <span>Format</span>
              <select class="form-select" id="vf-format-select">
                <option value="png">PNG</option>
                <option value="jpg">JPG</option>
                <option value="webp">WEBP</option>
              </select>
            </label>
            <div class="vf-option vf-option-folder">
              <span>Save to</span>
              <div class="vf-folder-row">
                <input class="form-input" id="vf-folder-input" type="text" readonly placeholder="Choose a folder">
                <button class="btn" id="vf-folder-btn">
                  <i class="fas fa-folder-open"></i> Choose
                </button>
              </div>
            </div>
          </div>

          <div class="vf-grid" id="vf-grid"></div>
        </div>
      </div>
    `;
  }

  async initialize(container) {
    console.log('🔧 Initializing Video Frames Tool...');
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this._setupEvents();
      this._loadDatasetDropdown();
      console.log('✅ Video Frames Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Video Frames Tool:', error);
    }
  }

  _setupEvents() {
    const dropzone = this.container.querySelector('#vf-dropzone');
    const workspace = this.container.querySelector('#vf-workspace');
    const fileInput = this.container.querySelector('#vf-file-input');
    const stepSelect = this.container.querySelector('#vf-step-select');
    const differenceRange = this.container.querySelector('#vf-difference-range');
    const formatSelect = this.container.querySelector('#vf-format-select');

    stepSelect.value = String(this.settings.step);
    differenceRange.value = this.settings.difference;
    formatSelect.value = this.settings.format;
    this.container.querySelector('#vf-difference-label').textContent = this.settings.difference;

    fileInput.addEventListener('change', (event) => {
      if (event.target.files.length) this._open(event.target.files[0]);
      fileInput.value = '';
    });
    // The picker's controls sit inside the drop zone; only a click on the zone itself browses.
    dropzone.addEventListener('click', (event) => {
      if (!event.target.closest('.vf-dataset-picker')) fileInput.click();
    });
    this.container.querySelector('#vf-open-btn').addEventListener('click', () => fileInput.click());
    this.container.querySelector('#vf-dataset-select').addEventListener('change', (event) => this._onDatasetSelect(event.target.value));
    this.container.querySelector('#vf-dataset-mode-toggle').addEventListener('change', () => this._onDatasetModeToggle());
    this.container.querySelector('#vf-video-select').addEventListener('change', (event) => this._openPath(event.target.value));
    this.container.querySelector('#vf-dataset-btn').addEventListener('click', async () => {
      const result = await window.electronAPI.dialog.openDirectory();
      if (result?.success && result.path) await this._listVideos(result.path);
    });

    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', (event) => {
      if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag-over');
    });
    [dropzone, workspace].forEach(target => target.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-over');
      if (event.dataTransfer.files.length) this._open(event.dataTransfer.files[0]);
    }));
    workspace.addEventListener('dragover', (event) => event.preventDefault());

    stepSelect.addEventListener('change', () => {
      this.settings.step = parseFloat(stepSelect.value);
      this._saveSettings();
      if (this.source) this._rescan();
    });
    differenceRange.addEventListener('input', () => {
      this.settings.difference = parseInt(differenceRange.value, 10);
      this.container.querySelector('#vf-difference-label').textContent = this.settings.difference;
      this._saveSettings();
      if (!this.run) this._renderGrid();
    });
    formatSelect.addEventListener('change', () => {
      this.settings.format = formatSelect.value;
      this._saveSettings();
    });

    this.container.querySelector('#vf-folder-btn').addEventListener('click', () => this._chooseFolder());
    this.container.querySelector('#vf-save-btn').addEventListener('click', () => this._save());
    this.container.querySelector('#vf-clear-btn').addEventListener('click', () => this._clear());
    this.container.querySelector('#vf-stop-btn').addEventListener('click', () => {
      if (this.run) this.run.stopped = true;
    });

    this.container.querySelector('#vf-select-all').addEventListener('change', (event) => {
      this.kept.forEach(sample => {
        if (event.target.checked) this.unticked.delete(sample.time);
        else this.unticked.add(sample.time);
      });
      this._renderGrid();
    });
    this.container.querySelector('#vf-grid').addEventListener('change', (event) => {
      const time = parseFloat(event.target.dataset.time);
      if (event.target.checked) this.unticked.delete(time);
      else this.unticked.add(time);
      event.target.closest('.vf-tile').classList.toggle('vf-tile-off', !event.target.checked);
      this._updateToolbar();
    });
  }

  // ---------------------------------------------------------------- dataset picker
  // The same "or load a dataset" picker as Comic Panels, Image Resizer and Image Upscaler.

  async _loadDatasetDropdown() {
    try {
      const result = await window.electronAPI.tagEditor.getAvailableArtists();
      if (result.success) {
        this.datasetEntries = result.artists || [];
        this._populateDatasetSelect();
      }
    } catch (error) {
      console.error('❌ Failed to load dataset list:', error);
    }
  }

  _populateDatasetSelect() {
    const select = this.container.querySelector('#vf-dataset-select');
    if (!select) return;
    const options = (this.datasetEntries || [])
      .filter(entry => entry.type === this.datasetMode)
      .sort((a, b) => (a.displayName || a.name || '').toLowerCase().localeCompare((b.displayName || b.name || '').toLowerCase()))
      .map(entry => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.displayName || entry.name)} (${entry.fileCount || 0} files)</option>`)
      .join('');
    select.innerHTML = `<option value="">Select ${this.datasetMode}...</option>${options}`;
  }

  _onDatasetModeToggle() {
    const isCharacterMode = this.container.querySelector('#vf-dataset-mode-toggle').checked;
    this.datasetMode = isCharacterMode ? 'character' : 'artist';
    this.container.querySelector('#vf-label-artist').classList.toggle('active', !isCharacterMode);
    this.container.querySelector('#vf-label-character').classList.toggle('active', isCharacterMode);
    this._populateDatasetSelect();
  }

  async _onDatasetSelect(entryId) {
    if (!entryId) return;
    const entry = (this.datasetEntries || []).find(item => item.id === entryId);
    if (entry?.path) await this._listVideos(entry.path);
    this.container.querySelector('#vf-dataset-select').value = '';
  }

  _loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  _saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // localStorage unavailable - settings just won't persist.
    }
  }

  /** Runs one read or save at a time; `task` should stop once run.stopped is set. */
  async _startRun(task) {
    const run = { stopped: false };
    this.run = run;
    this._updateToolbar();
    run.finished = task(run);
    await run.finished;
    this.run = null;
    this._updateToolbar();
  }

  async _stopRun() {
    if (!this.run) return;
    this.run.stopped = true;
    await this.run.finished;
    this.run = null;
  }

  /** The videos and animations in a folder, to pick one from. */
  async _listVideos(folderPath) {
    const select = this.container.querySelector('#vf-video-select');
    const scan = await window.electronAPI.utils.scanVideoFolder(folderPath);
    if (!scan.success) {
      this.showToast(scan.message || 'Failed to scan folder', 'error');
      return;
    }
    const videos = (scan.videos || []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!videos.length) {
      select.style.display = 'none';
      this.showToast('No videos or animations in that folder', 'info');
      return;
    }
    const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop();
    select.innerHTML = `<option value="">Select a video from ${escapeHtml(folderName)} (${videos.length})...</option>`
      + videos.map(v => `<option value="${escapeHtml(v.filePath)}">${escapeHtml(v.subFolder ? `${v.subFolder}/${v.name}` : v.name)}</option>`).join('');
    select.style.display = '';
    select.focus();
  }

  /** Opens a video picked from a dataset, which has a path but no browser File yet. */
  async _openPath(filePath) {
    if (!filePath) return;
    const read = await window.electronAPI.utils.readVideoFile(filePath);
    this.container.querySelector('#vf-video-select').value = '';
    if (!read.success) {
      this.showToast(read.message || 'Could not open that file', 'error');
      return;
    }
    const name = filePath.split(/[\\/]/).pop();
    await this._open(new File([new Uint8Array(read.data)], name, { type: read.mime }), filePath);
  }

  async _open(file, knownPath = null) {
    await this._stopRun();
    let source;
    try {
      source = await openFrameSource(file);
    } catch (error) {
      console.error(`Failed to open ${file.name}:`, error);
      this.showToast(error.message || 'Could not open that file', 'error');
      return;
    }

    this._releaseSamples();
    this.source?.close();
    this.source = source;
    this.unticked.clear();
    this.stem = file.name.replace(/\.[^.]+$/, '');

    // Beside the original when its location is known; a dropped file normally has one.
    const filePath = knownPath || window.electronAPI.utils.pathForFile(file);
    this.folder = filePath ? filePath.replace(/[^\\/]+$/, `${this.stem}_frames`) : '';
    this.container.querySelector('#vf-folder-input').value = this.folder;
    this.container.querySelector('#vf-source-label').textContent = `${file.name}, ${source.summary}`;
    this.container.querySelector('#vf-step-option').style.display = source.usesStep ? '' : 'none';
    this.container.querySelector('#vf-dropzone').style.display = 'none';
    this.container.querySelector('#vf-workspace').style.display = 'flex';

    await this._startRun((run) => this._readFrames(run));
  }

  async _rescan() {
    await this._stopRun();
    this._releaseSamples();
    this.unticked.clear();
    await this._startRun((run) => this._readFrames(run));
  }

  async _readFrames(run) {
    const positions = this.source.positions(this.settings.step, MAX_SAMPLES);
    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Reading frames', total: positions.length });
    this._renderGrid();
    let failure = null;

    try {
      for (let i = 0; i < positions.length && !run.stopped; i++) {
        const { image, time } = await this.source.frameAt(positions[i]);
        this.samples.push(await this._measure(image, positions[i], time));
        if (i % 5 === 0) {
          this.status = `Reading frame ${i + 1} of ${positions.length}`;
          this._updateToolbar();
          process?.update({ done: i, detail: this.stem });
        }
      }
    } catch (error) {
      console.error('Failed reading frames:', error);
      failure = error;
    }

    this.status = '';
    process?.finish({
      message: failure ? 'Stopped early' : `${this.samples.length} checked`,
      failed: Boolean(failure) && this.samples.length === 0,
      warning: Boolean(failure)
    });
    if (failure) this.showToast(`Stopped early: ${failure.message}`, 'warning');
    this._renderGrid();
  }

  /** Reduces a frame to what choosing needs: a thumbnail and its measurements. */
  async _measure(image, position, time) {
    if (!this.thumbCanvas) {
      this.thumbCanvas = document.createElement('canvas');
      this.signatureCanvas = document.createElement('canvas');
      this.signatureCanvas.width = window.FrameSelect.SIGNATURE_WIDTH;
      this.signatureCanvas.height = window.FrameSelect.SIGNATURE_HEIGHT;
    }
    const scale = Math.min(1, THUMB_EDGE / Math.max(this.source.width, this.source.height));
    const width = Math.max(1, Math.round(this.source.width * scale));
    const height = Math.max(1, Math.round(this.source.height * scale));
    if (this.thumbCanvas.width !== width || this.thumbCanvas.height !== height) {
      this.thumbCanvas.width = width;
      this.thumbCanvas.height = height;
    }

    const thumb = this.thumbCanvas.getContext('2d', { willReadFrequently: true });
    thumb.fillStyle = '#ffffff';
    thumb.fillRect(0, 0, width, height);
    thumb.drawImage(image, 0, 0, width, height);

    const small = this.signatureCanvas.getContext('2d', { willReadFrequently: true });
    small.drawImage(this.thumbCanvas, 0, 0, this.signatureCanvas.width, this.signatureCanvas.height);

    const { toGrey, contrast, sharpness } = window.FrameSelect;
    const signature = toGrey(small.getImageData(0, 0, this.signatureCanvas.width, this.signatureCanvas.height).data);
    const grey = toGrey(thumb.getImageData(0, 0, width, height).data);
    const blob = await new Promise(resolve => this.thumbCanvas.toBlob(resolve, 'image/jpeg', 0.8));

    return {
      position,
      time,
      signature,
      sharpness: sharpness(grey, width),
      contrast: contrast(signature),
      thumb: URL.createObjectURL(blob)
    };
  }

  _renderGrid() {
    const grid = this.container.querySelector('#vf-grid');
    this.kept = window.FrameSelect.pickFrames(this.samples, this.settings.difference / 100);
    grid.innerHTML = this.kept.map(sample => {
      const off = this.unticked.has(sample.time);
      return `
        <label class="vf-tile${off ? ' vf-tile-off' : ''}">
          <img src="${sample.thumb}" alt="" loading="lazy">
          <span class="vf-tile-info">
            <input type="checkbox" data-time="${sample.time}" ${off ? '' : 'checked'}>
            <span>${formatTime(sample.time)}</span>
          </span>
        </label>
      `;
    }).join('');
    this._updateToolbar();
  }

  _ticked() {
    return this.kept.filter(sample => !this.unticked.has(sample.time));
  }

  _updateToolbar() {
    if (!this.container) return;
    const busy = Boolean(this.run);
    const ticked = this._ticked().length;
    const selectAll = this.container.querySelector('#vf-select-all');

    this.container.querySelector('#vf-count-label').textContent = this.status
      || `${this.kept.length} of ${this.samples.length} frames kept, ${ticked} selected`;
    this.container.querySelector('#vf-save-label').textContent = ticked ? `Save ${ticked}` : 'Save';
    this.container.querySelector('#vf-save-btn').disabled = busy || ticked === 0;
    this.container.querySelector('#vf-stop-btn').style.display = busy ? '' : 'none';
    selectAll.checked = this.kept.length > 0 && ticked === this.kept.length;
    selectAll.indeterminate = ticked > 0 && ticked < this.kept.length;
  }

  async _chooseFolder() {
    const result = await window.electronAPI.dialog.openDirectory();
    if (!result?.success || !result.path) return false;
    this.folder = result.path;
    this.container.querySelector('#vf-folder-input').value = this.folder;
    return true;
  }

  async _save() {
    if (this.run) return;
    if (!this.folder && !(await this._chooseFolder())) return;
    await this._startRun((run) => this._writeFrames(run));
  }

  async _writeFrames(run) {
    const frames = this._ticked();
    const format = FORMATS[this.settings.format];
    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Saving frames', total: frames.length });
    const canvas = document.createElement('canvas');
    canvas.width = this.source.width;
    canvas.height = this.source.height;
    const context = canvas.getContext('2d');
    let saved = 0;
    let existing = 0;
    let failed = 0;

    for (let i = 0; i < frames.length && !run.stopped; i++) {
      const sample = frames[i];
      this.status = `Saving frame ${i + 1} of ${frames.length}`;
      this._updateToolbar();
      process?.update({ done: i, detail: this.stem });

      try {
        const { image } = await this.source.frameAt(sample.position);
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (format.type === 'image/jpeg') {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, format.type, format.quality));
        if (!blob) throw new Error('Could not encode the frame');
        const fileName = `${this.stem}_${String(Math.round(sample.time * 1000)).padStart(8, '0')}${format.extension}`;
        const result = await window.electronAPI.videoFrames.saveFrame(this.folder, fileName, await blob.arrayBuffer());
        if (!result.success) throw new Error(result.message || 'Save failed');
        if (result.existed) existing++;
        else saved++;
      } catch (error) {
        console.error(`Failed to save the frame at ${sample.time}s:`, error);
        failed++;
      }
    }

    this.status = '';
    const parts = [`${saved} saved`];
    if (existing) parts.push(`${existing} already there`);
    if (failed) parts.push(`${failed} failed`);
    process?.finish({ message: parts.join(', '), failed: failed > 0 && saved === 0, warning: failed > 0 });
    this.showToast(`${parts.join(', ')} in ${this.folder}`, failed ? 'warning' : 'success');
  }

  _releaseSamples() {
    this.samples.forEach(sample => URL.revokeObjectURL(sample.thumb));
    this.samples = [];
    this.kept = [];
  }

  async _clear() {
    await this._stopRun();
    this._releaseSamples();
    this.unticked.clear();
    this.source?.close();
    this.source = null;
    this.container.querySelector('#vf-grid').innerHTML = '';
    this.container.querySelector('#vf-workspace').style.display = 'none';
    this.container.querySelector('#vf-dropzone').style.display = '';
  }

  showToast(message, type = 'info') {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }
}

console.log('✅ VideoFrameTool module loaded');

export default VideoFrameTool;
window.VideoFrameTool = VideoFrameTool;
