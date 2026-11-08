// src/renderer/js/modules/tools/comic-panels/tagGrid.js - one tag across a folder
// Mixed into ComicPanelTool (see utils/mixMethods.js).
//
// Shows every panel still to check for one tag, a screen at a time, each with
// its current answer filled in. Clicking fixes the wrong ones and Confirm
// answers the whole screen, which also improves the guesses on the next one.

// Tile size and spacing, matching .cp-tile and .cp-grid-tiles in comic-panels.css.
const TILE_WIDTH = 170;
const TILE_HEIGHT = 182;
const TILE_GAP = 10;
const GRID_PADDING = { x: 32, y: 24 };
const TAGS_SHOWN = 300;

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

class ComicPanelTagGrid {
  _gridTemplate() {
    return `
      <div class="cp-grid-view" id="cp-grid" style="display:none">
        <div class="cp-grid-tags">
          <input class="form-input" id="cp-grid-search" placeholder="Find a tag" spellcheck="false">
          <div class="cp-grid-taglist" id="cp-grid-taglist"></div>
        </div>
        <div class="cp-grid-main">
          <div class="cp-editor-bar">
            <div class="cp-editor-info" id="cp-grid-info"></div>
            <div class="cp-editor-actions">
              <label class="cp-setting" title="Spread of scores: unsure panels from most to least likely, which settle the rest fastest. Unsure only: the panels review would ask about, in order">
                <span>Show</span>
                <select class="form-input" id="cp-grid-scope">
                  <option value="spread">Spread of scores</option>
                  <option value="all">All panels</option>
                  <option value="unsure">Unsure only</option>
                </select>
              </label>
              <button class="btn btn-sm" id="cp-grid-close" title="Back to the pages (Esc)">Back to Pages</button>
            </div>
          </div>
          <div class="cp-grid-tiles" id="cp-grid-tiles"></div>
          <div class="cp-grid-progress" id="cp-grid-progress"></div>
          <div class="cp-grid-actions">
            <span class="cp-grid-hint">Click a panel to change it. Right-click to leave it for later. Double-click to open it.</span>
            <button class="btn btn-sm" id="cp-grid-undo" title="Undo the last confirmed screen (U)" disabled>Undo Screen</button>
            <button class="btn btn-sm" id="cp-grid-all-on">All On</button>
            <button class="btn btn-sm" id="cp-grid-all-off">All Off</button>
            <button class="btn btn-sm btn-primary" id="cp-grid-confirm" title="Answer every panel on this screen (Enter)">Confirm Screen</button>
          </div>
        </div>
      </div>
    `;
  }

  _setupGridEvents() {
    this.$('#cp-grid-btn').addEventListener('click', () => this._openGrid());
    this.$('#cp-grid-close').addEventListener('click', () => this._closeGrid());
    this.$('#cp-grid-confirm').addEventListener('click', () => this._confirmGrid());
    this.$('#cp-grid-undo').addEventListener('click', () => this._undoGrid());
    this.$('#cp-grid-all-on').addEventListener('click', () => this._setAllTiles(true));
    this.$('#cp-grid-all-off').addEventListener('click', () => this._setAllTiles(false));
    this.$('#cp-grid-search').addEventListener('input', () => this._renderGridTags());
    this.$('#cp-grid-scope').addEventListener('change', (e) => {
      this.gridScope = e.target.value;
      this._renderGridTiles();
    });
    this.$('#cp-grid-taglist').addEventListener('click', (e) => {
      const row = e.target.closest('.cp-page-row');
      if (row) this._selectGridTag(row.dataset.tag);
    });

    const tiles = this.$('#cp-grid-tiles');
    const tileOf = (e) => this.gridTiles[Number(e.target.closest('.cp-tile')?.dataset.index)];
    tiles.addEventListener('click', (e) => {
      const tile = tileOf(e);
      if (tile) this._toggleTile(tile);
    });
    tiles.addEventListener('contextmenu', (e) => {
      const tile = tileOf(e);
      if (!tile) return;
      e.preventDefault();
      this.reviewSkipped.add(`${tile.key}|${this.gridTag}`);
      this._renderGridTiles();
    });
    tiles.addEventListener('dblclick', async (e) => {
      const tile = tileOf(e);
      if (!tile) return;
      this._closeGrid();
      await this._showPage(this.pages.indexOf(tile.page));
      this.selectedBox = tile.boxIndex;
      this._renderBoxes();
    });
  }

  _openGrid() {
    if (!this.pages[this.current] || !this._gridPanels().length) {
      this.showToast('Panels are still being tagged', 'warning');
      return;
    }
    this.gridOpen = true;
    this.$('.cp-body').style.display = 'none';
    this.$('#cp-grid').style.display = 'flex';
    this.gridUndo = null;
    this._renderGridTags();
    if (!this.gridSummary.some(item => item.tag === this.gridTag)) this._selectGridTag(this.gridSummary[0]?.tag);
    else this._renderGridTiles();
  }

  _closeGrid() {
    this.gridOpen = false;
    this.$('#cp-grid').style.display = 'none';
    this.$('.cp-body').style.display = '';
    this._renderPages();
    this._renderBoxes();
  }

  _gridPanels() {
    return this._folderPanels(this.pages[this.current]);
  }

  _gridQuestionsFor(panels) {
    const learning = this._learningFor(this.pages[this.current]);
    return (index) => window.PanelTagReview.panelQuestions(panels, index, learning,
      (i) => this._panelCharacters(panels[i].box, panels[i].page).clashes, this.reviewMemo);
  }

  _renderGridTags() {
    const list = this.$('#cp-grid-taglist');
    if (!list || !this.pages[this.current]) return;
    const panels = this._gridPanels();
    const learning = this._learningFor(this.pages[this.current]);
    this.gridSummary = window.PanelTagReview.tagSummary(panels, learning, this._gridQuestionsFor(panels));

    const search = this.$('#cp-grid-search').value.trim().toLowerCase().replace(/_/g, ' ');
    // General tags run to hundreds; without a search, only those worth a look.
    this._renderGridProgress();
    const shown = this.gridSummary
      .filter(item => (search ? item.tag.includes(search) : item.kind !== 'general' || item.unsure > 0))
      .slice(0, TAGS_SHOWN);
    const heading = { character: 'Characters', species: 'Species', general: 'General' };
    let kind = null;
    list.innerHTML = shown.map(item => {
      const head = item.kind === kind ? '' : `<div class="cp-tags-sub cp-grid-kind">${heading[item.kind]}</div>`;
      kind = item.kind;
      return `${head}<div class="cp-page-row${item.tag === this.gridTag ? ' active' : ''}" data-tag="${escapeHtml(item.tag)}">
        <div class="cp-page-name" title="${escapeHtml(item.tag)}">${escapeHtml(item.tag)}</div>
        <div class="cp-page-meta"><span>${item.open} to check</span><span>${item.unsure ? `${item.unsure} unsure` : ''}</span></div>
      </div>`;
    }).join('');
  }

  _unsureLeft() {
    return this.gridSummary.reduce((sum, item) => sum + item.unsure, 0);
  }

  /** How far through the folder's questions this is. */
  _renderGridProgress(settled = null) {
    const tags = this.gridSummary.filter(item => item.unsure > 0).length;
    const left = `${tags} tag${tags === 1 ? '' : 's'} and ${this._unsureLeft()} question${this._unsureLeft() === 1 ? '' : 's'} left.`;
    this.$('#cp-grid-progress').textContent = settled === null ? left
      : `That screen settled ${settled} question${settled === 1 ? '' : 's'}. ${this.settledTotal} this session. ${left}`;
  }

  _selectGridTag(tag) {
    this.gridTag = tag || null;
    const item = this.gridSummary?.find(entry => entry.tag === tag);
    this.gridScope = item?.kind === 'character' || !item?.unsure ? 'all' : 'spread';
    this.$('#cp-grid-scope').value = this.gridScope;
    this._renderGridTags();
    this._renderGridTiles();
  }

  /**
   * Confirm answers a whole screen, so a screen is only what fits without
   * scrolling: no panel gets an answer without being seen.
   */
  _gridScreenSize() {
    const { clientWidth, clientHeight } = this.$('#cp-grid-tiles');
    const fit = (space, tile) => Math.max(1, Math.floor((space + TILE_GAP) / (tile + TILE_GAP)));
    return fit(clientWidth - GRID_PADDING.x, TILE_WIDTH) * fit(clientHeight - GRID_PADDING.y, TILE_HEIGHT);
  }

  _renderGridTiles() {
    const panels = this._gridPanels();
    const screen = this._gridScreenSize();
    const list = this.gridTag ? window.PanelTagReview.tagPanels(panels, this.gridTag, this._learningFor(this.pages[this.current]), {
      unsureOnly: this.gridScope !== 'all',
      questionsFor: this._gridQuestionsFor(panels),
      skipped: this._skippedIn(panels)
    }) : [];
    const picked = this.gridScope === 'spread' ? window.PanelTagReview.spreadPanels(list, screen) : list.slice(0, screen);
    this.gridTiles = picked.map(item => ({ ...panels[item.index], on: item.present, was: item.present }));

    const on = this.gridTiles.filter(tile => tile.on).length;
    this.$('#cp-grid-info').innerHTML = this.gridTag
      ? `<span class="cp-editor-name">${escapeHtml(this.gridTag)}</span><span>${this.gridTiles.length} of ${list.length} left, ${on} on this screen have it</span>`
      : '<span>Choose a tag</span>';
    this.$('#cp-grid-tiles').innerHTML = this.gridTiles.length
      ? this.gridTiles.map((tile, i) => this._tileHtml(tile, i)).join('')
      : `<p class="cp-tags-note">${this.gridTag ? 'Nothing left to check for this tag here.' : ''}</p>`;
    this.$('#cp-grid-undo').disabled = !this.gridUndo;

    this._loadThumbs(this.gridTiles);
    this._loadThumbs(list.filter(item => !picked.includes(item)).slice(0, screen).map(item => panels[item.index]));
    this._updateConfirm();
  }

  /** A screen can't be confirmed until all of it can be seen. */
  _screenReady() {
    return this.gridTiles.length > 0 && !this.gridTiles.some(tile => this.thumbs.get(tile.key) === null);
  }

  _updateConfirm() {
    this.$('#cp-grid-confirm').disabled = !this._screenReady();
  }

  _tileHtml(tile, i) {
    const url = this.thumbs.get(tile.key);
    const classes = ['cp-tile', tile.on ? 'cp-tile-on' : 'cp-tile-off'];
    if (tile.on !== tile.was) classes.push('cp-tile-changed');
    return `<button class="${classes.join(' ')}" data-index="${i}" title="${escapeHtml(`${tile.page.name}, panel ${tile.boxIndex + 1}`)}">
      <span class="cp-tile-image">${typeof url === 'string' ? `<img src="${url}" alt="" draggable="false">` : ''}</span>
      <span class="cp-tile-label">${i < 9 ? `<span class="cp-tag-key">${i + 1}</span>` : ''}${tile.on ? 'Has it' : 'Not in it'}</span>
    </button>`;
  }

  _rerenderTile(tile) {
    const i = this.gridTiles.indexOf(tile);
    const el = this.$(`.cp-tile[data-index="${i}"]`);
    if (i >= 0 && el) el.outerHTML = this._tileHtml(tile, i);
  }

  /** Crops are made a page at a time, the first time each panel is shown. */
  async _loadThumbs(panels) {
    const byPage = new Map();
    for (const panel of panels) {
      if (this.thumbs.has(panel.key)) continue;
      this.thumbs.set(panel.key, null);
      if (!byPage.has(panel.page)) byPage.set(panel.page, []);
      byPage.get(panel.page).push(panel);
    }
    for (const [page, list] of byPage) {
      try {
        const result = await window.electronAPI.comicPanels.panelThumbs(page.filePath, list.map(({ box }) => box));
        if (!result.success) throw new Error(result.message);
        list.forEach((panel, i) => {
          if (!result.thumbs[i]) return;
          this.thumbs.set(panel.key, URL.createObjectURL(new Blob([new Uint8Array(result.thumbs[i])], { type: 'image/jpeg' })));
          const tile = this.gridTiles.find(item => item.key === panel.key);
          if (tile) this._rerenderTile(tile);
        });
      } catch (error) {
        console.error(`Panel thumbnails failed for ${page.name}:`, error);
      }
      // One that could not be made mustn't hold the screen up for good.
      list.forEach(panel => {
        if (this.thumbs.get(panel.key) === null) this.thumbs.delete(panel.key);
      });
      if (this.gridOpen) this._updateConfirm();
    }
  }

  /** Crops for every tagged panel, so a screen spread over many pages opens at once. */
  async _preloadThumbs(run) {
    for (const page of this.pages) {
      if (run !== this.tagRun) return;
      await this._loadThumbs(this._folderPanels(page).filter(panel => panel.page === page));
    }
  }

  _toggleTile(tile) {
    tile.on = !tile.on;
    this._rerenderTile(tile);
  }

  _setAllTiles(on) {
    this.gridTiles.forEach(tile => {
      tile.on = on;
      this._rerenderTile(tile);
    });
  }

  _confirmGrid() {
    const tiles = this.gridTiles;
    if (!this._screenReady()) return;
    const tag = this.gridTag;
    const learning = this._learningFor(this.pages[this.current]);
    const unsureBefore = this._unsureLeft();
    this.gridUndo = {
      tag,
      learned: { keep: learning.keep[tag], add: learning.add[tag], examples: learning.examples[tag] },
      unsureBefore,
      boxes: tiles.map(({ box, page }) => ({ box, page, edits: box.tagEdits && JSON.parse(JSON.stringify(box.tagEdits)) }))
    };
    for (const tile of tiles) {
      const panel = { facts: tile.facts, edits: tile.box.tagEdits, key: tile.key };
      window.PanelTagReview.answer(learning, panel, tag, tile.on);
      tile.box.tagEdits = panel.edits;
    }
    this._afterGridChange(tag, tiles);
    const settled = Math.max(0, unsureBefore - this._unsureLeft());
    this.settledTotal += settled;
    this.gridUndo.settled = settled;
    this._renderGridProgress(settled);
  }

  _undoGrid() {
    const undo = this.gridUndo;
    if (!undo) return;
    const learning = this._learningFor(this.pages[this.current]);
    for (const part of ['keep', 'add', 'examples']) {
      if (undo.learned[part] === undefined) delete learning[part][undo.tag];
      else learning[part][undo.tag] = undo.learned[part];
    }
    undo.boxes.forEach(({ box, edits }) => { box.tagEdits = edits; });
    this.gridUndo = null;
    this.gridTag = undo.tag;
    this.settledTotal -= undo.settled || 0;
    this._afterGridChange(undo.tag, undo.boxes);
  }

  /** Save and refresh after a whole screen of answers changed. */
  _afterGridChange(tag, touched) {
    const panels = this._gridPanels();
    this._learningFor(this.pages[this.current]).ranges = window.PanelTagReview.scoreRanges(panels);
    window.PanelTagReview.forgetTag(this.reviewMemo, panels, tag);
    touched.forEach(({ box, page }) => this.reviewMemo.delete(this._panelKey(page, box)));
    this.learnVersion++;
    for (const page of new Set(touched.map(item => item.page))) {
      page.status = 'edited';
      page.tagsChanged = true;
      this._scheduleSave(page);
    }
    this._saveLearning(this.pages[this.current]);
    this._renderPages();
    this._renderGridTags();
    this._renderGridTiles();
    // Finished with this tag: on to the next one that needs a look.
    if (!this.gridTiles.length && this.gridScope !== 'unsure') {
      const next = this.gridSummary.find(item => item.tag !== tag && (item.kind === 'character' || item.unsure > 0));
      if (next) this._selectGridTag(next.tag);
    }
  }

  _onGridKey(e) {
    const key = e.key.toLowerCase();
    if (e.key === 'Enter') {
      e.preventDefault();
      this._confirmGrid();
    } else if (e.key === 'Escape' || key === 'g') {
      e.preventDefault();
      this._closeGrid();
    } else if (key === 'u') {
      e.preventDefault();
      this._undoGrid();
    } else if (/^[1-9]$/.test(key) && this.gridTiles[Number(key) - 1]) {
      e.preventDefault();
      this._toggleTile(this.gridTiles[Number(key) - 1]);
    }
  }
}

export default ComicPanelTagGrid;
