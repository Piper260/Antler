// src/renderer/js/modules/tools/ImageOrganizerTool.js
// Scans a folder of generated images, reads embedded metadata to detect artist
// names, lets the user review assignments, then copies/moves files into
// per-artist subfolders.

console.log('🔧 ImageOrganizerTool module loading...');

class ImageOrganizerTool {
  constructor() {
    this.name = 'Image Organizer';
    this.id = 'image-organizer';
    this.icon = 'fas fa-folder-tree';
    this.description = 'Scan generated images, detect artist metadata, and organize into folders';
    this.version = '1.0.0';

    this.images = [];        // array of image result objects from IPC scan
    this.outputFolder = '';  // where to write organized subfolders
    this.inputFolder = '';   // scanned source folder
    this.isScanning = false;
    this.isOrganizing = false;

    console.log('🗂️ Image Organizer Tool initialized');
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
    this.images = [];
    console.log('🧹 Image Organizer Tool cleaned up');
  }

  // ─── Template ─────────────────────────────────────────────────────────────

  getTemplate() {
    return `
      <div class="imo-tool">

        <!-- Setup Panel (shown when no scan has been done) -->
        <div class="imo-setup" id="imo-setup">
          <div class="imo-setup-inner">
            <i class="fas fa-folder-open imo-setup-icon"></i>
            <h2 class="imo-setup-title">Image Output Organizer</h2>
            <p class="imo-setup-sub">
              Select a root folder — all subfolders will be crawled automatically. The tool reads
              embedded metadata (Stable Diffusion parameters, LoRA tags, artist prompts) and lets
              you organize images into per-artist subfolders, preserving the original subfolder
              structure beneath each artist.
            </p>
            <button class="btn btn-primary imo-btn imo-btn-primary imo-browse-btn" id="imo-browse-btn">
              <i class="fas fa-folder-open"></i> Choose Image Folder
            </button>
          </div>
        </div>

        <!-- Workspace (shown after scan) -->
        <div class="imo-workspace" id="imo-workspace" style="display:none">

          <!-- Toolbar -->
          <div class="imo-toolbar">
            <div class="imo-toolbar-info">
              <span class="imo-folder-label" id="imo-folder-label" title=""></span>
              <span class="imo-toolbar-sep">•</span>
              <span id="imo-count-label">0 images</span>
              <span class="imo-toolbar-sep">•</span>
              <span id="imo-detected-label" class="imo-detected-count">0 with artists</span>
            </div>
            <div class="imo-toolbar-actions">
              <button class="btn btn-sm imo-btn imo-btn-sm" id="imo-rescan-btn" title="Choose a different folder">
                <i class="fas fa-folder-open"></i> Change Folder
              </button>
              <button class="btn btn-sm imo-btn imo-btn-sm" id="imo-expand-btn" title="Expand / collapse all rows">
                <i class="fas fa-angles-down"></i> Expand All
              </button>
            </div>
          </div>

          <!-- Image List -->
          <div class="imo-list" id="imo-list">
            <!-- rows injected by JS -->
          </div>

          <!-- Organize Footer -->
          <div class="imo-footer">
            <div class="imo-footer-left">
              <div class="imo-output-row">
                <label class="imo-footer-label">Output folder</label>
                <div class="imo-output-input-wrap">
                  <input type="text" id="imo-output-input" class="form-input imo-output-input" placeholder="Same as source folder" readonly>
                  <button class="btn btn-sm imo-btn imo-btn-sm" id="imo-output-browse-btn">
                    <i class="fas fa-folder-open"></i>
                  </button>
                </div>
              </div>
            </div>
            <div class="imo-footer-right">
              <div class="imo-mode-toggle">
                <label class="imo-radio-label">
                  <input type="radio" name="imo-mode" value="copy" checked> Copy
                </label>
                <label class="imo-radio-label">
                  <input type="radio" name="imo-mode" value="move"> Move
                </label>
              </div>
              <button class="btn btn-primary imo-btn imo-btn-primary" id="imo-organize-btn">
                Organize
              </button>
            </div>
          </div>

        </div>

        <!-- Scanning overlay -->
        <div class="imo-overlay" id="imo-overlay" style="display:none">
          <div class="imo-overlay-inner">
            <i class="fas fa-circle-notch fa-spin imo-overlay-icon"></i>
            <p id="imo-overlay-text">Scanning images…</p>
          </div>
        </div>

      </div>
    `;
  }

  // ─── Initialize ───────────────────────────────────────────────────────────

  async initialize(container) {
    console.log('🔧 Initializing Image Organizer Tool...');
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this._setupEvents();
      console.log('✅ Image Organizer Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Image Organizer Tool:', error);
    }
  }

  _setupEvents() {
    const browseBtn      = this.container.querySelector('#imo-browse-btn');
    const rescanBtn      = this.container.querySelector('#imo-rescan-btn');
    const outputBrowse   = this.container.querySelector('#imo-output-browse-btn');
    const organizeBtn    = this.container.querySelector('#imo-organize-btn');
    const expandBtn      = this.container.querySelector('#imo-expand-btn');

    browseBtn.addEventListener('click', () => this._pickSourceFolder());
    rescanBtn.addEventListener('click', () => this._pickSourceFolder());
    outputBrowse.addEventListener('click', () => this._pickOutputFolder());
    organizeBtn.addEventListener('click', () => this._runOrganize());
    expandBtn.addEventListener('click', () => this._toggleExpandAll());
  }

  // ─── Folder Picking ───────────────────────────────────────────────────────

  async _pickSourceFolder() {
    const result = await window.electronAPI.dialog.openDirectory();
    if (!result?.success || !result.path) return;

    this.inputFolder = result.path;
    this.outputFolder = result.path; // default output = source
    this.container.querySelector('#imo-output-input').value = result.path;

    await this._scanFolder(result.path);
  }

  async _pickOutputFolder() {
    const result = await window.electronAPI.dialog.openDirectory();
    if (!result?.success || !result.path) return;

    this.outputFolder = result.path;
    this.container.querySelector('#imo-output-input').value = result.path;
  }

  // ─── Scanning ─────────────────────────────────────────────────────────────

  async _scanFolder(folderPath) {
    this._showOverlay('Scanning images (including subfolders)…');
    this.isScanning = true;

    try {
      const result = await window.electronAPI.imageOrganizer.scanFolder(folderPath);

      if (!result.success) {
        this._showToast(result.message || 'Scan failed', 'error');
        return;
      }

      this.images = result.images || [];
      this._switchToWorkspace(folderPath);
      this._renderList();
      this._updateToolbar();

      const withArtists = this.images.filter(i => i.artists.length > 0).length;
      this._showToast(
        `Found ${this.images.length} image(s), ${withArtists} with detected artists`,
        'success'
      );
    } catch (error) {
      console.error('❌ Scan error:', error);
      this._showToast('Failed to scan folder', 'error');
    } finally {
      this.isScanning = false;
      this._hideOverlay();
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  _switchToWorkspace(folderPath) {
    this.container.querySelector('#imo-setup').style.display = 'none';
    this.container.querySelector('#imo-workspace').style.display = 'flex';

    const label = this.container.querySelector('#imo-folder-label');
    const short = folderPath.length > 55 ? '…' + folderPath.slice(-52) : folderPath;
    label.textContent = short;
    label.title = folderPath;
  }

  _updateToolbar() {
    const withArtists = this.images.filter(i => i.artists.length > 0).length;
    this.container.querySelector('#imo-count-label').textContent = `${this.images.length} image(s)`;
    this.container.querySelector('#imo-detected-label').textContent = `${withArtists} with artists`;
  }

  _renderList() {
    const list = this.container.querySelector('#imo-list');
    list.innerHTML = '';

    if (this.images.length === 0) {
      list.innerHTML = `
        <div class="imo-empty">
          <i class="fas fa-images"></i>
          <p>No images found in this folder.</p>
        </div>`;
      return;
    }

    this.images.forEach((img, idx) => {
      const row = this._buildRow(img, idx);
      list.appendChild(row);
    });
  }

  _buildRow(img, idx) {
    const hasArtists      = img.artists.length > 0;
    const hasLoras        = img.loras && img.loras.length > 0;
    const hasLorasInactive = img.lorasInactive && img.lorasInactive.length > 0;
    const hasAnyLoras     = hasLoras || hasLorasInactive;
    const hasTags         = img.tags && img.tags.length > 0;
    const sizeLabel  = img.size ? this._formatSize(img.size) : '';

    // If no artist was derived but there's exactly one active LoRA, auto-use it
    const _cleanLora = l => l.replace(/\.(?:safetensors|pt|ckpt|bin|pth)$/i, '').replace(/_/g, ' ');
    const artistValue = img.artists[0] ||
      (img.loras && img.loras.length === 1 ? _cleanLora(img.loras[0]) : '') ||
      (img._selectedArtist || '');
    // Seed _selectedArtist so _runOrganize picks it up without needing a click
    if (artistValue && !img._selectedArtist) img._selectedArtist = artistValue;

    const row = document.createElement('div');
    row.className = `imo-row${hasArtists ? ' imo-row-has-artist' : (hasAnyLoras ? ' imo-row-has-lora' : ' imo-row-no-artist')}`;
    row.dataset.idx = idx;

    const makeChip = (l, inactive) => {
      const clean = l.replace(/\.(?:safetensors|pt|ckpt|bin|pth)$/i, '');
      const label = clean.replace(/_/g, ' ');
      const cls   = inactive ? 'imo-lora-chip imo-lora-chip-off' : 'imo-lora-chip';
      const tip   = inactive
        ? `Disabled LoRA — click to use as folder: ${this._escHtml(clean)}`
        : `Use as folder: ${this._escHtml(clean)}`;
      return `<button class="${cls}" data-lora="${this._escHtml(clean)}" data-idx="${idx}" title="${tip}"><i class="fas fa-puzzle-piece"></i> ${this._escHtml(label)}</button>`;
    };

    const loraChips = [
      ...(img.loras         || []).map(l => makeChip(l, false)),
      ...(img.lorasInactive || []).map(l => makeChip(l, true))
    ].join('');

    row.innerHTML = `
      <div class="imo-row-main">
        <div class="imo-row-icon">
          <i class="fas fa-image"></i>
        </div>
        <div class="imo-row-info">
          <span class="imo-row-name" title="${this._escHtml(img.filePath)}">${this._escHtml(img.name)}</span>
          <span class="imo-row-meta">
            ${sizeLabel}${sizeLabel && img.ext ? ' • ' : ''}${img.ext.replace('.', '').toUpperCase()}
            ${img.subFolder ? ` • <span class="imo-row-subfolder" title="${this._escHtml(img.subFolder)}"><i class="fas fa-folder-open"></i> ${this._escHtml(img.subFolder)}</span>` : ''}
          </span>
          ${hasAnyLoras ? `<div class="imo-lora-chips">${loraChips}</div>` : ''}
        </div>
        <div class="imo-row-artist">
          <input
            type="text"
            class="form-input imo-artist-input"
            placeholder="${hasArtists ? '' : (hasAnyLoras ? 'Click a LoRA chip to use as folder name' : 'No artist detected — enter manually or leave blank to skip')}"
            value="${this._escHtml(artistValue)}"
            data-idx="${idx}"
            title="Artist folder name for this image"
          >
          ${hasArtists && img.artists.length > 1 ? `
            <select class="form-select imo-artist-select" data-idx="${idx}" title="Other detected artists">
              ${img.artists.map(a => `<option value="${this._escHtml(a)}">${this._escHtml(a)}</option>`).join('')}
            </select>` : ''}
        </div>
        <button class="btn-icon imo-row-expand-btn" data-idx="${idx}" title="Show metadata">
          <i class="fas fa-chevron-down"></i>
        </button>
      </div>
      <div class="imo-row-detail" id="imo-detail-${idx}" style="display:none">
        ${hasLoras ? `<div class="imo-detail-section"><span class="imo-detail-label">LoRAs (on):</span> <span class="imo-detail-value">${img.loras.map(l => `<span class="imo-tag imo-tag-lora">${this._escHtml(l)}</span>`).join('')}</span></div>` : ''}
        ${hasLorasInactive ? `<div class="imo-detail-section"><span class="imo-detail-label">LoRAs (off):</span> <span class="imo-detail-value">${img.lorasInactive.map(l => `<span class="imo-tag imo-tag-lora-off">${this._escHtml(l)}</span>`).join('')}</span></div>` : ''}
        ${img.model ? `<div class="imo-detail-section"><span class="imo-detail-label">Model:</span> <span class="imo-detail-value"><span class="imo-tag imo-tag-model">${this._escHtml(img.model)}</span></span></div>` : ''}
        ${hasTags ? `<div class="imo-detail-section"><span class="imo-detail-label">Other Tags:</span> <span class="imo-detail-value">${img.tags.map(t => `<span class="imo-tag">${this._escHtml(t)}</span>`).join('')}</span></div>` : ''}
        ${img.artists.length > 1 ? `<div class="imo-detail-section"><span class="imo-detail-label">All Artists:</span> <span class="imo-detail-value">${img.artists.map(a => `<span class="imo-tag imo-tag-artist">${this._escHtml(a)}</span>`).join('')}</span></div>` : ''}
        ${img.rawParams ? `<div class="imo-detail-section imo-detail-params"><span class="imo-detail-label">Raw Params:</span><pre class="imo-params-pre">${this._escHtml(img.rawParams.slice(0, 600))}${img.rawParams.length > 600 ? '\n…' : ''}</pre></div>` : ''}
        ${!img.rawParams && !hasAnyLoras && !hasTags ? `<div class="imo-detail-section"><span class="imo-detail-value imo-no-meta">No embedded metadata found in this file.</span></div>` : ''}
      </div>
    `;

    // Expand/collapse toggle
    row.querySelector('.imo-row-expand-btn').addEventListener('click', () => {
      this._toggleRow(row, idx);
    });

    // Artist input changes update the image object
    const artistInput = row.querySelector('.imo-artist-input');
    artistInput.addEventListener('input', () => {
      this.images[idx]._selectedArtist = artistInput.value;
    });

    // Multi-artist select
    const artistSelect = row.querySelector('.imo-artist-select');
    if (artistSelect) {
      artistSelect.addEventListener('change', () => {
        artistInput.value = artistSelect.value;
        this.images[idx]._selectedArtist = artistSelect.value;
      });
    }

    // LoRA chip click — fill the artist input
    row.querySelectorAll('.imo-lora-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const loraName = chip.dataset.lora;
        artistInput.value = loraName;
        this.images[idx]._selectedArtist = loraName;
        // Highlight the selected chip
        row.querySelectorAll('.imo-lora-chip').forEach(c => c.classList.remove('imo-lora-chip-active'));
        chip.classList.add('imo-lora-chip-active');
      });
    });

    return row;
  }

  _toggleRow(row, idx) {
    const detail = row.querySelector(`#imo-detail-${idx}`);
    const btn    = row.querySelector('.imo-row-expand-btn i');
    const isOpen = detail.style.display !== 'none';
    detail.style.display = isOpen ? 'none' : 'block';
    btn.className = isOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
  }

  _toggleExpandAll() {
    const btn        = this.container.querySelector('#imo-expand-btn');
    const allDetails = this.container.querySelectorAll('.imo-row-detail');
    const anyOpen    = Array.from(allDetails).some(d => d.style.display !== 'none');

    allDetails.forEach((d, i) => {
      d.style.display = anyOpen ? 'none' : 'block';
      const chevron = this.container.querySelector(`.imo-row-expand-btn[data-idx="${i}"] i`);
      if (chevron) chevron.className = anyOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
    });

    btn.innerHTML = anyOpen
      ? '<i class="fas fa-angles-down"></i> Expand All'
      : '<i class="fas fa-angles-up"></i> Collapse All';
  }

  // ─── Organize ─────────────────────────────────────────────────────────────

  async _runOrganize() {
    if (this.isOrganizing) return;

    const modeEl = this.container.querySelector('input[name="imo-mode"]:checked');
    const mode   = modeEl ? modeEl.value : 'copy';
    const outputPath = this.outputFolder || this.inputFolder;

    if (!outputPath) {
      this._showToast('Please select an output folder', 'warning');
      return;
    }

    // Build operations — collect artist values from inputs at organize time
    const inputs = this.container.querySelectorAll('.imo-artist-input');
    const operations = [];

    inputs.forEach((input, i) => {
      const artist = (input.value || this.images[i]?._selectedArtist || '').trim();
      if (artist) {
        operations.push({
          filePath: this.images[i].filePath,
          artistFolder: artist,
          subFolder: this.images[i].subFolder || ''
        });
      }
    });

    if (operations.length === 0) {
      this._showToast('No images have an artist assigned — nothing to organize', 'warning');
      return;
    }

    this._showOverlay(`Organizing ${operations.length} image(s)…`);
    this.isOrganizing = true;

    try {
      const result = await window.electronAPI.imageOrganizer.organize(operations, outputPath, mode);

      if (!result.success) {
        this._showToast(result.message || 'Organize failed', 'error');
        return;
      }

      this._showToast(result.message, 'success');

      // Open the output folder so the user can see results
      await window.electronAPI.imageOrganizer.openFolder(outputPath);

      // If we moved files, re-scan to refresh the list
      if (mode === 'move') {
        await this._scanFolder(this.inputFolder);
      }
    } catch (error) {
      console.error('❌ Organize error:', error);
      this._showToast('Failed to organize images', 'error');
    } finally {
      this.isOrganizing = false;
      this._hideOverlay();
    }
  }

  // ─── Overlay ──────────────────────────────────────────────────────────────

  _showOverlay(text) {
    const overlay = this.container.querySelector('#imo-overlay');
    this.container.querySelector('#imo-overlay-text').textContent = text;
    overlay.style.display = 'flex';
  }

  _hideOverlay() {
    this.container.querySelector('#imo-overlay').style.display = 'none';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  _escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _showToast(message, type = 'info') {
    // Piggy-back on the global app toast system if available
    if (window.app?.showToast) {
      window.app.showToast(message, type);
      return;
    }
    // Fallback
    const toastId = type === 'error' ? 'error-toast'
      : type === 'warning' ? 'warning-toast'
      : 'success-toast';
    const msgId = type === 'error' ? 'error-message'
      : type === 'warning' ? 'warning-message'
      : 'success-message';
    const toast = document.getElementById(toastId);
    const msg   = document.getElementById(msgId);
    if (toast && msg) {
      msg.textContent = message;
      toast.style.display = 'flex';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }
  }
}

// Expose on window so app.js can find it
window.ImageOrganizerTool = ImageOrganizerTool;
console.log('✅ ImageOrganizerTool registered on window');
