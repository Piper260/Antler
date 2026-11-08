console.log('🔧 ImageUpscalerTool module loading...');

// Images whose longest edge is below the target are flagged as candidates for
// upscaling; anything at or above it is treated as already large enough.
const DEFAULT_TARGET_EDGE = 2048;
const MIN_TARGET_EDGE = 64;
const MAX_TARGET_EDGE = 16384;
const TARGET_EDGE_KEY = 'piper-aio:image-upscaler:target-edge';

const ENGINE_LABELS = {
  onnx: 'Transformer models (ONNX, GPU)',
  ncnn: 'Upscayl models (NCNN)'
};

class ImageUpscalerTool {
  constructor() {
    this.name = 'Image Upscaler';
    this.id = 'image-upscaler';
    this.icon = 'fas fa-up-right-and-down-left-from-center';
    this.description = 'Batch upscale images with local AI models';
    this.version = '1.0.0';
    // Upscaling carries on while other tools are open; see App.loadToolContent.
    this.keepAlive = true;

    this.images = [];
    this.backend = null;
    this.isProcessing = false;
    this.progressUnsub = null;
    this.sizeFilter = 'all'; // 'all' | 'needs' | 'ok'
    this.targetEdge = this._getSavedTargetEdge();

    // Dataset dropdown state (mirrors Tag Editor's artist/character picker)
    this.datasetMode = 'artist'; // 'artist' or 'character'
    this.datasetEntries = [];

    console.log('🖼️ Image Upscaler Tool initialized');
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
    this.images.forEach(img => {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    });
    this.images = [];
    if (this.progressUnsub) {
      this.progressUnsub();
      this.progressUnsub = null;
    }
    if (this.modelProgressUnsub) {
      this.modelProgressUnsub();
      this.modelProgressUnsub = null;
    }
    this._revokeCompareUrls();
    this._revokeGridUrls();
    if (this._compareEscHandler) {
      document.removeEventListener('keydown', this._compareEscHandler);
      this._compareEscHandler = null;
    }
    if (this._gridEscHandler) {
      document.removeEventListener('keydown', this._gridEscHandler);
      this._gridEscHandler = null;
    }
    console.log('🧹 Image Upscaler Tool cleaned up');
  }

  getTemplate() {
    return `
      <div class="iu-tool">
        <input type="file" id="iu-file-input" accept="image/*" multiple style="display:none">

        <div class="iu-dropzone" id="iu-dropzone">
          <div class="iu-dropzone-inner">
            <i class="fas fa-up-right-and-down-left-from-center iu-drop-icon"></i>
            <h2 class="iu-drop-title">Drop Images to Upscale</h2>
            <p class="iu-drop-sub" id="iu-drop-sub"></p>
            <div class="iu-drop-actions">
              <button class="btn btn-primary iu-browse-btn" id="iu-browse-btn">
                <i class="fas fa-folder-open"></i> Browse Files
              </button>
            </div>

            <div class="iu-dataset-picker">
              <div class="iu-dataset-divider"><span>or load a dataset</span></div>
              <div class="search-mode-container">
                <span class="mode-label active" id="iu-label-artist">Artist</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="iu-dataset-mode-toggle">
                  <span class="slider"></span>
                </label>
                <span class="mode-label" id="iu-label-character">Character</span>
              </div>
              <select class="form-input iu-dataset-select" id="iu-dataset-select">
                <option value="">Select artist...</option>
              </select>
              <button class="btn btn-ghost btn-sm iu-dataset-custom-link" id="iu-dataset-btn">
                <i class="fas fa-folder-open"></i> Or choose a custom folder
              </button>
            </div>
          </div>
        </div>

        <div class="iu-workspace" id="iu-workspace" style="display:none">
          <div class="iu-toolbar">
            <div class="iu-toolbar-info">
              <label class="iu-select-all-wrap" title="Select / deselect all">
                <input type="checkbox" id="iu-select-all" checked>
                <span>Select All</span>
              </label>
              <span id="iu-count-label">0 images</span>
              <span id="iu-backend-label" class="iu-backend-label">Checking backend...</span>
            </div>
            <div class="iu-toolbar-actions">
              <label class="iu-filter" title="Filter the list by image size">
                <span>Show</span>
                <select class="form-select" id="iu-size-filter">
                  <option value="all">All images</option>
                  <option value="needs" id="iu-filter-needs"></option>
                  <option value="ok" id="iu-filter-ok"></option>
                </select>
              </label>
              <button class="btn iu-btn iu-btn-add" id="iu-select-needs-btn">
                <i class="fas fa-check-double"></i> <span id="iu-select-needs-label"></span>
              </button>
              <button class="btn iu-btn iu-btn-add" id="iu-add-dataset-btn" title="Add another dataset folder">
                <i class="fas fa-database"></i> Add Folder
              </button>
              <button class="btn iu-btn iu-btn-add" id="iu-add-btn" title="Add more images">
                <i class="fas fa-plus"></i> Add More
              </button>
              <button class="btn btn-primary iu-btn iu-btn-upscale" id="iu-upscale-btn">
                <span id="iu-upscale-label">Upscale</span>
              </button>
              <button class="btn iu-btn iu-btn-clear" id="iu-clear-btn">
                <i class="fas fa-trash-alt"></i> Clear
              </button>
            </div>
          </div>

          <div class="iu-options">
            <label class="iu-option">
              <span>Model</span>
              <div class="iu-model-row">
                <select class="form-select" id="iu-model-select">
                  <option value="">Loading models...</option>
                </select>
                <button type="button" class="btn-icon iu-fav-btn" id="iu-model-fav-btn" title="Mark as favorite model">
                  <i class="fas fa-star"></i>
                </button>
              </div>
            </label>
            <label class="iu-option iu-option-small">
              <span>Scale</span>
              <select class="form-select" id="iu-scale-select">
                <option value="2">2x</option>
                <option value="3">3x</option>
                <option value="4" selected>4x</option>
              </select>
            </label>
            <label class="iu-option iu-option-small">
              <span>Longest side</span>
              <input class="form-input" id="iu-target-input" type="number" min="${MIN_TARGET_EDGE}" max="${MAX_TARGET_EDGE}" step="1" value="${this.targetEdge}" title="Images below this many pixels on their longest side are flagged for upscaling">
            </label>
            <label class="iu-option iu-option-small">
              <span>Format</span>
              <select class="form-select" id="iu-format-select">
                <option value="png" selected>PNG</option>
                <option value="jpg">JPG</option>
                <option value="webp">WEBP</option>
              </select>
            </label>
            <label class="iu-option iu-option-small">
              <span>Tile</span>
              <input class="form-input" id="iu-tile-input" type="number" min="0" max="1024" step="16" value="0" title="0 = auto">
            </label>
            <label class="iu-option iu-option-small">
              <span>GPU</span>
              <input class="form-input" id="iu-gpu-input" type="text" placeholder="auto" title="Optional GPU index (0 = primary)">
            </label>
          </div>

          <div class="iu-list" id="iu-list"></div>
        </div>

        <div class="modal-overlay iu-compare-modal" id="iu-compare-modal" style="display:none">
          <div class="iu-compare-backdrop" id="iu-compare-backdrop"></div>
          <div class="modal-content iu-compare-content">
            <div class="modal-header iu-compare-header">
              <h3 id="iu-compare-title" title="">Compare</h3>
              <button class="modal-close iu-compare-close" id="iu-compare-close" title="Close">&times;</button>
            </div>
            <div class="iu-compare-body">
              <div class="iu-compare-slider" id="iu-compare-slider">
                <div class="iu-compare-scroll" id="iu-compare-scroll">
                  <div class="iu-compare-stage" id="iu-compare-stage">
                    <img class="iu-compare-img iu-compare-after" id="iu-compare-after" alt="Upscaled">
                    <div class="iu-compare-before-wrap" id="iu-compare-before-wrap">
                      <img class="iu-compare-img iu-compare-before" id="iu-compare-before" alt="Original">
                    </div>
                    <div class="iu-compare-handle" id="iu-compare-handle">
                      <div class="iu-compare-handle-line"></div>
                      <div class="iu-compare-handle-grip"><i class="fas fa-arrows-alt-h"></i></div>
                    </div>
                  </div>
                </div>
                <span class="iu-compare-label iu-compare-label-before" id="iu-compare-label-before">Original</span>
                <span class="iu-compare-label iu-compare-label-after" id="iu-compare-label-after">Upscaled</span>
              </div>
              <div class="iu-compare-loading" id="iu-compare-loading">
                <div class="loading-spinner"></div>
              </div>
            </div>
            <div class="iu-compare-footer">
              <span id="iu-compare-dims"></span>
              <span id="iu-compare-zoom-label">100%</span>
              <span class="iu-compare-hint">Scroll to zoom, drag to pan, click to move the divider, double-click to reset</span>
            </div>
          </div>
        </div>

        <div class="modal-overlay iu-grid-modal" id="iu-grid-modal" style="display:none">
          <div class="iu-grid-backdrop" id="iu-grid-backdrop"></div>
          <div class="modal-content iu-grid-content">
            <div class="modal-header iu-grid-header">
              <h3 id="iu-grid-title" title="">Compare All Models</h3>
              <button class="modal-close iu-grid-close" id="iu-grid-close" title="Close">&times;</button>
            </div>
            <div class="iu-grid-toolbar" id="iu-grid-toolbar" style="display:none">
              <div class="iu-grid-toolbar-group">
                <label for="iu-grid-reveal-slider">Reveal</label>
                <input type="range" id="iu-grid-reveal-slider" min="0" max="100" value="50">
              </div>
              <div class="iu-grid-toolbar-group">
                <span id="iu-grid-zoom-label">100%</span>
                <button class="btn btn-sm iu-grid-toolbar-btn" id="iu-grid-reset-view" title="Reset zoom &amp; pan">
                  Reset View
                </button>
              </div>
              <span class="iu-grid-toolbar-hint">Drag to pan, scroll to zoom, click to move the divider. All tiles move together.</span>
            </div>
            <div class="iu-grid-body" id="iu-grid-body">
              <div class="iu-grid-loading" id="iu-grid-loading">
                <div class="loading-spinner"></div>
                <p id="iu-grid-loading-label">Running models...</p>
              </div>
              <div class="iu-grid-cards" id="iu-grid-cards"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async initialize(container) {
    console.log('🔧 Initializing Image Upscaler Tool...');
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this._updateTargetLabels();
      this._setupEvents();
      await this._loadBackendStatus();
      await this._loadDatasetDropdown();
      this._updateToolbar();

      if (window.electronAPI?.imageUpscaler?.onProgress && !this.progressUnsub) {
        this.progressUnsub = window.electronAPI.imageUpscaler.onProgress((data) => this._onUpscaleProgress(data));
      }
      if (window.electronAPI?.imageUpscaler?.onModelProgress && !this.modelProgressUnsub) {
        this.modelProgressUnsub = window.electronAPI.imageUpscaler.onModelProgress((data) => this._onModelProgress(data));
      }

      console.log('✅ Image Upscaler Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Image Upscaler Tool:', error);
      this.showToast(error.message || 'Image Upscaler failed to initialize', 'error');
    }
  }

  _setupEvents() {
    const dropzone = this.container.querySelector('#iu-dropzone');
    const fileInput = this.container.querySelector('#iu-file-input');
    const browseBtn = this.container.querySelector('#iu-browse-btn');
    const datasetBtn = this.container.querySelector('#iu-dataset-btn');
    const addDatasetBtn = this.container.querySelector('#iu-add-dataset-btn');
    const addBtn = this.container.querySelector('#iu-add-btn');
    const upscaleBtn = this.container.querySelector('#iu-upscale-btn');
    const clearBtn = this.container.querySelector('#iu-clear-btn');
    const workspace = this.container.querySelector('#iu-workspace');
    const scaleSelect = this.container.querySelector('#iu-scale-select');
    const selectAllCb = this.container.querySelector('#iu-select-all');
    const datasetSelect = this.container.querySelector('#iu-dataset-select');
    const datasetModeToggle = this.container.querySelector('#iu-dataset-mode-toggle');

    browseBtn.addEventListener('click', () => fileInput.click());
    addBtn.addEventListener('click', () => fileInput.click());
    datasetBtn.addEventListener('click', () => this._pickDatasetFolder());
    addDatasetBtn.addEventListener('click', () => this._pickDatasetFolder());
    datasetSelect.addEventListener('change', (event) => this._onDatasetSelect(event.target.value));
    datasetModeToggle.addEventListener('change', () => this._onDatasetModeToggle());
    fileInput.addEventListener('change', (event) => {
      if (event.target.files.length) this._handleFiles(event.target.files);
      fileInput.value = '';
    });

    dropzone.addEventListener('click', (event) => {
      if (!event.target.closest('#iu-browse-btn') && !event.target.closest('.iu-dataset-picker')) fileInput.click();
    });
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', (event) => {
      if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-over');
      this._handleFiles(event.dataTransfer.files);
    });

    workspace.addEventListener('dragover', (event) => event.preventDefault());
    workspace.addEventListener('drop', (event) => {
      event.preventDefault();
      this._handleFiles(event.dataTransfer.files);
    });

    upscaleBtn.addEventListener('click', () => this._upscaleAll());
    clearBtn.addEventListener('click', () => this._clear());
    scaleSelect.addEventListener('change', () => {
      if (this.images.length > 0) this._renderList();
    });
    this.container.querySelector('#iu-target-input').addEventListener('change', (event) => {
      this._setTargetEdge(event.target.value);
    });

    const modelSelect = this.container.querySelector('#iu-model-select');
    const modelFavBtn = this.container.querySelector('#iu-model-fav-btn');
    modelSelect.addEventListener('change', () => {
      this._modelManuallyChanged = true;
      this._updateFavButtonState();
    });
    modelFavBtn.addEventListener('click', () => this._toggleFavoriteModel());
    selectAllCb.addEventListener('change', (event) => {
      // Only rows the current filter shows are affected, so "select all"
      // while viewing "Below 2048px" (or whatever the target is) does what it
      // looks like it does.
      this.images.forEach(img => {
        if (this._matchesFilter(img)) img.selected = event.target.checked;
      });
      this._renderList();
      this._updateToolbar();
    });

    this.container.querySelector('#iu-size-filter').addEventListener('change', (event) => {
      this.sizeFilter = event.target.value;
      this._renderList();
      this._updateToolbar();
    });
    this.container.querySelector('#iu-select-needs-btn').addEventListener('click', () => {
      this.images.forEach(img => { img.selected = this._needsUpscale(img); });
      this._renderList();
      this._updateToolbar();
    });

    const list = this.container.querySelector('#iu-list');
    list.addEventListener('click', (event) => {
      const compareBtn = event.target.closest('.iu-compare-btn');
      if (compareBtn) this._openCompareModal(parseInt(compareBtn.dataset.index, 10));

      const allModelsBtn = event.target.closest('.iu-row-allmodels');
      if (allModelsBtn) this._runAllModelsCompare(parseInt(allModelsBtn.dataset.index, 10));
    });

    this._setupCompareModal();
    this._setupGridModal();
  }

  /**
   * Wires up the before/after comparison modal: open/close handlers and the
   * draggable divider that reveals more of the original vs. upscaled image.
   */
  _setupCompareModal() {
    const modal = this.container.querySelector('#iu-compare-modal');
    const backdrop = this.container.querySelector('#iu-compare-backdrop');
    const closeBtn = this.container.querySelector('#iu-compare-close');
    const scroll = this.container.querySelector('#iu-compare-scroll');
    const stage = this.container.querySelector('#iu-compare-stage');
    const handle = this.container.querySelector('#iu-compare-handle');
    const beforeWrap = this.container.querySelector('#iu-compare-before-wrap');
    const beforeImg = this.container.querySelector('#iu-compare-before');
    const afterImg = this.container.querySelector('#iu-compare-after');
    const zoomLabel = this.container.querySelector('#iu-compare-zoom-label');

    closeBtn.addEventListener('click', () => this._closeCompareModal());
    backdrop.addEventListener('click', () => this._closeCompareModal());

    // The divider is measured against the stage (not the viewport) so it
    // tracks a fixed point in the *image* while zoomed and panned.
    const setDivider = (clientX) => {
      const rect = stage.getBoundingClientRect();
      if (rect.width === 0) return;
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      this._comparePct = pct;
      beforeWrap.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      handle.style.left = `${pct}%`;
    };

    // Zoom works by resizing the stage in real CSS pixels rather than by
    // applying a `transform: scale()`. A composited transform stretches the
    // bitmap the browser already rasterized at fit-size, which threw away the
    // upscaled detail and made model output look like a bilinear resize.
    // Laying the images out at their true size forces a fresh raster from the
    // full-resolution source at every zoom level.
    const MAX_SCALE = 8;
    this._compareScale = 1;
    this._compareNatural = { width: 0, height: 0 };
    this._comparePct = 50;

    const fitScale = () => {
      const { width, height } = this._compareNatural;
      if (!width || !height) return 1;
      const box = scroll.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return 1;
      return Math.min(box.width / width, box.height / height, 1);
    };

    // `pivot` keeps the point under the cursor stationary across a zoom step by
    // converting it to image space, resizing, then scrolling it back under the
    // cursor. Omitted (double-click / initial fit), it pivots on the centre.
    const applyScale = (nextScale, pivotClientX, pivotClientY) => {
      const { width, height } = this._compareNatural;
      if (!width || !height) return;

      const box = scroll.getBoundingClientRect();
      const px = Number.isFinite(pivotClientX) ? pivotClientX - box.left : box.width / 2;
      const py = Number.isFinite(pivotClientY) ? pivotClientY - box.top : box.height / 2;
      const imageX = (scroll.scrollLeft + px) / this._compareScale;
      const imageY = (scroll.scrollTop + py) / this._compareScale;

      this._compareScale = nextScale;
      stage.style.width = `${Math.round(width * nextScale)}px`;
      stage.style.height = `${Math.round(height * nextScale)}px`;
      scroll.scrollLeft = imageX * nextScale - px;
      scroll.scrollTop = imageY * nextScale - py;

      // Past 2x there is no more source detail to resolve, so show true pixels
      // instead of the browser's smoothing - that's the point of zooming in.
      const rendering = nextScale > 2 ? 'pixelated' : 'auto';
      afterImg.style.imageRendering = rendering;
      beforeImg.style.imageRendering = rendering;

      if (zoomLabel) zoomLabel.textContent = `${Math.round(nextScale * 100)}%`;
    };

    this._fitCompareView = () => {
      applyScale(fitScale());
      setDivider(stage.getBoundingClientRect().left + stage.getBoundingClientRect().width * (this._comparePct / 100));
    };

    this._resetCompareZoom = () => {
      this._comparePct = 50;
      beforeWrap.style.clipPath = 'inset(0 50% 0 0)';
      handle.style.left = '50%';
      this._fitCompareView();
    };

    let draggingHandle = false;
    handle.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      draggingHandle = true;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (draggingHandle) setDivider(event.clientX);
    });
    handle.addEventListener('pointerup', (event) => {
      draggingHandle = false;
      handle.releasePointerCapture(event.pointerId);
    });

    // Dragging anywhere else pans the zoomed image; a click without meaningful
    // movement falls through to repositioning the divider.
    let pan = null;
    scroll.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.iu-compare-handle')) return;
      pan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop,
        moved: false
      };
      scroll.setPointerCapture(event.pointerId);
    });
    scroll.addEventListener('pointermove', (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      pan.moved = true;
      scroll.classList.add('is-panning');
      scroll.scrollLeft = pan.scrollLeft - dx;
      scroll.scrollTop = pan.scrollTop - dy;
    });
    const endPan = (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      if (!pan.moved) setDivider(event.clientX);
      scroll.releasePointerCapture(event.pointerId);
      scroll.classList.remove('is-panning');
      pan = null;
    };
    scroll.addEventListener('pointerup', endPan);
    scroll.addEventListener('pointercancel', endPan);

    scroll.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const min = Math.min(fitScale(), 1);
      applyScale(
        Math.max(min, Math.min(MAX_SCALE, this._compareScale * factor)),
        event.clientX,
        event.clientY
      );
    }, { passive: false });

    scroll.addEventListener('dblclick', () => this._resetCompareZoom());

    this._compareEscHandler = (event) => {
      if (event.key === 'Escape' && modal.style.display !== 'none') this._closeCompareModal();
    };
    document.addEventListener('keydown', this._compareEscHandler);
  }

  /**
   * Wires up the "Compare All Models" grid modal: open/close handlers only -
   * the cards themselves are built dynamically in `_renderModelGrid()`.
   */
  _setupGridModal() {
    const modal = this.container.querySelector('#iu-grid-modal');
    const backdrop = this.container.querySelector('#iu-grid-backdrop');
    const closeBtn = this.container.querySelector('#iu-grid-close');
    const revealSlider = this.container.querySelector('#iu-grid-reveal-slider');
    const resetBtn = this.container.querySelector('#iu-grid-reset-view');

    closeBtn.addEventListener('click', () => this._closeGridModal());
    backdrop.addEventListener('click', () => this._closeGridModal());

    revealSlider.addEventListener('input', () => {
      if (!this._gridSync) return;
      this._gridSync.pct = Number(revealSlider.value);
      this._applyGridSync();
    });

    resetBtn.addEventListener('click', () => this._resetGridSync());

    this._gridEscHandler = (event) => {
      if (event.key === 'Escape' && modal.style.display !== 'none') this._closeGridModal();
    };
    document.addEventListener('keydown', this._gridEscHandler);
  }

  async _loadBackendStatus() {
    const label = this.container.querySelector('#iu-backend-label');
    try {
      this.backend = await window.electronAPI.imageUpscaler.getStatus();
    } catch (error) {
      this.backend = { success: false, engine: 'sharp', message: error.message };
    }

    if (!label) return;

    if (this.backend && this.backend.aiAvailable) {
      label.textContent = this.backend.message || 'Models ready';
      label.classList.add('iu-backend-ready');
      label.classList.remove('iu-backend-fallback');
      label.title = this.backend.modelsPath || '';
    } else {
      const missing = this.backend?.missing?.length ? this.backend.missing.join(', ') : 'model files';
      label.textContent = `No AI models available (missing ${missing}) - plain resize only`;
      label.classList.add('iu-backend-fallback');
      label.classList.remove('iu-backend-ready');
      label.title = 'Models are loaded from resources/models (*.onnx, or *.param + *.bin)';
    }

    this._populateModelSelect(this.backend?.models || []);
  }

  _populateModelSelect(localModels) {
    const select = this.container.querySelector('#iu-model-select');
    if (!select) return;

    const models = localModels;
    const currentValue = select.value;
    const favoriteId = this._getFavoriteModel();
    const defaultId = this.backend?.defaultModel || models[0]?.id || '';

    if (models.length === 0) {
      select.innerHTML = '<option value="">No models found - plain resize</option>';
      this._updateFavButtonState();
      return;
    }

    const optionHtml = (model) => {
      const star = model.id === favoriteId ? '\u2605 ' : '';
      const note = model.note ? ` - ${model.note}` : '';
      return `<option value="${model.id}">${star}${model.name}${note}</option>`;
    };

    // Grouped by engine so it is clear which models are the slower
    // transformer ones and which run through the Upscayl binary.
    select.innerHTML = Object.keys(ENGINE_LABELS)
      .map(engine => {
        const group = models.filter(model => model.engine === engine);
        if (group.length === 0) return '';
        return `<optgroup label="${ENGINE_LABELS[engine]}">${group.map(optionHtml).join('')}</optgroup>`;
      })
      .join('');

    const has = (id) => Boolean(id) && models.some(model => model.id === id);
    if (this._modelManuallyChanged && has(currentValue)) {
      select.value = currentValue;
    } else {
      // Untouched this session: the saved favorite wins, then the backend's
      // recommended default.
      select.value = has(favoriteId) ? favoriteId : defaultId;
    }

    this._updateFavButtonState();
  }

  /**
   * Favorite upscale model, persisted across sessions via localStorage so
   * the preferred model is preselected and pinned to the top of the
   * dropdown next time the tool opens.
   */
  _getFavoriteModel() {
    try {
      return localStorage.getItem('piper-aio:image-upscaler:favorite-model') || null;
    } catch {
      return null;
    }
  }

  _setFavoriteModel(modelId) {
    try {
      if (modelId) localStorage.setItem('piper-aio:image-upscaler:favorite-model', modelId);
      else localStorage.removeItem('piper-aio:image-upscaler:favorite-model');
    } catch {
      // localStorage unavailable (e.g. private mode) - favorite just won't persist.
    }
  }

  /**
   * The longest-side target, persisted the same way as the favorite model.
   */
  _getSavedTargetEdge() {
    try {
      const saved = parseInt(localStorage.getItem(TARGET_EDGE_KEY), 10);
      if (saved >= MIN_TARGET_EDGE && saved <= MAX_TARGET_EDGE) return saved;
    } catch {
      // localStorage unavailable - fall through to the default.
    }
    return DEFAULT_TARGET_EDGE;
  }

  _setTargetEdge(value) {
    const input = this.container.querySelector('#iu-target-input');
    const typed = parseInt(value, 10);
    const edge = Number.isNaN(typed)
      ? this.targetEdge
      : Math.min(MAX_TARGET_EDGE, Math.max(MIN_TARGET_EDGE, typed));
    input.value = edge;
    if (edge === this.targetEdge) return;

    this.targetEdge = edge;
    try {
      localStorage.setItem(TARGET_EDGE_KEY, String(edge));
    } catch {
      // localStorage unavailable - the target just won't persist.
    }
    // Same selection a fresh load would make. Finished images stay out, so a
    // higher target never queues a second pass without being asked.
    this.images.forEach(img => {
      if (img.status !== 'done') img.selected = this._needsUpscale(img);
    });
    this._updateTargetLabels();
    this._renderList();
    this._updateToolbar();
  }

  _updateTargetLabels() {
    const edge = this.targetEdge;
    const text = (selector, value) => {
      this.container.querySelector(selector).textContent = value;
    };
    text('#iu-drop-sub', `Images under ${edge}px on their longest edge are flagged for upscaling. Upscaled files replace the originals, which are moved to bak/.`);
    text('#iu-filter-needs', `Below ${edge}px`);
    text('#iu-filter-ok', `${edge}px and above`);
    text('#iu-select-needs-label', `Select Below ${edge}`);
    this.container.querySelector('#iu-select-needs-btn').title = `Select only the images below ${edge}px on their longest edge`;
  }

  _toggleFavoriteModel() {
    const select = this.container.querySelector('#iu-model-select');
    if (!select || !select.value) return;

    const current = this._getFavoriteModel();
    const next = current === select.value ? null : select.value;
    this._setFavoriteModel(next);

    const label = select.options[select.selectedIndex]?.textContent?.replace(/^★\s*/, '') || select.value;
    this.showToast(next ? `${label} set as favorite model` : `${label} removed as favorite`, 'success');

    this._populateModelSelect(this.backend?.models || []);
  }

  _updateFavButtonState() {
    const select = this.container.querySelector('#iu-model-select');
    const favBtn = this.container.querySelector('#iu-model-fav-btn');
    if (!select || !favBtn) return;

    const isFavorite = this._getFavoriteModel() === select.value;
    favBtn.classList.toggle('is-favorite', isFavorite);
    favBtn.title = isFavorite ? 'Remove as favorite model' : 'Mark as favorite model';
  }

  async _handleFiles(fileList) {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'];
    const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'];
    const files = Array.from(fileList).filter(file =>
      validMimes.includes(file.type) || validExts.some(ext => file.name.toLowerCase().endsWith(ext))
    );

    if (files.length === 0) {
      this.showToast('No valid image files in selection', 'warning');
      return;
    }

    const loaded = (await Promise.all(files.map(file => this._loadFileMeta(file)))).filter(Boolean);
    loaded.forEach(img => this.images.push(img));

    this._switchToWorkspace();
    this._renderList();
    this._updateToolbar();
    this.showToast(`Loaded ${loaded.length} image(s)`, 'success');
  }

  /**
   * Let the user pick an arbitrary folder ("dataset") and recursively load
   * every image found inside it. Upscaling only needs the on-disk file path,
   * so this is even simpler than the resizer's version - it's just used for
   * the thumbnail/dimension preview in the list.
   */
  async _pickDatasetFolder() {
    const dirResult = await window.electronAPI.dialog.openDirectory();
    if (!dirResult?.success || !dirResult.path) return;

    await this._loadDatasetFromPath(dirResult.path);
  }

  /**
   * Populate the Artist/Character dropdown using the same downloaded-dataset
   * listing the Tag Editor tool uses (window.electronAPI.tagEditor).
   */
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
    const select = this.container.querySelector('#iu-dataset-select');
    if (!select) return;

    const filtered = this.datasetEntries
      .filter(a => a.type === this.datasetMode)
      .sort((a, b) => (a.displayName || a.name || '').toLowerCase().localeCompare((b.displayName || b.name || '').toLowerCase()));

    const options = filtered.map(entry => {
      const name = entry.displayName || entry.name;
      const fileCount = entry.fileCount || 0;
      return `<option value="${entry.id}">${name} (${fileCount} files)</option>`;
    }).join('');

    select.innerHTML = `<option value="">Select ${this.datasetMode}...</option>${options}`;
  }

  _onDatasetModeToggle() {
    const toggle = this.container.querySelector('#iu-dataset-mode-toggle');
    const isCharacterMode = toggle.checked;
    this.datasetMode = isCharacterMode ? 'character' : 'artist';

    this.container.querySelector('#iu-label-artist').classList.toggle('active', !isCharacterMode);
    this.container.querySelector('#iu-label-character').classList.toggle('active', isCharacterMode);
    this._populateDatasetSelect();
  }

  async _onDatasetSelect(entryId) {
    if (!entryId) return;
    const entry = this.datasetEntries.find(a => a.id === entryId);
    if (!entry || !entry.path) return;

    await this._loadDatasetFromPath(entry.path);

    // Reset the dropdown so it can be re-used to add another dataset later
    const select = this.container.querySelector('#iu-dataset-select');
    if (select) select.value = '';
  }

  /**
   * Recursively load every image found under an absolute folder path,
   * shared by both the native folder-picker and the dataset dropdown.
   */
  async _loadDatasetFromPath(folderPath) {
    const scanResult = await window.electronAPI.utils.scanImageFolder(folderPath);
    if (!scanResult.success) {
      this.showToast(scanResult.message || 'Failed to scan folder', 'error');
      return;
    }

    if (!scanResult.images || scanResult.images.length === 0) {
      this.showToast('No images found in that folder', 'warning');
      return;
    }

    this.showToast(`Loading ${scanResult.images.length} image(s) from dataset\u2026`, 'info');

    const loaded = [];
    for (const entry of scanResult.images) {
      const meta = await this._loadPathMeta(entry.filePath, entry.name);
      if (meta) loaded.push(meta);
    }

    if (loaded.length === 0) {
      this.showToast('Could not load any images from that folder', 'error');
      return;
    }

    loaded.forEach(img => this.images.push(img));
    this._switchToWorkspace();
    this._renderList();
    this._updateToolbar();
    this.showToast(`Loaded ${loaded.length} image(s) from dataset`, 'success');
  }

  /**
   * Load metadata for a dataset image referenced only by its on-disk path
   * (no File object). Reads the raw bytes via IPC purely to build a preview
   * thumbnail + read dimensions; the actual upscale call only needs filePath.
   */
  async _loadPathMeta(filePath, name) {
    try {
      const readResult = await window.electronAPI.utils.readImageFile(filePath);
      if (!readResult.success) return null;

      const mime = readResult.mime || 'image/png';
      const blob = new Blob([new Uint8Array(readResult.data)], { type: mime });
      const url = URL.createObjectURL(blob);

      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            file: null,
            name,
            filePath,
            width: img.width,
            height: img.height,
            previewUrl: url,
            outputPath: null,
            status: 'queued',
            statusMessage: '',
            selected: Math.max(img.width, img.height) < this.targetEdge
          });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });
    } catch (error) {
      console.error(`Failed to load ${name} from dataset:`, error);
      return null;
    }
  }

  _loadFileMeta(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({
          file,
          name: file.name,
          filePath: window.electronAPI.utils.pathForFile(file) || null,
          width: img.width,
          height: img.height,
          previewUrl: url,
          outputPath: null,
          status: 'queued',
          statusMessage: '',
          selected: Math.max(img.width, img.height) < this.targetEdge
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  _longestEdge(img) {
    return Math.max(img.width || 0, img.height || 0);
  }

  _needsUpscale(img) {
    return this._longestEdge(img) < this.targetEdge;
  }

  _matchesFilter(img) {
    if (this.sizeFilter === 'needs') return this._needsUpscale(img);
    if (this.sizeFilter === 'ok') return !this._needsUpscale(img);
    return true;
  }

  /**
   * Size column for a row: where the image stands against the longest-side
   * target, and whether the chosen scale is enough to reach it.
   */
  _sizeStatusHtml(img, scale) {
    const edge = this._longestEdge(img);
    if (edge >= this.targetEdge) {
      return `<span class="iu-size iu-size-ok" title="Longest edge ${edge}px">${this.targetEdge}px or larger</span>`;
    }
    if (img.status === 'done') {
      return `<span class="iu-size iu-size-needs" title="Longest edge ${edge}px">Still below ${this.targetEdge}px</span>`;
    }

    const after = edge * scale;
    const shortfall = after < this.targetEdge
      ? ` <span class="iu-size-note">still ${after}px at ${scale}x</span>`
      : '';
    return `<span class="iu-size iu-size-needs" title="Longest edge ${edge}px">Below ${this.targetEdge}px</span>${shortfall}`;
  }

  _switchToWorkspace() {
    this.container.querySelector('#iu-dropzone').style.display = 'none';
    this.container.querySelector('#iu-workspace').style.display = 'flex';
  }

  _renderList() {
    const list = this.container.querySelector('#iu-list');
    const scale = parseInt(this.container.querySelector('#iu-scale-select').value, 10) || 4;
    list.innerHTML = '';

    let shown = 0;
    this.images.forEach((img, index) => {
      if (!this._matchesFilter(img)) return;
      shown++;

      const needsUpscale = this._needsUpscale(img);
      const isDone = img.status === 'done';
      const row = document.createElement('div');
      row.className = `iu-row${needsUpscale ? ' iu-row-needs' : ''}`;
      row.dataset.index = index;

      row.innerHTML = `
        <label class="iu-row-check-wrap">
          <input type="checkbox" class="iu-row-check" data-index="${index}" ${img.selected ? 'checked' : ''}>
        </label>
        <div class="iu-thumb-wrap">
          <img class="iu-thumb" src="${img.previewUrl}" alt="${img.name}">
        </div>
        <div class="iu-row-info">
          <div class="iu-row-name" title="${img.name}">${img.name}</div>
          <div class="iu-row-dims">
            <span class="iu-dim-orig">${img.width} \u00d7 ${img.height}</span>
            ${isDone ? '' : `
              <i class="fas fa-arrow-right iu-dim-arrow"></i>
              <span class="iu-dim-new">${img.width * scale} \u00d7 ${img.height * scale}</span>
            `}
            ${this._sizeStatusHtml(img, scale)}
          </div>
          <div class="iu-row-output" id="iu-output-${index}" title="${img.outputPath || ''}">${img.outputPath || ''}</div>
        </div>
        <div class="iu-row-badge" id="iu-badge-${index}">
          ${this._badgeHtml(img.status, img.statusMessage, null, index)}
        </div>
        <button class="btn-icon iu-row-allmodels" data-index="${index}" title="Run every model on this image for comparison" ${img.modelsRunning ? 'disabled' : ''}>
          <i class="fas ${img.modelsRunning ? 'fa-spinner fa-spin' : 'fa-layer-group'}"></i>
        </button>
        <button class="btn-icon iu-row-remove" data-index="${index}" title="Remove">
          <i class="fas fa-times"></i>
        </button>
      `;

      row.querySelector('.iu-row-remove').addEventListener('click', () => this._removeImage(index));
      row.querySelector('.iu-row-check').addEventListener('change', (event) => {
        this.images[index].selected = event.target.checked;
        this._updateToolbar();
      });
      list.appendChild(row);
    });

    if (shown === 0 && this.images.length > 0) {
      const empty = document.createElement('div');
      empty.className = 'iu-list-empty';
      empty.textContent = this.sizeFilter === 'needs'
        ? `No images below ${this.targetEdge}px - nothing here needs upscaling.`
        : `No images at or above ${this.targetEdge}px.`;
      list.appendChild(empty);
    }
  }

  _badgeHtml(status, message = '', percent = null, index = null) {
    if (status === 'done') {
      const compareBtn = `<button class="btn btn-sm iu-compare-btn" data-index="${index}" title="Compare before/after">Compare</button>`;
      return `<span class="iu-badge iu-badge-done">Done</span>${compareBtn}`;
    }
    if (status === 'processing') {
      const percentLabel = Number.isFinite(percent) ? ` ${Math.floor(percent)}%` : '';
      return `<span class="iu-badge iu-badge-proc"><i class="fas fa-spinner fa-spin"></i> Upscaling${percentLabel}</span>`;
    }
    if (status === 'error') return `<span class="iu-badge iu-badge-err" title="${message}">Failed</span>`;
    return '';
  }

  _updateBadge(index, status, message = '', percent = null) {
    const img = this.images[index];
    if (img) {
      img.status = status;
      img.statusMessage = message;
    }
    const badge = this.container.querySelector(`#iu-badge-${index}`);
    if (badge) badge.innerHTML = this._badgeHtml(status, message, percent, index);
  }

  /**
   * Loads the pre-upscale backup and the upscaled replacement for the given
   * row and shows them in a draggable before/after comparison slider.
   */
  async _openCompareModal(index) {
    const img = this.images[index];
    if (!img || img.status !== 'done') return;

    if (!img.bakPath || !img.outputPath) {
      this.showToast('Comparison unavailable for this image', 'warning');
      return;
    }

    await this._showCompareSlider({
      beforePath: img.bakPath,
      afterPath: img.outputPath,
      title: img.name,
      beforeLabel: 'Original',
      afterLabel: 'Upscaled',
      dimsText: `${img.originalWidth || img.width} \u00d7 ${img.originalHeight || img.height} \u2192 ${img.width} \u00d7 ${img.height}`
    });
  }

  /**
   * Generic before/after slider used both by the single-image "Compare"
   * button (original vs. its one upscale) and by the "Compare All Models"
   * grid (original vs. any one model's output).
   */
  async _showCompareSlider({ beforePath, afterPath, title, beforeLabel = 'Original', afterLabel = 'Upscaled', dimsText = '' }) {
    const modal = this.container.querySelector('#iu-compare-modal');
    const loading = this.container.querySelector('#iu-compare-loading');
    const beforeImg = this.container.querySelector('#iu-compare-before');
    const afterImg = this.container.querySelector('#iu-compare-after');
    const titleEl = this.container.querySelector('#iu-compare-title');
    const dims = this.container.querySelector('#iu-compare-dims');
    const beforeWrap = this.container.querySelector('#iu-compare-before-wrap');
    const handle = this.container.querySelector('#iu-compare-handle');
    const beforeLabelEl = this.container.querySelector('#iu-compare-label-before');
    const afterLabelEl = this.container.querySelector('#iu-compare-label-after');

    titleEl.textContent = title;
    titleEl.title = title;
    if (beforeLabelEl) beforeLabelEl.textContent = beforeLabel;
    if (afterLabelEl) afterLabelEl.textContent = afterLabel;
    this._comparePct = 50;
    beforeWrap.style.clipPath = 'inset(0 50% 0 0)';
    handle.style.left = '50%';
    beforeImg.src = '';
    afterImg.src = '';
    dims.textContent = '';
    loading.style.display = 'flex';
    modal.style.display = 'flex';
    this._revokeCompareUrls();

    try {
      const [beforeUrl, afterUrl] = await Promise.all([
        this._loadImageBlobUrl(beforePath),
        this._loadImageBlobUrl(afterPath)
      ]);

      if (!beforeUrl || !afterUrl) {
        throw new Error('Could not load one or both images for comparison');
      }

      this._compareUrls = [beforeUrl, afterUrl];
      beforeImg.src = beforeUrl;
      afterImg.src = afterUrl;
      dims.textContent = dimsText;

      // The stage is sized from the upscaled image's true pixel dimensions, so
      // both panes render at matched physical scale - the original is compared
      // at the output size rather than the two being independently letterboxed.
      await Promise.all([beforeImg.decode(), afterImg.decode()].map(p => p.catch(() => {})));
      this._compareNatural = { width: afterImg.naturalWidth, height: afterImg.naturalHeight };
      if (this._fitCompareView) this._fitCompareView();
    } catch (error) {
      console.error('Failed to load comparison images:', error);
      this.showToast(error.message || 'Failed to load comparison', 'error');
      this._closeCompareModal();
    } finally {
      loading.style.display = 'none';
    }
  }

  async _loadImageBlobUrl(filePath) {
    try {
      const result = await window.electronAPI.utils.readImageFile(filePath);
      if (!result?.success) return null;
      const mime = result.mime || 'image/png';
      const blob = new Blob([new Uint8Array(result.data)], { type: mime });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error(`Failed to load ${filePath} for comparison:`, error);
      return null;
    }
  }

  _revokeCompareUrls() {
    if (this._compareUrls) {
      this._compareUrls.forEach(url => URL.revokeObjectURL(url));
      this._compareUrls = null;
    }
  }

  _closeCompareModal() {
    const modal = this.container?.querySelector('#iu-compare-modal');
    if (modal) modal.style.display = 'none';
    this._revokeCompareUrls();
  }

  /**
   * Runs every locally available Upscayl model against a single row's image
   * (leaving the original untouched) and opens a grid so the results can be
   * compared. Each model writes its own scratch file next to the source.
   */
  async _runAllModelsCompare(index) {
    const img = this.images[index];
    if (!img || img.modelsRunning) return;

    if (!img.filePath) {
      this.showToast('No file path - file may not be from local filesystem', 'warning');
      return;
    }

    img.modelsRunning = true;
    this._renderList();

    const modal = this.container.querySelector('#iu-grid-modal');
    const loading = this.container.querySelector('#iu-grid-loading');
    const loadingLabel = this.container.querySelector('#iu-grid-loading-label');
    const cardsEl = this.container.querySelector('#iu-grid-cards');
    const title = this.container.querySelector('#iu-grid-title');

    title.textContent = `Compare All Models \u2014 ${img.name}`;
    title.title = img.name;
    cardsEl.innerHTML = '';
    loadingLabel.textContent = 'Running models\u2026';
    loading.style.display = 'flex';
    modal.style.display = 'flex';
    this._revokeGridUrls();
    this._gridContext = { sourcePath: img.filePath };

    try {
      const options = this._getOptions();
      const result = await window.electronAPI.imageUpscaler.upscaleAllModels(img.filePath, options);
      if (!result.success) throw new Error(result.message || 'Failed to run all models');
      if (!result.results || result.results.length === 0) {
        throw new Error('All models failed - see console for details');
      }

      img.modelComparisons = result.results;
      await this._renderModelGrid(result.results, result.errors, img);

      if (result.errors?.length) {
        this.showToast(`Compared ${result.results.length} model(s); ${result.errors.length} failed`, 'warning');
      } else {
        this.showToast(`Compared ${result.results.length} model(s)`, 'success');
      }
    } catch (error) {
      console.error('Failed to run all models:', error);
      this.showToast(error.message || 'Failed to run all models', 'error');
      this._closeGridModal();
    } finally {
      loading.style.display = 'none';
      img.modelsRunning = false;
      this._renderList();
    }
  }

  /**
   * Builds the model comparison cards once every model has finished (or
   * failed). Each successful card gets a "View vs Original" button that
   * opens the same before/after slider used by the single-image Compare.
   */
  async _renderModelGrid(results, errors, img) {
    const cardsEl = this.container.querySelector('#iu-grid-cards');
    const toolbar = this.container.querySelector('#iu-grid-toolbar');
    cardsEl.innerHTML = '';

    const [beforeUrl, ...afterUrls] = await Promise.all([
      this._loadImageBlobUrl(img.filePath),
      ...results.map(result => this._loadImageBlobUrl(result.outputPath))
    ]);
    this._gridUrls = [beforeUrl, ...afterUrls].filter(Boolean);

    let syncedTileCount = 0;

    results.forEach((result, i) => {
      const url = afterUrls[i];
      const canSync = Boolean(url && beforeUrl);
      const card = document.createElement('div');
      card.className = 'iu-grid-card';
      card.innerHTML = `
        <div class="iu-grid-thumb-wrap">
          ${canSync ? `
            <div class="iu-grid-sync-tile" data-sync-tile>
              <img class="iu-grid-sync-img iu-grid-sync-before" src="${beforeUrl}" alt="Original" draggable="false">
              <div class="iu-grid-sync-after-wrap">
                <img class="iu-grid-sync-img iu-grid-sync-after" src="${url}" alt="${result.modelName}" draggable="false">
              </div>
              <div class="iu-grid-sync-divider"></div>
            </div>
          ` : (url
              ? `<img class="iu-grid-thumb" src="${url}" alt="${result.modelName}">`
              : '<div class="iu-grid-thumb-error"><i class="fas fa-exclamation-triangle"></i></div>')}
        </div>
        <div class="iu-grid-card-label">${result.modelName}</div>
        <div class="iu-grid-card-dims">${img.width * result.scale} \u00d7 ${img.height * result.scale}</div>
        <button class="btn btn-sm iu-grid-view-btn" ${url ? '' : 'disabled'}>Open Full Size</button>
      `;

      if (url) {
        card.querySelector('.iu-grid-view-btn').addEventListener('click', () => {
          this._showCompareSlider({
            beforePath: img.filePath,
            afterPath: result.outputPath,
            title: `${img.name} \u2014 ${result.modelName}`,
            beforeLabel: 'Original',
            afterLabel: result.modelName,
            dimsText: `${img.width} \u00d7 ${img.height} \u2192 ${img.width * result.scale} \u00d7 ${img.height * result.scale}`
          });
        });
      }

      if (canSync) {
        syncedTileCount++;
        this._wireSyncTile(card.querySelector('[data-sync-tile]'));
      }

      cardsEl.appendChild(card);
    });

    (errors || []).forEach(err => {
      const card = document.createElement('div');
      card.className = 'iu-grid-card iu-grid-card-error';
      card.innerHTML = `
        <div class="iu-grid-thumb-wrap"><div class="iu-grid-thumb-error"><i class="fas fa-exclamation-triangle"></i></div></div>
        <div class="iu-grid-card-label">${err.modelName}</div>
        <div class="iu-grid-card-dims iu-grid-card-err-msg" title="${err.message}">${err.message}</div>
      `;
      cardsEl.appendChild(card);
    });

    if (toolbar) toolbar.style.display = syncedTileCount > 0 ? 'flex' : 'none';
    this._resetGridSync();
  }

  /**
   * Shared pan/zoom/reveal state for the "Compare All Models" grid. All
   * synced tiles read these via CSS custom properties on `#iu-grid-cards`,
   * so panning or zooming one tile (or dragging the master reveal slider)
   * moves every model's tile together - the whole point being to see all
   * 7 model differences on the same crop at once instead of opening each
   * comparison one at a time.
   */
  _resetGridSync() {
    this._gridSync = { pct: 50, zoom: 1, panX: 0.5, panY: 0.5 };
    this._applyGridSync();
  }

  _applyGridSync() {
    const cardsEl = this.container?.querySelector('#iu-grid-cards');
    if (!cardsEl || !this._gridSync) return;
    const { pct, zoom, panX, panY } = this._gridSync;

    cardsEl.style.setProperty('--iu-sync-pct', `${pct}%`);
    cardsEl.style.setProperty('--iu-sync-zoom', zoom);
    cardsEl.style.setProperty('--iu-sync-px', `${panX * 100}%`);
    cardsEl.style.setProperty('--iu-sync-py', `${panY * 100}%`);

    const zoomLabel = this.container.querySelector('#iu-grid-zoom-label');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;

    const revealSlider = this.container.querySelector('#iu-grid-reveal-slider');
    if (revealSlider && document.activeElement !== revealSlider) revealSlider.value = pct;
  }

  /**
   * Wires drag-to-pan, wheel-to-zoom, click-to-move-divider and
   * double-click-to-reset on a single grid tile, all writing into the
   * shared `_gridSync` state so every other tile follows along.
   */
  _wireSyncTile(tile) {
    if (!tile) return;
    const DRAG_THRESHOLD = 4;
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0;
    let startPanX = 0.5, startPanY = 0.5;

    tile.addEventListener('pointerdown', (event) => {
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      startPanX = this._gridSync.panX;
      startPanY = this._gridSync.panY;
      tile.setPointerCapture?.(event.pointerId);
    });

    tile.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;

      const rect = tile.getBoundingClientRect();
      const zoom = this._gridSync.zoom || 1;
      const nextPanX = startPanX - (dx / rect.width) / zoom;
      const nextPanY = startPanY - (dy / rect.height) / zoom;
      this._gridSync.panX = Math.min(1, Math.max(0, nextPanX));
      this._gridSync.panY = Math.min(1, Math.max(0, nextPanY));
      this._applyGridSync();
    });

    tile.addEventListener('pointerup', (event) => {
      if (dragging && !moved) {
        const rect = tile.getBoundingClientRect();
        const pct = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
        this._gridSync.pct = pct;
        this._applyGridSync();
      }
      dragging = false;
      moved = false;
    });

    tile.addEventListener('pointerleave', () => {
      dragging = false;
      moved = false;
    });

    tile.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      this._gridSync.zoom = Math.min(6, Math.max(1, this._gridSync.zoom * factor));
      this._applyGridSync();
    }, { passive: false });

    tile.addEventListener('dblclick', () => {
      this._gridSync.zoom = 1;
      this._gridSync.panX = 0.5;
      this._gridSync.panY = 0.5;
      this._applyGridSync();
    });
  }

  _revokeGridUrls() {
    if (this._gridUrls) {
      this._gridUrls.forEach(url => URL.revokeObjectURL(url));
      this._gridUrls = null;
    }
  }

  _closeGridModal() {
    const modal = this.container?.querySelector('#iu-grid-modal');
    if (modal) modal.style.display = 'none';
    this._revokeGridUrls();
    this._gridContext = null;
  }

  /**
   * Handles 'image-upscaler:progress' events pushed from the main process
   * while a model is running, so the badge shows a live percentage
   * instead of a generic spinner during long-running upscales.
   */
  _onUpscaleProgress({ filePath, percent } = {}) {
    if (!this.isProcessing || !filePath) return;
    const index = this.images.findIndex(img => img.filePath === filePath);
    if (index === -1 || this.images[index].status !== 'processing') return;
    this._updateBadge(index, 'processing', '', percent);
    if (this.process && Number.isFinite(percent)) this.process.update({ current: percent / 100 });
  }

  /**
   * Handles 'image-upscaler:model-progress' events pushed while the
   * "Compare All Models" run is in progress, updating the grid modal's
   * loading label with which model is currently running.
   */
  _onModelProgress({ filePath, index, total, modelName, percent } = {}) {
    if (!this._gridContext || this._gridContext.sourcePath !== filePath) return;
    const label = this.container.querySelector('#iu-grid-loading-label');
    if (!label) return;
    const pct = Number.isFinite(percent) ? ` ${Math.floor(percent)}%` : '';
    label.textContent = `Model ${index + 1}/${total}: ${modelName}${pct}`;
  }

  _updateOutput(index, outputPath) {
    const output = this.container.querySelector(`#iu-output-${index}`);
    if (output) {
      output.textContent = outputPath || '';
      output.title = outputPath || '';
    }
  }

  _updateToolbar() {
    const total = this.images.length;
    const selected = this.images.filter(i => i.selected).length;
    const needs = this.images.filter(i => this._needsUpscale(i)).length;
    const countEl = this.container.querySelector('#iu-count-label');
    const label = this.container.querySelector('#iu-upscale-label');
    const btn = this.container.querySelector('#iu-upscale-btn');
    const selectAllCb = this.container.querySelector('#iu-select-all');
    const selectNeedsBtn = this.container.querySelector('#iu-select-needs-btn');
    const targetInput = this.container.querySelector('#iu-target-input');

    if (countEl) {
      countEl.textContent = `${total} image${total !== 1 ? 's' : ''}, ${needs} below ${this.targetEdge}px, ${selected} selected`;
    }
    if (label) label.textContent = selected > 0 ? `Upscale ${selected}` : 'Upscale';
    if (btn) btn.disabled = selected === 0 || this.isProcessing;
    if (selectNeedsBtn) selectNeedsBtn.disabled = needs === 0 || this.isProcessing;
    if (targetInput) targetInput.disabled = this.isProcessing;
    if (selectAllCb) {
      // Reflects the rows the current filter shows, matching what the
      // checkbox actually toggles.
      const visible = this.images.filter(i => this._matchesFilter(i));
      const visibleSelected = visible.filter(i => i.selected).length;
      selectAllCb.checked = visible.length > 0 && visibleSelected === visible.length;
      selectAllCb.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    }
  }

  _getOptions() {
    return {
      model: this.container.querySelector('#iu-model-select').value,
      scale: parseInt(this.container.querySelector('#iu-scale-select').value, 10) || 4,
      format: this.container.querySelector('#iu-format-select').value,
      tileSize: parseInt(this.container.querySelector('#iu-tile-input').value, 10) || 0,
      gpuId: this.container.querySelector('#iu-gpu-input').value.trim(),
      compression: '0'
    };
  }

  _removeImage(index) {
    const img = this.images[index];
    if (img && img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    this.images.splice(index, 1);

    if (this.images.length === 0) {
      this._clear();
    } else {
      this._renderList();
      this._updateToolbar();
    }
  }

  async _upscaleAll() {
    if (this.isProcessing) return;

    const selectedIndexes = this.images
      .map((_, i) => i)
      .filter(i => this.images[i].selected);

    if (selectedIndexes.length === 0) {
      this.showToast('No images selected', 'warning');
      return;
    }

    this.isProcessing = true;
    this._updateToolbar();

    const options = this._getOptions();
    const modelSelect = this.container.querySelector('#iu-model-select');
    const modelLabel = (this.backend?.models || []).find(model => model.id === options.model)?.name
      || modelSelect.value
      || 'the selected model';
    let doneCount = 0;
    let errCount = 0;
    let fallbackCount = 0;
    this.process = window.app?.startProcess?.({ toolId: this.id, label: 'Upscaling', total: selectedIndexes.length }) || null;
    this.ignoreGpuLoad = false;

    for (const index of selectedIndexes) {
      const img = this.images[index];
      this.process?.update({ done: doneCount + errCount, current: 0, detail: img.name });
      await this._waitForGpu();
      this._updateBadge(index, 'processing');

      try {
        if (!img.filePath) {
          throw new Error('No file path - file may not be from local filesystem');
        }

        const result = await window.electronAPI.imageUpscaler.upscale(img.filePath, options);
        if (!result.success) throw new Error(result.message || 'Upscale failed');

        img.outputPath = result.outputPath;
        img.bakPath = result.bakPath || null;
        img.originalWidth = img.width;
        img.originalHeight = img.height;
        img.width = result.width || img.width * options.scale;
        img.height = result.height || img.height * options.scale;
        img.selected = false;
        this._updateOutput(index, result.outputPath);
        this._updateBadge(index, 'done');
        doneCount++;
        if (result.engine === 'sharp') fallbackCount++;
      } catch (error) {
        console.error(`Failed to upscale ${img.name}:`, error);
        this._updateBadge(index, 'error', error.message);
        errCount++;
      }
    }

    this.isProcessing = false;
    this.process?.finish({
      message: errCount > 0 ? `${doneCount} done, ${errCount} failed` : `${doneCount} done`,
      failed: errCount > 0 && doneCount === 0,
      warning: errCount > 0
    });
    this.process = null;
    // Finished rows now carry their new dimensions, so re-render to drop the
    // "below target" flag from everything that has reached it.
    this._renderList();
    this._updateToolbar();

    if (errCount > 0) {
      this.showToast(`Done - ${doneCount} upscaled, ${errCount} failed`, 'warning');
    } else if (fallbackCount > 0) {
      this.showToast(`Resized ${doneCount} image(s) without an AI model - originals backed up to bak/`, 'warning');
    } else {
      this.showToast(`Upscaled ${doneCount} image(s) with ${modelLabel} - originals backed up to bak/`, 'success');
    }
  }

  /**
   * Hold the next image while another program keeps the GPU busy, checking
   * again every few seconds. Checked between images, when this tool's own
   * GPU use is zero, so the reading reflects everything else. "Run now" in
   * the Processes section skips the check for the rest of this run.
   */
  async _waitForGpu() {
    while (!this.ignoreGpuLoad) {
      let status = null;
      try {
        status = await window.electronAPI.system.getGpuStatus();
      } catch (error) {
        console.warn('GPU status unavailable:', error);
      }
      if (!status?.available || !status.busy || this.ignoreGpuLoad) break;

      this.process?.update({
        waiting: status.reason,
        onRunNow: () => {
          this.ignoreGpuLoad = true;
          this._wakeGpuWait?.();
        }
      });
      await new Promise(resolve => {
        this._wakeGpuWait = resolve;
        setTimeout(resolve, 5000);
      });
    }
    this._wakeGpuWait = null;
    this.process?.update({ waiting: '' });
  }

  _clear() {
    this.images.forEach(img => {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    });
    this.images = [];
    this.isProcessing = false;

    this.container.querySelector('#iu-workspace').style.display = 'none';
    this.container.querySelector('#iu-dropzone').style.display = '';
    this.container.querySelector('#iu-list').innerHTML = '';
  }

  showToast(message, type = 'info') {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }
}

console.log('✅ ImageUpscalerTool module loaded');

export default ImageUpscalerTool;
window.ImageUpscalerTool = ImageUpscalerTool;
