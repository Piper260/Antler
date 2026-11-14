// Image Cleanup's crop: drag a box over the image (optionally held to a
// shape such as 1:1 or 2:3), move it by dragging inside, then Apply Crop.
// The crop is done in the main process (ipc/CleanupIPC.js 'cleanup:crop'):
// the original is kept in bak/cleanup and the saved mask is cropped to match.
// Mixed into ImageCleanupTool (see utils/mixMethods.js).

// Width : height, or null for any shape.
const SHAPES = [
  { id: 'free', label: 'Any shape', ratio: null },
  { id: 'original', label: 'Original shape', ratio: 'original' },
  { id: '1:1', label: '1:1 square', ratio: 1 },
  { id: '4:5', label: '4:5 portrait', ratio: 4 / 5 },
  { id: '2:3', label: '2:3 portrait', ratio: 2 / 3 },
  { id: '3:4', label: '3:4 portrait', ratio: 3 / 4 },
  { id: '3:2', label: '3:2 landscape', ratio: 3 / 2 },
  { id: '16:9', label: '16:9 landscape', ratio: 16 / 9 }
];
const MIN_SIDE = 8;

export default class ImageCleanupCrop {
  getCropTemplate() {
    return `
      <div class="ic-crop" id="ic-crop" style="display:none">
        <label class="ic-setting">Shape
          <select class="form-input" id="ic-crop-shape">
            ${SHAPES.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
          </select>
        </label>
        <span class="ic-try-hint" id="ic-crop-size">Drag over the image to choose what to keep.</span>
        <div class="ic-try-actions">
          <button class="btn btn-sm" id="ic-crop-cancel" title="Clear the box (Esc)">Clear</button>
          <button class="btn btn-sm btn-primary" id="ic-crop-apply" disabled title="Crop the image to the box (Enter). The original is kept in bak/cleanup.">Apply Crop</button>
        </div>
      </div>`;
  }

  _cropSetup() {
    this.cropBox = null;
    this.cropShape = 'free';
    try {
      this.cropShape = localStorage.getItem('imageCleanup.cropShape') || 'free';
    } catch { /* default */ }
    const shape = this.$('#ic-crop-shape');
    shape.value = this.cropShape;
    shape.addEventListener('change', () => {
      this.cropShape = shape.value;
      try {
        localStorage.setItem('imageCleanup.cropShape', this.cropShape);
      } catch { /* not kept */ }
      // Reshape the box around its centre.
      if (this.cropBox) this._setCropBox(this._shapeAround(this.cropBox));
    });
    this.$('#ic-crop-cancel').addEventListener('click', () => this._setCropBox(null));
    this.$('#ic-crop-apply').addEventListener('click', () => this._applyCrop());
  }

  _cropRatio() {
    const shape = SHAPES.find(s => s.id === this.cropShape);
    if (!shape?.ratio) return null;
    return shape.ratio === 'original' ? this.width / this.height : shape.ratio;
  }

  /** Called when the mode changes: the crop bar and box only show in Crop. */
  _cropModeChanged(mode) {
    const on = mode === 'crop';
    this.$('#ic-crop').style.display = on && this.view === 'mask' ? '' : 'none';
    if (!on) this._setCropBox(null);
  }

  _setCropBox(box) {
    this.cropBox = box && box.w >= 1 && box.h >= 1 ? box : null;
    const el = this.$('#ic-crop-box');
    const shade = this.$('#ic-crop-shade');
    if (!this.cropBox) {
      el.style.display = 'none';
      shade.style.display = 'none';
      this.$('#ic-crop-size').textContent = 'Drag over the image to choose what to keep.';
      this.$('#ic-crop-apply').disabled = true;
      return;
    }
    const b = this.cropBox;
    Object.assign(el.style, {
      display: '',
      left: `${(b.x / this.width) * 100}%`,
      top: `${(b.y / this.height) * 100}%`,
      width: `${(b.w / this.width) * 100}%`,
      height: `${(b.h / this.height) * 100}%`
    });
    // The rest of the image dimmed: a dark layer with the box cut out.
    const x1 = (b.x / this.width) * 100;
    const y1 = (b.y / this.height) * 100;
    const x2 = ((b.x + b.w) / this.width) * 100;
    const y2 = ((b.y + b.h) / this.height) * 100;
    shade.style.display = '';
    shade.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${x1}% ${y1}%, ${x2}% ${y1}%, ${x2}% ${y2}%, ${x1}% ${y2}%, ${x1}% ${y1}%)`;
    const w = Math.round(b.w);
    const h = Math.round(b.h);
    this.$('#ic-crop-size').textContent = `${w} × ${h} of ${this.width} × ${this.height}`;
    this.$('#ic-crop-apply').disabled = w < MIN_SIDE || h < MIN_SIDE || this.cropBusy;
  }

  /** Keeps a box inside the image. */
  _clampBox(b) {
    const w = Math.min(b.w, this.width);
    const h = Math.min(b.h, this.height);
    return { x: Math.max(0, Math.min(this.width - w, b.x)), y: Math.max(0, Math.min(this.height - h, b.y)), w, h };
  }

  /** The box dragged from `a` to `b`, held to the chosen shape. */
  _cropFrom(a, b) {
    let w = Math.abs(b.x - a.x);
    let h = Math.abs(b.y - a.y);
    const ratio = this._cropRatio();
    if (ratio) {
      if (w / ratio > h) h = w / ratio;
      else w = h * ratio;
    }
    // Never past the image's edges, keeping the shape.
    const maxW = b.x >= a.x ? this.width - a.x : a.x;
    const maxH = b.y >= a.y ? this.height - a.y : a.y;
    const scale = Math.min(1, maxW / (w || 1), maxH / (h || 1));
    w *= scale;
    h *= scale;
    return { x: b.x >= a.x ? a.x : a.x - w, y: b.y >= a.y ? a.y : a.y - h, w, h };
  }

  /** The box reshaped to the chosen shape around its centre, as large as fits. */
  _shapeAround(b) {
    const ratio = this._cropRatio();
    if (!ratio) return this._clampBox(b);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    let w = b.w;
    let h = w / ratio;
    if (h > b.h) {
      h = b.h;
      w = h * ratio;
    }
    return this._clampBox({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  _inCropBox(p) {
    const b = this.cropBox;
    return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  _cropPointerDown(e, p) {
    this.$('#ic-canvas').setPointerCapture(e.pointerId);
    // Dragging inside the box moves it; anywhere else draws a new one.
    this.cropDrag = this._inCropBox(p)
      ? { move: true, start: p, from: { ...this.cropBox } }
      : { move: false, start: p };
  }

  _cropPointerMove(p) {
    const d = this.cropDrag;
    if (!d) return;
    if (d.move) {
      this._setCropBox(this._clampBox({ ...d.from, x: d.from.x + p.x - d.start.x, y: d.from.y + p.y - d.start.y }));
    } else {
      this._setCropBox(this._cropFrom(d.start, { x: Math.max(0, Math.min(this.width, p.x)), y: Math.max(0, Math.min(this.height, p.y)) }));
    }
  }

  _cropPointerUp() {
    const d = this.cropDrag;
    this.cropDrag = null;
    // A click without a drag clears the box.
    if (d && !d.move && this.cropBox && (this.cropBox.w < 2 || this.cropBox.h < 2)) this._setCropBox(null);
  }

  async _applyCrop() {
    const item = this.items[this.current];
    const box = this.cropBox;
    if (!item || !box || this.cropBusy) return;
    if (item.edits) {
      this.showToast('Save or discard the healing first, then crop', 'warning');
      return;
    }
    if (item.status === 'working' || item.status === 'queued') {
      this.showToast('Wait for the cleaning to finish, then crop', 'warning');
      return;
    }
    if (item.tries?.length && !confirm('Cropping discards the Flux tries for this image. Crop anyway?')) return;
    await this._flushMask();
    this.cropBusy = true;
    this.$('#ic-crop-apply').disabled = true;
    const result = await window.electronAPI.cleanup.crop(item.filePath, {
      x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h)
    });
    this.cropBusy = false;
    if (!result.success) {
      this.showToast(`Could not crop: ${result.message}`, 'error');
      this._setCropBox(box);
      return;
    }
    item.tries = [];
    item.finds = null;
    item.findsChecked = false;
    if (!result.unchanged) item.status = result.marked ? 'marked' : 'cleaned';
    this._setCropBox(null);
    const index = this.current;
    this.current = -1;
    await this._show(index);
    this.showToast(result.unchanged ? 'The box covers the whole image; nothing cropped' : `Cropped to ${result.width} × ${result.height}. The original is in bak/cleanup.`, 'success');
  }
}
