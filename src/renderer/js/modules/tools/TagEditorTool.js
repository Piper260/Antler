import { countTokens } from '../../utils/tokenCounter.js';
import TagEditorCaptions from './tag-editor/captions.js';

// Captions longer than this are flagged; it is the usual CLIP budget for
// LoRA training (3 x 75 tokens).
const TOKEN_LIMIT = 225;
// Images whose longest edge is below this are flagged as upscale candidates
// (same threshold the Image Upscaler uses).
const UPSCALE_TARGET_EDGE = 2048;

const FILTERS = {
  all: () => true,
  overlimit: (file) => file.tokens > TOKEN_LIMIT,
  lowres: (file) => file.needsUpscale,
  unsaved: (file) => file.modified,
  untagged: (file) => file.tags.length === 0,
  doubtful: (file) => file.hydraDoubts > 0
};

// A tag Hydra scores below this is counted as doubtful on the grid (the
// same line the editor's check uses).
const DOUBTFUL_BELOW = 0.2;
// The two kinds of batch, with their starting threshold and categories.
const BATCH_MODES = {
  add: { threshold: 0.85, min: 0.5, max: 0.99, label: 'Add tags scoring at least', categories: ['general', 'species'] },
  remove: { threshold: 0.05, min: 0.01, max: 0.5, label: 'Remove tags scoring below', categories: ['general', 'species'] }
};

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sameTags(a, b) {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/** Removes case-insensitive duplicates, keeping the first occurrence. */
function dedupeTags(tags) {
  const seen = new Set();
  return tags.filter(tag => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Tags the Hydra check never suggests, shared by every dataset.
const HIDDEN_SUGGESTIONS_KEY = 'tagEditor.hydraHiddenTags';
const normalizeHiddenTag = (tag) => String(tag).trim().toLowerCase().replace(/_/g, ' ');

// Grid card sizes (smallest column width), remembered between sessions.
const CARD_SIZES = { small: 120, medium: 168, large: 240 };
const CARD_SIZE_KEY = 'tagEditor.cardSize';

function plural(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

class TagEditorTool extends BaseTool {
  constructor() {
    super({
      name: 'Tag Editor',
      id: 'tag-editor',
      icon: 'fas fa-tags',
      description: 'Edit caption tags for LoRA training datasets',
      version: '3.0.0',
      category: 'LORA Tools'
    });

    this.datasets = [];
    this.searchMode = 'artist'; // 'artist' | 'character'
    this.dataset = null;

    // One entry per image. `tags` is the working copy, `saved` is what is on
    // disk; `modified`, `tokens` and `needsUpscale` are derived from them.
    this.files = [];
    this.filter = 'all';
    this.tagQuery = '';

    this.protectedTags = new Set();
    // Grid thumbnails: cached JPEG URL by image URL, and the observer that
    // asks for them as cards come near the visible part of the grid.
    this.thumbs = new Map();
    this.thumbObserver = null;
    this.editor = null; // { file, tags } while the editor modal is open
    // Hydra tag check. Once used, every file opened in the editor is checked.
    // review: { imagePath, scores, suggestions, doubtfulBelow } for the open file;
    // heatmap: { tag, loading } or { tag, values, grid: { rows, cols } }.
    // hidden: tags never to suggest, in tag-file form and lower case, for every dataset.
    this.hydra = { available: false, auto: false, review: null, heatmap: null, busy: false, request: 0, hidden: new Set() };
    // "Tag with Hydra" over many files. results: Hydra's suggestions per file
    // (scanned once, re-planned on every threshold change); undo: what the
    // last Apply added, per file.
    this.batch = this.newBatch(0);
    this.globalView = { query: '', sort: 'frequency-desc' };
    this.dialogResolve = null;
    this.el = {};
  }

  // ---------------------------------------------------------------- template

  getTemplate() {
    return `
      <div class="tool-container te-tool">
        <div class="te-bar">
          <div class="search-mode-container">
            <span class="mode-label active" id="te-label-artist">Artist</span>
            <label class="toggle-switch" title="Switch between artist and character datasets">
              <input type="checkbox" id="te-mode-toggle">
              <span class="slider"></span>
            </label>
            <span class="mode-label" id="te-label-character">Character</span>
          </div>
          <select class="form-select te-dataset-select" id="te-dataset-select" aria-label="Dataset">
            <option value="">Select artist...</option>
          </select>
        </div>

        <div class="te-main" id="te-main" hidden>
          <div class="toolbar te-toolbar">
            <span class="te-dataset-name" id="te-dataset-name"></span>
            <span class="toolbar-text" id="te-summary"></span>
            <span class="toolbar-spacer"></span>
            <input type="search" class="form-input te-tag-filter" id="te-tag-filter" placeholder="Files containing tag..." aria-label="Filter files by tag">
            <select class="form-select te-size" id="te-size" aria-label="Thumbnail size" title="Thumbnail size">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
            <select class="form-select te-filter" id="te-filter" aria-label="Filter files">
              <option value="all">All files</option>
              <option value="overlimit">Over ${TOKEN_LIMIT} tokens</option>
              <option value="lowres">Below ${UPSCALE_TARGET_EDGE}px</option>
              <option value="untagged">No tags</option>
              <option value="unsaved">Unsaved changes</option>
              <option value="doubtful">Hydra doubts a tag</option>
            </select>
            <button class="btn" id="te-all-tags" title="View, rename and delete tags across the whole dataset">All Tags</button>
            <button class="btn" id="te-batch-open" hidden title="Run Hydra over many files and add the tags it is confident about">Tag with Hydra</button>
            <button class="btn" id="te-caption-open" title="Write natural-language captions with a vision model in Ollama">Caption with AI</button>
            <button class="btn btn-primary" id="te-save-all" disabled>Save All</button>
          </div>
          <div class="te-grid" id="te-grid"></div>
          <div class="empty-state" id="te-grid-empty" hidden>
            <p>No files match the current filter.</p>
          </div>
        </div>

        <div class="empty-state" id="te-placeholder">
          <p>Select a dataset to edit its tags.</p>
        </div>
        <div class="loading-state" id="te-loading" hidden>
          <div class="loading-spinner"></div>
          <p>Loading files...</p>
        </div>
        <div class="error-state" id="te-error" hidden>
          <h4>Could not load this dataset</h4>
          <p id="te-error-message"></p>
        </div>

        <!-- File editor -->
        <div class="modal-overlay" id="te-editor" hidden>
          <div class="modal-content te-editor">
            <div class="modal-header">
              <h3 id="te-editor-title"></h3>
              <div class="te-editor-nav">
                <span class="toolbar-text" id="te-editor-position"></span>
                <button class="btn-icon" id="te-prev" title="Previous file (Alt+Left)"><i class="fas fa-chevron-left"></i></button>
                <button class="btn-icon" id="te-next" title="Next file (Alt+Right)"><i class="fas fa-chevron-right"></i></button>
                <button class="modal-close" id="te-editor-close" title="Close (Esc)">&times;</button>
              </div>
            </div>
            <div class="te-editor-body">
              <div class="te-editor-image" id="te-editor-image">
                <img id="te-editor-img" alt="">
                <canvas class="te-heatmap" id="te-heatmap" hidden></canvas>
              </div>
              <div class="te-editor-side">
                <div class="te-editor-stats">
                  <span id="te-editor-count"></span>
                  <span id="te-editor-tokens"></span>
                  <span id="te-editor-dims"></span>
                </div>
                <div class="te-editor-add">
                  <input type="text" class="form-input" id="te-tag-input" placeholder="Add tags, separated by commas" autocomplete="off">
                  <button class="btn" id="te-tag-add">Add</button>
                </div>
                <div class="te-tags" id="te-tags"></div>
                <div class="te-hydra" id="te-hydra-panel" hidden>
                  <div class="te-hydra-head">
                    <span class="toolbar-text" id="te-hydra-status"></span>
                    <span class="toolbar-spacer"></span>
                    <button class="btn btn-sm" id="te-hydra-hidden" title="Tags Hydra will never suggest, in any dataset">Hidden tags</button>
                    <button class="btn btn-sm" id="te-heatmap-clear" hidden>Hide heatmap</button>
                  </div>
                  <div class="te-hydra-heatmap-note" id="te-heatmap-label" hidden></div>
                  <div class="te-tags te-hydra-suggest" id="te-hydra-suggest"></div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn" id="te-suggest" title="List rarely used and costly tags that could be removed">Suggest Removals</button>
              <button class="btn" id="te-hydra" hidden title="Score this image's tags with the Hydra tagger and list confident tags it is missing. Once used, every file you open is checked.">Check with Hydra</button>
              <button class="btn" id="te-dedupe">Remove Duplicates</button>
              <span class="toolbar-spacer"></span>
              <button class="btn" id="te-editor-cancel">Cancel</button>
              <button class="btn btn-primary" id="te-editor-save" title="Save this file (Ctrl+S)">Save</button>
            </div>
          </div>
        </div>

        <!-- Dataset-wide tag list -->
        <div class="modal-overlay" id="te-global" hidden>
          <div class="modal-content te-global">
            <div class="modal-header">
              <h3 id="te-global-title">All Tags</h3>
              <button class="modal-close" id="te-global-close" title="Close (Esc)">&times;</button>
            </div>
            <div class="toolbar te-global-toolbar">
              <input type="search" class="form-input te-global-search" id="te-global-search" placeholder="Search tags..." aria-label="Search tags">
              <span class="toolbar-text" id="te-global-counts"></span>
              <span class="toolbar-spacer"></span>
              <select class="form-select te-global-sort" id="te-global-sort" aria-label="Sort tags">
                <option value="frequency-desc">Most used</option>
                <option value="frequency-asc">Least used</option>
                <option value="name-asc">A to Z</option>
                <option value="name-desc">Z to A</option>
                <option value="hydra-doubted">Most doubted by Hydra</option>
                <option value="hydra-low">Lowest Hydra score</option>
              </select>
              <button class="btn" id="te-global-rank" hidden title="Scan the files with Hydra to see how well it agrees with each tag">Rank with Hydra</button>
              <button class="btn" id="te-dedupe-all" title="Remove duplicate tags from every file">Remove Duplicates</button>
              <button class="btn" id="te-global-add">Add Tag to All</button>
              <button class="btn" id="te-global-export">Export CSV</button>
            </div>
            <div class="te-global-list">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th class="num">Files</th>
                    <th>Coverage</th>
                    <th class="te-col-hydra" title="Hydra's average score for the tag over the scanned files that have it, and how many of those it doubts">Hydra</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="te-global-rows"></tbody>
              </table>
            </div>
            <div class="modal-footer">
              <span class="toolbar-text">Changes here stay unsaved until you choose Save All.</span>
              <span class="toolbar-spacer"></span>
              <button class="btn" id="te-global-done">Close</button>
              <button class="btn btn-primary" id="te-global-save" disabled>Save All</button>
            </div>
          </div>
        </div>

        <!-- Removal suggestions for the file being edited -->
        <div class="modal-overlay" id="te-suggestions" hidden>
          <div class="modal-content te-suggestions">
            <div class="modal-header">
              <h3>Suggested Removals</h3>
              <button class="modal-close" id="te-suggestions-close" title="Close (Esc)">&times;</button>
            </div>
            <div class="te-suggestions-summary" id="te-suggestions-summary"></div>
            <div class="te-suggestions-list">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th class="num">Tokens</th>
                    <th class="num">Files</th>
                    <th>Why</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="te-suggestions-rows"></tbody>
              </table>
            </div>
            <div class="modal-footer">
              <span class="toolbar-text">Protected tags are never suggested.</span>
              <span class="toolbar-spacer"></span>
              <button class="btn" id="te-suggestions-done">Done</button>
            </div>
          </div>
        </div>

        <!-- Hydra over many files -->
        <div class="modal-overlay" id="te-batch" hidden>
          <div class="modal-content te-batch">
            <div class="modal-header">
              <h3>Tag with Hydra</h3>
              <button class="modal-close" id="te-batch-close" title="Close (Esc)">&times;</button>
            </div>
            <div class="toolbar te-batch-toolbar">
              <select class="form-select" id="te-batch-scope" aria-label="Files to scan"></select>
              <button class="btn btn-primary" id="te-batch-scan">Scan</button>
              <button class="btn" id="te-batch-stop" hidden>Stop</button>
              <span class="toolbar-text" id="te-batch-progress"></span>
            </div>
            <div class="te-batch-options">
              <select class="form-select te-batch-mode" id="te-batch-mode" aria-label="What to do">
                <option value="add">Add missing tags</option>
                <option value="remove">Remove doubtful tags</option>
              </select>
              <label class="te-batch-threshold"><span id="te-batch-threshold-label">Add tags scoring at least</span>
                <input type="number" class="form-input" id="te-batch-threshold" min="0.5" max="0.99" step="0.01" value="0.85">
              </label>
              <span class="te-batch-categories" id="te-batch-categories">
                <label><input type="checkbox" value="general" checked> General</label>
                <label><input type="checkbox" value="species" checked> Species</label>
                <label><input type="checkbox" value="character"> Character</label>
                <label><input type="checkbox" value="meta"> Meta</label>
                <label><input type="checkbox" value="copyright"> Copyright</label>
                <label><input type="checkbox" value="lore"> Lore</label>
              </span>
            </div>
            <div class="te-batch-summary" id="te-batch-summary"></div>
            <div class="te-batch-list">
              <table class="data-table">
                <thead id="te-batch-head"></thead>
                <tbody id="te-batch-rows"></tbody>
              </table>
            </div>
            <div class="modal-footer">
              <span class="toolbar-text" id="te-batch-note"></span>
              <span class="toolbar-spacer"></span>
              <button class="btn" id="te-batch-undo" hidden>Undo Last Apply</button>
              <button class="btn" id="te-batch-done">Close</button>
              <button class="btn btn-primary" id="te-batch-apply" disabled>Apply</button>
            </div>
          </div>
        </div>

        <!-- Shared confirm / prompt / list dialog -->
        <div class="modal-overlay" id="te-dialog" hidden>
          <div class="modal-content te-dialog">
            <div class="modal-header">
              <h3 id="te-dialog-title"></h3>
            </div>
            <div class="modal-body">
              <p id="te-dialog-message"></p>
              <input type="text" class="form-input te-dialog-input" id="te-dialog-input" hidden>
              <pre class="te-dialog-list" id="te-dialog-list" hidden></pre>
            </div>
            <div class="modal-footer">
              <button class="btn" id="te-dialog-cancel">Cancel</button>
              <button class="btn btn-primary" id="te-dialog-ok">OK</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------- setup

  async initialize(container) {
    this.setRoot(container);
    container.innerHTML = this.getTemplate();

    const ids = [
      'te-mode-toggle', 'te-label-artist', 'te-label-character', 'te-dataset-select',
      'te-main', 'te-dataset-name', 'te-summary', 'te-tag-filter', 'te-filter',
      'te-all-tags', 'te-dedupe-all', 'te-save-all', 'te-grid', 'te-grid-empty',
      'te-placeholder', 'te-loading', 'te-error', 'te-error-message',
      'te-editor', 'te-editor-title', 'te-editor-position', 'te-prev', 'te-next',
      'te-editor-close', 'te-editor-img', 'te-editor-count', 'te-editor-tokens',
      'te-editor-dims', 'te-tag-input', 'te-tag-add', 'te-tags', 'te-suggest',
      'te-dedupe', 'te-editor-cancel', 'te-editor-save',
      'te-editor-image', 'te-heatmap', 'te-hydra-panel', 'te-hydra-status', 'te-heatmap-clear',
      'te-heatmap-label', 'te-hydra-suggest', 'te-hydra', 'te-hydra-hidden',
      'te-global', 'te-global-title', 'te-global-close', 'te-global-search',
      'te-global-counts', 'te-global-sort', 'te-global-add', 'te-global-export', 'te-global-rank',
      'te-global-rows', 'te-global-done', 'te-global-save',
      'te-suggestions', 'te-suggestions-close', 'te-suggestions-summary',
      'te-suggestions-rows', 'te-suggestions-done',
      'te-dialog', 'te-dialog-title', 'te-dialog-message', 'te-dialog-input',
      'te-dialog-list', 'te-dialog-cancel', 'te-dialog-ok',
      'te-size',
      'te-batch-open', 'te-batch', 'te-batch-close', 'te-batch-scope', 'te-batch-scan', 'te-batch-stop',
      'te-batch-progress', 'te-batch-threshold', 'te-batch-categories', 'te-batch-summary', 'te-batch-rows',
      'te-batch-mode', 'te-batch-threshold-label', 'te-batch-head', 'te-batch-note',
      'te-batch-undo', 'te-batch-done', 'te-batch-apply',
      'te-caption-open'
    ];
    this.el = {};
    ids.forEach(id => {
      const key = id.replace(/^te-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.el[key] = container.querySelector(`#${id}`);
    });

    this.setupEvents();
    this.setCardSize(this.storedCardSize(), { save: false });
    await Promise.all([this.loadDatasets(), this.checkHydra()]);
  }

  setupEvents() {
    const el = this.el;

    this.on(el.modeToggle, 'change', () => this.onModeToggle());
    this.on(el.datasetSelect, 'change', () => this.onDatasetSelect());

    this.on(el.filter, 'change', () => {
      this.filter = el.filter.value;
      if (this.filter !== 'doubt-tag') this.clearDoubtTag();
      this.renderGrid();
    });
    this.on(el.tagFilter, 'input', () => {
      this.tagQuery = el.tagFilter.value.trim().toLowerCase();
      this.renderGrid();
    });
    this.on(el.allTags, 'click', () => this.openGlobal());
    this.on(el.size, 'change', () => this.setCardSize(el.size.value));
    this.on(el.dedupeAll, 'click', () => this.removeAllDuplicates());
    this.on(el.saveAll, 'click', () => this.saveAll());

    this.on(el.grid, 'click', (event) => {
      const card = event.target.closest('.te-card');
      if (card) this.openEditor(this.files[Number(card.dataset.index)]);
    });

    // Editor
    this.on(el.editorClose, 'click', () => this.closeEditor());
    this.on(el.editorCancel, 'click', () => this.closeEditor());
    this.on(el.editorSave, 'click', () => this.saveEditor());
    this.on(el.prev, 'click', () => this.stepEditor(-1));
    this.on(el.next, 'click', () => this.stepEditor(1));
    this.on(el.tagAdd, 'click', () => this.addEditorTags());
    this.on(el.tagInput, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.addEditorTags();
      }
    });
    this.on(el.dedupe, 'click', () => this.dedupeEditor());
    this.on(el.suggest, 'click', () => this.openSuggestions());
    this.on(el.tags, 'click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || !this.editor) return;
      const index = Number(button.closest('.te-tag').dataset.index);
      if (button.dataset.action === 'remove') {
        this.editor.tags.splice(index, 1);
        this.renderEditor();
        this.refreshHydraScores();
      } else if (button.dataset.action === 'protect') {
        this.toggleProtected(this.editor.tags[index]);
      } else if (button.dataset.action === 'heatmap') {
        this.showHeatmap(this.editor.tags[index]);
      }
    });
    this.on(el.hydra, 'click', () => {
      this.hydra.auto = true;
      this.runHydra();
    });
    this.on(el.heatmapClear, 'click', () => this.clearHeatmap());
    this.on(el.hydraSuggest, 'click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || !this.editor || !this.hydra.review) return;
      const tag = button.closest('.te-tag').dataset.tag;
      if (button.dataset.action === 'add') {
        if (!this.editor.tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) this.editor.tags.push(tag);
        this.renderEditor();
        this.refreshHydraScores();
      } else if (button.dataset.action === 'heatmap') {
        this.showHeatmap(tag);
      } else if (button.dataset.action === 'hide') {
        this.hideSuggestion(tag);
      }
    });
    this.on(el.hydraHidden, 'click', () => this.editHiddenSuggestions());

    // Caption with AI
    this.on(el.captionOpen, 'click', () => this.openCaptions());

    // Tag with Hydra
    this.on(el.batchOpen, 'click', () => this.openBatch());
    this.on(el.batchClose, 'click', () => this.closeBatch());
    this.on(el.batchDone, 'click', () => this.closeBatch());
    this.on(el.batchScan, 'click', () => this.scanBatch());
    this.on(el.batchStop, 'click', () => this.stopBatch());
    this.on(el.batchApply, 'click', () => this.applyBatch());
    this.on(el.batchUndo, 'click', () => this.undoBatch());
    this.on(el.batchMode, 'change', () => this.setBatchMode(el.batchMode.value));
    this.on(el.batchThreshold, 'input', () => {
      this.batchModeState().threshold = Number(el.batchThreshold.value);
      this.renderBatch();
    });
    this.on(el.batchCategories, 'change', () => {
      this.batchModeState().categories = new Set([...el.batchCategories.querySelectorAll('input:checked')].map(box => box.value));
      this.renderBatch();
    });
    this.on(el.batchRows, 'change', (event) => {
      const box = event.target.closest('input[type="checkbox"]');
      if (!box) return;
      const key = window.HydraBatch.normalize(box.closest('tr').dataset.tag);
      const { excluded } = this.batchModeState();
      if (box.checked) excluded.delete(key);
      else excluded.add(key);
      this.renderBatch();
    });
    this.on(el.editorImg, 'load', () => this.drawHeatmap());
    this.on(window, 'resize', () => this.drawHeatmap());

    // All tags
    this.on(el.globalClose, 'click', () => this.closeGlobal());
    this.on(el.globalDone, 'click', () => this.closeGlobal());
    this.on(el.globalSave, 'click', () => this.saveAll());
    this.on(el.globalSearch, 'input', () => {
      this.globalView.query = el.globalSearch.value.trim().toLowerCase();
      this.renderGlobal();
    });
    this.on(el.globalSort, 'change', () => {
      this.globalView.sort = el.globalSort.value;
      this.renderGlobal();
    });
    this.on(el.globalAdd, 'click', () => this.addTagToAll());
    this.on(el.globalRank, 'click', () => {
      this.closeGlobal();
      this.openBatch();
    });
    this.on(el.globalExport, 'click', () => this.exportTags());
    this.on(el.globalRows, 'click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const tag = button.closest('tr').dataset.tag;
      if (button.dataset.action === 'rename') this.renameTag(tag);
      else if (button.dataset.action === 'delete') this.deleteTag(tag);
      else if (button.dataset.action === 'files') this.showTagFiles(tag);
      else if (button.dataset.action === 'front') this.moveTagToFront(tag);
      else if (button.dataset.action === 'doubted') this.showDoubted(tag);
    });

    // Suggestions
    this.on(el.suggestionsClose, 'click', () => this.closeSuggestions());
    this.on(el.suggestionsDone, 'click', () => this.closeSuggestions());
    this.on(el.suggestionsRows, 'click', (event) => {
      const button = event.target.closest('button[data-action="remove"]');
      if (!button || !this.editor) return;
      const tag = button.closest('tr').dataset.tag;
      this.editor.tags = this.editor.tags.filter(t => t !== tag);
      this.renderEditor();
      this.renderSuggestions();
    });

    // Dialog
    this.on(el.dialogCancel, 'click', () => this.closeDialog(null));
    this.on(el.dialogOk, 'click', () => this.confirmDialog());
    this.on(el.dialogInput, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.confirmDialog();
      }
    });

    // Clicking the dimmed backdrop closes that modal.
    [[el.editor, () => this.closeEditor()],
      [el.global, () => this.closeGlobal()],
      [el.suggestions, () => this.closeSuggestions()],
      [el.dialog, () => this.closeDialog(null)],
      [el.batch, () => this.closeBatch()]
    ].forEach(([overlay, close]) => {
      this.on(overlay, 'mousedown', (event) => {
        if (event.target === overlay) close();
      });
    });

    this.onDocument('keydown', (event) => this.onKeyDown(event));
  }

  onKeyDown(event) {
    const el = this.el;

    if (event.key === 'Escape') {
      // Close only the topmost open layer.
      if (!el.dialog.hidden) this.closeDialog(null);
      else if (!el.batch.hidden) this.closeBatch();
      else if (!el.suggestions.hidden) this.closeSuggestions();
      else if (!el.editor.hidden) this.closeEditor();
      else if (!el.global.hidden) this.closeGlobal();
      else return;
      event.preventDefault();
      return;
    }

    const editorOnTop = !el.editor.hidden && el.dialog.hidden && el.suggestions.hidden;
    if (!editorOnTop) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveEditor();
    } else if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      this.stepEditor(-1);
    } else if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      this.stepEditor(1);
    }
  }

  // ---------------------------------------------------------------- datasets

  async loadDatasets() {
    try {
      const result = await window.electronAPI.tagEditor.getAvailableArtists();
      if (!result.success) throw new Error(result.error || result.message);
      this.datasets = result.artists || [];
      this.populateDatasets();
    } catch (error) {
      console.error('Failed to load datasets:', error);
      this.showToast('Could not list downloaded datasets', 'error');
    }
  }

  populateDatasets() {
    const entries = this.datasets
      .filter(entry => entry.type === this.searchMode)
      .sort((a, b) => (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '', undefined, { sensitivity: 'base' }));

    const options = entries.map(entry => {
      const name = entry.displayName || entry.name;
      return `<option value="${escapeHtml(entry.id)}">${escapeHtml(name)} (${plural(entry.fileCount || 0, 'file')})</option>`;
    }).join('');

    this.el.datasetSelect.innerHTML = `<option value="">Select ${this.searchMode}...</option>${options}`;
    if (this.dataset) this.el.datasetSelect.value = this.dataset.id;
  }

  async onModeToggle() {
    const el = this.el;
    const nextMode = el.modeToggle.checked ? 'character' : 'artist';
    if (!(await this.confirmDiscard())) {
      el.modeToggle.checked = this.searchMode === 'character';
      return;
    }

    this.searchMode = nextMode;
    el.labelArtist.classList.toggle('active', nextMode === 'artist');
    el.labelCharacter.classList.toggle('active', nextMode === 'character');

    this.dataset = null;
    this.files = [];
    this.populateDatasets();
    this.showView('placeholder');
  }

  async onDatasetSelect() {
    const el = this.el;
    const id = el.datasetSelect.value;
    if (id === (this.dataset?.id || '')) return;

    if (!(await this.confirmDiscard())) {
      el.datasetSelect.value = this.dataset?.id || '';
      return;
    }

    const dataset = this.datasets.find(entry => entry.id === id);
    if (!dataset) {
      this.dataset = null;
      this.files = [];
      this.showView('placeholder');
      return;
    }
    await this.loadDataset(dataset);
  }

  /** Asks before throwing away unsaved edits. Resolves true if it is safe to continue. */
  async confirmDiscard() {
    const unsaved = this.files.filter(file => file.modified).length;
    if (unsaved === 0) return true;
    return Boolean(await this.openDialog({
      title: 'Discard unsaved changes?',
      message: `${plural(unsaved, 'file')} in this dataset ${unsaved === 1 ? 'has' : 'have'} unsaved tag changes that will be lost.`,
      okLabel: 'Discard',
      danger: true
    }));
  }

  async loadDataset(dataset) {
    this.stopBatch();
    this.batch = this.newBatch(this.batch.run);
    this.dataset = dataset;
    this.loadProtectedTags();
    this.showView('loading');

    try {
      const result = await window.electronAPI.tagEditor.loadArtistFiles(dataset);
      if (!result.success) throw new Error(result.error || result.message);

      this.files = (result.data.files || []).map((file, index) => {
        const entry = {
          index,
          postId: file.postId,
          fileType: file.fileType,
          imagePath: file.imagePath,
          tagPath: file.tagPath,
          subFolder: file.subFolder || '',
          width: file.width || 0,
          height: file.height || 0,
          saved: [...file.tags],
          tags: [...file.tags]
        };
        entry.needsUpscale = entry.width > 0 && Math.max(entry.width, entry.height) < UPSCALE_TARGET_EDGE;
        this.refreshFile(entry);
        return entry;
      });

      this.filter = 'all';
      this.tagQuery = '';
      this.clearDoubtTag();
      this.el.filter.value = 'all';
      this.el.tagFilter.value = '';
      this.el.datasetName.textContent = dataset.displayName || dataset.name;
      this.renderGrid();
      this.showView('main');
    } catch (error) {
      console.error('Failed to load dataset:', error);
      this.el.errorMessage.textContent = error.message || 'Unknown error';
      this.showView('error');
    }
  }

  showView(view) {
    const el = this.el;
    el.main.hidden = view !== 'main';
    el.placeholder.hidden = view !== 'placeholder';
    el.loading.hidden = view !== 'loading';
    el.error.hidden = view !== 'error';
  }

  /** Recomputes the values derived from a file's tags after any change. */
  refreshFile(file) {
    file.modified = !sameTags(file.tags, file.saved);
    file.tokens = countTokens(file.tags.join(', '), false);
    file.hydraDoubts = this.doubtCount(file);
  }

  /** How many of the file's tags the last Hydra scan scored below DOUBTFUL_BELOW. */
  doubtCount(file) {
    const scan = this.batch?.results.get(file);
    if (!scan) return 0;
    const current = new Set(file.tags.map(tag => tag.trim().toLowerCase()));
    return Object.entries(scan.scores || {})
      .filter(([tag, score]) => score !== null && score < DOUBTFUL_BELOW && current.has(tag.trim().toLowerCase())).length;
  }

  // -------------------------------------------------------------------- grid

  visibleFiles() {
    const matches = this.filter === 'doubt-tag' ? (file) => this.doubts(file, this.doubtTag) : (FILTERS[this.filter] || FILTERS.all);
    const query = this.tagQuery;
    return this.files.filter(file => matches(file)
      && (!query || file.tags.some(tag => tag.toLowerCase().includes(query))));
  }

  cardHtml(file) {
    const overLimit = file.tokens > TOKEN_LIMIT;
    const dims = file.width > 0
      ? `${file.width} &times; ${file.height}${file.needsUpscale ? ` <span class="te-flag-warn">below ${UPSCALE_TARGET_EDGE}</span>` : ''}`
      : '';
    const folder = file.subFolder ? `<span class="te-card-folder" title="${escapeHtml(file.subFolder)}">${escapeHtml(file.subFolder)}</span>` : '';

    const thumb = this.thumbs.get(file.imagePath);
    return `
      <div class="te-card-thumb">
        <img${thumb ? ` src="${escapeHtml(thumb)}"` : ''} data-full="${escapeHtml(file.imagePath)}" alt="" decoding="async" draggable="false">
      </div>
      ${this.cardBodyHtml(file, overLimit, dims, folder)}
    `;
  }

  cardBodyHtml(file, overLimit, dims, folder) {
    return `
      <div class="te-card-body">
        <div class="te-card-title">
          <span>${escapeHtml(file.postId)}</span>
          ${file.modified ? '<span class="te-flag-accent">unsaved</span>' : ''}
        </div>
        <div class="te-card-meta">
          ${plural(file.tags.length, 'tag')}, <span class="${overLimit ? 'te-flag-error' : ''}">${plural(file.tokens, 'token')}</span>${file.hydraDoubts ? `, <span class="te-flag-warn" title="Tags Hydra scored below ${DOUBTFUL_BELOW}">${file.hydraDoubts} doubtful</span>` : ''}
        </div>
        <div class="te-card-meta">${dims}${folder}</div>
      </div>`;
  }

  renderGrid() {
    const el = this.el;
    const visible = this.visibleFiles();
    const fragment = document.createDocumentFragment();

    visible.forEach(file => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'te-card';
      card.dataset.index = file.index;
      card.innerHTML = this.cardHtml(file);
      fragment.appendChild(card);
    });

    el.grid.replaceChildren(fragment);
    el.gridEmpty.hidden = visible.length > 0;
    this.updateSummary();
    this.observeThumbs();
  }

  /** Re-renders a card's text in place; the image is left alone, so the grid keeps its scroll position and loaded images. */
  updateCard(file) {
    const body = this.el.grid.querySelector(`.te-card[data-index="${file.index}"] .te-card-body`);
    if (!body) return;
    const template = document.createElement('template');
    template.innerHTML = this.cardHtml(file);
    body.replaceWith(template.content.querySelector('.te-card-body'));
  }

  // -------------------------------------------------------------- thumbnails

  /**
   * Cards ask for their thumbnail only when they come within a few rows of
   * the visible part of the grid, so a folder of thousands opens at once and
   * only what you scroll to is made. Thumbnails are small cached JPEGs
   * (main/services/thumbnailCache.js); if one can't be made, the card shows
   * the full image instead.
   */
  observeThumbs() {
    if (!this.thumbObserver) {
      this.thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.thumbObserver.unobserve(entry.target);
          this.loadThumb(entry.target);
        }
      }, { root: this.el.grid, rootMargin: '600px 0px' });
    }
    this.thumbObserver.disconnect();
    this.el.grid.querySelectorAll('.te-card-thumb img:not([src])').forEach(img => this.thumbObserver.observe(img));
  }

  async loadThumb(img) {
    const full = img.dataset.full;
    let url = this.thumbs.get(full);
    if (!url) {
      try {
        const result = await window.electronAPI.tagEditor.thumbnail(full);
        url = result?.success ? result.url : full;
      } catch {
        url = full;
      }
      this.thumbs.set(full, url);
    }
    if (img.isConnected && !img.getAttribute('src')) img.src = url;
  }

  storedCardSize() {
    try {
      const stored = localStorage.getItem(CARD_SIZE_KEY);
      return CARD_SIZES[stored] ? stored : 'medium';
    } catch {
      return 'medium';
    }
  }

  setCardSize(size, { save = true } = {}) {
    const key = CARD_SIZES[size] ? size : 'medium';
    this.el.size.value = key;
    this.el.grid.style.setProperty('--te-card-min', `${CARD_SIZES[key]}px`);
    if (!save) return;
    try {
      localStorage.setItem(CARD_SIZE_KEY, key);
    } catch {
      // Not remembered; the grid still changes.
    }
  }

  updateSummary() {
    const total = this.files.length;
    const over = this.files.filter(FILTERS.overlimit).length;
    const lowres = this.files.filter(FILTERS.lowres).length;
    const unsaved = this.files.filter(FILTERS.unsaved).length;

    const parts = [plural(total, 'file')];
    if (over) parts.push(`${over} over ${TOKEN_LIMIT} tokens`);
    if (lowres) parts.push(`${lowres} below ${UPSCALE_TARGET_EDGE}px`);
    if (unsaved) parts.push(`${unsaved} unsaved`);
    this.el.summary.textContent = parts.join(', ');

    this.el.saveAll.disabled = unsaved === 0;
    this.el.saveAll.textContent = unsaved > 0 ? `Save All (${unsaved})` : 'Save All';
    this.el.globalSave.disabled = unsaved === 0;
    this.el.globalSave.textContent = this.el.saveAll.textContent;
  }

  /** Call after tags changed on any number of files outside the editor. */
  afterBulkChange(changedFiles) {
    changedFiles.forEach(file => this.refreshFile(file));
    if (this.filter === 'all' && !this.tagQuery) {
      changedFiles.forEach(file => this.updateCard(file));
      this.updateSummary();
    } else {
      this.renderGrid();
    }
    if (!this.el.global.hidden) this.renderGlobal();
  }

  // ------------------------------------------------------------------ saving

  async saveAll() {
    const modified = this.files.filter(file => file.modified);
    if (modified.length === 0) return;

    const payload = modified.map(file => ({ postId: file.postId, tags: file.tags, tagPath: file.tagPath }));
    let result;
    try {
      result = await window.electronAPI.tagEditor.batchSaveTagData(this.dataset, payload);
    } catch (error) {
      console.error('Batch save failed:', error);
      this.showToast('Save failed', 'error');
      return;
    }

    // Each file reports its own outcome; only the ones written are marked saved.
    const outcomes = Array.isArray(result?.results) ? result.results : [];
    const saved = [];
    modified.forEach((file, i) => {
      if (outcomes[i]?.success) {
        file.saved = [...file.tags];
        saved.push(file);
      }
    });

    this.afterBulkChange(saved);
    const failed = modified.length - saved.length;
    if (failed > 0) {
      this.showToast(`Saved ${saved.length} of ${modified.length} files; ${failed} failed`, 'error');
    } else {
      this.showToast(`Saved ${plural(saved.length, 'file')}`, 'success');
    }
  }

  removeAllDuplicates() {
    let removed = 0;
    const changed = [];
    this.files.forEach(file => {
      const deduped = dedupeTags(file.tags);
      if (deduped.length !== file.tags.length) {
        removed += file.tags.length - deduped.length;
        file.tags = deduped;
        changed.push(file);
      }
    });

    if (changed.length === 0) {
      this.showToast('No duplicate tags found', 'info');
      return;
    }
    this.afterBulkChange(changed);
    this.showToast(`Removed ${plural(removed, 'duplicate tag')} from ${plural(changed.length, 'file')}. Save All to keep the change.`, 'success');
  }

  // ------------------------------------------------------------------ editor

  openEditor(file) {
    if (!file) return;
    this.editor = { file, tags: [...file.tags] };

    const el = this.el;
    el.editorTitle.textContent = `${file.postId}.${file.fileType}`;
    el.editorImg.src = file.imagePath;
    el.tagInput.value = '';
    el.editor.hidden = false;
    this.hydra.review = null;
    this.hydra.heatmap = null;
    el.heatmap.hidden = true;
    el.editorImg.classList.remove('is-under-heatmap');
    this.renderEditor();
    el.tagInput.focus();
    if (this.hydra.auto) this.runHydra();
  }

  closeEditor() {
    this.closeSuggestions();
    this.el.editor.hidden = true;
    this.el.editorImg.removeAttribute('src');
    this.editor = null;
    this.hydra.review = null;
    this.hydra.heatmap = null;
    this.hydra.busy = false;
    this.hydra.request++;
    this.el.heatmap.hidden = true;
    this.el.editorImg.classList.remove('is-under-heatmap');
  }

  renderEditor() {
    if (!this.editor) return;
    const el = this.el;
    const { file, tags } = this.editor;
    const tokens = countTokens(tags.join(', '), false);
    const over = tokens - TOKEN_LIMIT;

    const visible = this.visibleFiles();
    const position = visible.indexOf(file);
    el.editorPosition.textContent = position === -1 ? '' : `${position + 1} of ${visible.length}`;
    el.prev.disabled = position <= 0;
    el.next.disabled = position === -1 || position >= visible.length - 1;

    el.editorCount.textContent = plural(tags.length, 'tag');
    el.editorTokens.textContent = over > 0
      ? `${tokens} / ${TOKEN_LIMIT} tokens, ${over} over the limit`
      : `${tokens} / ${TOKEN_LIMIT} tokens`;
    el.editorTokens.classList.toggle('te-flag-error', over > 0);

    if (file.width > 0) {
      el.editorDims.textContent = `${file.width} × ${file.height}${file.needsUpscale ? `, below ${UPSCALE_TARGET_EDGE}px` : ''}`;
      el.editorDims.classList.toggle('te-flag-warn', file.needsUpscale);
    } else {
      el.editorDims.textContent = '';
    }

    el.editorSave.disabled = sameTags(tags, file.saved);

    const review = this.hydra.review;
    el.tags.innerHTML = tags.map((tag, index) => {
      const isProtected = this.protectedTags.has(tag.trim().toLowerCase());
      const score = review ? review.scores[tag] : undefined;
      const doubtful = typeof score === 'number' && score < review.doubtfulBelow;
      const classes = ['te-tag'];
      if (isProtected) classes.push('is-protected');
      if (doubtful) classes.push('is-doubtful');
      if (this.hydra.heatmap?.tag === tag) classes.push('is-mapped');
      return `
        <span class="${classes.join(' ')}" data-index="${index}">
          <button type="button" class="te-tag-btn te-tag-protect" data-action="protect" title="${isProtected ? 'Unprotect tag' : 'Protect tag: keep it out of removal suggestions'}">
            <i class="${isProtected ? 'fas' : 'far'} fa-star"></i>
          </button>
          <span class="te-tag-text">${escapeHtml(tag)}</span>
          ${typeof score === 'number' ? this.scoreButton(score, doubtful) : ''}
          <button type="button" class="te-tag-btn te-tag-remove" data-action="remove" title="Remove tag">
            <i class="fas fa-times"></i>
          </button>
        </span>
      `;
    }).join('') || '<span class="te-tags-empty">No tags yet.</span>';
    this.renderHydra();
  }

  // ------------------------------------------------------------- Hydra check

  async checkHydra() {
    this.loadHiddenSuggestions();
    try {
      const result = await window.electronAPI.tagEditor.hydraAvailable();
      this.hydra.available = Boolean(result?.available);
    } catch {
      this.hydra.available = false;
    }
    this.el.hydra.hidden = !this.hydra.available;
    this.el.batchOpen.hidden = !this.hydra.available;
  }

  scoreButton(score, doubtful) {
    const title = doubtful
      ? `Hydra gives this tag ${score.toFixed(2)}, so it may not fit this image. Click to see where it looked.`
      : 'Hydra\'s score for this tag. Click to see where in the image it found it.';
    return `<button type="button" class="te-tag-btn te-tag-score" data-action="heatmap" title="${title}">${score.toFixed(2)}</button>`;
  }

  /** Scores the open file's tags with Hydra and lists confident tags it lacks. */
  async runHydra() {
    if (!this.editor || !this.hydra.available) return;
    const file = this.editor.file;
    const request = ++this.hydra.request;
    this.hydra.busy = true;
    this.renderHydra();
    try {
      const result = await window.electronAPI.tagEditor.hydraTags(file.imagePath, this.editor.tags, [...this.hydra.hidden]);
      if (request !== this.hydra.request || this.editor?.file !== file) return;
      if (!result.success) throw new Error(result.error || 'Hydra check failed');
      this.hydra.review = { imagePath: file.imagePath, scores: result.scores, suggestions: result.suggestions, doubtfulBelow: result.doubtfulBelow };
    } catch (error) {
      if (request !== this.hydra.request) return;
      console.error('Hydra check failed:', error);
      this.showToast(`Hydra check failed: ${error.message}`, 'error');
    } finally {
      if (request === this.hydra.request) this.hydra.busy = false;
    }
    if (this.editor?.file === file) this.renderEditor();
  }

  /** After tags were added or removed: fresh scores, from the model output the worker kept. */
  refreshHydraScores() {
    if (this.hydra.review && this.editor && this.hydra.review.imagePath === this.editor.file.imagePath) this.runHydra();
  }

  renderHydra() {
    const el = this.el;
    const { review, busy, heatmap } = this.hydra;
    el.hydra.disabled = busy || !this.editor;
    el.hydraPanel.hidden = !busy && !review && !heatmap;
    if (el.hydraPanel.hidden) return;

    if (busy && !review) {
      el.hydraStatus.textContent = 'Checking with Hydra...';
      el.hydraSuggest.innerHTML = '';
    } else if (review) {
      const scores = Object.values(review.scores);
      const unknown = scores.filter(score => score === null).length;
      const doubtful = scores.filter(score => score !== null && score < review.doubtfulBelow).length;
      const parts = [review.suggestions.length ? 'Hydra suggests:' : 'Hydra has no tags to suggest.'];
      if (doubtful) parts.push(`${plural(doubtful, 'tag')} scored below ${review.doubtfulBelow}.`);
      if (unknown) parts.push(`${plural(unknown, 'tag')} it doesn't know.`);
      el.hydraStatus.textContent = parts.join(' ');
      el.hydraSuggest.innerHTML = review.suggestions.map(({ tag, score, category }) => `
        <span class="te-tag te-tag-suggestion${heatmap?.tag === tag ? ' is-mapped' : ''}" data-tag="${escapeHtml(tag)}" title="${escapeHtml(category)}">
          <button type="button" class="te-tag-btn" data-action="add" title="Add this tag"><i class="fas fa-plus"></i></button>
          <span class="te-tag-text">${escapeHtml(tag)}</span>
          ${this.scoreButton(score, false)}
          <button type="button" class="te-tag-btn te-tag-remove" data-action="hide" title="Never suggest this tag"><i class="fas fa-eye-slash"></i></button>
        </span>
      `).join('');
    }
    el.hydraHidden.textContent = this.hydra.hidden.size ? `Hidden tags (${this.hydra.hidden.size})` : 'Hidden tags';

    el.heatmapClear.hidden = !heatmap;
    el.heatmapLabel.hidden = !heatmap;
    if (heatmap) {
      el.heatmapLabel.textContent = heatmap.loading
        ? `Finding "${heatmap.tag}" in the image...`
        : `Heatmap for "${heatmap.tag}": green areas support the tag, red areas argue against it.`;
    }
  }

  loadHiddenSuggestions() {
    this.hydra.hidden = new Set();
    try {
      const stored = localStorage.getItem(HIDDEN_SUGGESTIONS_KEY);
      if (stored) this.hydra.hidden = new Set(JSON.parse(stored));
    } catch (error) {
      console.warn('Could not read hidden Hydra tags:', error);
    }
  }

  saveHiddenSuggestions() {
    try {
      localStorage.setItem(HIDDEN_SUGGESTIONS_KEY, JSON.stringify([...this.hydra.hidden].sort()));
    } catch (error) {
      console.warn('Could not store hidden Hydra tags:', error);
    }
  }

  /** Stops Hydra suggesting a tag, here and in every other dataset. */
  hideSuggestion(tag) {
    this.hydra.hidden.add(normalizeHiddenTag(tag));
    this.saveHiddenSuggestions();
    if (this.hydra.review) this.hydra.review.suggestions = this.hydra.review.suggestions.filter(item => item.tag !== tag);
    if (this.hydra.heatmap?.tag === tag) this.clearHeatmap();
    this.renderHydra();
    // Refills the list from the model output the worker kept.
    this.refreshHydraScores();
  }

  /** The hidden list as an editable, comma-separated line. */
  async editHiddenSuggestions() {
    const current = [...this.hydra.hidden].sort().join(', ');
    const value = await this.openDialog({
      title: 'Tags Hydra never suggests',
      message: 'Separate tags with commas. This list applies to every dataset; it only affects suggestions, never your tag files.',
      input: current,
      okLabel: 'Save'
    });
    if (value === null || value === undefined) return;
    this.hydra.hidden = new Set(String(value).split(',').map(normalizeHiddenTag).filter(Boolean));
    this.saveHiddenSuggestions();
    this.renderHydra();
    this.refreshHydraScores();
  }

  /** Shows where Hydra found a tag; the same tag again hides it. */
  async showHeatmap(tag) {
    if (!this.editor || !this.hydra.available) return;
    if (this.hydra.heatmap?.tag === tag && !this.hydra.heatmap.loading) {
      this.clearHeatmap();
      return;
    }
    const file = this.editor.file;
    const request = ++this.hydra.request;
    this.hydra.busy = false;
    this.hydra.heatmap = { tag, loading: true };
    this.renderEditor();
    try {
      const result = await window.electronAPI.tagEditor.hydraHeatmap(file.imagePath, tag);
      if (request !== this.hydra.request || this.editor?.file !== file) return;
      if (!result.success) throw new Error(result.error || 'Heatmap failed');
      this.hydra.heatmap = { tag, values: result.values, grid: result.grid };
    } catch (error) {
      if (request !== this.hydra.request) return;
      this.hydra.heatmap = null;
      this.showToast(`Heatmap failed: ${error.message}`, 'error');
    }
    this.renderEditor();
    this.drawHeatmap();
  }

  clearHeatmap() {
    this.hydra.heatmap = null;
    this.el.heatmap.hidden = true;
    this.el.editorImg.classList.remove('is-under-heatmap');
    if (this.editor) this.renderEditor();
  }

  /** A CSS colour variable as [r, g, b]. */
  cssColor(name, fallback) {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    document.body.appendChild(probe);
    const parts = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    probe.remove();
    return parts.length === 3 ? parts : [128, 128, 128];
  }

  /**
   * Paints the heatmap over the image, one cell per 16px patch Hydra saw (it
   * stretches the whole image onto its patch grid): green where the area
   * supports the tag, red where it argues against it, over a greyed image,
   * as in Hydra's own demo. The values are smoothed and weak ones left out
   * (utils/heatmapCells.js), and the browser's scaling blends the cells, so
   * the area the tag is about shows instead of a speckle over everything.
   */
  drawHeatmap() {
    const el = this.el;
    const heatmap = this.hydra.heatmap;
    const img = el.editorImg;
    const shown = Boolean(heatmap?.values && img.naturalWidth && !el.editor.hidden);
    img.classList.toggle('is-under-heatmap', shown);
    if (!shown) {
      el.heatmap.hidden = true;
      return;
    }

    const { rows, cols } = heatmap.grid;
    const canvas = el.heatmap;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(cols, rows);
    const { sign, alpha } = window.HeatmapCells.heatmapCells(heatmap.values, rows, cols);
    const plus = this.cssColor('--success', 'rgb(0, 200, 0)');
    const minus = this.cssColor('--error', 'rgb(220, 0, 0)');
    for (let i = 0; i < sign.length; i++) {
      if (!sign[i]) continue;
      const [r, g, b] = sign[i] > 0 ? plus : minus;
      pixels.data.set([r, g, b, Math.round(alpha[i] * 255)], i * 4);
    }
    ctx.putImageData(pixels, 0, 0);

    // Over the image as displayed; object-fit: contain keeps the element the image's shape.
    canvas.style.left = `${img.offsetLeft}px`;
    canvas.style.top = `${img.offsetTop}px`;
    canvas.style.width = `${img.offsetWidth}px`;
    canvas.style.height = `${img.offsetHeight}px`;
    canvas.hidden = false;
  }

  // --------------------------------------------------------- Tag with Hydra

  batchTargets() {
    return this.el.batchScope.value === 'all' ? this.files : this.visibleFiles();
  }

  openBatch() {
    const el = this.el;
    const shown = this.visibleFiles().length;
    const scope = el.batchScope.value || 'shown';
    el.batchScope.innerHTML = `
      <option value="shown">Files shown (${shown.toLocaleString()})</option>
      <option value="all">All files (${this.files.length.toLocaleString()})</option>`;
    el.batchScope.value = scope;
    el.batch.hidden = false;
    this.syncBatchControls();
    this.renderBatch();
  }

  closeBatch() {
    // A running scan carries on (it's in Processes); its results show when reopened.
    this.el.batch.hidden = true;
  }

  stopBatch() {
    if (!this.batch.running) return;
    this.batch.run++;
    this.batch.running = false;
    this.wakeBatch?.();
  }

  /**
   * Runs Hydra over the chosen files, one at a time: each image goes through
   * the same worker queue as Comic Panels and the editor's own check, so
   * those still get their turn between images. While another program keeps
   * the GPU busy (not merely its memory full) the scan waits (checked every 30 seconds, as the Image
   * Upscaler does; "Run now" in Processes skips the wait). Files scanned
   * before are not scanned again.
   */
  async scanBatch() {
    if (this.batch.running || !this.hydra.available) return;
    const targets = this.batchTargets().filter(file => !this.batch.results.has(file));
    if (targets.length === 0) {
      this.showToast('These files are already scanned', 'info');
      return;
    }

    const run = ++this.batch.run;
    this.batch.running = true;
    let ignoreGpu = false;
    let lastGpuCheck = 0;
    let failed = 0;
    const process = window.app?.startProcess?.({ toolId: this.id, label: 'Tagging with Hydra', total: targets.length });
    this.renderBatch();

    for (let i = 0; i < targets.length; i++) {
      if (run !== this.batch.run) break;

      if (!ignoreGpu && Date.now() - lastGpuCheck > 30000) {
        lastGpuCheck = Date.now();
        while (!ignoreGpu && run === this.batch.run) {
          let status = null;
          try {
            status = await window.electronAPI.system.getGpuStatus();
          } catch {
            status = null;
          }
          // Only a busy GPU holds the scan: Hydra's memory is already taken
          // once it's loaded, so a full GPU would otherwise wait on itself.
          if (!status?.available || !status.busy || status.cause === 'memory') break;
          process?.update({ waiting: status.reason, onRunNow: () => { ignoreGpu = true; this.wakeBatch?.(); } });
          this.el.batchProgress.textContent = `Waiting: ${status.reason}`;
          await new Promise(resolve => { this.wakeBatch = resolve; setTimeout(resolve, 5000); });
        }
        this.wakeBatch = null;
        process?.update({ waiting: '' });
        if (run !== this.batch.run) break;
      }

      const file = targets[i];
      process?.update({ done: i, detail: `${file.postId}.${file.fileType}` });
      this.el.batchProgress.textContent = `Scanning ${(i + 1).toLocaleString()} of ${targets.length.toLocaleString()}`;
      try {
        const result = await window.electronAPI.tagEditor.hydraTags(file.imagePath, file.tags, [], { all: true });
        if (!result.success) throw new Error(result.error || 'Hydra check failed');
        if (run === this.batch.run) {
          this.batch.results.set(file, { suggestions: result.suggestions, scores: result.scores, categories: result.categories });
          this.refreshFile(file);
          this.updateCard(file);
        }
      } catch (error) {
        failed++;
        console.warn(`Hydra scan failed for ${file.postId}:`, error);
      }
      // Lets the page draw between images.
      if (i % 10 === 9) {
        this.renderBatch();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const stopped = run !== this.batch.run;
    const scanned = targets.filter(file => this.batch.results.has(file)).length;
    if (!stopped) this.batch.running = false;
    process?.finish({
      message: stopped ? `Stopped after ${scanned}` : failed ? `${scanned} scanned, ${failed} failed` : `${scanned} scanned`,
      failed: !stopped && scanned === 0,
      warning: failed > 0
    });
    if (failed) this.showToast(`Hydra couldn't read ${plural(failed, 'file')}; see the console for details`, 'error');
    if (this.filter === 'doubtful') this.renderGrid();
    else this.updateSummary();
    this.renderBatch();
  }

  newBatch(run) {
    const modeState = (mode) => ({
      threshold: BATCH_MODES[mode].threshold,
      categories: new Set(BATCH_MODES[mode].categories),
      excluded: new Set()
    });
    return { results: new Map(), run, running: false, mode: 'add', modes: { add: modeState('add'), remove: modeState('remove') }, undo: null, plan: null };
  }

  batchModeState() {
    return this.batch.modes[this.batch.mode];
  }

  /** Switches between adding and removing; each keeps its own threshold, categories and unticked tags. */
  setBatchMode(mode) {
    this.batch.mode = BATCH_MODES[mode] ? mode : 'add';
    this.syncBatchControls();
    this.renderBatch();
  }

  syncBatchControls() {
    const el = this.el;
    const mode = BATCH_MODES[this.batch.mode];
    const state = this.batchModeState();
    el.batchMode.value = this.batch.mode;
    el.batchThresholdLabel.textContent = mode.label;
    el.batchThreshold.min = mode.min;
    el.batchThreshold.max = mode.max;
    el.batchThreshold.value = state.threshold;
    el.batchCategories.querySelectorAll('input').forEach(box => { box.checked = state.categories.has(box.value); });
  }

  batchOptions() {
    const mode = BATCH_MODES[this.batch.mode];
    const state = this.batchModeState();
    const threshold = Math.min(mode.max, Math.max(mode.min, Number(state.threshold) || mode.threshold));
    return {
      threshold,
      categories: state.categories,
      excluded: state.excluded,
      hidden: this.hydra.hidden,
      protectedTags: this.protectedTags
    };
  }

  renderBatch() {
    const el = this.el;
    if (el.batch.hidden) return;
    const { results, running, undo } = this.batch;

    const removing = this.batch.mode === 'remove';
    const scanned = [...results].map(([file, scan]) => ({ file, ...scan }));
    const plan = removing
      ? window.HydraBatch.planRemovals(scanned, this.batchOptions())
      : window.HydraBatch.planAdditions(scanned, this.batchOptions());
    this.batch.plan = { ...plan, mode: this.batch.mode };
    el.batchMode.disabled = running;

    el.batchScan.hidden = running;
    el.batchStop.hidden = !running;
    el.batchScope.disabled = running;
    el.batchUndo.hidden = !undo;
    el.batchApply.disabled = running || plan.total === 0;
    el.batchApply.textContent = plan.total ? `Apply (${plan.total.toLocaleString()})` : 'Apply';
    if (!running) {
      const pending = this.batchTargets().filter(file => !results.has(file)).length;
      el.batchProgress.textContent = results.size === 0 ? ''
        : `${plural(results.size, 'file')} scanned${pending ? `, ${pending.toLocaleString()} not yet` : ''}`;
    }

    const verb = removing ? 'Removes' : 'Adds';
    el.batchSummary.textContent = results.size === 0
      ? 'Scan the files first. Hydra looks at one image at a time; you can keep working, and stop the scan at any point.'
      : plan.total
        ? `${verb} ${plural(plan.total, 'tag')} ${removing ? 'from' : 'to'} ${plural(plan.perFile.size, 'file')}. Untick a tag to leave it out.`
        : removing
          ? 'Nothing to remove at this threshold.'
          : plan.perTag.length
            ? 'Nothing left to add: the files have these tags already, or they are unticked.'
            : 'Nothing to add at this threshold.';
    el.batchNote.textContent = removing
      ? 'Unsaved until Save All. Protected tags and tags Hydra doesn\'t know are never removed.'
      : 'Unsaved until Save All. Hidden tags are never added.';

    const { excluded } = this.batchModeState();
    el.batchHead.innerHTML = removing
      ? `<tr><th class="te-batch-check"></th><th>Tag</th><th>Category</th>
          <th class="num" title="Files that have this tag">Files</th>
          <th class="num" title="Of those, files where Hydra scores the tag 0.5 or more">Hydra agrees</th>
          <th class="num" title="Files it would be removed from at this threshold">Remove</th></tr>`
      : '<tr><th class="te-batch-check"></th><th>Tag</th><th>Category</th><th class="num">Files</th></tr>';

    // Removing: tags Hydra would take off somewhere first, then the rest, for reference.
    el.batchRows.innerHTML = plan.perTag.map((row) => {
      const { tag, category } = row;
      const on = !excluded.has(window.HydraBatch.normalize(tag));
      const checkable = !removing || row.remove > 0;
      const cells = removing
        ? `<td class="num">${row.files.toLocaleString()}</td>
           <td class="num">${row.agree.toLocaleString()}</td>
           <td class="num">${row.remove ? row.remove.toLocaleString() : ''}</td>`
        : `<td class="num">${row.files.toLocaleString()}</td>`;
      return `
        <tr data-tag="${escapeHtml(tag)}"${on && checkable ? '' : ' class="is-excluded"'}>
          <td class="te-batch-check">${checkable ? `<input type="checkbox"${on ? ' checked' : ''} aria-label="${removing ? 'Remove' : 'Add'} ${escapeHtml(tag)}">` : ''}</td>
          <td>${escapeHtml(tag)}</td>
          <td>${escapeHtml(category)}</td>
          ${cells}
        </tr>`;
    }).join('');
  }

  applyBatch() {
    const plan = this.batch.plan;
    if (!plan || plan.total === 0 || this.batch.running) return;
    const undo = [];
    const changed = [];
    for (const [file, tags] of plan.perFile) {
      if (plan.mode === 'remove') {
        const { tags: kept, taken } = window.HydraBatch.removeTags(file.tags, tags);
        file.tags = kept;
        undo.push({ file, taken });
      } else {
        file.tags = [...file.tags, ...tags];
        undo.push({ file, added: tags });
      }
      changed.push(file);
    }
    this.batch.undo = undo;
    this.afterBulkChange(changed);
    const what = plan.mode === 'remove' ? `Removed ${plural(plan.total, 'tag')} from` : `Added ${plural(plan.total, 'tag')} to`;
    this.showToast(`${what} ${plural(changed.length, 'file')}. Save All to keep the change.`, 'success');
    this.renderBatch();
  }

  undoBatch() {
    const undo = this.batch.undo;
    if (!undo) return;
    const changed = [];
    for (const { file, added, taken } of undo) {
      const before = file.tags.join('\n');
      file.tags = added ? window.HydraBatch.withoutAdded(file.tags, added) : window.HydraBatch.restoreRemoved(file.tags, taken);
      if (file.tags.join('\n') !== before) changed.push(file);
    }
    this.batch.undo = null;
    this.afterBulkChange(changed);
    this.showToast(`Undid the last apply on ${plural(changed.length, 'file')}`, 'info');
    this.renderBatch();
  }

  addEditorTags() {
    if (!this.editor) return;
    const input = this.el.tagInput;
    const incoming = input.value.split(',').map(tag => tag.trim()).filter(Boolean);
    if (incoming.length === 0) return;

    const existing = new Set(this.editor.tags.map(tag => tag.toLowerCase()));
    let skipped = 0;
    incoming.forEach(tag => {
      const key = tag.toLowerCase();
      if (existing.has(key)) {
        skipped++;
        return;
      }
      existing.add(key);
      this.editor.tags.push(tag);
    });

    input.value = '';
    this.renderEditor();
    this.refreshHydraScores();
    if (skipped > 0) this.showToast(`${plural(skipped, 'tag')} already present`, 'info');
  }

  dedupeEditor() {
    if (!this.editor) return;
    const deduped = dedupeTags(this.editor.tags);
    const removed = this.editor.tags.length - deduped.length;
    if (removed === 0) {
      this.showToast('No duplicate tags in this file', 'info');
      return;
    }
    this.editor.tags = deduped;
    this.renderEditor();
    this.showToast(`Removed ${plural(removed, 'duplicate tag')}`, 'success');
  }

  /** Copies the editor's working tags onto the file (in memory only). */
  commitEditor() {
    if (!this.editor) return;
    const { file, tags } = this.editor;
    if (sameTags(file.tags, tags)) return;
    file.tags = [...tags];
    this.afterBulkChange([file]);
  }

  /** Moves to the previous/next visible file, keeping any edits as unsaved changes. */
  stepEditor(delta) {
    if (!this.editor) return;
    const visible = this.visibleFiles();
    const position = visible.indexOf(this.editor.file);
    const target = visible[position + delta];
    if (position === -1 || !target) return;

    this.closeSuggestions();
    this.commitEditor();
    this.openEditor(target);
  }

  async saveEditor() {
    if (!this.editor) return;
    const { file, tags } = this.editor;
    const el = this.el;
    el.editorSave.disabled = true;

    try {
      const result = await window.electronAPI.tagEditor.saveTagData(this.dataset, file.postId, tags, file.tagPath);
      if (!result.success) throw new Error(result.error || result.message);

      file.tags = [...tags];
      file.saved = [...tags];
      this.afterBulkChange([file]);
      this.showToast(`Saved ${file.postId}`, 'success');
      this.closeEditor();
    } catch (error) {
      console.error('Save failed:', error);
      this.showToast(`Save failed: ${error.message}`, 'error');
      if (this.editor) this.renderEditor();
    }
  }

  // --------------------------------------------------------- protected tags

  protectedTagsKey() {
    const name = this.dataset?.name || this.dataset?.displayName || 'dataset';
    return `protectedTags_${this.searchMode}_${name}`;
  }

  loadProtectedTags() {
    this.protectedTags = new Set();
    try {
      const stored = localStorage.getItem(this.protectedTagsKey());
      if (stored) this.protectedTags = new Set(JSON.parse(stored));
    } catch (error) {
      console.warn('Could not read protected tags:', error);
    }
  }

  toggleProtected(tag) {
    const key = tag.trim().toLowerCase();
    if (this.protectedTags.has(key)) this.protectedTags.delete(key);
    else this.protectedTags.add(key);

    try {
      localStorage.setItem(this.protectedTagsKey(), JSON.stringify([...this.protectedTags]));
    } catch (error) {
      console.warn('Could not store protected tags:', error);
    }

    this.renderEditor();
    if (!this.el.global.hidden) this.renderGlobal();
  }

  // ------------------------------------------------------------- suggestions

  /**
   * Ranks the edited file's tags by how safely they could be dropped: tags
   * that are rare across the dataset and expensive in tokens come first.
   * This is a plain frequency/cost heuristic, not a model.
   */
  buildSuggestions() {
    if (!this.editor) return [];
    const totalFiles = this.files.length;
    const usage = new Map();
    this.files.forEach(file => {
      const tags = file === this.editor.file ? this.editor.tags : file.tags;
      new Set(tags.map(tag => tag.toLowerCase())).forEach(key => usage.set(key, (usage.get(key) || 0) + 1));
    });

    const suggestions = [];
    this.editor.tags.forEach(tag => {
      const key = tag.toLowerCase();
      if (this.protectedTags.has(key.trim())) return;

      const fileCount = usage.get(key) || 1;
      const share = (fileCount / totalFiles) * 100;
      const cost = countTokens(tag, false);
      let score = 0;
      let reason = '';

      if (fileCount === 1 && totalFiles > 1) {
        score += 14;
        reason = 'Only in this file';
      } else if (share < 5) {
        score += 10;
        reason = `Rare: ${share.toFixed(1)}% of files`;
      } else if (share < 15) {
        score += 5;
        reason = `Uncommon: ${share.toFixed(1)}% of files`;
      }

      if (cost >= 3) {
        score += 5;
        reason = reason ? `${reason}; ${cost} tokens` : `Costs ${cost} tokens`;
      } else if (cost === 2) {
        score += 3;
      }
      if (tag.length > 20) score += 4;
      else if (tag.length > 15) score += 2;

      if (score >= 8) suggestions.push({ tag, score, fileCount, cost, reason: reason || 'Long, specific tag' });
    });

    return suggestions.sort((a, b) => b.score - a.score);
  }

  openSuggestions() {
    if (!this.editor) return;
    if (this.buildSuggestions().length === 0) {
      this.showToast('No tags stand out as removable', 'info');
      return;
    }
    this.el.suggestions.hidden = false;
    this.renderSuggestions();
  }

  renderSuggestions() {
    const el = this.el;
    const suggestions = this.buildSuggestions();
    if (suggestions.length === 0) {
      this.closeSuggestions();
      return;
    }

    const current = countTokens(this.editor.tags.join(', '), false);
    const remaining = countTokens(
      this.editor.tags.filter(tag => !suggestions.some(s => s.tag === tag)).join(', '),
      false
    );
    el.suggestionsSummary.textContent =
      `${current} tokens now (limit ${TOKEN_LIMIT}). Removing all ${suggestions.length} suggestions would leave ${remaining}.`;

    el.suggestionsRows.innerHTML = suggestions.map(s => `
      <tr data-tag="${escapeHtml(s.tag)}">
        <td class="te-cell-tag">${escapeHtml(s.tag)}</td>
        <td class="num">${s.cost}</td>
        <td class="num">${s.fileCount} / ${this.files.length}</td>
        <td class="te-cell-reason">${escapeHtml(s.reason)}</td>
        <td class="te-cell-actions"><button type="button" class="btn btn-sm" data-action="remove">Remove</button></td>
      </tr>
    `).join('');
  }

  closeSuggestions() {
    this.el.suggestions.hidden = true;
  }

  // ---------------------------------------------------------------- all tags

  /** Tag usage across the dataset, keyed case-insensitively. */
  collectTagStats() {
    const stats = new Map();
    this.files.forEach(file => {
      new Set(file.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean)).forEach(key => {
        if (!stats.has(key)) stats.set(key, { tag: key, files: [] });
        stats.get(key).files.push(file);
      });
    });
    return [...stats.values()];
  }

  openGlobal() {
    if (this.files.length === 0) return;
    const el = this.el;
    this.globalView = { query: '', sort: 'frequency-desc' };
    el.globalSearch.value = '';
    el.globalSort.value = 'frequency-desc';
    el.globalTitle.textContent = `All Tags: ${this.dataset.displayName || this.dataset.name}`;
    el.global.hidden = false;
    this.renderGlobal();
    el.globalSearch.focus();
  }

  closeGlobal() {
    this.el.global.hidden = true;
  }

  async renderGlobal() {
    const el = this.el;
    const all = this.collectTagStats();
    const totalFiles = this.files.length;
    const { query, sort } = this.globalView;

    // Hydra's view of each tag, once some files are scanned (Tag with Hydra).
    const scanned = [...this.batch.results].map(([file, scan]) => ({ file, ...scan }));
    const agreement = scanned.length ? window.HydraBatch.tagAgreement(scanned, { doubtBelow: DOUBTFUL_BELOW }) : null;
    const hydraOf = (entry) => agreement?.get(window.HydraBatch.normalize(entry.tag)) || null;
    el.global.querySelector('table').classList.toggle('has-hydra', Boolean(agreement));
    el.globalRank.hidden = !this.hydra.available || Boolean(agreement);

    const rows = (query ? all.filter(entry => entry.tag.includes(query)) : all).sort((a, b) => {
      if (agreement && sort === 'hydra-doubted') {
        return (hydraOf(b)?.doubted || 0) - (hydraOf(a)?.doubted || 0) || b.files.length - a.files.length || a.tag.localeCompare(b.tag);
      }
      if (agreement && sort === 'hydra-low') {
        // Tags Hydra doesn't know go last.
        return (hydraOf(a)?.mean ?? 2) - (hydraOf(b)?.mean ?? 2) || b.files.length - a.files.length || a.tag.localeCompare(b.tag);
      }
      if (sort === 'frequency-asc') return a.files.length - b.files.length || a.tag.localeCompare(b.tag);
      if (sort === 'name-asc') return a.tag.localeCompare(b.tag);
      if (sort === 'name-desc') return b.tag.localeCompare(a.tag);
      return b.files.length - a.files.length || a.tag.localeCompare(b.tag);
    });

    el.globalCounts.textContent = (query
      ? `${rows.length} of ${plural(all.length, 'tag')}`
      : `${plural(all.length, 'unique tag')} in ${plural(totalFiles, 'file')}`)
      + (agreement && scanned.length < totalFiles ? `, Hydra scores from ${plural(scanned.length, 'scanned file')}` : '');

        // The first rows show at once; the rest are added in chunks, giving the
    // page a turn between them so typing in the search box stays smooth. A
    // newer render (the next keystroke) stops an older one.
    const run = this.globalRender = (this.globalRender || 0) + 1;
    const rowHtml = (entry) => {
      const coverage = (entry.files.length / totalFiles) * 100;
      const isProtected = this.protectedTags.has(entry.tag);
      return `
        <tr data-tag="${escapeHtml(entry.tag)}">
          <td class="te-cell-tag">${escapeHtml(entry.tag)}${isProtected ? ' <span class="te-flag-accent">protected</span>' : ''}</td>
          <td class="num">${entry.files.length.toLocaleString()}</td>
          <td>
            <div class="te-coverage">
              <div class="progress-bar-container"><div class="progress-bar" style="width: ${coverage.toFixed(1)}%"></div></div>
              <span>${coverage.toFixed(1)}%</span>
            </div>
          </td>
          ${agreement ? this.hydraCell(hydraOf(entry)) : '<td class="te-col-hydra"></td>'}
          <td class="te-cell-actions">
            <button type="button" class="btn-icon" data-action="front" title="Move to the front of every file that has it"><i class="fas fa-arrow-up"></i></button>
            <button type="button" class="btn-icon" data-action="files" title="List files with this tag"><i class="fas fa-list"></i></button>
            <button type="button" class="btn-icon" data-action="rename" title="Rename in all files"><i class="fas fa-pen"></i></button>
            <button type="button" class="btn-icon" data-action="delete" title="Delete from all files"><i class="fas fa-trash"></i></button>
          </td>
                </tr>
      `;
    };
    const CHUNK = 200;
    el.globalRows.innerHTML = rows.slice(0, CHUNK).map(rowHtml).join('') || '<tr><td colspan="5" class="te-cell-empty">No tags match.</td></tr>';
    for (let i = CHUNK; i < rows.length; i += CHUNK) {
      await (globalThis.scheduler?.yield?.() ?? new Promise(resolve => setTimeout(resolve)));
      if (run !== this.globalRender || el.global.hidden) return;
      el.globalRows.insertAdjacentHTML('beforeend', rows.slice(i, i + CHUNK).map(rowHtml).join(''));
    }
  }

  hydraCell(stat) {
    if (!stat) return '<td class="te-col-hydra"><span class="te-cell-muted" title="Hydra doesn\'t know this tag, or no scanned file has it">-</span></td>';
    const doubted = stat.doubted
      ? ` <button type="button" class="te-link te-flag-warn" data-action="doubted" title="Show the files where Hydra scores this tag below ${DOUBTFUL_BELOW}">${stat.doubted} doubted</button>`
      : '';
    return `<td class="te-col-hydra"><span title="Average over ${plural(stat.scored, 'scanned file')}; Hydra agrees on ${stat.agree}">${stat.mean.toFixed(2)}</span>${doubted}</td>`;
  }

  /** Whether the last scan scored `tag` below DOUBTFUL_BELOW on this file, which still has it. */
  doubts(file, tag) {
    const scan = this.batch.results.get(file);
    if (!scan || !tag) return false;
    const key = window.HydraBatch.normalize(tag);
    if (!file.tags.some(existing => window.HydraBatch.normalize(existing) === key)) return false;
    return Object.entries(scan.scores || {}).some(([scored, score]) => score !== null && score < DOUBTFUL_BELOW && window.HydraBatch.normalize(scored) === key);
  }

  /** Narrows the grid to the files where Hydra doubts one tag, through the file filter. */
  showDoubted(tag) {
    const el = this.el;
    this.doubtTag = tag;
    let option = el.filter.querySelector('option[value="doubt-tag"]');
    if (!option) {
      option = document.createElement('option');
      option.value = 'doubt-tag';
      el.filter.appendChild(option);
    }
    option.textContent = `Hydra doubts "${tag}"`;
    el.filter.value = 'doubt-tag';
    this.filter = 'doubt-tag';
    this.tagQuery = '';
    el.tagFilter.value = '';
    this.closeGlobal();
    this.renderGrid();
  }

  clearDoubtTag() {
    this.doubtTag = null;
    this.el.filter.querySelector('option[value="doubt-tag"]')?.remove();
  }

  /**
   * Makes `tag` the first tag in every file that has it (e.g. the artist
   * tag, so it leads each caption). Files without the tag are left alone;
   * the order of the remaining tags is kept.
   */
  moveTagToFront(tag) {
    const changed = [];
    let withTag = 0;

    this.files.forEach(file => {
      const index = file.tags.findIndex(t => t.trim().toLowerCase() === tag);
      if (index === -1) return;
      withTag++;
      if (index === 0) return;
      const [moved] = file.tags.splice(index, 1);
      file.tags.unshift(moved);
      changed.push(file);
    });

    if (changed.length === 0) {
      this.showToast(`"${tag}" is already first in every file that has it`, 'info');
      return;
    }

    this.afterBulkChange(changed);
    const missing = this.files.length - withTag;
    const note = missing > 0 ? ` ${plural(missing, 'file')} ${missing === 1 ? 'does' : 'do'} not have this tag.` : '';
    this.showToast(`Moved "${tag}" to the front in ${plural(changed.length, 'file')}.${note} Save All to keep the change.`, 'success', 6000);
  }

  async renameTag(oldTag) {
    const value = await this.openDialog({
      title: 'Rename tag',
      message: `Rename "${oldTag}" in every file that uses it.`,
      input: oldTag,
      okLabel: 'Rename'
    });
    const newTag = (value || '').trim();
    if (!newTag || newTag.toLowerCase() === oldTag) return;

    const changed = [];
    this.files.forEach(file => {
      if (!file.tags.some(tag => tag.trim().toLowerCase() === oldTag)) return;
      // Renaming onto a tag the file already has must not create a duplicate.
      file.tags = dedupeTags(file.tags.map(tag => (tag.trim().toLowerCase() === oldTag ? newTag : tag)));
      changed.push(file);
    });

    this.afterBulkChange(changed);
    this.showToast(`Renamed in ${plural(changed.length, 'file')}`, 'success');
  }

  async deleteTag(tag) {
    const count = this.files.filter(file => file.tags.some(t => t.trim().toLowerCase() === tag)).length;
    const confirmed = await this.openDialog({
      title: 'Delete tag',
      message: `Remove "${tag}" from ${plural(count, 'file')}?`,
      okLabel: 'Delete',
      danger: true
    });
    if (!confirmed) return;

    const changed = [];
    this.files.forEach(file => {
      const kept = file.tags.filter(t => t.trim().toLowerCase() !== tag);
      if (kept.length !== file.tags.length) {
        file.tags = kept;
        changed.push(file);
      }
    });

    this.afterBulkChange(changed);
    this.showToast(`Deleted from ${plural(changed.length, 'file')}`, 'success');
  }

  async addTagToAll() {
    const value = await this.openDialog({
      title: 'Add tag to all files',
      message: `Adds the tag to every one of the ${plural(this.files.length, 'file')} that does not have it yet.`,
      input: '',
      okLabel: 'Add'
    });
    const tag = (value || '').trim();
    if (!tag) return;

    const key = tag.toLowerCase();
    const changed = [];
    this.files.forEach(file => {
      if (file.tags.some(t => t.trim().toLowerCase() === key)) return;
      file.tags = [...file.tags, tag];
      changed.push(file);
    });

    if (changed.length === 0) {
      this.showToast('Every file already has that tag', 'info');
      return;
    }
    this.afterBulkChange(changed);
    this.showToast(`Added to ${plural(changed.length, 'file')}`, 'success');
  }

  showTagFiles(tag) {
    const names = this.files
      .filter(file => file.tags.some(t => t.trim().toLowerCase() === tag))
      .map(file => (file.subFolder ? `${file.subFolder}/` : '') + `${file.postId}.${file.fileType}`);

    this.openDialog({
      title: `Files tagged "${tag}"`,
      message: plural(names.length, 'file'),
      list: names.join('\n'),
      okLabel: 'Close',
      hideCancel: true
    });
  }

  exportTags() {
    const totalFiles = this.files.length;
    const rows = this.collectTagStats().sort((a, b) => b.files.length - a.files.length);
    const lines = ['Tag,Files,Coverage'];
    rows.forEach(entry => {
      const coverage = ((entry.files.length / totalFiles) * 100).toFixed(1);
      lines.push(`"${entry.tag.replace(/"/g, '""')}",${entry.files.length},${coverage}%`);
    });

    const name = (this.dataset.displayName || this.dataset.name || 'dataset').replace(/[^a-z0-9._-]+/gi, '_');
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}_tags_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.showToast(`Exported ${plural(rows.length, 'tag')}`, 'success');
  }

  // ------------------------------------------------------------------ dialog

  /**
   * Shows the shared dialog. Resolves with the input's text when `input` is
   * given, `true` for a plain confirmation, or `null` if cancelled.
   */
  openDialog({ title, message = '', input, list, okLabel = 'OK', danger = false, hideCancel = false }) {
    const el = this.el;
    if (this.dialogResolve) this.closeDialog(null);

    el.dialogTitle.textContent = title;
    el.dialogMessage.textContent = message;
    el.dialogInput.hidden = input === undefined;
    el.dialogInput.value = input || '';
    el.dialogList.hidden = list === undefined;
    el.dialogList.textContent = list || '';
    el.dialogOk.textContent = okLabel;
    el.dialogOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    el.dialogCancel.hidden = hideCancel;
    el.dialog.hidden = false;

    if (input !== undefined) {
      el.dialogInput.focus();
      el.dialogInput.select();
    } else {
      el.dialogOk.focus();
    }

    return new Promise(resolve => {
      this.dialogResolve = resolve;
    });
  }

  confirmDialog() {
    this.closeDialog(this.el.dialogInput.hidden ? true : this.el.dialogInput.value);
  }

  closeDialog(value) {
    this.el.dialog.hidden = true;
    const resolve = this.dialogResolve;
    this.dialogResolve = null;
    if (resolve) resolve(value);
  }

  destroy() {
    this.stopBatch();
    this.captionProgressOff?.();
    this.captionModal = null;
    this.thumbObserver?.disconnect();
    this.thumbObserver = null;
    if (this.dialogResolve) this.closeDialog(null);
    this.editor = null;
    this.files = [];
    super.destroy();
  }
}

window.mixMethods(TagEditorTool, TagEditorCaptions);

window.TagEditorTool = TagEditorTool;
export default TagEditorTool;
