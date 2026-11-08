console.log('🔧 ImageResizerTool module loading...');

const MAX_SIDE = 2048;

class ImageResizerTool {
  constructor() {
    this.name = 'Image Resizer';
    this.id = 'image-resizer';
    this.icon = 'fas fa-expand-arrows-alt';
    this.description = 'Batch resize images — scales down to 2048px max side';
    this.version = '2.0.0';
    // Resizing carries on while other tools are open; see App.loadToolContent.
    this.keepAlive = true;

    // { file, name, filePath, width, height, previewUrl, needsResize, newWidth, newHeight, status }
    this.images = [];
    this.isProcessing = false;

    // Dataset dropdown state (mirrors Tag Editor's artist/character picker)
    this.datasetMode = 'artist'; // 'artist' or 'character'
    this.datasetEntries = [];

    console.log('🖼️ Image Resizer Tool initialized');
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
    console.log('🧹 Image Resizer Tool cleaned up');
  }

  getTemplate() {
    return `
      <div class="ir-tool">

        <!-- Hidden file input lives outside dropzone so its click events don't retrigger the dropzone handler -->
        <input type="file" id="ir-file-input" accept="image/*" multiple style="display:none">

        <!-- Drop Zone (visible when no images loaded) -->
        <div class="ir-dropzone" id="ir-dropzone">
          <div class="ir-dropzone-inner">
            <i class="fas fa-images ir-drop-icon"></i>
            <h2 class="ir-drop-title">Drop Images Here</h2>
            <p class="ir-drop-sub">or click to browse your files</p>
            <div class="ir-drop-actions">
              <button class="btn btn-primary ir-browse-btn" id="ir-browse-btn">
                <i class="fas fa-folder-open"></i> Browse Files
              </button>
            </div>

            <div class="ir-dataset-picker">
              <div class="ir-dataset-divider"><span>or load a dataset</span></div>
              <div class="search-mode-container">
                <span class="mode-label active" id="ir-label-artist">Artist</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="ir-dataset-mode-toggle">
                  <span class="slider"></span>
                </label>
                <span class="mode-label" id="ir-label-character">Character</span>
              </div>
              <select class="form-input ir-dataset-select" id="ir-dataset-select">
                <option value="">Select artist...</option>
              </select>
              <button class="btn btn-ghost btn-sm ir-dataset-custom-link" id="ir-dataset-btn">
                <i class="fas fa-folder-open"></i> Or choose a custom folder
              </button>
            </div>
          </div>
        </div>

        <!-- Image List (visible after loading) -->
        <div class="ir-workspace" id="ir-workspace" style="display:none">

          <!-- Toolbar -->
          <div class="ir-toolbar">
            <div class="ir-toolbar-info">
              <label class="ir-select-all-wrap" title="Select / deselect all">
                <input type="checkbox" id="ir-select-all" checked>
                <span>Select All</span>
              </label>
              <span class="ir-toolbar-sep">•</span>
              <span id="ir-count-label">0 images</span>
              <span class="ir-toolbar-sep">•</span>
              <span id="ir-needs-label" class="ir-needs-count">0 need resizing</span>
            </div>
            <div class="ir-toolbar-actions">
              <button class="btn ir-btn ir-btn-add" id="ir-add-dataset-btn" title="Add another dataset folder">
                <i class="fas fa-database"></i> Add Folder
              </button>
              <button class="btn ir-btn ir-btn-add" id="ir-add-btn" title="Add more images">
                <i class="fas fa-plus"></i> Add More
              </button>
              <button class="btn btn-primary ir-btn ir-btn-resize" id="ir-resize-btn">
                <span id="ir-resize-label">Resize All</span>
              </button>
              <button class="btn ir-btn ir-btn-clear" id="ir-clear-btn">
                <i class="fas fa-trash-alt"></i> Clear
              </button>
            </div>
          </div>

          <!-- List -->
          <div class="ir-list" id="ir-list">
            <!-- rows injected by JS -->
          </div>

        </div>

      </div>
    `;
  }

  async initialize(container) {
    console.log('🔧 Initializing Image Resizer Tool...');
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this._setupEvents();
      await this._loadDatasetDropdown();
      console.log('✅ Image Resizer Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Image Resizer Tool:', error);
    }
  }

  _setupEvents() {
    const dropzone  = this.container.querySelector('#ir-dropzone');
    const fileInput = this.container.querySelector('#ir-file-input');
    const browseBtn = this.container.querySelector('#ir-browse-btn');
    const datasetBtn = this.container.querySelector('#ir-dataset-btn');
    const addDatasetBtn = this.container.querySelector('#ir-add-dataset-btn');
    const addBtn    = this.container.querySelector('#ir-add-btn');
    const resizeBtn = this.container.querySelector('#ir-resize-btn');
    const clearBtn  = this.container.querySelector('#ir-clear-btn');
    const selectAllCb = this.container.querySelector('#ir-select-all');
    const datasetSelect = this.container.querySelector('#ir-dataset-select');
    const datasetModeToggle = this.container.querySelector('#ir-dataset-mode-toggle');

    // Browse
    browseBtn.addEventListener('click', () => fileInput.click());
    addBtn.addEventListener('click', () => fileInput.click());
    datasetBtn.addEventListener('click', () => this._pickDatasetFolder());
    addDatasetBtn.addEventListener('click', () => this._pickDatasetFolder());
    datasetSelect.addEventListener('change', (e) => this._onDatasetSelect(e.target.value));
    datasetModeToggle.addEventListener('change', () => this._onDatasetModeToggle());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) this._handleFiles(e.target.files);
      fileInput.value = '';
    });

    // Drop on drop zone
    dropzone.addEventListener('click', (e) => {
      if (!e.target.closest('#ir-browse-btn') && !e.target.closest('.ir-dataset-picker')) fileInput.click();
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
      this._handleFiles(e.dataTransfer.files);
    });

    // Drop anywhere in the workspace too
    const workspace = this.container.querySelector('#ir-workspace');
    workspace.addEventListener('dragover', (e) => e.preventDefault());
    workspace.addEventListener('drop', (e) => {
      e.preventDefault();
      this._handleFiles(e.dataTransfer.files);
    });

    // Actions
    resizeBtn.addEventListener('click', () => this._resizeAll());
    clearBtn.addEventListener('click', () => this._clear());
    selectAllCb.addEventListener('change', (e) => {
      this.images.forEach(img => { img.selected = e.target.checked; });
      this._renderList();
      this._updateToolbar();
    });
  }

  async _handleFiles(fileList) {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
    const validExts  = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
    const files = Array.from(fileList).filter(f =>
      validMimes.includes(f.type) || validExts.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    if (files.length === 0) {
      this.showToast('No valid image files in selection', 'warning');
      return;
    }

    const loaded = (await Promise.all(files.map(f => this._loadFileMeta(f)))).filter(Boolean);
    loaded.forEach(img => this.images.push(img));

    this._switchToWorkspace();
    this._renderList();
    this._updateToolbar();
    this.showToast(`Loaded ${loaded.length} image(s)`, 'success');
  }

  /**
   * Let the user pick an arbitrary folder ("dataset") and recursively load
   * every image found inside it, mirroring the drag/drop flow above but
   * sourced from disk paths instead of browser File objects.
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
    const select = this.container.querySelector('#ir-dataset-select');
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
    const toggle = this.container.querySelector('#ir-dataset-mode-toggle');
    const isCharacterMode = toggle.checked;
    this.datasetMode = isCharacterMode ? 'character' : 'artist';

    this.container.querySelector('#ir-label-artist').classList.toggle('active', !isCharacterMode);
    this.container.querySelector('#ir-label-character').classList.toggle('active', isCharacterMode);
    this._populateDatasetSelect();
  }

  async _onDatasetSelect(entryId) {
    if (!entryId) return;
    const entry = this.datasetEntries.find(a => a.id === entryId);
    if (!entry || !entry.path) return;

    await this._loadDatasetFromPath(entry.path);

    // Reset the dropdown so it can be re-used to add another dataset later
    const select = this.container.querySelector('#ir-dataset-select');
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
   * (no File object). Reads the raw bytes via IPC and builds a blob URL so
   * the rest of the pipeline (thumbnail, canvas resize) works unchanged.
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
          const w = img.width;
          const h = img.height;
          const longest = Math.max(w, h);
          const needsResize = longest > MAX_SIDE;
          let newWidth = w, newHeight = h;
          if (needsResize) {
            const scale = MAX_SIDE / longest;
            newWidth  = Math.round(w * scale);
            newHeight = Math.round(h * scale);
          }
          resolve({
            file: null,
            mimeType: mime,
            name,
            filePath,
            width: w,
            height: h,
            previewUrl: url,
            needsResize,
            newWidth,
            newHeight,
            status: 'queued',
            selected: true
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
        const w = img.width;
        const h = img.height;
        const longest = Math.max(w, h);
        const needsResize = longest > MAX_SIDE;
        let newWidth = w, newHeight = h;
        if (needsResize) {
          const scale = MAX_SIDE / longest;
          newWidth  = Math.round(w * scale);
          newHeight = Math.round(h * scale);
        }
        resolve({
          file,
          name: file.name,
          filePath: window.electronAPI.utils.pathForFile(file) || null,
          width: w,
          height: h,
          previewUrl: url,
          needsResize,
          newWidth,
          newHeight,
          status: 'queued',
          selected: true
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  _switchToWorkspace() {
    this.container.querySelector('#ir-dropzone').style.display  = 'none';
    this.container.querySelector('#ir-workspace').style.display = 'flex';
  }

  _renderList() {
    const list = this.container.querySelector('#ir-list');
    list.innerHTML = '';

    this.images.forEach((img, i) => {
      const row = document.createElement('div');
      row.className = 'ir-row';
      row.dataset.index = i;

      const dimStr    = `${img.width} \u00d7 ${img.height}`;
      const newDimStr = `${img.newWidth} \u00d7 ${img.newHeight}`;

      row.innerHTML = `
        <label class="ir-row-check-wrap">
          <input type="checkbox" class="ir-row-check" data-index="${i}" ${img.selected ? 'checked' : ''}>
        </label>
        <div class="ir-thumb-wrap">
          <img class="ir-thumb" src="${img.previewUrl}" alt="${img.name}">
        </div>
        <div class="ir-row-info">
          <div class="ir-row-name" title="${img.name}">${img.name}</div>
          <div class="ir-row-dims">
            <span class="ir-dim-orig">${dimStr}</span>
            ${img.needsResize ? `<i class="fas fa-arrow-right ir-dim-arrow"></i><span class="ir-dim-new">${newDimStr}</span>` : ''}
          </div>
        </div>
        <div class="ir-row-badge" id="ir-badge-${i}">
          ${this._badgeHtml(img.status, img.needsResize)}
        </div>
        <button class="btn-icon ir-row-remove" data-index="${i}" title="Remove">
          <i class="fas fa-times"></i>
        </button>
      `;

      row.querySelector('.ir-row-remove').addEventListener('click', () => this._removeImage(i));
      row.querySelector('.ir-row-check').addEventListener('change', (e) => {
        this.images[i].selected = e.target.checked;
        this._updateToolbar();
      });
      list.appendChild(row);
    });
  }

  _badgeHtml(status, needsResize) {
    if (status === 'done')       return `<span class="ir-badge ir-badge-done">Done</span>`;
    if (status === 'skipped')    return `<span class="ir-badge ir-badge-skip">Already \u2264 ${MAX_SIDE}</span>`;
    if (status === 'processing') return `<span class="ir-badge ir-badge-proc"><i class="fas fa-spinner fa-spin"></i> Resizing\u2026</span>`;
    if (status === 'error')      return `<span class="ir-badge ir-badge-err">Failed</span>`;
    if (!needsResize)            return `<span class="ir-badge ir-badge-ok">No resize needed</span>`;
    return '';
  }

  _updateBadge(index, status) {
    const badge = this.container.querySelector(`#ir-badge-${index}`);
    if (badge) badge.innerHTML = this._badgeHtml(status, this.images[index].needsResize);
  }

  _updateToolbar() {
    const total   = this.images.length;
    const selected = this.images.filter(i => i.selected).length;
    const needsSelected = this.images.filter(i => i.selected && i.needsResize).length;
    const countEl = this.container.querySelector('#ir-count-label');
    const needsEl = this.container.querySelector('#ir-needs-label');
    const label   = this.container.querySelector('#ir-resize-label');
    const btn     = this.container.querySelector('#ir-resize-btn');
    const selectAllCb = this.container.querySelector('#ir-select-all');

    if (countEl) countEl.textContent = `${total} image${total !== 1 ? 's' : ''} (${selected} selected)`;
    if (needsEl) needsEl.textContent = `${needsSelected} need resizing`;
    if (label)   label.textContent   = needsSelected > 0 ? `Resize ${needsSelected}` : 'Nothing to resize';
    if (btn)     btn.disabled        = needsSelected === 0 || this.isProcessing;
    if (selectAllCb) {
      selectAllCb.checked = total > 0 && selected === total;
      selectAllCb.indeterminate = selected > 0 && selected < total;
    }
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

  async _resizeAll() {
    if (this.isProcessing) return;

    const selectedIndexes = this.images
      .map((_, i) => i)
      .filter(i => this.images[i].selected);

    if (selectedIndexes.length === 0) {
      this.showToast('No images selected', 'warning');
      return;
    }

    this.isProcessing = true;

    const btn = this.container.querySelector('#ir-resize-btn');
    if (btn) btn.disabled = true;

    let doneCount = 0;
    let errCount  = 0;
    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Resizing', total: selectedIndexes.length });

    for (const [position, i] of selectedIndexes.entries()) {
      const img = this.images[i];
      process?.update({ done: position, detail: img.name });

      if (!img.needsResize) {
        img.status = 'skipped';
        this._updateBadge(i, 'skipped');
        continue;
      }

      img.status = 'processing';
      this._updateBadge(i, 'processing');

      try {
        const buffer = await this._resizeToBuffer(img);

        if (!img.filePath) {
          throw new Error('No file path — file may not be from the local filesystem');
        }

        const result = await window.electronAPI.utils.resizeSaveImage(img.filePath, buffer);

        if (!result.success) throw new Error(result.message || 'Save failed');

        img.status = 'done';
        this._updateBadge(i, 'done');
        doneCount++;
      } catch (err) {
        console.error(`Failed to resize ${img.name}:`, err);
        img.status = 'error';
        this._updateBadge(i, 'error');
        errCount++;
      }
    }

    this.isProcessing = false;
    this._updateToolbar();
    process?.finish({ message: errCount > 0 ? `${doneCount} done, ${errCount} failed` : `${doneCount} done`, failed: doneCount === 0 && errCount > 0, warning: errCount > 0 });

    if (errCount > 0) {
      this.showToast(`Done \u2014 ${doneCount} resized, ${errCount} failed`, 'warning');
    } else {
      this.showToast(`Resized ${doneCount} image(s) \u2014 originals backed up to bak/`, 'success');
    }
  }

  _resizeToBuffer(imageData) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = imageData.newWidth;
          canvas.height = imageData.newHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, imageData.newWidth, imageData.newHeight);

          canvas.toBlob(async (blob) => {
            if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
            const arrayBuffer = await blob.arrayBuffer();
            resolve(arrayBuffer);
          }, imageData.mimeType || (imageData.file && imageData.file.type) || 'image/png', 0.95);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image for canvas'));
      img.src = imageData.previewUrl;
    });
  }

  _clear() {
    this.images.forEach(img => {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    });
    this.images = [];
    this.isProcessing = false;

    this.container.querySelector('#ir-workspace').style.display = 'none';
    this.container.querySelector('#ir-dropzone').style.display  = '';
    this.container.querySelector('#ir-list').innerHTML = '';
  }

  showToast(message, type = 'info') {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }
}

console.log('✅ ImageResizerTool module loaded');

export default ImageResizerTool;
window.ImageResizerTool = ImageResizerTool;
