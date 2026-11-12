// Image Cleanup's spot healing and signature sign-off. Healing runs on this
// computer (main/services/spotHeal.js in the vision worker), not on ComfyUI:
// paint over a mark with the Heal brush, or let Find Signatures box the
// artist's signature and watermarks and sign off on each find, or on all of
// them at once. Heals stay a working copy until saved; saving keeps the
// original in bak/cleanup, as keeping a Flux try does. Finds that healing
// would do poorly (a solid logo plate, a big area) can go to Flux Fill
// instead: they're added to the image's mask for Clean Marked.
// Mixed into ImageCleanupTool (see utils/mixMethods.js).

const STROKE_COLOR = [80, 170, 255];
// A find covering more of the image than this, or one healed as a whole box
// (busy artwork or a solid plate), is likely to heal poorly: Flux is suggested.
const FLUX_AREA = 0.02;
const STATE_LABELS = { healed: 'Healed', skipped: 'Skipped', flux: 'For Flux' };

export default class ImageCleanupHealing {
  _healSetup() {
    this.work = this.$('#ic-work');
    this.workCtx = this.work.getContext('2d');
    this.stroke = this.$('#ic-stroke');
    this.strokeCtx = this.stroke.getContext('2d', { willReadFrequently: true });
    this.actions = [];
    this.$('#ic-sig-btn').addEventListener('click', () => this._findSignatures(this.items[this.current]));
    this.$('#ic-sig-all-btn').addEventListener('click', () => this._findSignaturesAll());
    this.$('#ic-heal-all-btn').addEventListener('click', () => this._healAllEverywhere());
    this.$('#ic-heal').addEventListener('click', (e) => {
      const button = e.target.closest('[data-heal]');
      if (!button || button.disabled) return;
      const item = this.items[this.current];
      const index = Number(button.dataset.index);
      const act = button.dataset.heal;
      if (act === 'find') this._healFind(item, index);
      else if (act === 'skip') this._setFindState(item, index, 'skipped');
      else if (act === 'flux') this._fluxFinds(item, [index]);
      else if (act === 'flux-all') this._fluxFinds(item, item.finds.map((f, n) => (f.state === 'pending' ? n : -1)).filter(n => n >= 0));
      else if (act === 'unskip') this._setFindState(item, index, 'pending');
      else if (act === 'all') this._healAllFinds(item);
      else if (act === 'skip-all') this._skipAllFinds(item);
      else if (act === 'undo') this._healUndo();
      else if (act === 'save') this._healSave(item);
      else if (act === 'discard') this._healDiscard(item);
    });
    this.$('#ic-finds').addEventListener('mouseover', (e) => this._highlightFind(e.target.closest('[data-find]')?.dataset.find));
    this.$('#ic-finds').addEventListener('mouseout', () => this._highlightFind(null));
    this._keyUpHandler = (e) => {
      if (e.key.toLowerCase() === 'o') this._comparing(false);
    };
    document.addEventListener('keyup', this._keyUpHandler);
  }

  _healTeardown() {
    document.removeEventListener('keyup', this._keyUpHandler);
  }

  // ------------------------------------------------------------ showing

  /** Leaving an image: keep what its heals look like, to show again on return. */
  async _healOnLeave(item) {
    if (!item || !this.width) return;
    item.workBitmap?.close?.();
    item.workBitmap = item.edits ? await createImageBitmap(this.work) : null;
  }

  _healOnShow(item) {
    for (const canvas of [this.work, this.stroke]) {
      canvas.width = this.width;
      canvas.height = this.height;
    }
    this.workCtx.clearRect(0, 0, this.width, this.height);
    if (item.workBitmap && item.edits) this.workCtx.drawImage(item.workBitmap, 0, 0);
    this.actions = [];
  }

  _renderFinds() {
    const item = this.items[this.current];
    const layer = this.$('#ic-finds');
    const show = item?.finds?.length && this.view === 'mask';
    layer.innerHTML = show ? item.finds.map((f, n) => `
      <div class="ic-find ic-find-${f.state}" data-find="${n}" style="left:${f.x / this.width * 100}%;top:${f.y / this.height * 100}%;width:${f.w / this.width * 100}%;height:${f.h / this.height * 100}%">
        <span>${n + 1}</span>
      </div>`).join('') : '';
  }

  _highlightFind(index) {
    this.$('#ic-heal').querySelectorAll('[data-row]').forEach(row => row.classList.toggle('active', row.dataset.row === index));
    this.$('#ic-finds').querySelectorAll('[data-find]').forEach(box => box.classList.toggle('active', box.dataset.find === index));
  }

  _renderHeal() {
    const item = this.items[this.current];
    const panel = this.$('#ic-heal');
    this._renderFinds();
    const finds = item?.finds || [];
    if (!item || this.view !== 'mask' || (!finds.length && !item.edits && !item.findsChecked)) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }
    const busy = Boolean(this.healBusy || this.run);
    const pending = finds.filter(f => f.state === 'pending').length;
    const kind = (f) => (f.kind === 'watermark' ? 'Watermark' : 'Signature');
    panel.style.display = '';
    panel.innerHTML = `
      <div class="ic-heal-list">
        ${finds.length ? finds.map((f, n) => `
          <div class="ic-heal-row" data-row="${n}">
            <span class="ic-heal-name">${n + 1}. ${kind(f)}</span>
            <span class="ic-heal-score" title="How sure the finder is">${Math.round(f.score * 100)}%</span>
            <span class="ic-heal-state ic-find-state-${f.state}">${STATE_LABELS[f.state] || (this._fluxSuggested(f) ? 'Flux suggested' : '')}</span>
            ${f.state === 'pending' ? `
              <button class="btn btn-sm" data-heal="skip" data-index="${n}" ${busy ? 'disabled' : ''}>Skip</button>
              <button class="btn btn-sm btn-boost" data-heal="flux" data-index="${n}" ${busy ? 'disabled' : ''} title="Add it to the mask for Flux Fill on ComfyUI, for areas healing does poorly"><i class="fas fa-angles-right"></i><span>Flux</span></button>
              <button class="btn btn-sm${this._fluxSuggested(f) ? '' : ' btn-primary'}" data-heal="find" data-index="${n}" ${busy ? 'disabled' : ''}>Heal</button>`
            : f.state === 'skipped' ? `<button class="btn btn-sm" data-heal="unskip" data-index="${n}" ${busy ? 'disabled' : ''}>Undo skip</button>` : ''}
          </div>`).join('') : '<span class="ic-try-hint">No signatures or watermarks found. Paint over any with the Heal brush (H).</span>'}
      </div>
      <div class="ic-try-actions">
        ${pending ? `<button class="btn btn-sm" data-heal="skip-all" ${busy ? 'disabled' : ''}>Skip All</button>
        <button class="btn btn-sm btn-boost" data-heal="flux-all" ${busy ? 'disabled' : ''} title="Add every waiting find to the mask for Flux Fill"><i class="fas fa-angles-right"></i><span>All to Flux</span></button>
        <button class="btn btn-sm" data-heal="all" ${busy ? 'disabled' : ''} title="Heal every waiting find here; ones marked Flux suggested go to Flux">Heal All (${pending})</button>` : ''}
        ${finds.some(f => f.state === 'flux') && !item.edits ? '<span class="ic-try-hint">Marked for Flux: Clean This Image (C) repairs them on ComfyUI.</span>' : ''}
        ${item.edits ? `<span class="ic-try-hint">${this.healBusy ? 'Healing…' : 'Hold O to see the original.'}</span>
        <button class="btn btn-sm" data-heal="undo" ${busy ? 'disabled' : ''}>Undo Heal</button>
        <button class="btn btn-sm" data-heal="discard" ${busy ? 'disabled' : ''}>Discard</button>
        <button class="btn btn-sm btn-primary" data-heal="save" ${busy ? 'disabled' : ''} title="Write the healing into the image (Ctrl+S). The original is kept in bak/cleanup.">Save Healing</button>`
        : this.healBusy ? '<span class="ic-try-hint">Healing…</span>' : ''}
      </div>`;
  }

  _fluxSuggested(find, size = this.width * this.height) {
    return Boolean(find.region?.whole) || (find.w * find.h) / (size || 1) > FLUX_AREA;
  }

  /** Adds finds to the image's mask, for Flux Fill on ComfyUI to repair. Returns how many. */
  async _fluxFinds(item, indexes, { quiet = false } = {}) {
    const finds = indexes.map(n => item?.finds?.[n]).filter(f => f && f.state === 'pending' && f.region);
    if (!finds.length) return 0;
    const shown = item === this.items[this.current];
    if (shown) await this._flushMask();
    const result = await window.electronAPI.cleanup.markRegions(item.filePath, finds.map(f => f.region));
    if (!result.success) {
      if (!quiet) this.showToast(`Could not mark for Flux: ${result.message}`, 'error');
      return 0;
    }
    finds.forEach(f => { f.state = 'flux'; });
    if (['none', 'cleaned'].includes(item.status)) item.status = 'marked';
    if (shown) {
      this._snapshot();
      await this._loadMask(item);
    }
    this._renderHealState(item);
    if (shown && !this.run) this._renderEditor();
    return finds.length;
  }

  _comparing(on) {
    if (!this.work) return;
    this.work.style.visibility = on ? 'hidden' : '';
    this.$('#ic-finds').style.visibility = on ? 'hidden' : '';
  }

  /** Count of finds still waiting across all images, for the toolbar. */
  _updateHealToolbar() {
    const pending = this.items.reduce((n, item) => n + (item.finds || []).filter(f => f.state === 'pending').length, 0);
    const button = this.$('#ic-heal-all-btn');
    button.style.display = pending ? '' : 'none';
    button.textContent = `Heal All Finds (${pending})`;
    button.disabled = Boolean(this.run || this.healBusy);
    this.$('#ic-sig-all-btn').disabled = Boolean(this.run);
  }

  /** The list's note for an image: unsaved healing or finds to sign off. */
  _healNote(item) {
    if (item.edits) return 'Healed, not saved';
    const pending = (item.finds || []).filter(f => f.state === 'pending').length;
    return pending ? `${pending} to sign off` : '';
  }

  // ------------------------------------------------------------ brush

  _healPointerDown(e, p) {
    this.$('#ic-canvas').setPointerCapture(e.pointerId);
    this.healDrag = { last: p };
    this._healStrokeTo(p);
  }

  _healStrokeTo(p) {
    const ctx = this.strokeCtx;
    ctx.save();
    ctx.strokeStyle = `rgb(${STROKE_COLOR.join(',')})`;
    ctx.lineWidth = this._brushWidth();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.healDrag.last.x, this.healDrag.last.y);
    ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
    ctx.restore();
    this.healDrag.last = p;
  }

  /** The stroke just painted becomes the area to heal. */
  async _healPointerUp() {
    this.healDrag = null;
    const { width: w, height: h } = this;
    const pixels = this.strokeCtx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[(y * w + x) * 4 + 3] < 64) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) {
      this.strokeCtx.clearRect(0, 0, w, h);
      return;
    }
    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;
    const mask = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) mask[y * rw + x] = pixels[((y + y0) * w + x + x0) * 4 + 3] >= 64 ? 1 : 0;
    }
    await this._heal(this.items[this.current], { x: x0, y: y0, w: rw, h: rh, mask });
    this.strokeCtx.clearRect(0, 0, w, h);
  }

  // ------------------------------------------------------------ healing

  /** Heals one area of an image and draws the result if it's shown. True when it worked. */
  async _heal(item, region, { quiet = false } = {}) {
    if (!item) return false;
    this.healBusy = true;
    this._renderHealState(item);
    try {
      const result = await window.electronAPI.cleanup.heal(item.filePath, region, { seed: (item.edits || 0) + 1 });
      if (!result.success) throw new Error(result.message);
      item.edits = result.edits;
      if (result.box && item === this.items[this.current]) {
        await this._drawHealed(result.box, result.png);
        this.actions.push('heal');
      }
      return true;
    } catch (error) {
      if (!quiet) this.showToast(`Could not heal: ${error.message}`, 'error');
      return false;
    } finally {
      this.healBusy = false;
      this._renderHealState(item);
    }
  }

  async _drawHealed(box, png) {
    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    this.workCtx.clearRect(box.x, box.y, box.w, box.h);
    this.workCtx.drawImage(bitmap, box.x, box.y);
    bitmap.close?.();
  }

  _renderHealState(item) {
    this._renderList();
    if (item === this.items[this.current]) this._renderHeal();
  }

  async _healUndo() {
    const item = this.items[this.current];
    if (!item?.edits || this.healBusy) return;
    const result = await window.electronAPI.cleanup.healUndo(item.filePath);
    if (!result.success) {
      this.showToast(result.message, 'error');
      return;
    }
    if (result.box) await this._drawHealed(result.box, result.png);
    item.edits = result.edits;
    // The last find healed goes back to waiting.
    const healed = (item.finds || []).filter(f => f.state === 'healed');
    const last = healed.sort((a, b) => (b.healedAt || 0) - (a.healedAt || 0))[0];
    if (last && last.healedAt === item.lastHealAt) {
      last.state = 'pending';
      item.lastHealAt = Math.max(0, ...healed.filter(f => f !== last).map(f => f.healedAt || 0));
    }
    if (!item.edits) this.workCtx.clearRect(0, 0, this.width, this.height);
    this._renderHealState(item);
  }

  async _healSave(item, { quiet = false } = {}) {
    if (!item?.edits || this.healBusy) return false;
    const result = await window.electronAPI.cleanup.healSave(item.filePath);
    if (!result.success) {
      this.showToast(`Could not save: ${result.message}`, 'error');
      return false;
    }
    item.edits = 0;
    item.workBitmap?.close?.();
    item.workBitmap = null;
    if (item.status !== 'review') item.status = item.status === 'marked' ? 'marked' : 'cleaned';
    if (item === this.items[this.current]) {
      // The saved image is now the original; reload it under the (cleared) work layer.
      const index = this.current;
      this.current = -1;
      await this._show(index);
    } else this._renderList();
    if (!quiet) this.showToast('Healing saved. The original is in bak/cleanup.', 'success');
    return true;
  }

  async _healDiscard(item) {
    if (!item?.edits || this.healBusy) return;
    await window.electronAPI.cleanup.healDiscard(item.filePath);
    item.edits = 0;
    item.workBitmap?.close?.();
    item.workBitmap = null;
    (item.finds || []).forEach(f => { if (f.state === 'healed') f.state = 'pending'; });
    if (item === this.items[this.current]) this.workCtx.clearRect(0, 0, this.width, this.height);
    this._renderHealState(item);
  }

  // ------------------------------------------------------------ signatures

  async _findSignatures(item, { quiet = false } = {}) {
    if (!item) return false;
    const result = await window.electronAPI.cleanup.findSignatures(item.filePath);
    if (!result.success) {
      if (!quiet) this.showToast(result.message, 'error');
      return false;
    }
    // Finds already signed off keep their state; new ones wait.
    item.finds = result.finds.map(f => ({ ...f, state: 'pending' }));
    item.size = result.width * result.height;
    item.findsChecked = true;
    this._renderHealState(item);
    if (!quiet) this.showToast(item.finds.length ? `Found ${item.finds.length}: heal or skip each, or all at once` : 'No signatures or watermarks found', item.finds.length ? 'success' : 'info');
    return true;
  }

  async _findSignaturesAll() {
    const targets = this.items.filter(item => !item.findsChecked && item.status !== 'working' && item.status !== 'queued');
    if (!targets.length) {
      this.showToast('Every image has been checked for signatures', 'info');
      return;
    }
    await this._startRun('Finding signatures', targets.length, async (run, process) => {
      let found = 0;
      for (let i = 0; i < targets.length && !run.stopped; i++) {
        process?.update({ done: i, detail: targets[i].name });
        if (await this._findSignatures(targets[i], { quiet: true }) && targets[i].finds.length) found++;
      }
      return { message: `${found} of ${targets.length} with finds`, toast: `Found signatures or watermarks on ${found} of ${targets.length} images. Sign off on each image, or Heal All Finds.` };
    });
  }

  _setFindState(item, index, state) {
    const find = item?.finds?.[index];
    if (!find) return;
    find.state = state;
    this._renderHealState(item);
  }

  async _healFind(item, index) {
    const find = item?.finds?.[index];
    if (!find || find.state !== 'pending' || this.healBusy) return false;
    const ok = await this._heal(item, find.region);
    if (ok) {
      find.state = 'healed';
      find.healedAt = item.lastHealAt = (item.lastHealAt || 0) + 1;
      this._renderHealState(item);
    }
    return ok;
  }

  /** Heals every waiting find; the ones healing would do poorly go to Flux. */
  async _healAllFinds(item) {
    const finds = item?.finds || [];
    await this._fluxFinds(item, finds.map((f, n) => (f.state === 'pending' && this._fluxSuggested(f) ? n : -1)).filter(n => n >= 0));
    for (let i = 0; i < finds.length; i++) {
      if (finds[i].state === 'pending' && !(await this._healFind(item, i))) break;
    }
  }

  _skipAllFinds(item) {
    (item?.finds || []).forEach(f => { if (f.state === 'pending') f.state = 'skipped'; });
    this._renderHealState(item);
  }

  /** Signs off on every waiting find of every image: heals them and saves each image. */
  async _healAllEverywhere() {
    const targets = this.items.filter(item => (item.finds || []).some(f => f.state === 'pending'));
    if (!targets.length) return;
    const count = targets.reduce((n, item) => n + item.finds.filter(f => f.state === 'pending').length, 0);
    if (!confirm(`Heal ${count} find${count === 1 ? '' : 's'} on ${targets.length} image${targets.length === 1 ? '' : 's'} and save them? Finds marked Flux suggested go to the mask for Clean Marked instead, and finds you skipped are left alone. Each original is kept in bak/cleanup.`)) return;
    await this._startRun('Healing signatures', targets.length, async (run, process) => {
      let saved = 0;
      let failed = 0;
      let toFlux = 0;
      for (let i = 0; i < targets.length && !run.stopped; i++) {
        const item = targets[i];
        process?.update({ done: i, detail: item.name });
        const poor = item.finds.map((f, n) => (f.state === 'pending' && this._fluxSuggested(f, item.size) ? n : -1)).filter(n => n >= 0);
        toFlux += await this._fluxFinds(item, poor, { quiet: true });
        for (let n = 0; n < item.finds.length; n++) {
          const find = item.finds[n];
          if (find.state !== 'pending') continue;
          if (await this._heal(item, find.region, { quiet: true })) {
            find.state = 'healed';
            find.healedAt = item.lastHealAt = (item.lastHealAt || 0) + 1;
          } else failed++;
        }
        if (item.edits && await this._healSave(item, { quiet: true })) saved++;
      }
      const flux = toFlux ? ` ${toFlux} find${toFlux === 1 ? '' : 's'} marked for Flux: press Clean Marked to repair them.` : '';
      return { message: `${saved} saved${toFlux ? `, ${toFlux} for Flux` : ''}${failed ? `, ${failed} failed` : ''}`, warning: failed > 0, toast: `Healed and saved ${saved} image${saved === 1 ? '' : 's'}${failed ? `; ${failed} finds failed` : ''}.${flux}` };
    });
  }
}
