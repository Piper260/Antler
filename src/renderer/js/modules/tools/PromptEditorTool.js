console.log('🔧 PromptEditorTool module loading...');

class PromptEditorTool {
  constructor() {
    this.name = 'Prompt Editor';
    this.id = 'prompt-editor';
    this.icon = 'fas fa-pen-to-square';
    this.description = 'Paste, edit, and copy AI image generation prompts';
    this.version = '1.0.0';

    this._provider = 'huggingface';
    this._ollamaModel = '';
    this._hfModel = '';
    this._aiEnabled = false;
    this._inlineSelection = null; // { start, end, text }
    this._outsideClickHandler = null;
    this._popover = null;

    console.log('✏️ Prompt Editor Tool initialized');
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
    console.log('🧹 Prompt Editor Tool cleaned up');
  }

  getTemplate() {
    return `
      <div class="pe-tool">

        <!-- Toolbar -->
        <div class="pe-toolbar">
          <button class="btn pe-btn pe-btn-paste" id="pe-paste-btn" title="Paste from clipboard">
            <i class="fas fa-clipboard"></i> Paste
          </button>
          <button class="btn pe-btn pe-btn-clear" id="pe-clear-btn" title="Clear">
            <i class="fas fa-xmark"></i> Clear
          </button>
          <div class="pe-toolbar-spacer"></div>
          <button class="btn pe-btn pe-btn-copy" id="pe-copy-btn" title="Copy to clipboard">
            <i class="fas fa-copy"></i> Copy
          </button>
        </div>

        <!-- Main editor -->
        <textarea class="pe-textarea" id="pe-prompt" spellcheck="false"
                  placeholder="Paste or type your prompt here…

Highlight any text then describe your edit — the AI will replace just that selection."></textarea>

        <!-- AI bar (provider + inline-edit status) -->
        <div class="pe-ai-bar">
          <span class="pe-ai-status" id="pe-ai-status">Checking AI…</span>

          <div class="segmented pe-provider-toggle" id="pe-provider-toggle" style="display:none">
            <button class="segmented-btn pe-provider-btn pe-provider-btn--active" id="pe-btn-hf" title="Use Hugging Face">
              <i class="fas fa-cloud"></i> HuggingFace
            </button>
            <button class="segmented-btn pe-provider-btn" id="pe-btn-ollama" title="Use local Ollama">
              <i class="fas fa-server"></i> Ollama
            </button>
          </div>

          <span id="pe-model-badge" class="toolbar-text pe-model-badge" title="Configured in Settings"></span>

          <div class="pe-ollama-row" id="pe-ollama-row" style="display:none">
            <select id="pe-ollama-select" class="form-select pe-ollama-select">
              <option value="">— select model —</option>
            </select>
            <button class="btn-icon pe-icon-btn" id="pe-ollama-refresh" title="Refresh model list">
              <i class="fas fa-sync-alt"></i>
            </button>
          </div>
        </div>

        <p class="pe-hint">
          <i class="fas fa-pen"></i>
          Highlight any text and describe how to change it — AI replaces only that selection.
        </p>

      </div>
    `;
  }

  async initialize(container) {
    try {
      if (!container) throw new Error('Container element is required');
      container.innerHTML = this.getTemplate();
      this.container = container;
      this._injectPopover();
      this._setupEvents();
      await this._checkAIStatus();
      console.log('✅ Prompt Editor Tool ready');
    } catch (error) {
      console.error('❌ Failed to initialize Prompt Editor Tool:', error);
    }
  }

  // ─── Popover ──────────────────────────────────────────────────────────────

  _injectPopover() {
    document.getElementById('pe-inline-edit')?.remove();

    const el = document.createElement('div');
    el.className = 'ap-inline-edit';
    el.id = 'pe-inline-edit';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="ap-inline-header">
        <i class="fas fa-pen"></i>
        <span class="ap-inline-title">Edit with AI</span>
        <button class="ap-inline-copy" id="pe-inline-copy" title="Copy selection">
          <i class="fas fa-copy"></i>
        </button>
        <button class="ap-inline-dismiss" id="pe-inline-dismiss" title="Dismiss">&times;</button>
      </div>
      <div class="ap-inline-preview" id="pe-inline-preview">
        <span class="ap-inline-selected-text" id="pe-inline-selected-text"></span>
      </div>
      <div class="ap-inline-body">
        <input type="text" id="pe-inline-instruction" class="form-input ap-inline-input"
               placeholder="Describe your edit…" autocomplete="off" maxlength="200">
        <button class="btn btn-primary ap-inline-apply" id="pe-inline-apply">
          <i class="fas fa-check"></i>
        </button>
      </div>
    `;
    document.body.appendChild(el);
    this._popover = el;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  _setupEvents() {
    const pasteBtn  = this.container.querySelector('#pe-paste-btn');
    const clearBtn  = this.container.querySelector('#pe-clear-btn');
    const copyBtn   = this.container.querySelector('#pe-copy-btn');
    const textarea  = this.container.querySelector('#pe-prompt');

    pasteBtn.addEventListener('click', () => this._paste());
    clearBtn.addEventListener('click', () => this._clear());
    copyBtn.addEventListener('click',  () => this._copy());

    // Provider toggles
    const btnHF     = this.container.querySelector('#pe-btn-hf');
    const btnOllama = this.container.querySelector('#pe-btn-ollama');
    if (btnHF)     btnHF.addEventListener('click',     () => this._setProvider('huggingface'));
    if (btnOllama) btnOllama.addEventListener('click', () => this._setProvider('ollama'));

    const ollamaSelect = this.container.querySelector('#pe-ollama-select');
    if (ollamaSelect) {
      ollamaSelect.addEventListener('change', (e) => { this._ollamaModel = e.target.value; });
    }

    const refreshBtn = this.container.querySelector('#pe-ollama-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this._loadOllamaModels());
    }

    // Inline edit
    textarea.addEventListener('mouseup', (e) => {
      const start = textarea.selectionStart;
      const end   = textarea.selectionEnd;
      if (start === end) { this._hideInlineEdit(); return; }
      this._showInlineEdit(e.clientX, e.clientY, textarea, start, end);
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._hideInlineEdit();
    });

    this._popover.querySelector('#pe-inline-dismiss')
      .addEventListener('click', () => this._hideInlineEdit());

    this._popover.querySelector('#pe-inline-copy')
      .addEventListener('click', () => {
        if (this._inlineSelection?.text) {
          navigator.clipboard.writeText(this._inlineSelection.text)
            .then(() => this.showToast('Copied!', 'success'))
            .catch(() => this.showToast('Copy failed', 'error'));
        }
      });

    this._popover.querySelector('#pe-inline-apply')
      .addEventListener('click', () => this._applyInlineEdit());

    this._popover.querySelector('#pe-inline-instruction')
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._applyInlineEdit(); }
        if (e.key === 'Escape') this._hideInlineEdit();
      });

    this._outsideClickHandler = (e) => {
      if (this._popover.style.display === 'none') return;
      if (!this._popover.contains(e.target) && e.target !== textarea) {
        this._hideInlineEdit();
      }
    };
    document.addEventListener('mousedown', this._outsideClickHandler);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async _paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { this.showToast('Clipboard is empty', 'warning'); return; }
      const ta = this.container.querySelector('#pe-prompt');
      ta.value = text;
      ta.focus();
      this.showToast('Pasted from clipboard', 'success');
    } catch {
      this.showToast('Could not read clipboard', 'error');
    }
  }

  _clear() {
    const ta = this.container.querySelector('#pe-prompt');
    ta.value = '';
    ta.focus();
    this._hideInlineEdit();
  }

  _copy() {
    const ta = this.container.querySelector('#pe-prompt');
    if (!ta.value.trim()) { this.showToast('Nothing to copy', 'warning'); return; }
    navigator.clipboard.writeText(ta.value)
      .then(() => this.showToast('Copied!', 'success'))
      .catch(() => {
        ta.select();
        document.execCommand('copy');
        this.showToast('Copied!', 'success');
      });
  }

  // ─── Inline AI edit ───────────────────────────────────────────────────────

  _showInlineEdit(clientX, clientY, textarea, start, end) {
    this._inlineSelection = { start, end, text: textarea.value.slice(start, end) };

    const pw = 340;
    const x  = Math.min(clientX, window.innerWidth - pw - 12);
    const y  = clientY + 18;

    this._popover.style.left    = `${x}px`;
    this._popover.style.top     = `${y}px`;
    this._popover.style.display = 'block';

    const preview = this._popover.querySelector('#pe-inline-selected-text');
    const raw = this._inlineSelection.text;
    preview.textContent = raw.length > 70 ? raw.slice(0, 70) + '…' : raw;

    setTimeout(() => this._popover.querySelector('#pe-inline-instruction')?.focus(), 40);
  }

  _hideInlineEdit() {
    if (!this._popover) return;
    this._popover.style.display = 'none';
    this._popover.querySelector('#pe-inline-instruction').value = '';
    this._inlineSelection = null;
  }

  async _applyInlineEdit() {
    const instruction = this._popover.querySelector('#pe-inline-instruction').value.trim();
    if (!instruction || !this._inlineSelection) return;

    const textarea   = this.container.querySelector('#pe-prompt');
    const fullPrompt = textarea.value;
    const { start, end, text } = this._inlineSelection;

    const applyBtn = this._popover.querySelector('#pe-inline-apply');
    const input    = this._popover.querySelector('#pe-inline-instruction');
    applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    applyBtn.disabled  = true;
    input.disabled     = true;
    textarea.style.pointerEvents = 'none';

    const provider = this._provider;
    const model    = provider === 'ollama'
      ? (this.container.querySelector('#pe-ollama-select')?.value || this._ollamaModel || '')
      : (this.container.querySelector('#pe-model-badge')?.dataset.modelId || this._hfModel || '');

    try {
      const messages = [
        {
          role: 'system',
          content: `You are a surgical text replacement tool for AI image generation prompts.
Your ONLY job: output the replacement for the highlighted text. Nothing else.
- Do NOT include any preamble, explanation, label, or punctuation that wasn't in the original selection
- Do NOT rewrite or touch any text outside the highlighted portion
- Do NOT wrap output in quotes or code fences
- Match the style of the original exactly (lowercase, commas, spacing)
- If the instruction says to remove, output nothing (empty string)
Output starts immediately with the replacement. No lead-in text.`
        },
        {
          role: 'user',
          content: `Highlighted text to replace: "${text}"\nInstruction: ${instruction}`
        }
      ];

      const result = await window.electronAPI.ai.chatCompletion(messages, {
        provider,
        maxTokens: provider === 'ollama' ? 2000 : 300,
        temperature: 0.6,
        ...(model ? { model } : {})
      });

      if (!result.success) throw new Error(result.message || 'AI edit failed');

      let replacement = (result.response || '')
        .replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
        .replace(/^(here(?:'s| is)(?: the)?(?: replacement)?:?\s*)/i, '')
        .replace(/^(replacement:?\s*)/i, '')
        .replace(/^(result:?\s*)/i, '')
        .replace(/^["']|["']$/g, '')
        .trim();

      const isRemoveIntent = /\b(remov|delet|strip|clear|erase)\b/i.test(instruction);
      if (!replacement && !isRemoveIntent) throw new Error('AI returned an empty replacement');

      textarea.value          = fullPrompt.slice(0, start) + replacement + fullPrompt.slice(end);
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
    }
  }

  // ─── Provider management ──────────────────────────────────────────────────

  _setProvider(provider) {
    this._provider = provider;

    const btnHF     = this.container.querySelector('#pe-btn-hf');
    const btnOllama = this.container.querySelector('#pe-btn-ollama');
    const badge     = this.container.querySelector('#pe-model-badge');
    const ollamaRow = this.container.querySelector('#pe-ollama-row');

    if (provider === 'ollama') {
      btnHF?.classList.remove('pe-provider-btn--active');
      btnOllama?.classList.add('pe-provider-btn--active');
      if (badge)     badge.style.display     = 'none';
      if (ollamaRow) ollamaRow.style.display = 'flex';
      this._loadOllamaModels();
    } else {
      btnOllama?.classList.remove('pe-provider-btn--active');
      btnHF?.classList.add('pe-provider-btn--active');
      if (badge)     badge.style.display     = '';
      if (ollamaRow) ollamaRow.style.display = 'none';
    }
  }

  async _loadOllamaModels() {
    const select     = this.container.querySelector('#pe-ollama-select');
    const refreshBtn = this.container.querySelector('#pe-ollama-refresh');
    if (!select) return;

    if (refreshBtn) refreshBtn.classList.add('fa-spin');
    select.disabled  = true;
    select.innerHTML = '<option value="">Loading…</option>';

    try {
      const result = await window.electronAPI.ai.listOllamaModels();
      if (!result.success || !result.models?.length) {
        select.innerHTML = '<option value="">No models found</option>';
        this.showToast(result.message || 'No Ollama models found', 'warning');
        return;
      }

      select.innerHTML = '<option value="">— select model —</option>';
      result.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value       = m.name;
        opt.textContent = m.name;
        if (this._ollamaModel && m.name === this._ollamaModel) opt.selected = true;
        select.appendChild(opt);
      });

      if (!this._ollamaModel && result.models.length) {
        this._ollamaModel = result.models[0].name;
        select.value = this._ollamaModel;
      }
    } catch {
      this.showToast('Could not reach Ollama', 'error');
      select.innerHTML = '<option value="">Error loading models</option>';
    } finally {
      select.disabled = false;
      if (refreshBtn) refreshBtn.classList.remove('fa-spin');
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
    const status  = this.container.querySelector('#pe-ai-status');
    const badge   = this.container.querySelector('#pe-model-badge');
    const toggle  = this.container.querySelector('#pe-provider-toggle');

    let hfEnabled = false;
    try {
      const result = await window.electronAPI.ai.isEnabled();
      hfEnabled = result?.enabled || false;
    } catch { /* ignore */ }

    let ollamaOk = false;
    try {
      const check = await window.electronAPI.ai.checkOllama();
      ollamaOk = check?.success || false;
    } catch { /* ignore */ }

    this._aiEnabled = hfEnabled || ollamaOk;

    if (!this._aiEnabled) {
      if (status) {
        status.textContent = 'AI inactive — configure Hugging Face in Settings or start Ollama';
        status.className   = 'pe-ai-status pe-ai-status--off';
      }
      if (badge)  badge.textContent    = '';
      if (toggle) toggle.style.display = 'none';
      return;
    }

    if (status) {
      status.textContent = 'AI active — highlight text to edit';
      status.className   = 'pe-ai-status pe-ai-status--on';
    }

    if (toggle) toggle.style.display = 'flex';

    if (!hfEnabled && ollamaOk) {
      this._setProvider('ollama');
    } else if (badge && window.electronAPI?.settings?.get) {
      const saved   = await window.electronAPI.settings.get('huggingface.preferredModel');
      const modelId = saved?.value || 'Qwen/Qwen2.5-72B-Instruct';
      this._hfModel         = modelId;
      badge.textContent     = this._modelShortName(modelId);
      badge.dataset.modelId = modelId;
    }

    const btnOllama = this.container.querySelector('#pe-btn-ollama');
    if (btnOllama && !ollamaOk) {
      btnOllama.disabled = true;
      btnOllama.title    = 'Ollama not reachable — start Ollama to use local models';
    }
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  showToast(message, type = 'info') {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(message, type);
    }
  }
}

window.PromptEditorTool = PromptEditorTool;
console.log('✅ PromptEditorTool class registered on window');
