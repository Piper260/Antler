import ComicPanelTagGrid, { escapeHtml } from './comic-panels/tagGrid.js';

console.log('🔧 ComicPanelTool module loading...');

// The tagger's own guesses at well-known characters are shown from this score.
const GUESS_SHOWN = 0.5;

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp'];
// Exported panels land in a "panels" folder next to the page by default;
// pages found inside such a folder are earlier output, not new pages.
const OUTPUT_FOLDER_PATTERN = /[\\/]panels[\\/][^\\/]+$/i;
// Boxes drawn smaller than this (in page pixels) are treated as stray clicks.
const MIN_BOX = 12;
const SAVE_DELAY = 400;

const STATUS_LABELS = {
  pending: 'Waiting',
  detecting: 'Detecting…',
  detected: 'Detected',
  review: 'Needs review',
  edited: 'Edited',
  exported: 'Exported',
  error: 'Failed'
};

class ComicPanelTool {
  constructor() {
    this.name = 'Comic Panels';
    this.id = 'comic-panels';
    this.icon = 'fas fa-table-cells-large';
    this.description = 'Split comic pages into separate panel images';
    this.version = '1.0.0';
    // Detection and export carry on while other tools are open; see
    // App.loadToolContent.
    this.keepAlive = true;

    // { name, filePath, file, previewUrl, width, height, panels: [{x,y,w,h}], gutterColor, status, message }
    this.pages = [];
    this.current = -1;
    this.selectedBox = -1;
    this.orderQueue = null; // panel indexes clicked so far while setting the order
    this.drag = null;
    this.detectRun = 0;     // bumped to cancel a running batch detection
    this.tagRun = 0;        // bumped to cancel the background tagging of the folder
    this.isExporting = false;
    this.saveTimers = new Map();
    // What the Panel tags pane learned, by page folder; see utils/panelTagLearning.js.
    this.learning = new Map();
    this.learningLoads = new Map();
    this.learningTimers = new Map();
    // Character profile lookups in flight or failed, by character tag.
    this.profileLoads = new Map();
    this.profileQueue = Promise.resolve();
    // Review of unsure tags (utils/panelTagReview.js): questions skipped, by
    // panel key and tag, the current question list while it's valid, and each
    // panel's questions, which mostly outlive one answer.
    this.reviewing = false;
    this.reviewSkipped = new Set();
    this.reviewCache = null;
    this.reviewMemo = new Map();
    this.learnVersion = 0;
    // Panels the last correction changed: { tag, current: [box indexes], other: count }.
    this.ripple = null;
    this.hideFinished = false;
    // Tag grid (comic-panels/tagGrid.js): crops by panel key, as object URLs.
    this.gridOpen = false;
    this.gridTag = null;
    this.gridScope = 'all';
    this.gridTiles = [];
    this.gridSummary = [];
    this.gridUndo = null;
    this.thumbs = new Map();
    this.settledTotal = 0;

    this.datasetMode = 'artist';
    this.datasetEntries = [];

    console.log('🗂️ Comic Panels Tool initialized');
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
    this.detectRun++;
    this.tagRun++;
    this._flushSaves();
    this.pages.forEach(page => {
      if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
    });
    this.pages = [];
    this._clearThumbs();
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    console.log('🧹 Comic Panels Tool cleaned up');
  }

  getTemplate() {
    return `
      <div class="cp-tool">
        <input type="file" id="cp-file-input" accept="image/*" multiple style="display:none">

        <div class="cp-dropzone" id="cp-dropzone">
          <div class="cp-dropzone-inner">
            <i class="fas fa-table-cells-large cp-drop-icon"></i>
            <h2 class="cp-drop-title">Drop Comic Pages</h2>
            <p class="cp-drop-sub">Panels are found automatically. Check them, fix any mistakes, then export each panel as its own image.</p>
            <div class="cp-drop-actions">
              <button class="btn btn-primary" id="cp-browse-btn">
                <i class="fas fa-folder-open"></i> Browse Files
              </button>
            </div>

            <div class="cp-dataset-picker">
              <div class="cp-dataset-divider"><span>or load a dataset</span></div>
              <div class="search-mode-container">
                <span class="mode-label active" id="cp-label-artist">Artist</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="cp-dataset-mode-toggle">
                  <span class="slider"></span>
                </label>
                <span class="mode-label" id="cp-label-character">Character</span>
              </div>
              <select class="form-input cp-dataset-select" id="cp-dataset-select">
                <option value="">Select artist...</option>
              </select>
              <button class="btn btn-ghost btn-sm" id="cp-dataset-btn">
                <i class="fas fa-folder-open"></i> Or choose a custom folder
              </button>
            </div>
          </div>
        </div>

        <div class="cp-workspace" id="cp-workspace" style="display:none">
          <div class="cp-toolbar">
            <div class="cp-toolbar-info">
              <span id="cp-count-label">0 pages</span>
              <label class="cp-setting cp-setting-check" title="Leave pages with every panel done out of the list">
                <input type="checkbox" id="cp-hide-finished">
                <span>Hide finished</span>
              </label>
            </div>
            <div class="cp-settings">
              <label class="cp-setting" title="Model: a trained panel detector, best for overlapping and irregular layouts. Gutters: follows the gaps between panels exactly, best for clean grids.">
                <span>Method</span>
                <select class="form-input" id="cp-method">
                  <option value="model">Model</option>
                  <option value="gutters">Gutters</option>
                </select>
              </label>
              <label class="cp-setting" title="Background colour between panels">
                <span>Gutter</span>
                <select class="form-input" id="cp-gutter">
                  <option value="auto">Auto</option>
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
              </label>
              <label class="cp-setting" title="How far a colour may differ from the gutter and still count as gutter">
                <span>Tolerance</span>
                <input type="number" class="form-input" id="cp-tolerance" min="5" max="120" step="5" value="40">
              </label>
              <label class="cp-setting" title="Regions smaller than this share of the page are ignored">
                <span>Min size %</span>
                <input type="number" class="form-input" id="cp-min-size" min="0.1" max="50" step="0.5" value="1.5">
              </label>
              <label class="cp-setting cp-setting-check">
                <input type="checkbox" id="cp-rtl">
                <span>Right to left</span>
              </label>
            </div>
            <div class="cp-toolbar-actions">
              <button class="btn" id="cp-add-dataset-btn" title="Add another folder of pages">
                <i class="fas fa-database"></i> Add Folder
              </button>
              <button class="btn" id="cp-add-btn" title="Add more pages">
                <i class="fas fa-plus"></i> Add More
              </button>
              <button class="btn" id="cp-detect-all-btn" title="Detect again on every page you have not edited">
                <i class="fas fa-rotate"></i> Detect All
              </button>
              <button class="btn" id="cp-grid-btn" title="Check one tag across every panel in the folder (G)">
                <i class="fas fa-table-cells"></i> Check a Tag
              </button>
              <button class="btn btn-primary" id="cp-export-btn">
                <i class="fas fa-file-export"></i> Export
              </button>
              <button class="btn" id="cp-apply-cleaned-btn" title="Paste each page's exported panel images, as they are now, back into the page. Each original page is kept in bak/cleanup beside it">
                <i class="fas fa-file-import"></i> Update Pages
              </button>
              <button class="btn" id="cp-clear-btn">
                <i class="fas fa-trash-alt"></i> Clear
              </button>
            </div>
          </div>

          <div class="cp-body">
            <div class="cp-pages" id="cp-pages"></div>

            <div class="cp-editor">
              <div class="cp-editor-bar">
                <div class="cp-editor-info" id="cp-editor-info"></div>
                <div class="cp-editor-actions">
                  <button class="btn btn-sm" id="cp-redetect-btn" title="Detect panels on this page again, replacing its boxes">
                    <i class="fas fa-rotate"></i> Re-detect Page
                  </button>
                  <button class="btn btn-sm" id="cp-order-btn" title="Click the panels in reading order">
                    <i class="fas fa-arrow-down-1-9"></i> Set Order
                  </button>
                  <button class="btn btn-sm" id="cp-delete-btn" title="Delete the selected panel (Delete key)" disabled>
                    <i class="fas fa-trash-alt"></i> Delete Panel
                  </button>
                </div>
              </div>
              <div class="cp-stage" id="cp-stage">
                <div class="cp-canvas" id="cp-canvas">
                  <img class="cp-page-img" id="cp-page-img" alt="" draggable="false">
                  <div class="cp-boxes" id="cp-boxes"></div>
                </div>
              </div>
              <div class="cp-hint" id="cp-hint">Drag on an empty area to add a panel. Drag a panel to move it, or its corners to resize.</div>
            </div>

            <div class="cp-tags-pane" id="cp-tags-pane"></div>
          </div>
          ${this._gridTemplate()}
        </div>

        <div class="modal-overlay" id="cp-export-modal" style="display:none">
          <div class="modal-content cp-export-content">
            <div class="modal-header">
              <h3>Export Panels</h3>
              <button class="modal-close" id="cp-export-close" title="Close">&times;</button>
            </div>
            <div class="modal-body cp-export-body">
              <div class="form-group">
                <span class="form-label">Save to</span>
                <label class="cp-radio">
                  <input type="radio" name="cp-dest" value="beside" checked>
                  <span>Where each page's panels already are, or a <code>panels</code> folder next to it</span>
                </label>
                <label class="cp-radio">
                  <input type="radio" name="cp-dest" value="folder">
                  <span>One folder:</span>
                  <span class="cp-dest-path" id="cp-dest-path">none chosen</span>
                  <button class="btn btn-sm" id="cp-dest-choose">Choose…</button>
                </label>
              </div>
              <div class="cp-export-grid">
                <label class="form-group">
                  <span class="form-label">Format</span>
                  <select class="form-input" id="cp-format">
                    <option value="png">PNG</option>
                    <option value="jpg">JPG</option>
                    <option value="webp">WebP</option>
                  </select>
                </label>
                <label class="form-group">
                  <span class="form-label">Padding (px)</span>
                  <input type="number" class="form-input" id="cp-padding" min="0" max="200" value="0">
                </label>
                <label class="form-group">
                  <span class="form-label">Outside the panel shape</span>
                  <select class="form-input" id="cp-outside">
                    <option value="keep">Keep as is</option>
                    <option value="gutter">Fill with gutter colour</option>
                    <option value="transparent">Make transparent</option>
                  </select>
                </label>
              </div>
              <p class="form-help">Only matters for panels that aren't rectangles: corners of the crop that belong to the gutter or a neighbouring panel are cleared. Transparency needs PNG or WebP.</p>
              <label class="cp-radio cp-write-tags">
                <input type="checkbox" id="cp-write-tags" checked>
                <span>Write a tag file for each panel</span>
              </label>
              <p class="form-help" id="cp-write-tags-help">Starts from the page's tag file (same name, .txt), keeps the tags the e621 tagger sees in each panel and adds ones it is confident about. Pages without a tag file are exported without one.</p>
              <p class="form-help">Panel images that already exist are kept, so upscaled sets stay as they are. Their tag files are still updated.</p>
              <p class="cp-export-summary" id="cp-export-summary"></p>
            </div>
            <div class="modal-actions">
              <button class="btn" id="cp-export-cancel">Cancel</button>
              <button class="btn btn-primary" id="cp-export-run">Export</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async initialize(container) {
    console.log('🔧 Initializing Comic Panels Tool...');
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this.exportDir = null;
      this._setupEvents();
      await Promise.all([this._loadDatasetDropdown(), this._loadStatus()]);
      console.log('✅ Comic Panels Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Comic Panels Tool:', error);
    }
  }

  $(selector) {
    return this.container.querySelector(selector);
  }

  _setupEvents() {
    const dropzone = this.$('#cp-dropzone');
    const fileInput = this.$('#cp-file-input');

    this.$('#cp-browse-btn').addEventListener('click', () => fileInput.click());
    this.$('#cp-add-btn').addEventListener('click', () => fileInput.click());
    this.$('#cp-dataset-btn').addEventListener('click', () => this._pickFolder());
    this.$('#cp-add-dataset-btn').addEventListener('click', () => this._pickFolder());
    this.$('#cp-dataset-select').addEventListener('change', (e) => this._onDatasetSelect(e.target.value));
    this.$('#cp-dataset-mode-toggle').addEventListener('change', () => this._onDatasetModeToggle());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) this._addFiles(e.target.files);
      fileInput.value = '';
    });

    dropzone.addEventListener('click', (e) => {
      if (!e.target.closest('#cp-browse-btn') && !e.target.closest('.cp-dataset-picker')) fileInput.click();
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', (e) => {
      if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      this._addFiles(e.dataTransfer.files);
    });

    const workspace = this.$('#cp-workspace');
    workspace.addEventListener('dragover', (e) => e.preventDefault());
    workspace.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) this._addFiles(e.dataTransfer.files);
    });

    this.$('#cp-detect-all-btn').addEventListener('click', () => this._detectAll({ includeDetected: true }));
    this.$('#cp-export-btn').addEventListener('click', () => this._openExport());
    this.$('#cp-apply-cleaned-btn').addEventListener('click', () => this._applyCleaned());
    this.$('#cp-clear-btn').addEventListener('click', () => this._clear());
    this.$('#cp-redetect-btn').addEventListener('click', () => this._redetectCurrent());
    this.$('#cp-order-btn').addEventListener('click', () => this._toggleOrderMode());
    this.$('#cp-delete-btn').addEventListener('click', () => this._deleteSelected());
    this.$('#cp-hide-finished').addEventListener('change', (e) => {
      this.hideFinished = e.target.checked;
      this._renderPages();
    });
    this._setupGridEvents();

    this.$('#cp-pages').addEventListener('click', (e) => {
      const row = e.target.closest('.cp-page-row');
      if (row) this._showPage(Number(row.dataset.index));
    });

    const canvas = this.$('#cp-canvas');
    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    this.$('#cp-page-img').addEventListener('load', () => this._fitCanvas());

    this._resizeObserver = new ResizeObserver(() => this._fitCanvas());
    this._resizeObserver.observe(this.$('#cp-stage'));

    const tagsPane = this.$('#cp-tags-pane');
    tagsPane.addEventListener('click', (e) => {
      const review = e.target.closest('[data-review]');
      if (review) {
        this._onReviewButton(review.dataset.review);
        return;
      }
      const tag = e.target.closest('.cp-tag');
      if (tag) this._toggleTag(tag.dataset.tag, tag.dataset.action);
    });
    tagsPane.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.matches('.cp-tag-input')) {
        e.target.blur();
        return;
      }
      if (e.key !== 'Enter' || !e.target.matches('.cp-tag-input')) return;
      const value = e.target.value.trim().replace(/_/g, ' ');
      if (value) this._toggleTag(value, 'restore');
      this.$('#cp-tags-pane .cp-tag-input')?.focus();
    });

    this._keyHandler = (e) => this._onKeyDown(e);
    document.addEventListener('keydown', this._keyHandler);

    // Export dialog
    this.$('#cp-export-close').addEventListener('click', () => this._closeExport());
    this.$('#cp-export-cancel').addEventListener('click', () => this._closeExport());
    this.$('#cp-export-run').addEventListener('click', () => this._runExport());
    this.$('#cp-dest-choose').addEventListener('click', async (e) => {
      e.preventDefault();
      const result = await window.electronAPI.dialog.openDirectory();
      if (!result?.success || !result.path) return;
      this.exportDir = result.path;
      this.$('#cp-dest-path').textContent = result.path;
      this.$('#cp-dest-path').title = result.path;
      this.$('input[name="cp-dest"][value="folder"]').checked = true;
    });
  }

  // ---------------------------------------------------------------- loading

  /** Without the model files, only gutter detection and untagged export are offered. */
  async _loadStatus() {
    let status = null;
    try {
      status = await window.electronAPI.comicPanels.getStatus();
    } catch (error) {
      console.error('❌ Failed to read comic panel status:', error);
    }
    this.taggerAvailable = Boolean(status?.taggerAvailable);
    if (!status?.taggerAvailable) {
      const box = this.$('#cp-write-tags');
      box.checked = false;
      box.disabled = true;
      this.$('#cp-write-tags-help').textContent = 'The e621 tagger (resources/models/tagger) was not found, so panels are exported without tag files.';
    }
    if (status?.success && status.modelAvailable) return;
    const select = this.$('#cp-method');
    select.querySelector('option[value="model"]').disabled = true;
    select.value = 'gutters';
    select.closest('.cp-setting').title = 'The panel model (resources/models/comic/inkwell-panels.onnx) was not found, so gutter detection is used.';
  }

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
    const select = this.$('#cp-dataset-select');
    if (!select) return;

    const options = this.datasetEntries
      .filter(entry => entry.type === this.datasetMode)
      .sort((a, b) => (a.displayName || a.name || '').toLowerCase().localeCompare((b.displayName || b.name || '').toLowerCase()))
      .map(entry => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.displayName || entry.name)} (${entry.fileCount || 0} files)</option>`)
      .join('');

    select.innerHTML = `<option value="">Select ${this.datasetMode}...</option>${options}`;
  }

  _onDatasetModeToggle() {
    const isCharacterMode = this.$('#cp-dataset-mode-toggle').checked;
    this.datasetMode = isCharacterMode ? 'character' : 'artist';
    this.$('#cp-label-artist').classList.toggle('active', !isCharacterMode);
    this.$('#cp-label-character').classList.toggle('active', isCharacterMode);
    this._populateDatasetSelect();
  }

  async _onDatasetSelect(entryId) {
    if (!entryId) return;
    const entry = this.datasetEntries.find(item => item.id === entryId);
    if (entry?.path) await this._addFolder(entry.path);
    this.$('#cp-dataset-select').value = '';
  }

  async _pickFolder() {
    const result = await window.electronAPI.dialog.openDirectory();
    if (result?.success && result.path) await this._addFolder(result.path);
  }

  async _addFolder(folderPath) {
    const scan = await window.electronAPI.utils.scanImageFolder(folderPath);
    if (!scan.success) {
      this.showToast(scan.message || 'Failed to scan folder', 'error');
      return;
    }
    await this._addPages((scan.images || []).map(entry => ({ name: entry.name, filePath: entry.filePath, file: null })));
  }

  async _addFiles(fileList) {
    const files = Array.from(fileList).filter(file => IMAGE_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext)));
    const withPaths = files.map(file => ({ file, filePath: window.electronAPI.utils.pathForFile(file) })).filter(entry => entry.filePath);
    if (withPaths.length < files.length) {
      this.showToast('Some files have no location on disk and were skipped', 'warning');
    }
    await this._addPages(withPaths.map(({ file, filePath }) => ({ name: file.name, filePath, file })));
  }

  async _addPages(entries) {
    const known = new Set(this.pages.map(page => page.filePath));
    const fresh = entries
      .filter(entry => !known.has(entry.filePath) && !OUTPUT_FOLDER_PATTERN.test(entry.filePath))
      // Compared without extensions so "page2.jpg" sorts before "page2_extra.png".
      .sort((a, b) => a.filePath.replace(/\.[^.\\/]+$/, '')
        .localeCompare(b.filePath.replace(/\.[^.\\/]+$/, ''), undefined, { numeric: true, sensitivity: 'base' }));

    if (fresh.length === 0) {
      this.showToast(entries.length ? 'Those pages are already loaded' : 'No images found', 'warning');
      return;
    }

    for (const entry of fresh) {
      const page = { ...entry, previewUrl: null, width: 0, height: 0, panels: [], gutterColor: null, status: 'pending', message: '' };
      try {
        const saved = await window.electronAPI.comicPanels.loadLayout(entry.filePath);
        if (saved.success && saved.layout) {
          Object.assign(page, {
            panels: saved.layout.panels,
            width: saved.layout.width,
            height: saved.layout.height,
            gutterColor: saved.layout.gutterColor,
            exportDir: saved.layout.exportDir || null,
            status: 'edited'
          });
          await this._matchExported(page);
        }
      } catch (error) {
        console.error(`Failed to read saved panels for ${entry.name}:`, error);
      }
      this.pages.push(page);
    }

    this._switchToWorkspace();
    this._renderPages();
    if (this.current < 0) this._showPage(0);
    this.showToast(`Loaded ${fresh.length} page(s)`, 'success');
    this._detectAll({ includeDetected: false });
  }

  _switchToWorkspace() {
    this.$('#cp-dropzone').style.display = 'none';
    this.$('#cp-workspace').style.display = 'flex';
  }

  // -------------------------------------------------------------- detection

  _detectOptions() {
    return {
      method: this.$('#cp-method').value,
      gutter: this.$('#cp-gutter').value,
      tolerance: Number(this.$('#cp-tolerance').value) || 40,
      minAreaPercent: Number(this.$('#cp-min-size').value) || 1.5,
      rtl: this.$('#cp-rtl').checked
    };
  }

  /**
   * Detect on every page still waiting, and with `includeDetected` also on
   * pages that were only auto-detected. Hand-edited pages are never
   * overwritten here; Re-detect Page does that for one page on purpose.
   */
  async _detectAll({ includeDetected }) {
    const run = ++this.detectRun;
    const targets = this.pages.filter(page => page.status === 'pending' || page.status === 'error'
      || (includeDetected && (page.status === 'detected' || page.status === 'review')));
    targets.forEach(page => { page.status = 'pending'; });
    this._renderPages();
    if (targets.length === 0) {
      this._tagAll();
      return;
    }

    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Finding panels', total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (run !== this.detectRun) {
        process?.finish({ message: 'Stopped' });
        return;
      }
      process?.update({ done: i, detail: targets[i].name });
      await this._detectPage(targets[i]);
    }
    const review = targets.filter(page => page.status === 'review').length;
    const failed = targets.filter(page => page.status === 'error').length;
    process?.finish({
      message: [failed && `${failed} failed`, review && `${review} to review`].filter(Boolean).join(', ') || `${targets.length} done`,
      failed: failed === targets.length,
      warning: failed > 0 || review > 0
    });
    this._tagAll();
  }

  /**
   * Tags every panel in the background, so review and the tag grid see the
   * whole folder from the start. Facts already in the folder's cache
   * (main/services/panelTagCache.js) come straight back.
   */
  async _tagAll() {
    if (!this.taggerAvailable) return;
    const run = ++this.tagRun;
    const targets = this.pages.filter(page => page.status !== 'pending' && page.status !== 'detecting'
      && !['none', 'error'].includes(page.tagState) && page.panels.some(box => !box.tagFacts));
    if (targets.length === 0) {
      this._preloadThumbs(run);
      return;
    }

    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Tagging panels', total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (run !== this.tagRun) {
        process?.finish({ message: 'Stopped' });
        return;
      }
      process?.update({ done: i, detail: targets[i].name });
      await this._ensurePanelTags(targets[i]);
    }
    const failed = targets.filter(page => page.tagState === 'error').length;
    process?.finish({ message: failed ? `${failed} failed` : `${targets.length} done`, failed: failed === targets.length, warning: failed > 0 });
    this._preloadThumbs(run);
  }

  async _redetectCurrent() {
    const page = this.pages[this.current];
    if (!page || page.status === 'detecting') return;
    this._cancelOrderMode();
    await this._detectPage(page);
    // Overwrite any saved edits too, or reopening the page would bring the
    // old boxes back.
    if (page.status !== 'error') this._scheduleSave(page);
  }

  async _detectPage(page) {
    page.status = 'detecting';
    this._renderPages();
    if (page === this.pages[this.current]) this._renderEditorInfo();

    try {
      const result = await window.electronAPI.comicPanels.detect(page.filePath, this._detectOptions());
      if (!this.pages.includes(page)) return;
      if (!result.success) throw new Error(result.message || 'Detection failed');

      Object.assign(page, {
        width: result.width,
        height: result.height,
        panels: result.panels,
        gutterColor: result.gutterColor,
        status: result.needsReview ? 'review' : 'detected',
        message: result.fallbackReason || ''
      });
      await this._matchExported(page);
      if (result.fallbackReason && !this.fallbackWarned) {
        this.fallbackWarned = true;
        this.showToast(result.fallbackReason, 'warning');
      }
    } catch (error) {
      console.error(`Panel detection failed for ${page.name}:`, error);
      page.status = 'error';
      page.message = error.message;
    }

    this._renderPages();
    if (page === this.pages[this.current]) {
      this.selectedBox = -1;
      this._renderBoxes();
      this._renderEditorInfo();
    }
  }

  // ------------------------------------------------------------- page list

  _renderPages() {
    const list = this.$('#cp-pages');
    if (!list) return;

    const doneIn = (page) => page.panels.filter(box => box.tagEdits?.final).length;
    list.innerHTML = this.pages.map((page, i) => {
      const done = doneIn(page);
      if (this.hideFinished && i !== this.current && page.panels.length && done === page.panels.length) return '';
      const count = page.status === 'pending' || page.status === 'detecting' ? ''
        : `${page.panels.length} panel${page.panels.length === 1 ? '' : 's'}${done ? `, ${done} done` : ''}`;
      return `
        <div class="cp-page-row${i === this.current ? ' active' : ''}" data-index="${i}" title="${escapeHtml(page.filePath)}">
          <div class="cp-page-name">${escapeHtml(page.name)}</div>
          <div class="cp-page-meta">
            <span>${count}</span>
            <span class="cp-status cp-status-${page.status}"${page.message ? ` title="${escapeHtml(page.message)}"` : ''}>
              ${page.status === 'detecting' ? '<i class="fas fa-spinner fa-spin"></i> ' : ''}${STATUS_LABELS[page.status]}
            </span>
          </div>
        </div>
      `;
    }).join('');

    const total = this.pages.reduce((sum, page) => sum + page.panels.length, 0);
    const review = this.pages.filter(page => page.status === 'review').length;
    const done = this.pages.reduce((sum, page) => sum + doneIn(page), 0);
    this.$('#cp-count-label').textContent = `${this.pages.length} page${this.pages.length === 1 ? '' : 's'}, ${total} panel${total === 1 ? '' : 's'}`
      + (done ? `, ${done} done` : '') + (review ? `, ${review} to review` : '');
  }

  async _showPage(index, { keepRipple = false } = {}) {
    const page = this.pages[index];
    if (!page) return;

    this._cancelOrderMode();
    this.current = index;
    this.selectedBox = -1;
    if (!keepRipple) this.ripple = null;
    this._renderPages();
    this._renderEditorInfo();

    const img = this.$('#cp-page-img');
    if (!page.previewUrl) {
      try {
        if (page.file) {
          page.previewUrl = URL.createObjectURL(page.file);
        } else {
          const read = await window.electronAPI.utils.readImageFile(page.filePath);
          if (!read.success) throw new Error(read.message || 'Could not read the page');
          page.previewUrl = URL.createObjectURL(new Blob([new Uint8Array(read.data)], { type: read.mime || 'image/png' }));
        }
      } catch (error) {
        this.showToast(`Could not open ${page.name}: ${error.message}`, 'error');
        return;
      }
    }
    if (this.current !== index) return;

    img.src = page.previewUrl;
    if (this.reviewing) this._nextQuestion();
    else this._renderBoxes();
  }

  _renderEditorInfo() {
    const page = this.pages[this.current];
    const info = this.$('#cp-editor-info');
    if (!info) return;
    if (!page) {
      info.textContent = '';
      return;
    }
    const size = page.width ? `${page.width} × ${page.height}` : '';
    info.innerHTML = `<span class="cp-editor-name">${escapeHtml(page.name)}</span><span>${size}</span>`;
    this.$('#cp-redetect-btn').disabled = page.status === 'detecting';
    this.$('#cp-order-btn').disabled = page.panels.length < 2;
    this.$('#cp-delete-btn').disabled = this.selectedBox < 0;
  }

  // ---------------------------------------------------------------- editor

  /** Size the canvas to the largest fit of the page inside the stage. */
  _fitCanvas() {
    const img = this.$('#cp-page-img');
    const stage = this.$('#cp-stage');
    const canvas = this.$('#cp-canvas');
    if (!img || !img.naturalWidth || !stage.clientWidth) return;

    const page = this.pages[this.current];
    if (page && !page.width) {
      page.width = img.naturalWidth;
      page.height = img.naturalHeight;
      this._renderEditorInfo();
    }

    const scale = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
    canvas.style.width = `${Math.floor(img.naturalWidth * scale)}px`;
    canvas.style.height = `${Math.floor(img.naturalHeight * scale)}px`;
  }

  /** Page dimensions for box maths; the image itself is the fallback. */
  _pageSize(page) {
    const img = this.$('#cp-page-img');
    return {
      width: page.width || img.naturalWidth || 1,
      height: page.height || img.naturalHeight || 1
    };
  }

  _renderBoxes() {
    const layer = this.$('#cp-boxes');
    const page = this.pages[this.current];
    if (!layer) return;
    if (!page) {
      layer.innerHTML = '';
      return;
    }

    const { width, height } = this._pageSize(page);
    layer.innerHTML = page.panels.map((box, i) => {
      let label = String(i + 1);
      if (this.orderQueue) {
        const position = this.orderQueue.indexOf(i);
        label = position >= 0 ? String(position + 1) : '';
      }
      const classes = ['cp-box'];
      if (i === this.selectedBox && !this.orderQueue) classes.push('selected');
      if (this.orderQueue && this.orderQueue.includes(i)) classes.push('ordered');
      if (this.ripple?.fresh && this.ripple.current.includes(i)) classes.push('cp-box-changed');
      if (box.tagEdits?.final) classes.push('cp-box-done');
      return `
        <div class="${classes.join(' ')}" data-index="${i}" title="${escapeHtml(box.tagFacts ? `Panel ${i + 1}: ${this._finalTags(box, page).join(', ')}` : '')}" style="left:${(box.x / width) * 100}%;top:${(box.y / height) * 100}%;width:${(box.w / width) * 100}%;height:${(box.h / height) * 100}%">
          <span class="cp-box-label">${label}</span>
          ${i === this.selectedBox && !this.orderQueue ? ['nw', 'ne', 'sw', 'se'].map(corner => `<span class="cp-handle cp-handle-${corner}" data-corner="${corner}"></span>`).join('') : ''}
        </div>
      `;
    }).join('');

    this.$('#cp-delete-btn').disabled = this.selectedBox < 0;
    this.$('#cp-order-btn').disabled = page.panels.length < 2;
    this._renderTagPane();
    this._scheduleTagPreview(page);
  }

  _toPagePoint(e) {
    const rect = this.$('#cp-canvas').getBoundingClientRect();
    const { width, height } = this._pageSize(this.pages[this.current]);
    return {
      x: Math.min(width, Math.max(0, ((e.clientX - rect.left) / rect.width) * width)),
      y: Math.min(height, Math.max(0, ((e.clientY - rect.top) / rect.height) * height))
    };
  }

  _onPointerDown(e) {
    const page = this.pages[this.current];
    if (!page || e.button !== 0 || page.status === 'detecting') return;
    const point = this._toPagePoint(e);
    const boxEl = e.target.closest('.cp-box');

    if (this.orderQueue) {
      if (boxEl) this._orderClick(Number(boxEl.dataset.index));
      return;
    }

    const handle = e.target.closest('.cp-handle');
    if (boxEl) {
      const index = Number(boxEl.dataset.index);
      this.selectedBox = index;
      this.drag = {
        mode: handle ? 'resize' : 'move',
        corner: handle?.dataset.corner,
        index,
        start: point,
        original: { ...page.panels[index] },
        changed: false
      };
    } else {
      page.panels.push({ x: point.x, y: point.y, w: 0, h: 0 });
      this.selectedBox = page.panels.length - 1;
      this.drag = { mode: 'draw', index: this.selectedBox, start: point, changed: false };
    }

    this.$('#cp-canvas').setPointerCapture(e.pointerId);
    this._renderBoxes();
    e.preventDefault();
  }

  _onPointerMove(e) {
    if (!this.drag) return;
    const page = this.pages[this.current];
    const { width, height } = this._pageSize(page);
    const point = this._toPagePoint(e);
    const box = page.panels[this.drag.index];
    const { start, original } = this.drag;

    if (this.drag.mode === 'move') {
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      box.x = Math.min(width - original.w, Math.max(0, original.x + dx));
      box.y = Math.min(height - original.h, Math.max(0, original.y + dy));
    } else {
      // Drawing is resizing from the corner opposite the start point.
      const anchor = this.drag.mode === 'draw' ? start : {
        x: this.drag.corner.includes('w') ? original.x + original.w : original.x,
        y: this.drag.corner.includes('n') ? original.y + original.h : original.y
      };
      box.x = Math.min(anchor.x, point.x);
      box.y = Math.min(anchor.y, point.y);
      box.w = Math.abs(point.x - anchor.x);
      box.h = Math.abs(point.y - anchor.y);
    }

    this.drag.changed = true;
    const el = this.$(`.cp-box[data-index="${this.drag.index}"]`);
    if (el) {
      el.style.left = `${(box.x / width) * 100}%`;
      el.style.top = `${(box.y / height) * 100}%`;
      el.style.width = `${(box.w / width) * 100}%`;
      el.style.height = `${(box.h / height) * 100}%`;
    }
  }

  _onPointerUp(e) {
    if (!this.drag) return;
    const page = this.pages[this.current];
    const { mode, index, changed, original } = this.drag;
    this.drag = null;
    if (this.$('#cp-canvas').hasPointerCapture(e.pointerId)) this.$('#cp-canvas').releasePointerCapture(e.pointerId);

    const box = page.panels[index];
    box.x = Math.round(box.x);
    box.y = Math.round(box.y);
    box.w = Math.round(box.w);
    box.h = Math.round(box.h);

    if (mode !== 'move' && (box.w < MIN_BOX || box.h < MIN_BOX)) {
      if (mode === 'draw') {
        page.panels.splice(index, 1);
        this.selectedBox = -1;
      } else {
        Object.assign(box, original);
      }
    } else if (changed) {
      delete box.tagFacts;
      if (box.tagEdits) delete box.tagEdits.final;
      this._markEdited(page);
    }
    this._renderBoxes();
  }

  _onKeyDown(e) {
    // A kept-alive tool stays in the page while hidden; only react when shown.
    if (!this.container?.isConnected || !this.container.offsetParent || this.$('#cp-workspace').style.display === 'none') return;
    if (e.target.closest('input, select, textarea')) return;
    if (this.$('#cp-export-modal').style.display !== 'none') return;

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.gridOpen) {
      this._onGridKey(e);
      return;
    }
    const key = e.key.toLowerCase();
    const tagsReady = !this.orderQueue && this.pages[this.current]?.tagState === 'ready';
    const folderReady = () => !this.orderQueue && this.pages[this.current] && this._folderPanels(this.pages[this.current]).length > 0;

    if (this.reviewing && ['y', 'n', 's'].includes(key) && folderReady()) {
      e.preventDefault();
      this._reviewAnswer({ y: 'yes', n: 'no', s: 'skip' }[key]);
    } else if (key === 'r' && folderReady()) {
      e.preventDefault();
      this._toggleReview();
    } else if (key === 'g' && folderReady()) {
      e.preventDefault();
      this._openGrid();
    } else if (e.key === 'Enter' && folderReady()) {
      e.preventDefault();
      this._finishPanel();
    } else if (key === 't' && tagsReady && this.selectedBox >= 0) {
      e.preventDefault();
      this.$('#cp-tags-pane .cp-tag-input')?.focus();
    } else if (/^[1-9]$/.test(key) && tagsReady) {
      const numbered = [...this.container.querySelectorAll('#cp-tags-pane .cp-tag-key')].find(el => el.textContent === key);
      if (numbered) {
        e.preventDefault();
        numbered.closest('.cp-tag').click();
      }
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !this.orderQueue) {
      e.preventDefault();
      this._stepPanel(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Escape' && this.reviewing) {
      this._toggleReview(false);
    } else if (e.key === 'Escape') {
      if (this.orderQueue) this._cancelOrderMode();
      else if (this.selectedBox >= 0) {
        this.selectedBox = -1;
        this._renderBoxes();
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedBox >= 0 && !this.orderQueue) {
      e.preventDefault();
      this._deleteSelected();
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      if (this.current < this.pages.length - 1) {
        e.preventDefault();
        this._showPage(this.current + 1);
      }
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      if (this.current > 0) {
        e.preventDefault();
        this._showPage(this.current - 1);
      }
    }
  }

  _deleteSelected() {
    const page = this.pages[this.current];
    if (!page || this.selectedBox < 0) return;
    page.panels.splice(this.selectedBox, 1);
    this.selectedBox = -1;
    this._markEdited(page);
    this._renderBoxes();
  }

  _toggleOrderMode() {
    if (this.orderQueue) {
      this._cancelOrderMode();
      return;
    }
    const page = this.pages[this.current];
    if (!page || page.panels.length < 2) return;
    this.orderQueue = [];
    this.selectedBox = -1;
    this.$('#cp-order-btn').classList.add('active');
    this.$('#cp-hint').textContent = 'Click the panels in reading order. Esc cancels.';
    this._renderBoxes();
  }

  _orderClick(index) {
    const page = this.pages[this.current];
    if (this.orderQueue.includes(index)) return;
    this.orderQueue.push(index);

    if (this.orderQueue.length === page.panels.length) {
      page.panels = this.orderQueue.map(i => page.panels[i]);
      this._cancelOrderMode();
      this._markEdited(page);
      return;
    }
    this._renderBoxes();
  }

  _cancelOrderMode() {
    if (!this.orderQueue) return;
    this.orderQueue = null;
    this.$('#cp-order-btn').classList.remove('active');
    this.$('#cp-hint').textContent = 'Drag on an empty area to add a panel. Drag a panel to move it, or its corners to resize.';
    this._renderBoxes();
  }

  _markEdited(page) {
    page.status = 'edited';
    this._renderPages();
    this._scheduleSave(page);
  }

  _scheduleSave(page) {
    clearTimeout(this.saveTimers.get(page.filePath));
    this.saveTimers.set(page.filePath, setTimeout(() => {
      this.saveTimers.delete(page.filePath);
      this._saveLayout(page);
    }, SAVE_DELAY));
  }

  _flushSaves() {
    for (const [filePath, timer] of this.saveTimers) {
      clearTimeout(timer);
      const page = this.pages.find(item => item.filePath === filePath);
      if (page) this._saveLayout(page);
    }
    this.saveTimers.clear();
  }

  async _saveLayout(page) {
    try {
      const result = await window.electronAPI.comicPanels.saveLayout(page.filePath, {
        width: page.width,
        height: page.height,
        gutterColor: page.gutterColor,
        exportDir: page.exportDir || null,
        panels: page.panels
      });
      if (!result.success) throw new Error(result.message);
    } catch (error) {
      console.error(`Failed to save panels for ${page.name}:`, error);
      this.showToast(`Could not save panel edits for ${page.name}`, 'error');
    }
    if (page.tagsChanged) await this._writeLiveTags(page);
  }

  /**
   * A panel keeps its file name once exported, so deleting or reordering
   * panels can't point its tags at another panel's image. Panels exported
   * before names were kept are matched up by their number.
   */
  async _matchExported(page, folder = page.exportDir) {
    try {
      const result = await window.electronAPI.comicPanels.exportedNames(page.filePath, page.panels.length, folder);
      if (!result.success) throw new Error(result.message);
      page.exportDir = page.exportDir || result.folder;
      this._keepNames(page.panels, result.names);
    } catch (error) {
      console.error(`Failed to look up exported panels for ${page.name}:`, error);
    }
  }

  _keepNames(boxes, names) {
    let added = false;
    boxes.forEach((box, i) => {
      if (box.exportName || !names?.[i]) return;
      box.exportName = names[i];
      added = true;
    });
    return added;
  }

  /**
   * Tag edits reach the exported files as they're made. Only panels with the
   * user's own answers are written, so opening a page never replaces a
   * caption edited in the Tag Editor.
   */
  async _writeLiveTags(page) {
    page.tagsChanged = false;
    // A box still being drawn has no size yet.
    const boxes = page.panels.filter(box => box.w > 0 && box.h > 0);
    const panelTags = boxes.map(box => (box.tagFacts && box.tagEdits ? this._finalTags(box, page) : null));
    if (!panelTags.some(Boolean)) return;
    try {
      const result = await window.electronAPI.comicPanels.exportPanels(page.filePath, boxes, {
        ...this._exportSettings(),
        outputDir: page.exportDir || null,
        gutterColor: page.gutterColor || [255, 255, 255],
        panelTags,
        live: true
      });
      if (!result.success) throw new Error(result.message);
      if (this._keepNames(boxes, result.names)) this._scheduleSave(page);
    } catch (error) {
      console.error(`Failed to update panel tags for ${page.name}:`, error);
      this.showToast(`Could not update panel tags for ${page.name}`, 'error');
    }
  }

  // ------------------------------------------------------------ panel tags

  /**
   * Each panel's tags come from the page's tag file and what the e621 tagger
   * sees in the panel. The tagger's facts for a panel (main/services/
   * tagMerge.js panelTagFacts) are fetched in the background and kept on the
   * box as tagFacts; the tags are worked out from them plus what was learned
   * from corrections in this folder (utils/panelTagLearning.js), and the
   * user's own answers are kept as tagEdits ({ add, remove }), saved with the
   * layout, the panel's tag list too (final) once it is marked done. Export
   * writes the result.
   */
  _folderOf(page) {
    return page.filePath.replace(/[\\/][^\\/]*$/, '');
  }

  /** Learning for a page's folder, loaded on first use. */
  _ensureLearning(folder) {
    if (!this.learningLoads.has(folder)) {
      this.learningLoads.set(folder, (async () => {
        let saved = null;
        try {
          const result = await window.electronAPI.comicPanels.loadLearning(folder);
          if (result.success) saved = result.learning;
        } catch (error) {
          console.error('Panel tag learning load failed:', error);
        }
        this.learning.set(folder, { ...window.PanelTagLearning.emptyLearning(), ...(saved || {}) });
      })());
    }
    return this.learningLoads.get(folder);
  }

  _learningFor(page) {
    return this.learning.get(this._folderOf(page)) || window.PanelTagLearning.emptyLearning();
  }

  _saveLearning(page) {
    const folder = this._folderOf(page);
    clearTimeout(this.learningTimers.get(folder));
    this.learningTimers.set(folder, setTimeout(async () => {
      try {
        const result = await window.electronAPI.comicPanels.saveLearning(folder, this.learning.get(folder));
        if (!result.success) throw new Error(result.message);
      } catch (error) {
        console.error('Panel tag learning save failed:', error);
      }
    }, 600));
  }

  _resolve(box, page) {
    return window.PanelTagLearning.resolvePanelTags(box.tagFacts, this._learningFor(page));
  }

  _finalTags(box, page = this.pages[this.current]) {
    return window.PanelTagReview.finalTags(box.tagFacts, box.tagEdits, this._learningFor(page));
  }

  _panelKey(page, box) {
    return `${page.filePath}#${box.x},${box.y},${box.w},${box.h}`;
  }

  /** Every tagged panel in the page's folder, which all share its learning. */
  _folderPanels(page) {
    const folder = this._folderOf(page);
    return this.pages.filter(other => this._folderOf(other) === folder).flatMap(other => other.panels
      .map((box, boxIndex) => ({ page: other, box, boxIndex, facts: box.tagFacts, edits: box.tagEdits, key: this._panelKey(other, box) }))
      .filter(panel => panel.facts));
  }

  /** The panel's characters, their profiles, and species none of them usually are. */
  _panelCharacters(box, page) {
    const profiles = this._learningFor(page).profiles || {};
    const final = this._finalTags(box, page);
    const pageCharacters = [...new Set(page.panels.flatMap(panel => panel.tagFacts?.characters || []))].sort();
    const inPanel = pageCharacters.filter(name => final.includes(name));
    const panelProfiles = inPanel.map(name => profiles[name]).filter(profile => profile?.posts);
    const speciesTags = new Set(Object.keys(box.tagFacts.speciesScores || {}));
    panelProfiles.forEach(profile => Object.keys(profile.species).forEach(tag => speciesTags.add(tag)));
    // Only species get a fit: general tags like "anthro" are on nearly every post.
    const clashes = panelProfiles.length
      ? final.filter(tag => speciesTags.has(tag) && window.CharacterProfiles.fit(tag, panelProfiles).share < 0.05)
      : [];
    return { final, pageCharacters, inPanel, panelProfiles, speciesTags, clashes };
  }

  _scheduleTagPreview(page) {
    if (!this.taggerAvailable || !page || this.drag || ['none', 'error'].includes(page.tagState)) return;
    if (!page.panels.some(box => !box.tagFacts)) return;
    clearTimeout(page.tagTimer);
    page.tagTimer = setTimeout(() => this._loadPanelTags(page), 300);
  }

  /** Make sure every panel of a page has its tag facts (used before export). */
  async _ensurePanelTags(page) {
    if (!this.taggerAvailable || ['none', 'error'].includes(page.tagState)) return;
    clearTimeout(page.tagTimer);
    while (page.tagLoading) await new Promise(resolve => setTimeout(resolve, 100));
    await this._loadPanelTags(page);
  }

  async _loadPanelTags(page) {
    if (page.tagLoading) {
      page.tagAgain = true;
      return;
    }
    const boxes = page.panels.filter(box => !box.tagFacts);
    if (!boxes.length) return;
    page.tagLoading = true;
    page.tagState = 'loading';
    if (page === this.pages[this.current]) this._renderTagPane();

    try {
      await this._ensureLearning(this._folderOf(page));
      const result = await window.electronAPI.comicPanels.previewTags(page.filePath, boxes);
      if (!result.success) throw new Error(result.message);
      if (!result.available) page.tagState = 'none';
      else if (!result.pageTagFile) page.tagState = 'none';
      else {
        // Boxes moved meanwhile were cleared again and wait for the next round.
        const empty = { known: {}, candidates: {}, alwaysKeep: [], unknown: [], unknownDropped: [], signature: {} };
        boxes.forEach((box, i) => {
          if (page.panels.includes(box)) box.tagFacts = result.panels[i] || empty;
        });
        page.tagState = 'ready';
      }
    } catch (error) {
      console.error(`Panel tags failed for ${page.name}:`, error);
      page.tagState = 'error';
      page.tagMessage = error.message;
    }
    page.tagLoading = false;
    if (page.tagState === 'ready') {
      this._refreshFolderFacts(page);
      this.profileQueue = this.profileQueue.then(() => this._ensureProfiles(page));
    }
    if (this.gridOpen) this._renderGridTags();

    if (page === this.pages[this.current]) {
      if (this.reviewing) this._nextQuestion();
      else this._renderBoxes();
    }
    if (page.tagAgain) {
      page.tagAgain = false;
      this._scheduleTagPreview(page);
    }
  }

  /**
   * What is worked out from the folder's panels rather than saved: tags on
   * every page, which aren't questions (PanelTagReview.folderWideTags), and
   * each tag's score range from the answers so far (PanelTagReview.scoreRanges).
   */
  _refreshFolderFacts(page) {
    const learning = this._learningFor(page);
    const panels = this._folderPanels(page);
    const wide = window.PanelTagReview.folderWideTags(panels);
    const ranges = window.PanelTagReview.scoreRanges(panels);
    if (JSON.stringify([wide, ranges]) === JSON.stringify([learning.folderWide || {}, learning.ranges || { keep: {}, add: {} }])) return;
    learning.folderWide = wide;
    learning.ranges = ranges;
    this.reviewMemo.clear();
    this.learnVersion++;
  }

  /**
   * Remove a tag from the selected panel, or restore / add one. The change
   * is also learned (utils/panelTagLearning.js), so other panels that look
   * alike follow it; the panel's own edits only hold what learning doesn't
   * already give it.
   */
  _toggleTag(tag, action) {
    this._answer(this.pages[this.current], this.selectedBox, tag, action !== 'remove');
  }

  /**
   * Put `tag` on panel `index` of `page` or take it off, learn from it, and
   * note which other panels in the folder changed as a result.
   */
  _answer(page, index, tag, present) {
    const box = page?.panels[index];
    if (!box?.tagFacts) return;
    const learning = this._learningFor(page);
    const panels = this._folderPanels(page);
    // An answer only ever changes its own tag.
    const tagsOf = () => panels.map(panel => (window.PanelTagReview.hasTag(panel.facts, panel.box.tagEdits, learning, tag) ? [tag] : []));
    const before = tagsOf();

    const panel = { facts: box.tagFacts, edits: box.tagEdits, key: this._panelKey(page, box) };
    window.PanelTagReview.answer(learning, panel, tag, present);
    box.tagEdits = panel.edits;
    page.tagsChanged = true;
    // Rebuilt, as an answer may replace an earlier one on this panel.
    learning.ranges = window.PanelTagReview.scoreRanges(this._folderPanels(page));
    window.PanelTagReview.forgetTag(this.reviewMemo, panels, tag);
    this.reviewMemo.delete(panel.key);
    this.learnVersion++;

    const changed = window.PanelTagReview.changedPanels(before, tagsOf()).map(i => panels[i]).filter(other => other.box !== box);
    this.ripple = {
      tag,
      current: changed.filter(other => other.page === page).map(other => other.boxIndex),
      other: changed.filter(other => other.page !== page).length,
      fresh: true
    };
    clearTimeout(this.rippleTimer);
    this.rippleTimer = setTimeout(() => {
      if (this.ripple) this.ripple.fresh = false;
      this.container?.querySelectorAll('.cp-box-changed').forEach(el => el.classList.remove('cp-box-changed'));
    }, 2500);

    this._saveLearning(page);
    this._markEdited(page);
    this._renderBoxes();
  }

  // ---------------------------------------------------------------- review

  /** Skipped questions as reviewQueue wants them: by index into `panels`. */
  _skippedIn(panels) {
    const indexes = new Map(panels.map((panel, i) => [panel.key, i]));
    const skipped = new Set();
    for (const entry of this.reviewSkipped) {
      const cut = entry.lastIndexOf('|');
      const index = indexes.get(entry.slice(0, cut));
      if (index !== undefined) skipped.add(`${index}|${entry.slice(cut + 1)}`);
    }
    return skipped;
  }

  /** Questions about unsure tags across the folder, most far-reaching first. */
  _reviewQueue() {
    const page = this.pages[this.current];
    if (!page) return [];
    const panels = this._folderPanels(page);
    const stamp = [this._folderOf(page), this.learnVersion, this.reviewSkipped.size, panels.length].join('/');
    if (this.reviewCache?.stamp === stamp) return this.reviewCache.queue;

    const queue = window.PanelTagReview.reviewQueue(panels, panels.map((panel, i) => i), this._learningFor(page),
      (i) => this._panelCharacters(panels[i].box, panels[i].page).clashes, this._skippedIn(panels), this.reviewMemo)
      .map(item => ({ ...item, page: panels[item.index].page, boxIndex: panels[item.index].boxIndex, key: panels[item.index].key }));
    this.reviewCache = { stamp, queue };
    return queue;
  }

  /** The most useful question; one that settles nothing else needn't change page. */
  _topQuestion() {
    const queue = this._reviewQueue();
    const page = this.pages[this.current];
    const top = queue[0];
    if (!top || top.reach || top.page === page) return top;
    return queue.find(item => item.page === page && item.kind === top.kind) || top;
  }

  /** The question shown: the selected panel's first, else the top one. */
  _currentQuestion() {
    const page = this.pages[this.current];
    return this._reviewQueue().find(item => item.page === page && item.boxIndex === this.selectedBox) || this._topQuestion();
  }

  /** Select the panel the next question is about, on whichever page it is. */
  _nextQuestion() {
    const question = this._topQuestion();
    if (question && question.page !== this.pages[this.current]) {
      if (this.ripple) {
        this.ripple.other += this.ripple.current.length;
        this.ripple.current = [];
      }
      this._showPage(this.pages.indexOf(question.page), { keepRipple: true });
      return;
    }
    if (question) this.selectedBox = question.boxIndex;
    this._renderBoxes();
  }

  _toggleReview(on = !this.reviewing) {
    this.reviewing = on;
    if (on) this._nextQuestion();
    else this._renderTagPane();
  }

  _reviewAnswer(choice) {
    const question = this._currentQuestion();
    if (!question) return;
    if (choice === 'skip') this.reviewSkipped.add(`${question.key}|${question.tag}`);
    else this._answer(question.page, question.boxIndex, question.tag, choice === 'yes');
    this._nextQuestion();
  }

  _onReviewButton(action) {
    if (action === 'start') this._toggleReview(true);
    else if (action === 'stop') this._toggleReview(false);
    else if (action === 'done') this._finishPanel();
    else if (action === 'reopen') this._setDone(this.pages[this.current], this.selectedBox, false);
    else this._reviewAnswer(action);
  }

  /** Mark panel `index` of `page` done or open again. */
  _setDone(page, index, done) {
    const box = page.panels[index];
    if (!box?.tagFacts) return;
    const panels = this._folderPanels(page);
    const panel = { facts: box.tagFacts, edits: box.tagEdits, key: this._panelKey(page, box) };
    window.PanelTagReview.setDone(this._learningFor(page), panel, done);
    box.tagEdits = panel.edits;
    page.tagsChanged = true;
    panel.facts.unknown.forEach(tag => window.PanelTagReview.forgetTag(this.reviewMemo, panels, tag));
    this.reviewMemo.delete(panel.key);
    this.learnVersion++;
    this._saveLearning(page);
    this._markEdited(page);
    this._renderBoxes();
  }

  /** Enter: the selected panel is done; on to the next one that isn't. */
  async _finishPanel() {
    const page = this.pages[this.current];
    const box = page?.panels[this.selectedBox];
    if (box?.tagFacts && !box.tagEdits?.final) this._setDone(page, this.selectedBox, true);
    if (this.reviewing) {
      this._nextQuestion();
      return;
    }

    for (let p = this.current; p < this.pages.length; p++) {
      const panels = this.pages[p].panels;
      const next = panels.findIndex((other, i) => (p > this.current || i > this.selectedBox) && other.tagFacts && !other.tagEdits?.final);
      if (next < 0) continue;
      if (p !== this.current) await this._showPage(p);
      this.selectedBox = next;
      this._renderBoxes();
      return;
    }
    this.showToast('No panels left to do after this one', 'info');
  }

  /** Select the panel `step` away from the selected one on this page. */
  _stepPanel(step) {
    const page = this.pages[this.current];
    if (!page?.panels.length) return;
    const start = this.selectedBox < 0 ? (step > 0 ? -1 : page.panels.length) : this.selectedBox;
    this.selectedBox = Math.min(page.panels.length - 1, Math.max(0, start + step));
    this._renderBoxes();
  }

  /**
   * Character profiles (utils/characterProfiles.js) for the page's characters
   * and well-known characters the tagger recognises, counted from their e621
   * posts through the logged-in search and kept with the folder's learning.
   */
  async _ensureProfiles(page) {
    await this._ensureLearning(this._folderOf(page));
    const learning = this._learningFor(page);
    learning.profiles = learning.profiles || {};
    const names = new Set();
    for (const box of page.panels) {
      (box.tagFacts?.characters || []).forEach(name => names.add(name));
      Object.entries(box.tagFacts?.characterGuesses || {}).forEach(([name, score]) => {
        if (score >= GUESS_SHOWN) names.add(name);
      });
    }

    for (const name of names) {
      if (learning.profiles[name] || this.profileLoads.has(name)) continue;
      this.profileLoads.set(name, 'loading');
      if (page === this.pages[this.current]) this._renderTagPane();
      try {
        const result = await window.electronAPI.e621.searchByCharacter(name.replace(/ /g, '_'), { limit: 320 });
        if (!result.success) throw new Error(result.message || 'Search failed');
        learning.profiles[name] = window.CharacterProfiles.buildCharacterProfile(name, result.posts || []);
        this.profileLoads.delete(name);
        this.reviewMemo.clear();
        this.learnVersion++;
        this._saveLearning(page);
      } catch (error) {
        console.error(`Character profile for ${name} failed:`, error);
        this.profileLoads.set(name, 'failed');
      }
      if (page === this.pages[this.current]) this._renderBoxes();
    }
  }

  _resetLearning() {
    const page = this.pages[this.current];
    if (!page) return;
    const profiles = this._learningFor(page).profiles || {};
    this.learning.set(this._folderOf(page), { ...window.PanelTagLearning.emptyLearning(), profiles });
    this.reviewMemo.clear();
    this.learnVersion++;
    this._refreshFolderFacts(page);
    this._saveLearning(page);
    this._renderBoxes();
    this.showToast('Cleared what the panel tags learned for this folder', 'info');
  }

  _renderTagPane() {
    const pane = this.$('#cp-tags-pane');
    if (!pane) return;
    const page = this.pages[this.current];
    const box = page?.panels[this.selectedBox];
    const message = (text) => `<div class="cp-tags-head">Panel tags</div><p class="cp-tags-note">${text}</p>`;

    if (!this.taggerAvailable) {
      pane.innerHTML = message('The e621 tagger (resources/models/tagger) was not found.');
      return;
    }
    if (!page) {
      pane.innerHTML = message('');
      return;
    }
    if (page.tagState === 'none') {
      pane.innerHTML = message('This page has no tag file (same name, .txt) to start from.');
      return;
    }
    if (page.tagState === 'error') {
      pane.innerHTML = message(`Could not tag panels: ${escapeHtml(page.tagMessage || 'unknown error')}`);
      return;
    }
    if (!box) {
      pane.innerHTML = this._reviewHtml(page)
        + message(page.tagState === 'loading' ? 'Tagging panels\u2026' : 'Select a panel to see its tags, or press R to review the tags the tagger is unsure of.');
      return;
    }
    if (!box.tagFacts) {
      pane.innerHTML = message('Tagging this panel\u2026');
      return;
    }

    const result = this._resolve(box, page);
    const added = new Set(result.added);
    const unchecked = new Set(result.unverified);
    const learned = new Set(result.learned);
    const userAdded = new Set(box.tagEdits?.add || []);
    const final = this._finalTags(box, page);
    const dropped = [...new Set([...result.dropped, ...(box.tagEdits?.remove || [])])]
      .filter(tag => !final.includes(tag)).sort();

    const learning = this._learningFor(page);
    const done = Boolean(box.tagEdits?.final);
    const lessons = Object.keys(learning.keep).length + Object.keys(learning.add).length + Object.keys(learning.examples).length;

    // Characters: which are in this panel, their profiles, and what fits them.
    const profiles = learning.profiles || {};
    const { pageCharacters, inPanel, panelProfiles, speciesTags } = this._panelCharacters(box, page);
    const profiled = new Set(result.profiled || []);
    // A guess like "finnick" is the page's "finnick (zootopia)" under another name.
    const namedOnPage = (guess) => pageCharacters.some(name => name === guess || name.startsWith(`${guess} (`));
    const guesses = Object.entries(box.tagFacts.characterGuesses || {})
      .filter(([name, score]) => score >= GUESS_SHOWN && !final.includes(name) && !namedOnPage(name))
      .sort((a, b) => b[1] - a[1]);
    const suggested = window.CharacterProfiles.suggestions(panelProfiles, final).slice(0, 8);
    const percent = (share) => `${Math.round(share * 100)}%`;
    const profileLine = (name) => {
      const profile = profiles[name];
      if (profile?.posts) {
        const top = Object.entries(profile.species).sort((a, b) => b[1] - a[1]).slice(0, 3);
        return top.length ? top.map(([tag, share]) => `${escapeHtml(tag)} ${percent(share)}`).join(', ') : `${profile.posts} posts, no species`;
      }
      if (profile) return 'no e621 posts';
      if (this.profileLoads.get(name) === 'failed') return 'lookup failed';
      return 'looking up\u2026';
    };

    // Number keys 1-9 add the suggestions, then the tags taken off, in order.
    let nextKey = 1;
    const keyLabel = () => (nextKey <= 9 ? `<span class="cp-tag-key">${nextKey++}</span>` : '');
    const tagButton = (tag, action) => {
      const kinds = [];
      let title = action === 'remove' ? 'Click to remove' : 'Click to put back';
      if (action === 'remove' && userAdded.has(tag)) { kinds.push('cp-tag-user'); title = 'Set by you. Click to remove'; }
      else if (action === 'remove' && added.has(tag)) { kinds.push('cp-tag-added'); title = 'Added by the tagger. Click to remove'; }
      else if (action === 'remove' && unchecked.has(tag)) { kinds.push('cp-tag-unchecked'); title = 'The tagger can\'t check this one. Click to remove'; }
      else if (action === 'restore') kinds.push('cp-tag-dropped');
      if (learned.has(tag) && !userAdded.has(tag)) {
        kinds.push('cp-tag-learned');
        title = `Learned from your corrections. ${title}`;
      } else if (profiled.has(tag) && !userAdded.has(tag)) {
        kinds.push('cp-tag-learned');
        title = `Decided from the character's usual species. ${title}`;
      }
      let share = '';
      // Only species get a fit: general tags like "anthro" are on nearly every post.
      if (action === 'remove' && panelProfiles.length && speciesTags.has(tag)) {
        const match = window.CharacterProfiles.fit(tag, panelProfiles);
        if (match.share >= window.CharacterProfiles.OWN_SPECIES) {
          share = `<span class="cp-tag-fit">${percent(match.share)}</span>`;
          title = `Typical for ${match.name} (${percent(match.share)} of their posts). ${title}`;
        } else if (match.share < 0.05) {
          kinds.push('cp-tag-clash');
          title = `Not a usual species for ${inPanel.join(', ')}. ${title}`;
        }
      }
      const key = action === 'restore' ? keyLabel() : '';
      return `<button class="cp-tag ${kinds.join(' ')}" data-tag="${escapeHtml(tag)}" data-action="${action}" title="${escapeHtml(title)}">${key}${escapeHtml(tag)}${share}</button>`;
    };

    const ripple = this.ripple;
    const rippleParts = ripple ? [
      ripple.current.length ? `panel${ripple.current.length === 1 ? '' : 's'} ${ripple.current.map(i => i + 1).join(', ')}` : '',
      ripple.other ? `${ripple.other} panel${ripple.other === 1 ? '' : 's'} on other pages` : ''
    ].filter(Boolean) : [];

    pane.innerHTML = `
      ${this._reviewHtml(page)}
      ${ripple ? `<p class="cp-ripple">${rippleParts.length
        ? `That also changed ${rippleParts.join(' and ')}.`
        : 'No other panels changed.'}</p>` : ''}
      ${pageCharacters.length || guesses.length ? `<div class="cp-tags-sub">Characters</div>
      <div class="cp-characters">
        ${pageCharacters.map(name => `<div class="cp-character${final.includes(name) ? '' : ' cp-character-away'}" title="${final.includes(name) ? 'In this panel' : 'Not in this panel'}">
          <span class="cp-character-name">${escapeHtml(name)}</span>
          <span class="cp-character-info">${profileLine(name)}</span>
        </div>`).join('')}
        ${guesses.map(([name, score]) => `<div class="cp-character cp-character-guess">
          <span class="cp-character-name">May be <button class="cp-tag cp-tag-suggest" data-tag="${escapeHtml(name)}" data-action="restore" title="The tagger recognises this character (${percent(score)}). Click to add">${keyLabel()}${escapeHtml(name)}</button> ${percent(score)}</span>
          <span class="cp-character-info">${profileLine(name)}</span>
        </div>`).join('')}
      </div>` : ''}
      <div class="cp-tags-head">Panel ${this.selectedBox + 1} tags <span class="cp-tags-count">${final.length}</span></div>
      ${done
        ? '<p class="cp-tags-done">Done. These tags stay as they are. <button class="btn btn-sm btn-ghost" data-review="reopen">Reopen</button></p>'
        : '<button class="btn btn-sm cp-review-start" data-review="done" title="These tags are right; go to the next panel (Enter)">Panel Done <kbd>Enter</kbd></button>'}
      <div class="cp-tags-list">${final.map(tag => tagButton(tag, 'remove')).join('')}</div>
      ${suggested.length ? `<div class="cp-tags-sub">Usually tagged for ${escapeHtml(inPanel.join(', '))}</div>
      <div class="cp-tags-list">${suggested.map(item => `<button class="cp-tag cp-tag-suggest" data-tag="${escapeHtml(item.tag)}" data-action="restore" title="${escapeHtml(`${item.name}: ${percent(item.share)} of their posts. Click to add`)}">${keyLabel()}${escapeHtml(item.tag)}<span class="cp-tag-fit">${percent(item.share)}</span></button>`).join('')}</div>` : ''}
      <input class="form-input cp-tag-input" placeholder="Add a tag, then Enter" spellcheck="false">
      ${dropped.length ? `<div class="cp-tags-sub">Not in this panel <span class="cp-tags-count">${dropped.length}</span></div>
      <div class="cp-tags-list">${dropped.map(tag => tagButton(tag, 'restore')).join('')}</div>` : ''}
      <p class="cp-tags-note">
        <span class="cp-tag-added">Blue</span>: added by the tagger.
        <span class="cp-tag-unchecked">Amber</span>: the tagger can't check it (usually a character).
        <span class="cp-tag-learned">Underlined</span>: decided by what it learned from your corrections or a character's usual species.
        Percent on a species: how often a character in this panel is tagged with it. <span class="cp-tag-clash">Red</span>: a species none of them usually are.
        Struck out: page tags the tagger doesn't see here. Click any tag to remove or restore it; other panels that look alike follow.
      </p>
      <p class="cp-tags-note">
        Keys: <kbd>\u2190</kbd> <kbd>\u2192</kbd> panel, <kbd>\u2191</kbd> <kbd>\u2193</kbd> page, <kbd>Enter</kbd> panel done, <kbd>R</kbd> review unsure tags,
        <kbd>G</kbd> check one tag, <kbd>Y</kbd> <kbd>N</kbd> <kbd>S</kbd> answer, <kbd>1</kbd>\u2013<kbd>9</kbd> add a numbered tag, <kbd>T</kbd> type a tag.
      </p>
      <div class="cp-tags-learning">
        <span>${lessons ? `Learned ${lessons} tag${lessons === 1 ? '' : 's'} in this folder` : 'Nothing learned in this folder yet'}</span>
        ${lessons ? '<button class="btn btn-sm btn-ghost" id="cp-reset-learning">Reset learning</button>' : ''}
      </div>
    `;
    pane.querySelector('#cp-reset-learning')?.addEventListener('click', () => this._resetLearning());
  }

  /** The current review question, or a button to start reviewing. */
  _reviewHtml(page) {
    if (!this.reviewing) {
      if (page.tagState !== 'ready') return '';
      return '<button class="btn btn-sm cp-review-start" data-review="start" title="Answer the tags the tagger is least sure of, one at a time (R)">Review unsure tags</button>';
    }

    const queue = this._reviewQueue();
    const question = this._currentQuestion();
    const stop = '<button class="btn btn-sm btn-ghost" data-review="stop" title="Stop reviewing (Esc)">Stop</button>';
    if (!question) {
      return `<div class="cp-review">
        <div class="cp-tags-head">Review</div>
        <p class="cp-review-question">Nothing unsure left in this folder.</p>
        <div class="cp-review-actions">${stop}</div>
      </div>`;
    }

    page = question.page;
    const box = page.panels[question.boxIndex];
    const { width, height } = this._pageSize(page);
    // Fits the pane's width (260px less padding) and at most 180px high.
    const scale = Math.min(236 / box.w, 180 / box.h);
    const crop = page.previewUrl && box.w && box.h
      ? `<div class="cp-review-crop" style="width:${Math.round(box.w * scale)}px;height:${Math.round(box.h * scale)}px;background-image:url('${page.previewUrl}');background-size:${(width / box.w) * 100}% ${(height / box.h) * 100}%;background-position:${width > box.w ? (box.x / (width - box.w)) * 100 : 0}% ${height > box.h ? (box.y / (height - box.h)) * 100 : 0}%"></div>`
      : '';
    const tag = `<strong>${escapeHtml(question.tag)}</strong>`;
    const text = {
      unverified: `Is ${tag} in this panel?`,
      close: `Is ${tag} in this panel?`,
      clash: `Is this panel really ${tag}?`,
      unsure: `Does ${tag} belong on this panel?`
    }[question.reason];
    const why = {
      unverified: 'The tagger can\'t see characters, so this comes from the page\'s tags.',
      close: 'This panel looks about as much like one you said has them as one you said doesn\'t.',
      clash: `Not a usual species for ${escapeHtml(this._panelCharacters(box, page).inPanel.join(', '))}.`,
      unsure: `The tagger scored it ${Math.round((question.score || 0) * 100)}%, close to where it decides.`
    }[question.reason];
    const main = queue.filter(item => item.kind !== 'general').length;
    const reach = question.reach ? ` Your answer also settles ${question.reach} other panel${question.reach === 1 ? '' : 's'}.` : '';

    return `<div class="cp-review">
      <div class="cp-tags-head">Review <span class="cp-tags-count" title="Questions about who is in each panel and their species come first">${main ? `${main} on characters and species, ` : ''}${queue.length - main} other</span></div>
      ${crop}
      <p class="cp-review-question">${text}</p>
      <p class="cp-tags-note">Panel ${question.boxIndex + 1}, currently ${question.present ? 'on' : 'off'}. ${why}${reach}</p>
      <div class="cp-review-actions">
        <button class="btn btn-sm btn-primary" data-review="yes">Yes <kbd>Y</kbd></button>
        <button class="btn btn-sm" data-review="no">No <kbd>N</kbd></button>
        <button class="btn btn-sm" data-review="skip">Skip <kbd>S</kbd></button>
        ${stop}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- export

  _openExport() {
    const ready = this.pages.filter(page => page.panels.length > 0);
    if (ready.length === 0) {
      this.showToast('No panels to export yet', 'warning');
      return;
    }
    const busy = this.pages.filter(page => page.status === 'pending' || page.status === 'detecting').length;
    const total = ready.reduce((sum, page) => sum + page.panels.length, 0);
    const done = ready.reduce((sum, page) => sum + page.panels.filter(box => box.tagEdits?.final).length, 0);
    this.$('#cp-export-summary').textContent = `${total} panel${total === 1 ? '' : 's'} from ${ready.length} page${ready.length === 1 ? '' : 's'}, ${done} marked done.`
      + (busy ? ` ${busy} page${busy === 1 ? ' is' : 's are'} still being detected and will be skipped.` : '');
    this.$('#cp-export-modal').style.display = 'flex';
  }

  _closeExport() {
    if (this.isExporting) return;
    this.$('#cp-export-modal').style.display = 'none';
  }

  _exportSettings() {
    return {
      format: this.$('#cp-format').value,
      padding: Number(this.$('#cp-padding').value) || 0,
      outside: this.$('#cp-outside').value,
      tolerance: Number(this.$('#cp-tolerance').value) || 40
    };
  }

  async _runExport() {
    if (this.isExporting) return;
    const dest = this.$('input[name="cp-dest"]:checked').value;
    if (dest === 'folder' && !this.exportDir) {
      this.showToast('Choose a folder first', 'warning');
      return;
    }

    this._flushSaves();
    const options = {
      ...this._exportSettings(),
      outputDir: dest === 'folder' ? this.exportDir : null,
      writeTags: this.$('#cp-write-tags').checked && !this.$('#cp-write-tags').disabled
    };

    const pages = this.pages.filter(page => page.panels.length > 0 && page.status !== 'pending' && page.status !== 'detecting');
    const runBtn = this.$('#cp-export-run');
    this.isExporting = true;
    runBtn.disabled = true;
    if (options.writeTags) {
      runBtn.textContent = 'Tagging panels\u2026';
      for (const page of pages) await this._ensurePanelTags(page);
    }

    let files = 0;
    let kept = 0;
    let failed = 0;
    let firstFile = null;
    let tagFiles = 0;
    let untaggedPages = 0;
    const unverified = new Set();
    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Exporting panels', total: pages.length });
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      runBtn.textContent = `Exporting ${i + 1} of ${pages.length}…`;
      process?.update({ done: i, detail: page.name });
      try {
        if (options.outputDir) await this._matchExported(page, options.outputDir);
        const result = await window.electronAPI.comicPanels.exportPanels(page.filePath, page.panels, {
          ...options,
          outputDir: options.outputDir || page.exportDir || null,
          gutterColor: page.gutterColor || [255, 255, 255],
          panelTags: options.writeTags ? page.panels.map(box => (box.tagFacts ? this._finalTags(box, page) : null)) : null
        });
        if (!result.success) throw new Error(result.message);
        files += result.files.length;
        kept += result.kept.length;
        firstFile = firstFile || result.files[0] || result.kept[0];
        page.exportDir = result.outputDir;
        this._keepNames(page.panels, result.names);
        this._scheduleSave(page);
        if (options.writeTags) {
          tagFiles += result.tags?.written || 0;
          if (!result.tags?.pageTagFile) untaggedPages++;
          (result.tags?.unverified || []).forEach(tag => unverified.add(tag));
        }
        page.status = 'exported';
        page.message = '';
      } catch (error) {
        console.error(`Export failed for ${page.name}:`, error);
        page.status = 'error';
        page.message = error.message;
        failed++;
      }
      this._renderPages();
    }

    this.isExporting = false;
    process?.finish({ message: failed ? `${files} panels, ${failed} failed` : `${files} panels`, failed: failed === pages.length, warning: failed > 0 });
    runBtn.disabled = false;
    runBtn.textContent = 'Export';
    this._closeExport();

    const notes = [];
    if (options.writeTags) {
      notes.push(`${tagFiles} tag file${tagFiles === 1 ? '' : 's'} written`);
      if (untaggedPages) notes.push(`${untaggedPages} page${untaggedPages === 1 ? ' has' : 's have'} no tag file`);
      // Tags the tagger doesn't know (mostly artist-original characters) are
      // kept as they were; worth a look in the Tag Editor.
      if (unverified.size) notes.push(`kept unchecked: ${[...unverified].slice(0, 5).join(', ')}${unverified.size > 5 ? ` and ${unverified.size - 5} more` : ''}`);
    }
    if (kept) notes.unshift(`${kept} existing image${kept === 1 ? '' : 's'} kept`);
    const summary = `Exported ${files} panel(s)${failed ? `; ${failed} page(s) failed` : ''}${notes.length ? `; ${notes.join('; ')}` : ''}`;
    this.showToast(summary, failed || untaggedPages ? 'warning' : 'success');
    if (firstFile) window.electronAPI.utils.showInFolder(firstFile);
  }

  // ------------------------------------------------ panel images to pages

  async _applyCleaned() {
    if (this.isExporting || this.isApplying) return;
    const pages = this.pages.filter(page => page.panels.some(box => box.exportName));
    if (pages.length === 0) {
      this.showToast('No exported panels yet', 'warning');
      return;
    }

    this._flushSaves();
    const button = this.$('#cp-apply-cleaned-btn');
    this.isApplying = true;
    button.disabled = true;
    const totals = { applied: 0, already: 0, unplaced: 0, pages: 0, failed: 0 };
    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Updating pages', total: pages.length });
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      process?.update({ done: i, detail: page.name });
      try {
        const result = await window.electronAPI.comicPanels.applyCleaned(page.filePath, page.panels, page.exportDir || null);
        if (!result.success) throw new Error(result.message);
        totals.applied += result.applied;
        totals.already += result.already;
        totals.unplaced += result.unplaced;
        if (result.applied) {
          totals.pages++;
          // Show the updated page from disk.
          if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
          page.previewUrl = null;
          page.file = null;
        }
      } catch (error) {
        console.error(`Updating ${page.name} failed:`, error);
        totals.failed++;
      }
    }

    this.isApplying = false;
    button.disabled = false;
    process?.finish({ message: `${totals.applied} panels into ${totals.pages} pages`, failed: totals.failed === pages.length, warning: totals.failed > 0 || totals.unplaced > 0 });
    if (totals.pages) {
      this._clearThumbs();
      if (this.current >= 0) this._showPage(this.current);
    }

    const notes = [];
    if (totals.already) notes.push(`${totals.already} already the same`);
    if (totals.unplaced) notes.push(`${totals.unplaced} couldn't be matched to the page`);
    if (totals.failed) notes.push(`${totals.failed} page(s) failed`);
    const summary = `Put ${totals.applied} panel(s) into ${totals.pages} page(s)${notes.length ? `; ${notes.join('; ')}` : ''}`;
    this.showToast(summary, totals.failed || totals.unplaced ? 'warning' : 'success');
  }

  _clearThumbs() {
    for (const url of this.thumbs.values()) if (url) URL.revokeObjectURL(url);
    this.thumbs.clear();
  }

  _clear() {
    this.detectRun++;
    this.tagRun++;
    if (this.gridOpen) this._closeGrid();
    this._flushSaves();
    this.pages.forEach(page => {
      if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
    });
    this.pages = [];
    this._clearThumbs();
    this.reviewMemo.clear();
    this.reviewing = false;
    this.current = -1;
    this.selectedBox = -1;
    this.orderQueue = null;
    this.$('#cp-page-img').removeAttribute('src');
    this.$('#cp-boxes').innerHTML = '';
    this.$('#cp-pages').innerHTML = '';
    this.$('#cp-workspace').style.display = 'none';
    this.$('#cp-dropzone').style.display = '';
  }

  showToast(message, type = 'info') {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }
}

window.mixMethods(ComicPanelTool, ComicPanelTagGrid);

console.log('✅ ComicPanelTool module loaded');

export default ComicPanelTool;
window.ComicPanelTool = ComicPanelTool;
