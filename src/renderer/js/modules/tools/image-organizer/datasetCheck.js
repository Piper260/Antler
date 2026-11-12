// Image Organizer's dataset check: crawls every dataset in the user's
// libraries and lists what needs attention, each with a quick fix: tag
// images that have no caption with Hydra, move strays into the dataset's
// bak/ folder, drop repeated tags. The work is done in the main process
// (main/ipc/DatasetHealthIPC.js). Mixed into ImageOrganizerTool.

const MIN_SIDE_KEY = 'imageOrganizer.minSide';
const HIDDEN_TAGS_KEY = 'tagEditor.hydraHiddenTags'; // the Tag Editor's never-suggest list
const PREVIEW_FILES = 4;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (file) => String(file).split(/[\\/]/).pop();
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// What each fix button says, by the kind's fix.
const FIX_LABELS = { tag: 'Tag with Hydra', move: 'Move to bak', dedupe: 'Remove repeats' };
// A line under each kind, saying what the fix does.
const KIND_NOTES = {
  'missing-caption': 'Hydra writes a caption: the dataset\'s trigger tag first (when its captions share one), then the tags it is surest of, as many as the dataset\'s captions usually have.',
  'empty-caption': 'Hydra writes a caption in place of the empty one.',
  'orphan-caption': 'Probably left behind when an image was deleted. Moved to bak/orphan-captions.',
  'duplicate-tags': 'Each tag is kept once, in its first place. The old caption is kept in bak/.',
  video: 'Video files are skipped in training. Moved to bak/videos with their captions; Video Frames can pull stills from them.',
  duplicate: 'Byte-for-byte copies. The first by name stays; the copies go to bak/duplicates.',
  'low-res': 'Shorter side below the size set above. Moved to bak/low-res; or upscale them in Image Upscaler instead.',
  temp: 'Downloads that never finished. Moved to bak/temp.',
  'cross-duplicate': 'Shown only: a collab or a repost can rightly be in two datasets.'
};

function readHiddenTags() {
  try {
    const list = JSON.parse(localStorage.getItem(HIDDEN_TAGS_KEY) || '[]');
    return Array.isArray(list) ? list.filter(t => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export default class ImageOrganizerDatasetCheck {
  getCheckTemplate() {
    return `
      <div class="imo-check" id="imo-check" style="display:none">
        <div class="imo-toolbar">
          <div class="imo-toolbar-info">
            <span id="imo-check-summary">Checking...</span>
          </div>
          <div class="imo-toolbar-actions">
            <label class="imo-check-size" title="Images with a shorter side below this are listed as small. 0 skips the size check, which is the slowest part.">
              Smallest side <input type="number" class="form-input" id="imo-check-minside" min="0" max="4096" step="64"> px
            </label>
            <button class="btn btn-sm" id="imo-check-again">Check again</button>
            <button class="btn btn-sm" id="imo-check-stop" style="display:none">Stop</button>
            <button class="btn btn-sm" id="imo-check-back">Back</button>
          </div>
        </div>
        <div class="imo-check-progress" id="imo-check-progress" style="display:none">
          <span id="imo-check-progress-text"></span>
          <div class="progress-bar-container"><div class="progress-bar" id="imo-check-progress-bar"></div></div>
        </div>
        <div class="imo-check-list" id="imo-check-list"></div>
      </div>`;
  }

  _setupCheck() {
    const $ = (s) => this.container.querySelector(s);
    const minSide = $('#imo-check-minside');
    minSide.value = (() => {
      try {
        return localStorage.getItem(MIN_SIDE_KEY) ?? '512';
      } catch {
        return '512';
      }
    })();
    minSide.addEventListener('change', () => {
      try {
        localStorage.setItem(MIN_SIDE_KEY, String(Math.max(0, Number(minSide.value) || 0)));
      } catch { /* not kept */ }
    });
    $('#imo-check-btn').addEventListener('click', (e) => { e.stopPropagation(); this._runCheck(); });
    $('#imo-check-again').addEventListener('click', () => this._runCheck());
    $('#imo-check-stop').addEventListener('click', () => window.electronAPI.datasetHealth.stop());
    $('#imo-check-back').addEventListener('click', () => this._showSetup());
    $('#imo-check-list').addEventListener('click', (e) => this._onCheckClick(e));
    this._offCheckProgress = window.electronAPI.datasetHealth.onProgress((p) => this._onCheckProgress(p));
  }

  _showSetup() {
    if (this.checkBusy) return;
    this.container.querySelector('#imo-check').style.display = 'none';
    this.container.querySelector('#imo-workspace').style.display = 'none';
    this.container.querySelector('#imo-setup').style.display = '';
  }

  _setCheckBusy(busy, text = '') {
    const $ = (s) => this.container.querySelector(s);
    this.checkBusy = busy;
    $('#imo-check-progress').style.display = busy ? '' : 'none';
    $('#imo-check-stop').style.display = busy ? '' : 'none';
    $('#imo-check-again').disabled = busy;
    $('#imo-check-back').disabled = busy;
    $('#imo-check-list').querySelectorAll('button[data-fix]').forEach(b => { b.disabled = busy; });
    if (busy) {
      $('#imo-check-progress-text').textContent = text;
      $('#imo-check-progress-bar').style.width = '0%';
    }
  }

  _onCheckProgress({ phase, done, total, detail }) {
    if (!this.checkBusy) return;
    const $ = (s) => this.container.querySelector(s);
    const what = phase === 'scan' ? `Checking ${detail}` : phase === 'tag' ? `Tagging ${detail}` : detail;
    $('#imo-check-progress-text').textContent = `${what} (${Math.min(done + 1, total)} of ${total})`;
    $('#imo-check-progress-bar').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  }

  async _runCheck() {
    if (this.checkBusy) return;
    const $ = (s) => this.container.querySelector(s);
    $('#imo-setup').style.display = 'none';
    $('#imo-workspace').style.display = 'none';
    $('#imo-check').style.display = 'flex';
    $('#imo-check-summary').textContent = 'Checking your datasets...';
    $('#imo-check-list').innerHTML = '';
    this._setCheckBusy(true, 'Starting...');
    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Checking datasets', total: 0 });
    const result = await window.electronAPI.datasetHealth.scan({ minSide: Number($('#imo-check-minside').value) || 0 });
    this._setCheckBusy(false);
    if (!result.success) {
      process?.finish({ message: 'Failed', failed: true });
      $('#imo-check-summary').textContent = 'The check failed';
      this._showToast(result.message || 'The check failed', 'error');
      return;
    }
    this.check = result;
    const issues = this._issueCount();
    process?.finish({ message: issues ? `${issues} to look at` : 'All clear', warning: result.stopped });
    this._renderCheck();
  }

  /** Findings still open, across datasets (cross-dataset duplicates count once per group). */
  _issueCount() {
    if (!this.check) return 0;
    return this.check.datasets.reduce((n, ds) => n + Object.entries(ds.findings).reduce((m, [kind, files]) => m + (kind === 'cross-duplicate' ? 0 : files.length), 0), 0)
      + this.check.cross.length;
  }

  _renderCheck() {
    const $ = (s) => this.container.querySelector(s);
    const { datasets, kinds, cross, hydra, stopped } = this.check;
    const images = datasets.reduce((n, ds) => n + ds.images, 0);
    const issues = this._issueCount();
    $('#imo-check-summary').textContent = `${plural(datasets.length, 'dataset')}, ${plural(images, 'image')}: `
      + (issues ? `${plural(issues, 'thing')} to look at` : 'nothing to fix') + (stopped ? ' (stopped early)' : '');

    const sections = [];
    for (const [kind, info] of Object.entries(kinds)) {
      if (kind === 'cross-duplicate') continue;
      const rows = datasets.filter(ds => ds.findings[kind]?.length);
      if (!rows.length) continue;
      const total = rows.reduce((n, ds) => n + ds.findings[kind].length, 0);
      const fixLabel = info.fix === 'tag' && !hydra ? null : FIX_LABELS[info.fix];
      sections.push(`
        <section class="imo-check-group">
          <header class="imo-check-head">
            <div>
              <h3>${esc(info.title)} <span class="imo-check-count">${total.toLocaleString()} in ${plural(rows.length, 'dataset')}</span></h3>
              <p class="imo-check-note">${esc(KIND_NOTES[kind] || '')}${info.fix === 'tag' && !hydra ? ' Install Hydra in Settings > Models to tag them here.' : ''}</p>
            </div>
            ${fixLabel && rows.length > 1 ? `<button class="btn btn-sm btn-primary" data-fix="${kind}" data-all="1">${esc(fixLabel)}: all ${total.toLocaleString()}</button>` : ''}
          </header>
          ${rows.map(ds => this._checkRow(kind, ds, fixLabel)).join('')}
        </section>`);
    }
    if (cross.length) {
      sections.push(`
        <section class="imo-check-group">
          <header class="imo-check-head"><div>
            <h3>${esc(kinds['cross-duplicate'].title)} <span class="imo-check-count">${plural(cross.length, 'image')}</span></h3>
            <p class="imo-check-note">${esc(KIND_NOTES['cross-duplicate'])}</p>
          </div></header>
          ${cross.slice(0, 50).map(group => `
            <div class="imo-check-row"><div class="imo-check-files">${group.files.map(f => `<span title="${esc(f.file)}">${esc(f.dataset)} / ${esc(base(f.file))}</span>`).join('<span class="imo-check-sep">=</span>')}</div></div>`).join('')}
          ${cross.length > 50 ? `<p class="imo-check-note">And ${cross.length - 50} more.</p>` : ''}
        </section>`);
    }
    $('#imo-check-list').innerHTML = sections.length ? sections.join('')
      : '<div class="imo-empty"><i class="fas fa-check"></i><p>Every dataset looks fine.</p></div>';
  }

  _checkRow(kind, ds, fixLabel) {
    const files = ds.findings[kind];
    const shown = files.slice(0, PREVIEW_FILES).map(f => `<span title="${esc(f)}">${esc(base(f))}</span>`).join('');
    return `
      <div class="imo-check-row">
        <div class="imo-check-dataset">
          <span class="imo-check-name">${esc(ds.name)}</span>
          <span class="imo-check-type">${ds.type === 'character' ? 'character' : 'artist'}${ds.triggerTag && kind === 'missing-caption' ? `, captions start with "${esc(ds.triggerTag)}"` : ''}</span>
        </div>
        <div class="imo-check-files">${shown}${files.length > PREVIEW_FILES ? `<span class="imo-check-more">and ${files.length - PREVIEW_FILES} more</span>` : ''}</div>
        <div class="imo-check-actions">
          <span class="imo-check-n">${files.length}</span>
          <button class="btn btn-sm" data-open="${esc(ds.path)}" title="Open the dataset folder">Open</button>
          ${fixLabel ? `<button class="btn btn-sm" data-fix="${kind}" data-dataset="${esc(ds.path)}">${esc(fixLabel)}</button>` : ''}
        </div>
      </div>`;
  }

  async _onCheckClick(e) {
    const open = e.target.closest('[data-open]');
    if (open) {
      window.electronAPI.imageOrganizer.openFolder(open.dataset.open);
      return;
    }
    const button = e.target.closest('button[data-fix]');
    if (!button || this.checkBusy) return;
    const kind = button.dataset.fix;
    const targets = button.dataset.all
      ? this.check.datasets.filter(ds => ds.findings[kind]?.length)
      : this.check.datasets.filter(ds => ds.path === button.dataset.dataset);
    await this._fix(kind, targets);
  }

  /** Runs one kind's fix on some datasets, then takes the fixed files off the list. */
  async _fix(kind, targets) {
    const info = this.check.kinds[kind];
    const count = targets.reduce((n, ds) => n + ds.findings[kind].length, 0);
    if (info.fix === 'move' && count > 20
      && !confirm(`Move ${count} file${count === 1 ? '' : 's'} into ${targets.length === 1 ? 'the dataset\'s' : 'each dataset\'s'} bak/${info.bak} folder?`)) return;
    this._setCheckBusy(true, `${FIX_LABELS[info.fix]}...`);
    const process = window.app?.startProcess?.({ toolId: this.id, label: FIX_LABELS[info.fix], total: targets.length });
    let done = 0;
    let failed = 0;
    let stopped = false;
    for (let i = 0; i < targets.length && !stopped; i++) {
      const ds = targets[i];
      process?.update({ done: i, detail: ds.name });
      const files = ds.findings[kind];
      let result;
      if (info.fix === 'tag') result = await window.electronAPI.datasetHealth.tag(ds.path, files, { hidden: readHiddenTags() });
      else if (info.fix === 'move') result = await window.electronAPI.datasetHealth.move(ds.path, kind, files);
      else result = await window.electronAPI.datasetHealth.dedupe(ds.path, files);
      if (!result.success) {
        this._showToast(`${ds.name}: ${result.message}`, 'error');
        failed += files.length;
        continue;
      }
      stopped = Boolean(result.stopped);
      const failedFiles = new Set((result.failed || []).map(f => f.file));
      failed += failedFiles.size;
      done += result.tagged ?? result.moved ?? result.fixed ?? 0;
      // Fixed files leave the list; ones that failed (or were not reached) stay to try again.
      if (result.done) {
        const fixed = new Set(result.done);
        ds.findings[kind] = files.filter(f => !fixed.has(f));
        ds.findings['empty-caption'] = (ds.findings['empty-caption'] || []).filter(f => !fixed.has(f));
        ds.findings['missing-caption'] = (ds.findings['missing-caption'] || []).filter(f => !fixed.has(f));
      } else {
        ds.findings[kind] = files.filter(f => failedFiles.has(f));
      }
    }
    this._setCheckBusy(false);
    process?.finish({ message: `${done} fixed${failed ? `, ${failed} failed` : ''}`, warning: failed > 0 });
    this._showToast(`${FIX_LABELS[info.fix]}: ${done} done${failed ? `, ${failed} failed (still listed)` : ''}`, failed ? 'warning' : 'success');
    this._renderCheck();
  }
}
