console.log('🔧 AutoPrompterTool module loading...');

class AutoPrompterTool {
  constructor() {
    this.name = 'Auto Prompter';
    this.id = 'auto-prompter';
    this.icon = 'fas fa-align-left';
    this.description = 'Generate structured prompts from E621 post IDs';
    this.version = '2.1.0';

    this.currentPostData = null;
    this.isLoading = false;
    this.generatedPrompt = null;

    // Provider / model state
    this._provider = 'huggingface'; // 'huggingface' | 'ollama'
    this._ollamaModel = '';
    this._hfModel = '';
    this._aiEnabled = false;
    this._nsfw = true;
    this._inlineSelection = null; // { start, end, text }
    this._outsideClickHandler = null;

    console.log('🪄 Auto Prompter Tool initialized');
  }

  getMetadata() {
    return {
      name: this.name,
      id: this.id,
      icon: this.icon,
      description: this.description,
      version: this.version,
      category: 'AI Tools'
    };
  }

  destroy() {
    if (this._outsideClickHandler) {
      document.removeEventListener('mousedown', this._outsideClickHandler);
    }
    this._popover?.remove();
    console.log('🧹 Auto Prompter Tool cleaned up');
  }

  getTemplate() {
    return `
      <div class="ap-tool">

        <!-- Input -->
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">Post ID</label>
          <div class="ap-input-row">
            <input type="text" id="ap-id-input" class="form-input ap-id-input"
                   placeholder="Enter E621 post ID…" autocomplete="off">
            <button class="btn btn-primary ap-btn ap-btn-generate" id="ap-generate-btn">
              Generate
            </button>
          </div>
        </div>

        <!-- Divider -->
        <div class="ap-or-divider">
          <span>or</span>
        </div>

        <!-- Custom prompt import -->
        <div class="ap-custom-section">
          <div class="ap-custom-label">
            <i class="fas fa-pen-to-square"></i>
            <span>Bring your own prompt</span>
          </div>
          <div class="ap-custom-body" id="ap-custom-body">
            <textarea class="ap-textarea ap-textarea-custom" id="ap-custom-input" rows="6"
                      placeholder="Paste your prompt here…
masterpiece, best quality, newest, very awa, by artist,

solo, anthro, adult,
male, wolf, grey fur, blue eyes,

nude,

standing, looking at viewer"></textarea>
            <button class="btn btn-primary ap-btn ap-btn-load" id="ap-custom-load">
              <i class="fas fa-arrow-right-to-bracket"></i> Load Prompt
            </button>
          </div>
        </div>

        <!-- AI Provider bar -->
        <div class="ap-ai-bar">
          <span class="ap-ai-status" id="ap-ai-status"></span>

          <!-- Provider toggle -->
          <div class="segmented ap-provider-toggle" id="ap-provider-toggle" style="display:none">
            <button class="segmented-btn ap-provider-btn ap-provider-btn--active" id="ap-btn-hf" data-provider="huggingface" title="Use Hugging Face API">
              <i class="fas fa-cloud"></i> HuggingFace
            </button>
            <button class="segmented-btn ap-provider-btn" id="ap-btn-ollama" data-provider="ollama" title="Use local Ollama">
              <i class="fas fa-server"></i> Ollama
            </button>
          </div>

          <!-- HF model badge -->
          <span id="ap-model-badge" class="toolbar-text ap-model-badge" title="Preferred model — configure in Settings"></span>

          <!-- Ollama model selector -->
          <div class="ap-ollama-row" id="ap-ollama-row" style="display:none">
            <select id="ap-ollama-select" class="form-select ap-ollama-select">
              <option value="">— select model —</option>
            </select>
            <button class="btn-icon ap-icon-btn" id="ap-ollama-refresh" title="Refresh model list">
              <i class="fas fa-sync-alt"></i>
            </button>
          </div>

          <!-- Ollama download section -->
          <div class="ap-ollama-pull" id="ap-ollama-pull" style="display:none">
            <div class="ap-ollama-pull-row">
              <input type="text" id="ap-ollama-pull-input" class="form-select ap-ollama-select"
                     placeholder="model:tag  (e.g. llama3:8b)"
                     autocomplete="off" style="flex:1;min-width:0;">
              <button class="btn-icon ap-icon-btn" id="ap-ollama-pull-btn" title="Download model via Ollama">
                <i class="fas fa-download"></i>
              </button>
            </div>
            <div class="ap-ollama-pull-progress" id="ap-ollama-pull-progress" style="display:none">
              <div class="ap-progress-track" style="margin:4px 0 2px;">
                <div class="ap-progress-fill" id="ap-ollama-pull-fill" style="width:0%"></div>
              </div>
              <span class="ap-progress-phase" id="ap-ollama-pull-status"></span>
            </div>
          </div>

          <!-- NSFW toggle -->
          <label class="ap-nsfw-label">
            <input type="checkbox" id="ap-nsfw-check" checked>
            <span>NSFW</span>
          </label>
        </div>

        <!-- Inline AI Edit Popover (fixed, appended to body in initialize) -->

        <!-- AI Progress bar (shown while AI is running) -->
        <div class="ap-progress" id="ap-progress" style="display:none">
          <div class="ap-progress-track">
            <div class="ap-progress-fill" id="ap-progress-fill"></div>
          </div>
          <div class="ap-progress-info">
            <span class="ap-progress-phase" id="ap-progress-phase">Generating…</span>
            <span class="ap-progress-stats" id="ap-progress-stats"></span>
          </div>
        </div>

        <!-- Output (hidden until generated) -->
        <div class="ap-output" id="ap-output" style="display:none">

          <div class="ap-out-section">
            <div class="ap-out-header">
              <span class="ap-out-label">Prompt</span>
              <button class="btn btn-sm ap-copy-btn" id="ap-copy-prompt">
                <i class="fas fa-copy"></i> Copy
              </button>
            </div>
            <textarea class="ap-textarea" id="ap-prompt-out" readonly rows="10"
                      placeholder="Generated prompt will appear here…"></textarea>
          </div>

          <div class="ap-out-section">
            <div class="ap-out-header">
              <span class="ap-out-label">Negative Prompt</span>
              <button class="btn btn-sm ap-copy-btn" id="ap-copy-negative">
                <i class="fas fa-copy"></i> Copy
              </button>
            </div>
            <textarea class="ap-textarea ap-textarea-sm" id="ap-negative-out" readonly rows="4"
                      placeholder="Suggested negative prompt will appear here…"></textarea>
          </div>

        </div>

      </div>
    `;
  }

  async initialize(container) {
    console.log('🔧 Initializing Auto Prompter Tool...');
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this._injectPopover();
      this._setupEvents();
      await this._checkAIStatus();
      console.log('✅ Auto Prompter Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Auto Prompter Tool:', error);
    }
  }

  _injectPopover() {
    // Remove any stale popover from a previous instance
    document.getElementById('ap-inline-edit')?.remove();

    const el = document.createElement('div');
    el.className = 'ap-inline-edit';
    el.id = 'ap-inline-edit';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="ap-inline-header">
        <i class="fas fa-pen"></i>
        <span class="ap-inline-title">Edit with AI</span>
        <button class="ap-inline-copy" id="ap-inline-copy" title="Copy selection">
          <i class="fas fa-copy"></i>
        </button>
        <button class="ap-inline-dismiss" id="ap-inline-dismiss" title="Dismiss">&times;</button>
      </div>
      <div class="ap-inline-preview" id="ap-inline-preview">
        <span class="ap-inline-selected-text" id="ap-inline-selected-text"></span>
      </div>
      <div class="ap-inline-body">
        <input type="text" id="ap-inline-instruction" class="form-input ap-inline-input"
               placeholder="Describe your edit…" autocomplete="off" maxlength="200">
        <button class="btn btn-primary ap-inline-apply" id="ap-inline-apply">
          <i class="fas fa-check"></i>
        </button>
      </div>
    `;
    document.body.appendChild(el);
    this._popover = el;
  }

  _setupEvents() {
    const input       = this.container.querySelector('#ap-id-input');
    const generateBtn = this.container.querySelector('#ap-generate-btn');
    const copyPrompt  = this.container.querySelector('#ap-copy-prompt');
    const copyNeg     = this.container.querySelector('#ap-copy-negative');

    generateBtn.addEventListener('click', () => this._generate());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._generate(); });
    copyPrompt.addEventListener('click', () => this._copyText('#ap-prompt-out'));
    copyNeg.addEventListener('click',    () => this._copyText('#ap-negative-out'));

    // Provider toggle buttons
    const btnHF     = this.container.querySelector('#ap-btn-hf');
    const btnOllama = this.container.querySelector('#ap-btn-ollama');
    if (btnHF)     btnHF.addEventListener('click',     () => this._setProvider('huggingface'));
    if (btnOllama) btnOllama.addEventListener('click', () => this._setProvider('ollama'));

    // Ollama model select
    const ollamaSelect = this.container.querySelector('#ap-ollama-select');
    if (ollamaSelect) {
      ollamaSelect.addEventListener('change', (e) => {
        this._ollamaModel = e.target.value;
      });
    }

    // Refresh Ollama models
    const refreshBtn = this.container.querySelector('#ap-ollama-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this._loadOllamaModels());
    }

    // Ollama pull (download)
    const pullBtn   = this.container.querySelector('#ap-ollama-pull-btn');
    const pullInput = this.container.querySelector('#ap-ollama-pull-input');
    if (pullBtn) {
      pullBtn.addEventListener('click', () => this._pullOllamaModel());
    }
    if (pullInput) {
      pullInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._pullOllamaModel(); });
    }

    // NSFW checkbox
    const nsfwCheck = this.container.querySelector('#ap-nsfw-check');
    if (nsfwCheck) {
      nsfwCheck.addEventListener('change', (e) => { this._nsfw = e.target.checked; });
    }

    // Load custom prompt
    const customLoad = this.container.querySelector('#ap-custom-load');
    if (customLoad) {
      customLoad.addEventListener('click', () => this._loadCustomPrompt());
    }

    // Inline AI edit
    this._setupInlineEdit();
  }

  // ─── Inline AI Edit ───────────────────────────────────────────────────────

  _setupInlineEdit() {
    const textarea = this.container.querySelector('#ap-prompt-out');
    if (!textarea) return;

    // Show popover when user finishes a selection
    textarea.addEventListener('mouseup', (e) => {
      const start = textarea.selectionStart;
      const end   = textarea.selectionEnd;
      if (start === end) { this._hideInlineEdit(); return; }
      this._showInlineEdit(e.clientX, e.clientY, textarea, start, end);
    });

    // Hide when selection collapses via keyboard
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._hideInlineEdit();
    });

    // Popover buttons
    this._popover.querySelector('#ap-inline-dismiss')
      .addEventListener('click', () => this._hideInlineEdit());

    this._popover.querySelector('#ap-inline-copy')
      .addEventListener('click', () => {
        if (this._inlineSelection?.text) {
          navigator.clipboard.writeText(this._inlineSelection.text)
            .then(() => this.showToast('Copied!', 'success'))
            .catch(() => this.showToast('Copy failed', 'error'));
        }
      });

    this._popover.querySelector('#ap-inline-apply')
      .addEventListener('click', () => this._applyInlineEdit());

    this._popover.querySelector('#ap-inline-instruction')
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._applyInlineEdit(); }
        if (e.key === 'Escape') this._hideInlineEdit();
      });

    // Click outside popover → hide
    this._outsideClickHandler = (e) => {
      if (this._popover.style.display === 'none') return;
      if (!this._popover.contains(e.target) && e.target !== textarea) {
        this._hideInlineEdit();
      }
    };
    document.addEventListener('mousedown', this._outsideClickHandler);
  }

  _showInlineEdit(clientX, clientY, textarea, start, end) {
    this._inlineSelection = { start, end, text: textarea.value.slice(start, end) };

    // Clamp position so the popover stays on screen
    const pw = 340;
    const x  = Math.min(clientX, window.innerWidth  - pw - 12);
    const y  = clientY + 18;

    this._popover.style.left    = `${x}px`;
    this._popover.style.top     = `${y}px`;
    this._popover.style.display = 'block';

    // Preview the selected text (truncate long selections)
    const preview = this._popover.querySelector('#ap-inline-selected-text');
    const raw = this._inlineSelection.text;
    preview.textContent = raw.length > 70 ? raw.slice(0, 70) + '…' : raw;

    // Focus the instruction input
    setTimeout(() => this._popover.querySelector('#ap-inline-instruction')?.focus(), 40);
  }

  _hideInlineEdit() {
    if (!this._popover) return;
    this._popover.style.display = 'none';
    this._popover.querySelector('#ap-inline-instruction').value = '';
    this._inlineSelection = null;
  }

  /**
   * Classify the user's intent so we can give the AI a precise directive.
   * Returns 'add' | 'remove' | 'replace' | 'enhance' | 'unknown'
   */
  _classifyEditIntent(instruction) {
    const t = instruction.toLowerCase();
    if (/\b(add|include|insert|append|also|put in|attach|tack on)\b/.test(t))     return 'add';
    if (/\b(remov|delet|strip|clear|erase|get rid|drop|take out)\b/.test(t))      return 'remove';
    if (/\b(replac|swap|switch|change|turn into|convert|update to|use)\b/.test(t)) return 'replace';
    if (/\b(improv|enhanc|refin|better|expand|elaborat|strengthen|detail)\b/.test(t)) return 'enhance';
    return 'unknown';
  }

  /**
   * Parse a comma/newline separated tag string into a de-duped lowercase array.
   */
  _parseTags(text) {
    return text.split(/[\n,]+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
  }

  async _applyInlineEdit() {
    // Shares `isLoading` with the main Generate flow (see _generate()) since
    // both drive the same #ap-progress bar through the same 'ai:progress'
    // IPC channel - letting them run concurrently made the bar flicker
    // between two unrelated requests' token counts and phases.
    if (this.isLoading) return;

    const instruction = this._popover.querySelector('#ap-inline-instruction').value.trim();
    if (!instruction || !this._inlineSelection) return;

    const textarea   = this.container.querySelector('#ap-prompt-out');
    const fullPrompt = textarea.value;
    const { start, end, text } = this._inlineSelection;

    const applyBtn = this._popover.querySelector('#ap-inline-apply');
    const input    = this._popover.querySelector('#ap-inline-instruction');
    applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    applyBtn.disabled  = true;
    input.disabled     = true;
    textarea.style.pointerEvents = 'none';
    this.isLoading = true;

    const provider = this._provider;
    const model    = provider === 'ollama'
      ? (this.container.querySelector('#ap-ollama-select')?.value || this._ollamaModel || '')
      : (this.container.querySelector('#ap-model-badge')?.dataset.modelId || this._hfModel || '');

    // Classify intent before sending to AI so we can give a precise directive
    const intent = this._classifyEditIntent(instruction);
    const existingTags = this._parseTags(text);

    // Build an intent-specific directive that tells the model exactly what
    // kind of operation this is, leaving no room for misinterpretation
    const intentDirectives = {
      add: `OPERATION: ADDITION
You must ADD new content to the selection. Every single existing tag listed in the CURRENT SELECTION must appear in your output — not one may be dropped or altered. Only append/insert the new tag(s) that the instruction requests. Think of it as inserting into a list, not replacing it.`,

      remove: `OPERATION: REMOVAL
Remove ONLY the specific tag(s) or content the instruction names. Every OTHER tag in the selection must be preserved exactly as written. Do not reorder or reformat anything else.`,

      replace: `OPERATION: REPLACEMENT
Replace ONLY the specific tag(s) the instruction names with the new value. Every other tag in the selection must appear in your output unchanged.`,

      enhance: `OPERATION: ENHANCEMENT
Improve or expand the selection while keeping all existing tags. You may add synonyms, more-descriptive alternatives, or related tags — but do not remove any existing tag unless it directly contradicts your addition.`,

      unknown: `OPERATION: SELECTIVE EDIT
Apply only what the instruction explicitly requests. All existing tags that are not mentioned in the instruction must remain in the output exactly as they are.`
    };

    const intentDirective = intentDirectives[intent];

    try {
      // Build context: everything before and after the selection, so the AI
      // understands what tags already exist in the prompt and avoids duplicating
      // or contradicting them. Only the selection itself will be replaced.
      const before = fullPrompt.slice(0, start).trim();
      const after  = fullPrompt.slice(end).trim();
      const contextNote = [
        before ? `Tags BEFORE selection (read-only context — do NOT reproduce these in output):\n${before}` : '',
        after  ? `Tags AFTER selection (read-only context — do NOT reproduce these in output):\n${after}`   : ''
      ].filter(Boolean).join('\n\n');

      // For ADD/ENHANCE, give the model an explicit checklist of tags it must preserve
      const mustKeepNote = (intent === 'add' || intent === 'enhance') && existingTags.length
        ? `\nTAGS YOU MUST KEEP (every one of these must appear in your output):\n${existingTags.map(t => `  • ${t}`).join('\n')}`
        : '';

      const messages = [
        {
          role: 'system',
          content: `You are a surgical text editor for AI image generation tag prompts.
You receive a selected block of tags and a user instruction. Output ONLY the modified version of that selection — nothing else.

${intentDirective}

UNIVERSAL RULES (override nothing above, apply to all operations):
- Output ONLY the final tag text. No preamble, no explanation, no quotes, no code fences.
- Match the original formatting exactly: lowercase, comma-separated, same line-break structure.
- Do NOT duplicate any tag already present in the surrounding context (read-only sections above).
- Do NOT output the read-only context sections in your response — only the selection content.
- If the result of a removal is an empty selection, output nothing (empty string).${mustKeepNote}`
        },
        {
          role: 'user',
          content: [
            contextNote,
            `CURRENT SELECTION:\n${text}`,
            `INSTRUCTION: ${instruction}`
          ].filter(Boolean).join('\n\n')
        }
      ];

      const editMaxTokens = provider === 'ollama' ? 2000 : 300;
      // Only Ollama streams tokens back (see AIService.ollamaChatCompletion);
      // HF's chatCompletion resolves in one shot, so there's no per-token
      // signal to size a determinate bar from - pass 0 to keep it indeterminate.
      this._showProgress(provider === 'ollama' ? editMaxTokens : 0);
      let cleanupProgress = null;
      if (window.electronAPI.ai.onProgress) {
        cleanupProgress = window.electronAPI.ai.onProgress((data) => this._updateProgress(data));
      }

      let result;
      try {
        result = await window.electronAPI.ai.chatCompletion(messages, {
          provider,
          maxTokens: editMaxTokens,
          temperature: 0.6,
          ...(model ? { model } : {})
        });
      } finally {
        if (cleanupProgress) cleanupProgress();
        this._hideProgress();
      }

      if (!result.success) throw new Error(result.message || 'AI edit failed');

      // Strip any preamble a talkative model might prepend, then clean code fences
      let replacement = (result.response || '')
        .replace(/^```[^\n]*\n?/, '').replace(/```$/, '') // strip code fences
        .replace(/^(here(?:'s| is)(?: the)?(?: replacement| result| output)?:?\s*)/i, '')
        .replace(/^(replacement|result|output|modified selection|updated selection):?\s*/i, '')
        .replace(/^["']|["']$/g, '')                       // strip wrapping quotes
        .trim();

      // Safety net for ADD / ENHANCE: if the AI silently dropped any existing
      // tags, re-inject the missing ones so we never lose content.
      if ((intent === 'add' || intent === 'enhance') && existingTags.length) {
        const outputTags  = this._parseTags(replacement);
        const outputSet   = new Set(outputTags);
        const missing     = existingTags.filter(t => !outputSet.has(t));
        if (missing.length) {
          // Append the missing tags at the end, preserving original order
          const sep = replacement && !replacement.endsWith(',') ? ', ' : '';
          replacement = replacement + sep + missing.join(', ');
        }
      }

      // If instruction was to remove, allow empty replacement
      const isRemoveIntent = intent === 'remove' || /\b(remov|delet|strip|clear|erase)\b/i.test(instruction);
      if (!replacement && !isRemoveIntent) throw new Error('AI returned an empty replacement');

      // Splice ONLY the selection — nothing outside start/end is touched
      textarea.value          = fullPrompt.slice(0, start) + replacement + fullPrompt.slice(end);
      this.generatedPrompt    = textarea.value;
      textarea.selectionStart = textarea.selectionEnd = start + replacement.length;

      this._hideInlineEdit();
      this.showToast('Edit applied', 'success');
    } catch (err) {
      this.showToast(`AI edit failed: ${err.message}`, 'error');
    } finally {
      applyBtn.innerHTML = '<i class="fas fa-check"></i>';
      applyBtn.disabled  = false;
      input.disabled     = false;
      textarea.style.pointerEvents = '';
      this.isLoading = false;
    }
  }

  // ─── Custom prompt loader ─────────────────────────────────────────────────

  _loadCustomPrompt() {
    const customInput = this.container.querySelector('#ap-custom-input');
    const raw = customInput?.value.trim();
    if (!raw) {
      this.showToast('Paste a prompt first', 'warning');
      return;
    }

    // Populate the output textarea and show the output panel
    const pOut = this.container.querySelector('#ap-prompt-out');
    if (pOut) pOut.value = raw;
    this.generatedPrompt = raw;

    // Build a rule-based negative prompt from whatever we can parse out of the text
    const guessedTags = raw.split(/[\n,]+/).map(t => t.trim().replace(/_/g, ' ')).filter(Boolean);
    const categories  = this._categorizeTags(guessedTags, []);
    const negative    = this._buildNegativePrompt(categories);
    const nOut = this.container.querySelector('#ap-negative-out');
    if (nOut) nOut.value = negative;

    this.container.querySelector('#ap-output').style.display = 'flex';

    // Clear the textarea and keep the section open — ready for the next one
    customInput.value = '';
    customInput.focus();

    this.showToast('Prompt loaded', 'success');
  }

  _setProvider(provider) {
    this._provider = provider;

    const btnHF       = this.container.querySelector('#ap-btn-hf');
    const btnOllama   = this.container.querySelector('#ap-btn-ollama');
    const badge       = this.container.querySelector('#ap-model-badge');
    const ollamaRow   = this.container.querySelector('#ap-ollama-row');
    const ollamaPull  = this.container.querySelector('#ap-ollama-pull');

    if (provider === 'ollama') {
      btnHF?.classList.remove('ap-provider-btn--active');
      btnOllama?.classList.add('ap-provider-btn--active');
      if (badge)      badge.style.display      = 'none';
      if (ollamaRow)  ollamaRow.style.display  = 'flex';
      if (ollamaPull) ollamaPull.style.display = 'block';
      this._loadOllamaModels();
    } else {
      btnOllama?.classList.remove('ap-provider-btn--active');
      btnHF?.classList.add('ap-provider-btn--active');
      if (badge)      badge.style.display      = '';
      if (ollamaRow)  ollamaRow.style.display  = 'none';
      if (ollamaPull) ollamaPull.style.display = 'none';
    }
  }

  async _loadOllamaModels() {
    const select     = this.container.querySelector('#ap-ollama-select');
    const refreshBtn = this.container.querySelector('#ap-ollama-refresh');
    if (!select) return;

    if (refreshBtn) refreshBtn.classList.add('fa-spin');
    select.disabled = true;
    select.innerHTML = '<option value="">Loading…</option>';

    try {
      const result = await window.electronAPI.ai.listOllamaModels();
      if (!result.success || !result.models?.length) {
        select.innerHTML = '<option value="">No models found</option>';
        this.showToast(result.message || 'No Ollama models found', 'warning');
        return;
      }

      select.innerHTML = '<option value="">— select model —</option>';
      for (const m of result.models) {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        select.appendChild(opt);
      }

      // Restore previously selected model if still present
      if (this._ollamaModel) {
        select.value = this._ollamaModel;
      }
      // Auto-select if only one model
      if (result.models.length === 1) {
        select.value = result.models[0].name;
        this._ollamaModel = result.models[0].name;
      }
    } catch (err) {
      select.innerHTML = '<option value="">Error loading models</option>';
      this.showToast('Could not reach Ollama', 'error');
    } finally {
      select.disabled = false;
      if (refreshBtn) refreshBtn.classList.remove('fa-spin');
    }
  }

  async _pullOllamaModel() {
    const input      = this.container.querySelector('#ap-ollama-pull-input');
    const pullBtn    = this.container.querySelector('#ap-ollama-pull-btn');
    const progressEl = this.container.querySelector('#ap-ollama-pull-progress');
    const fillEl     = this.container.querySelector('#ap-ollama-pull-fill');
    const statusEl   = this.container.querySelector('#ap-ollama-pull-status');

    const modelName = input?.value.trim();
    if (!modelName) { this.showToast('Enter a model name first', 'warning'); return; }

    // Lock UI
    if (pullBtn) { pullBtn.disabled = true; pullBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    if (progressEl) progressEl.style.display = 'block';
    if (statusEl)   statusEl.textContent = 'Starting download…';
    if (fillEl)     fillEl.style.width   = '0%';

    // Listen for progress events
    let removeListener = null;
    if (window.electronAPI.ai.onOllamaPullProgress) {
      removeListener = window.electronAPI.ai.onOllamaPullProgress((data) => {
        if (!statusEl || !fillEl) return;
        statusEl.textContent = data.status || '';
        if (data.percent != null) {
          fillEl.style.width = `${data.percent}%`;
        } else if (data.status && !data.total) {
          // Indeterminate phases (manifest, verifying, etc.) — pulse at 100%
          fillEl.style.width = '100%';
          fillEl.style.opacity = '0.5';
        }
      });
    }

    try {
      const result = await window.electronAPI.ai.pullOllamaModel(modelName);
      if (result.success) {
        if (fillEl)   { fillEl.style.width = '100%'; fillEl.style.opacity = '1'; }
        if (statusEl) statusEl.textContent = 'Download complete!';
        if (input)    input.value = '';
        this.showToast(`${modelName} downloaded`, 'success');
        // Refresh the model selector so the new model appears
        await this._loadOllamaModels();
        // Auto-select the newly downloaded model
        const select = this.container.querySelector('#ap-ollama-select');
        if (select && modelName) {
          // Ollama may normalise the name (e.g. add :latest) — find closest match
          const matchingOpt = Array.from(select.options).find(o => o.value.startsWith(modelName.split(':')[0]));
          if (matchingOpt) {
            select.value = matchingOpt.value;
            this._ollamaModel = matchingOpt.value;
          }
        }
      } else {
        if (statusEl) statusEl.textContent = `${result.message}`;
        this.showToast(result.message || 'Download failed', 'error');
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = `${err.message}`;
      this.showToast('Download failed', 'error');
    } finally {
      if (removeListener) removeListener();
      if (pullBtn) { pullBtn.disabled = false; pullBtn.innerHTML = '<i class="fas fa-download"></i>'; }
      // Hide progress bar after a moment
      setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 4000);
    }
  }

  _modelShortName(modelId) {
    const names = {
      'Qwen/Qwen2.5-72B-Instruct': 'Qwen 2.5 72B',
      'meta-llama/Llama-3.3-70B-Instruct': 'Llama 3.3 70B',
      'mistralai/Mistral-Nemo-Instruct-2407': 'Mistral Nemo 12B',
    };
    return names[modelId] || (modelId ? modelId.split('/').pop() : 'Default Model');
  }

  async _checkAIStatus() {
    const status  = this.container.querySelector('#ap-ai-status');
    const badge   = this.container.querySelector('#ap-model-badge');
    const toggle  = this.container.querySelector('#ap-provider-toggle');

    // Check HuggingFace
    let hfEnabled = false;
    try {
      const result = await window.electronAPI.ai.isEnabled();
      hfEnabled = result?.enabled || false;
    } catch { /* ignore */ }

    // Check Ollama reachability
    let ollamaOk = false;
    try {
      const check = await window.electronAPI.ai.checkOllama();
      ollamaOk = check?.success || false;
    } catch { /* ignore */ }

    this._aiEnabled = hfEnabled || ollamaOk;

    if (!this._aiEnabled) {
      if (status) {
        status.textContent = 'AI inactive — configure Hugging Face in Settings or start Ollama';
        status.className   = 'ap-ai-status ap-ai-status-off';
      }
      if (badge)  badge.textContent  = '';
      if (toggle) toggle.style.display = 'none';
      return;
    }

    if (status) {
      status.textContent = 'AI active';
      status.className   = 'ap-ai-status ap-ai-status-on';
    }

    // Show provider toggle only when both are available, or at least one
    if (toggle) toggle.style.display = 'flex';

    // Default provider: prefer HF if configured, else Ollama
    if (!hfEnabled && ollamaOk) {
      this._setProvider('ollama');
    } else {
      // Show HF badge
      if (badge && window.electronAPI?.settings?.get) {
        const saved   = await window.electronAPI.settings.get('huggingface.preferredModel');
        const modelId = saved?.value || 'Qwen/Qwen2.5-72B-Instruct';
        this._hfModel             = modelId;
        badge.textContent         = this._modelShortName(modelId);
        badge.dataset.modelId     = modelId;
      }
    }

    // Disable the Ollama toggle button if Ollama isn't reachable
    const btnOllama = this.container.querySelector('#ap-btn-ollama');
    if (btnOllama && !ollamaOk) {
      btnOllama.disabled = true;
      btnOllama.title    = 'Ollama not reachable — start Ollama to use local models';
    }
  }

  // ─── AI Progress bar ──────────────────────────────────────────────────────

  /**
   * @param {number} maxTokens - expected token budget for this request (see
   *   call sites for how each mirrors the AIService maxTokens it actually
   *   sent). 0 means no per-token signal exists (HF's chatCompletion doesn't
   *   stream), so the bar stays on the indeterminate pulse the whole time
   *   instead of pretending to track real progress.
   */
  _showProgress(maxTokens = 0) {
    const wrap  = this.container.querySelector('#ap-progress');
    const phase = this.container.querySelector('#ap-progress-phase');
    const stats = this.container.querySelector('#ap-progress-stats');
    const fill  = this.container.querySelector('#ap-progress-fill');
    if (wrap)  { wrap.style.display = 'flex'; wrap.classList.remove('is-determinate'); }
    if (phase) phase.textContent = 'Waiting for model…';
    if (stats) stats.textContent = '';
    if (fill)  fill.style.transform = '';
    this._progressMaxTokens = maxTokens;
    this._progressRAF = null;
    this._progressPending = null;
  }

  /**
   * Streaming Ollama responses can fire a token delta dozens of times a
   * second; painting the DOM on every single one made the stats text and
   * fill width flicker instead of reading as smooth progress. This coalesces
   * bursts down to at most one repaint per animation frame.
   */
  _updateProgress(data) {
    this._progressPending = data;
    if (this._progressRAF) return;
    this._progressRAF = requestAnimationFrame(() => {
      this._progressRAF = null;
      this._paintProgress(this._progressPending);
    });
  }

  _paintProgress({ phase, tokens, elapsed }) {
    const wrap    = this.container.querySelector('#ap-progress');
    const phaseEl = this.container.querySelector('#ap-progress-phase');
    const statsEl = this.container.querySelector('#ap-progress-stats');
    const fillEl  = this.container.querySelector('#ap-progress-fill');
    if (!phaseEl) return;

    if (phase === 'generating') {
      phaseEl.textContent = 'Generating…';
      const secs = (elapsed / 1000).toFixed(1);

      // Elapsed is a few ms on the first tick or two - dividing by that
      // spiked the rate to nonsense values (e.g. "2000 t/s") before settling.
      // Wait for a less noisy window before showing a rate at all.
      if (tokens > 0 && elapsed >= 300) {
        const tps = (tokens / (elapsed / 1000)).toFixed(1);
        if (statsEl) statsEl.textContent = `${tokens} tokens · ${secs}s · ${tps} t/s`;
      } else if (tokens > 0) {
        if (statsEl) statsEl.textContent = `${tokens} tokens · ${secs}s`;
      } else {
        if (statsEl) statsEl.textContent = `${secs}s`;
      }

      if (fillEl && this._progressMaxTokens > 0 && tokens > 0) {
        wrap?.classList.add('is-determinate');
        // scaleX rather than width - transform is compositor-only and avoids
        // forcing layout on every animation-frame repaint (see CSS).
        const ratio = Math.min(1, tokens / this._progressMaxTokens);
        fillEl.style.transform = `scaleX(${ratio})`;
      }
    } else if (phase === 'done') {
      phaseEl.textContent = 'Done';
      const secs = (elapsed / 1000).toFixed(1);
      if (statsEl) statsEl.textContent = `${tokens} tokens in ${secs}s`;
      if (fillEl && wrap?.classList.contains('is-determinate')) fillEl.style.transform = 'scaleX(1)';
    }
  }

  _hideProgress() {
    const wrap = this.container.querySelector('#ap-progress');
    if (wrap) { wrap.style.display = 'none'; wrap.classList.remove('is-determinate'); }
    if (this._progressRAF) { cancelAnimationFrame(this._progressRAF); this._progressRAF = null; }
    this._progressPending = null;
  }

  // ─── Main generate ────────────────────────────────────────────────────────

  async _generate() {
    if (this.isLoading) return;
    this._hideInlineEdit();

    const input   = this.container.querySelector('#ap-id-input');
    const postId  = input?.value.trim();

    if (!postId || !/^\d+$/.test(postId)) {
      this.showToast('Enter a valid numeric post ID', 'warning');
      return;
    }

    const generateBtn = this.container.querySelector('#ap-generate-btn');
    this.isLoading    = true;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching…';

    // UI safety net — if the IPC call never returns, reset the button after 140s
    const uiTimeout = setTimeout(() => {
      if (!this.isLoading) return;
      this.isLoading = false;
      generateBtn.disabled = false;
      generateBtn.innerHTML = 'Generate';
      this.showToast('Request timed out — the model may be busy. Try again.', 'error');
    }, 140_000);

    try {
      const result = await window.electronAPI.e621.fetchPost(postId);
      if (!result.success) throw new Error(result.message || 'Failed to fetch post');

      this.currentPostData = result.post;

      if (this._aiEnabled) {
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
        // Mirrors the maxTokens AIService.analyzeAndOptimizePrompt() actually
        // requests (see src/main/services/AIService.js) so the determinate
        // bar's percentage lines up with reality; HF never streams tokens
        // back, so 0 keeps it on the honest indeterminate pulse instead.
        this._showProgress(this._provider === 'ollama' ? 8000 : 0);
        let cleanupProgress = null;
        if (window.electronAPI.ai.onProgress) {
          cleanupProgress = window.electronAPI.ai.onProgress((data) => this._updateProgress(data));
        }
        try {
          await this._generateWithAI(result.post);
        } finally {
          if (cleanupProgress) cleanupProgress();
          this._hideProgress();
        }
      } else {
        this._generateRuleBased(result.post);
      }

      this.container.querySelector('#ap-output').style.display = 'flex';

    } catch (err) {
      console.error('❌ Auto Prompter error:', err);
      this.showToast(`Error: ${err.message}`, 'error');
    } finally {
      clearTimeout(uiTimeout);
      this.isLoading = false;
      generateBtn.disabled = false;
      generateBtn.innerHTML = 'Generate';
    }
  }

  // ─── Rule-based ───────────────────────────────────────────────────────────

  _generateRuleBased(post) {
    const allTags   = Object.values(post.tags || {}).flat().map(t => String(t).trim()).filter(Boolean);
    const categories = this._categorizeTags(allTags, post.tags?.artist || []);
    const prompt    = this._buildStructuredPrompt(categories);
    const negative  = this._buildNegativePrompt(categories);
    this._setOutput(prompt, negative);
    this.generatedPrompt = prompt;
    this.showToast('Prompt generated', 'success');
  }

  // ─── AI mode ─────────────────────────────────────────────────────────────

  async _generateWithAI(post) {
    // Flatten all tags for rule-based fallback
    const allTags = Object.values(post.tags || {}).flat()
      .map(t => String(t).trim())
      .filter(t => t && t !== '[object Object]');

    // Build structured tag object — send all E621 categories separately so
    // the AI can make smarter decisions about placement in the 4 sections.
    const rawTags  = post.tags || {};
    const tagsByCategory = {
      artist:    (rawTags.artist    || []).map(t => String(t).trim()).filter(Boolean),
      species:   (rawTags.species   || []).map(t => String(t).trim()).filter(Boolean),
      character: (rawTags.character || []).map(t => String(t).trim()).filter(Boolean),
      general:   (rawTags.general   || []).map(t => String(t).trim()).filter(Boolean),
      copyright: (rawTags.copyright || []).map(t => String(t).trim()).filter(Boolean),
      lore:      (rawTags.lore      || []).map(t => String(t).trim()).filter(Boolean),
      meta:      (rawTags.meta      || []).map(t => String(t).trim()).filter(Boolean)
    };

    const categories = this._categorizeTags(allTags, rawTags.artist || []);

    // Determine provider and model
    const provider = this._provider;
    const model    = provider === 'ollama'
      ? (this.container.querySelector('#ap-ollama-select')?.value || this._ollamaModel || '')
      : (this.container.querySelector('#ap-model-badge')?.dataset.modelId || this._hfModel || '');

    if (provider === 'ollama' && !model) {
      this.showToast('Select an Ollama model first', 'warning');
      this._generateRuleBased(post);
      return;
    }

    console.log(`🤖 Generating with ${provider}${model ? ` / ${model}` : ''} | NSFW: ${this._nsfw}`);
    if (this._nsfw) {
      console.log('🔞 NSFW mode enabled — explicit tags will be included in prompt');
    }

    try {
      const result = await window.electronAPI.ai.optimizePrompt(allTags, {
        tagsByCategory,
        provider,
        nsfw: this._nsfw,
        ...(model ? { model } : {})
      });

      if (!result.success) throw new Error(result.message || 'AI failed');

      const prompt   = this._normalizeAIOutput(result.optimizedPrompt);
      const negative = result.negativePrompt?.trim() || this._buildNegativePrompt(categories);
      this._setOutput(prompt, negative);
      this.generatedPrompt = prompt;

      const providerLabel = provider === 'ollama' ? `Ollama (${model})` : this._modelShortName(model);
      this.showToast(`AI prompt generated via ${providerLabel}`, 'success');

    } catch (err) {
      console.warn('⚠️ AI failed, falling back to rule-based:', err.message);
      this.showToast(`AI error — using rule-based fallback`, 'warning');
      this._generateRuleBased(post);
    }
  }

  /**
   * Clean up AI output — it already uses the correct 4-section format.
   */
  _normalizeAIOutput(rawPrompt) {
    // Strip NEGATIVE: section if the AI included it in the positive block
    const positiveOnly = rawPrompt.split(/\bNEGATIVE:\s*/i)[0];

    // Strip any accidental label prefixes the model might prepend
    const cleaned = positiveOnly
      .replace(/^(OPTIMIZED_PROMPT:|PROMPT:)\s*/i, '')
      .trim();

    // Ensure the last line has no trailing comma
    const lines = cleaned.split('\n');
    const lastIdx = lines.length - 1;
    lines[lastIdx] = lines[lastIdx].replace(/,\s*$/, '');

    return lines.join('\n');
  }

  // ─── Tag categorisation ───────────────────────────────────────────────────

  _categorizeTags(tags, artistTags = []) {
    const artistSet = new Set(artistTags.map(a => a.toLowerCase()));

    const out = {
      quality: [], camera: [], setting: [], lighting: [],
      charCount: [], form: [], speciesBroad: [],
      gender: [], speciesSpecific: [], bodyFeatures: [],
      clothing: [], actions: [],
      ignored: []
    };

    const qualityExact = new Set([
      'masterpiece', 'best_quality', 'best quality', 'newest', 'very_awa', 'very awa',
      'detailed', 'amazing_quality',
      'film_grain', 'film grain', 'white_border', 'white border'
    ]);
    const qualityPat = /masterpiece|best.quality|film.?grain|white.?border|amazing.quality/i;

    // Media/format tags ("digital_drawing_(artwork)", "traditional media") and
    // resolution tags ("hi_res", "absurd_res") describe the *source post*, not
    // something to carry into a new generation — dropped rather than dumped
    // into Section 1 verbatim (underscores/parens and all).
    // No \b around "media" - tags use underscores as separators
    // ("digital_media"), and \w treats underscore as a word character, so a
    // word-boundary check there would silently never match.
    const mediaOrResPat = /artwork|media|hi.?res|high.?res|absurd.?res|resolution/i;

    const cameraPat = /angle|pov|portrait|close.?up|wide.?angle|fisheye|cinematic|over.the.shoulder|from.above|from.below|from.side|dutch/i;

    const settingPat = /indoor|outdoor|inside|outside|beach|ocean|sea|forest|woods|sky|city|room|bedroom|kitchen|office|school|park|mountain|space|spacecraft|cockpit|dark.ambiance|ambiance|background|stage|corridor|alley|urban|street/i;
    const lightingPat = /sunlight|moonlight|daylight|glow|shadow|backlight|rimlight|neon|dark(?!.ambiance)\b/i;

    const charCountExact = new Set(['solo', 'duo', 'trio', 'group', 'multiple_characters', 'multiple characters']);
    const formExact = new Set(['anthro', 'feral', 'human', 'humanoid', 'taur', 'furry']);

    // Broad species groupings (for line 2a)
    const speciesBroadPat = /canine|feline|dragon|equine|reptile|rodent|cervine|ursine|lupine|vulpine|chiropteran|lagomorph/i;

    // Specific species (for line 2b, checked BEFORE broad)
    const speciesSpecificExact = new Set(['avian', 'canid', 'felid', 'equid']);
    const speciesSpecificPat   = /wolf|fox|cat|dog|horse|bird|passerine|parrot|hawk|eagle|owl|raven|crow|songbird|raptor|snake|lizard|gecko|rabbit|deer|bear|tiger|lion|panther|cheetah|rat|mouse|bunny|otter|shark|fish/i;

    const genderExact = new Set(['male', 'female', 'intersex', 'ambiguous_gender', 'herm', 'andromorph', 'gynomorph']);

    const clothingStateExact = new Set(['nude', 'naked', 'clothed', 'fully_clothed', 'fully clothed', 'topless', 'bottomless', 'partially_clothed', 'partially clothed']);
    const clothingItemPat    = /shirt|top|vest|jacket|coat|bodysuit|suit|pants|jeans|shorts|skirt|dress|underwear|bra|gloves?|hat|helmet|headgear|earpiece|shoes?|boots?|socks?|collar|sleeves?|gauntlet|armor|armour|uniform/i;

    const actionExact = new Set(['looking_at_viewer', 'looking_away', 'looking afar', 'looking_afar', 'eyes_closed']);
    const actionPat   = /sitting|standing|lying|kneeling|walking|running|jumping|flying|swimming|grabbing|holding|looking|watching|captaining|piloting|reaching|leaning|crouching|posing/i;

    const bodyPat = /fur|feather|scale|tail|wing|horn|claw|paw|hoof|beak|snout|mane|muzzle|slim|muscular|athletic|chubby|heavy|thick|petite|short|tall|adult|aged|ears?|eyes?|hair|half.?lidded|half[-_ ]closed|lithe|lanky|penis|balls|genital|foreskin|flaccid|erect|navel|v.?line|sheath|vulva|vagina|breast|nipple|areola|phallus|testicle|scrotum|clitoris|anus|rectum|pubes|pubic/i;

    const metaPat = /signature|watermark|text|dialogue|speech|20\d{2}|patreon|twitter|deviantart|logo/i;

    for (const rawTag of tags) {
      const tag = rawTag.trim();
      const tl  = tag.toLowerCase();
      if (!tag) continue;

      if (artistSet.has(tl))                { out.ignored.push(tag);         continue; }
      if (metaPat.test(tl))                 { out.ignored.push(tag);         continue; }
      if (mediaOrResPat.test(tl))           { out.ignored.push(tag);         continue; }
      if (qualityExact.has(tl) || qualityPat.test(tl)) { out.quality.push(tag); continue; }
      if (cameraPat.test(tl))              { out.camera.push(tag);          continue; }
      if (lightingPat.test(tl))            { out.lighting.push(tag);        continue; }
      if (settingPat.test(tl))             { out.setting.push(tag);         continue; }
      if (charCountExact.has(tl))          { out.charCount.push(tag);       continue; }
      if (formExact.has(tl))               { out.form.push(tag);            continue; }
      if (genderExact.has(tl))             { out.gender.push(tag);          continue; }
      if (clothingStateExact.has(tl))      { out.clothing.push(tag);        continue; }
      // Species specifics checked before broad
      if (speciesSpecificExact.has(tl) || speciesSpecificPat.test(tl)) { out.speciesSpecific.push(tag); continue; }
      if (speciesBroadPat.test(tl))        { out.speciesBroad.push(tag);    continue; }
      if (clothingItemPat.test(tl))        { out.clothing.push(tag);        continue; }
      if (actionExact.has(tl) || actionPat.test(tl)) { out.actions.push(tag); continue; }
      if (bodyPat.test(tl))                { out.bodyFeatures.push(tag);    continue; }

      // Unmatched — add to bodyFeatures as catch-all
      out.bodyFeatures.push(tag);
    }

    // Dedupe
    for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];

    return out;
  }

  // ─── Prompt builder ───────────────────────────────────────────────────────

  _buildStructuredPrompt(categories) {
    // No artist attribution appended here - trigger words are LoRA/user-specific,
    // not derivable from the source post's artist tag, so it's left for the
    // user to add themselves rather than guessed at.
    const qualityParts  = categories.quality.length ? categories.quality : ['masterpiece', 'best quality', 'newest'];
    const qualityLine   = [
      ...qualityParts,
      ...categories.setting,
      ...categories.lighting,
      ...categories.camera
    ].join(', ');

    return this._assembleBlocks(qualityLine, categories);
  }

  /**
   * Assemble the final prompt from a quality line string + categories object.
   * Format:
   *   {quality, setting, camera, artist},
   *
   *   {charCount, form, speciesBroad},
   *   {gender, speciesSpecific, bodyFeatures},
   *
   *   {clothing},
   *
   *   {actions}          ← no trailing comma on last line
   */
  _assembleBlocks(qualityLine, categories) {
    const blocks = [];

    // Block 1: quality + environment
    if (qualityLine.trim()) blocks.push([qualityLine.trim()]);

    // Block 2: character (two sub-lines)
    const charLine1 = [
      ...(categories.charCount.length ? categories.charCount : ['solo']),
      ...categories.form,
      ...categories.speciesBroad
    ].join(', ');
    const charLine2 = [
      ...categories.gender,
      ...categories.speciesSpecific,
      ...categories.bodyFeatures.slice(0, 8)
    ].join(', ');
    const charBlock = [charLine1, charLine2].filter(Boolean);
    if (charBlock.length) blocks.push(charBlock);

    // Block 3: clothing
    if (categories.clothing.length) blocks.push([categories.clothing.join(', ')]);

    // Block 4: actions
    if (categories.actions.length) blocks.push([categories.actions.join(', ')]);

    // Render: trailing comma on every line except the very last
    const outputLines = [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      for (let li = 0; li < block.length; li++) {
        const isLastLine = (bi === blocks.length - 1) && (li === block.length - 1);
        outputLines.push(isLastLine ? block[li] : block[li] + ',');
      }
      if (bi < blocks.length - 1) outputLines.push(''); // blank line between blocks
    }

    return outputLines.join('\n').trim();
  }

  // ─── Negative prompt ──────────────────────────────────────────────────────

  _buildNegativePrompt(categories) {
    const base = [
      'lowres', 'bad anatomy', 'bad hands', 'malformed hands', 'extra fingers',
      'fused fingers', 'missing fingers', 'extra limbs', 'deformed', 'disfigured',
      'text', 'watermark', 'signature', 'username', 'error', 'jpeg artifacts',
      'old', 'oldest', 'jaggy lines'
    ];
    const ctx = [];

    if (categories.charCount.some(t => t.toLowerCase() === 'solo')) {
      ctx.push('multiple characters', 'duo', 'group');
    }

    const isMale   = categories.gender.some(t => /\bmale\b/i.test(t) && !/female/i.test(t));
    const isFemale = categories.gender.some(t => /female/i.test(t));
    if (isMale && !isFemale) ctx.push('female', 'breasts', 'pussy');
    else if (isFemale && !isMale) ctx.push('male', 'penis', 'balls');

    const isAnthro = categories.form.some(t => t.toLowerCase() === 'anthro');
    const isFeral  = categories.form.some(t => t.toLowerCase() === 'feral');
    if (isAnthro && !isFeral) ctx.push('feral');
    if (isFeral && !isAnthro) ctx.push('anthro');

    const isNude = categories.clothing.some(t => /nude|naked/i.test(t));
    if (isNude) ctx.push('clothed', 'clothing');

    return [...base, ...ctx].join(', ');
  }

  // ─── Output helpers ───────────────────────────────────────────────────────

  _setOutput(prompt, negative) {
    const pOut = this.container.querySelector('#ap-prompt-out');
    const nOut = this.container.querySelector('#ap-negative-out');
    if (pOut)  pOut.value  = prompt;
    if (nOut)  nOut.value  = negative;
  }

  async _copyText(selector) {
    const el = this.container.querySelector(selector);
    if (!el || !el.value) { this.showToast('Nothing to copy', 'warning'); return; }
    try {
      await navigator.clipboard.writeText(el.value);
      this.showToast('Copied!', 'success');
    } catch {
      el.select();
      document.execCommand('copy');
      this.showToast('Copied!', 'success');
    }
  }

  showToast(message, type = 'info') {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }
}

console.log('✅ AutoPrompterTool module loaded');

export default AutoPrompterTool;
window.AutoPrompterTool = AutoPrompterTool;
