// src/main/services/AIService.js - AI integration service (Hugging Face + Ollama)
const { getPreset, qualityLine } = require('../../shared/promptPresets');

// Hugging Face models offered in Settings and the prompt tools, best first.
// All are on Hugging Face's inference router (checked 2026-11-08). A saved
// choice that has since been withdrawn falls back to the first.
const HF_MODELS = {
  'Qwen/Qwen3.8-27B': { name: 'Qwen 3.8 27B', note: 'fast, recommended' },
  'deepseek-ai/DeepSeek-V3.2': { name: 'DeepSeek V3.2', note: 'strong, slower' },
  'google/gemma-4-31B-it': { name: 'Gemma 4 31B', note: 'balanced' },
  'meta-llama/Llama-3.3-70B-Instruct': { name: 'Llama 3.3 70B', note: 'older, reliable' },
  'openai/gpt-oss-120b': { name: 'gpt-oss 120B', note: 'fast on Groq or Cerebras' }
};
const DEFAULT_HF_MODEL = Object.keys(HF_MODELS)[0];

// Sentinel markers wrapping the structured prompt output. Used both as a
// stop sequence (so generation truncates right after the closing marker
// instead of trailing off into commentary) and as an extraction anchor for
// parsing — see analyzeAndOptimizePrompt() / _extractPromptBlock().
const PROMPT_START = '===PIPER_PROMPT_START===';
const PROMPT_END = '===PIPER_PROMPT_END===';

class AIService {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.hfBaseURL = 'https://router.huggingface.co/v1/chat/completions';

    this.availableModels = HF_MODELS;

    console.log('🤖 AI Service initialized (Hugging Face + Ollama support)');
  }

  // ─── Settings helpers ─────────────────────────────────────────────────────

  getAPIToken() {
    const settings = this.settingsService.getAllSettings();
    return settings.huggingface?.apiToken || '';
  }

  /**
   * The Hugging Face model to use. A custom model the user added is kept;
   * one of the old built-in choices that has been withdrawn (or a stale
   * default) gives way to the current default.
   */
  getPreferredModel() {
    const settings = this.settingsService.getAllSettings();
    const saved = settings.huggingface?.preferredModel || '';
    const custom = (settings.huggingface?.customModels || []).map((m) => (typeof m === 'string' ? m : m?.id));
    const retired = ['mistralai/Mistral-Nemo-Instruct-2407', 'Qwen/Qwen2.5-72B-Instruct'];
    if (!saved || (retired.includes(saved) && !custom.includes(saved))) return DEFAULT_HF_MODEL;
    return saved;
  }

  getOllamaSettings() {
    const settings = this.settingsService.getAllSettings();
    return {
      host: settings.ollama?.host || 'http://localhost:11434',
      preferredModel: settings.ollama?.preferredModel || ''
    };
  }

  isAIEnabled() {
    return this.getAPIToken().length > 0;
  }

  // ─── Ollama methods ───────────────────────────────────────────────────────

  /**
   * List models available in the local Ollama instance.
   * Returns { success, models: [{name, size, ...}] }
   */
  async listOllamaModels() {
    const { host } = this.getOllamaSettings();
    try {
            const response = await fetch(`${host}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        return { success: false, message: `Ollama returned ${response.status}` };
      }
      const data = await response.json();
      const models = (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        modified_at: m.modified_at
      }));
      console.log(`✅ Ollama: found ${models.length} model(s)`);
      return { success: true, models };
    } catch (err) {
      console.warn('⚠️ Ollama not reachable:', err.message);
      return { success: false, message: `Cannot connect to Ollama at ${host}. Is it running?` };
    }
  }

  /**
   * Quick reachability ping for Ollama.
   */
  async checkOllama() {
    const { host } = this.getOllamaSettings();
    try {
            const response = await fetch(`${host}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(5000) });
      return { success: response.ok, host };
    } catch {
      return { success: false, host };
    }
  }

  /**
   * Chat completion routed to the local Ollama instance (OpenAI-compatible endpoint).
   * Streams the response and fires onProgress({ phase, tokens, elapsed }) per chunk.
   */
  async ollamaChatCompletion(messages, options = {}, onProgress = null) {
    const { host, preferredModel } = this.getOllamaSettings();
    const model = options.model || preferredModel;
    if (!model) {
      throw new Error('No Ollama model selected. Pick one in the Auto Prompter panel.');
    }
    const maxTokens   = options.maxTokens  || 8000;
    const temperature = options.temperature !== undefined ? options.temperature : 0.7;

    console.log(`🦙 Ollama chat: model=${model} host=${host}`);

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 120_000);
    const startTime  = Date.now();

    let response;
    try {
      response = await fetch(`${host}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, max_tokens: maxTokens, temperature, stream: true,
          ...(options.stop ? { stop: options.stop } : {})
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      const message   = isTimeout
        ? 'Ollama request timed out after 120 seconds. The model may be overloaded — try again.'
        : err.message;
      console.error('❌ Ollama connection error:', message);
      return { success: false, error: message, userMessage: message };
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      const text    = await response.text();
      const message = `Ollama error ${response.status}: ${text}`;
      return { success: false, error: message, userMessage: message };
    }

    if (onProgress) onProgress({ phase: 'generating', tokens: 0, elapsed: Date.now() - startTime });

        let fullText   = '';
    let tokenCount = 0;
    let buffer     = '';
    const decoder  = new TextDecoder();

    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep any incomplete trailing line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const data  = JSON.parse(payload);
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              tokenCount++;
              if (onProgress) {
                onProgress({ phase: 'generating', tokens: tokenCount, elapsed: Date.now() - startTime });
              }
            }
          } catch { /* ignore malformed SSE frames */ }
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      const message   = isTimeout ? 'Ollama request timed out after 120 seconds.' : err.message;
      console.error('❌ Ollama stream error:', message);
      return { success: false, error: message, userMessage: message };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!fullText) {
      return {
        success: false,
        error: 'Ollama returned an empty response. The model may need more tokens or a different prompt.',
        userMessage: 'Ollama returned an empty response.'
      };
    }

    const elapsed = Date.now() - startTime;
    if (onProgress) onProgress({ phase: 'done', tokens: tokenCount, elapsed });
    console.log(`✅ Ollama: ${tokenCount} tokens in ${(elapsed / 1000).toFixed(1)}s`);

    return { success: true, response: fullText, model, provider: 'ollama' };
  }

  // ─── HuggingFace chat completion ──────────────────────────────────────────

  async chatCompletion(messages, options = {}, onProgress = null) {
    // Route to Ollama when requested
    if (options.provider === 'ollama') {
      return this.ollamaChatCompletion(messages, options, onProgress);
    }

    const token = this.getAPIToken();
    if (!token) {
      throw new Error('Hugging Face API token not configured. Please add your token in Settings.');
    }

    const model = options.model || this.getPreferredModel();
    const maxTokens = options.maxTokens || 2000;
    const temperature = options.temperature !== undefined ? options.temperature : 0.7;

    console.log(`🤖 HuggingFace chat: model=${model}`);

    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 60_000); // 60s

      let response;
      try {
        response = await fetch(this.hfBaseURL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
            stream: false,
            ...(options.stop ? { stop: options.stop } : {})
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ HuggingFace API error:', response.status, errorText);

        if (response.status === 401) throw new Error('Invalid Hugging Face API token. Please check your token in Settings.');
        if (response.status === 403) throw new Error('Token lacks required permissions. Create a new token at https://huggingface.co/settings/tokens with "Make calls to Inference Providers" permission enabled.');
        if (response.status === 429) throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        if (response.status === 503) throw new Error('Model is loading. Please wait 20-30 seconds and try again.');
        if (response.status === 410) throw new Error('API endpoint has changed. Please update the application.');
        throw new Error(`AI API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ HuggingFace response received');

      const generatedText =
        result.choices?.[0]?.message?.content ||
        result.message?.content ||
        JSON.stringify(result);

      return { success: true, response: generatedText, model, usage: result.usage, provider: 'huggingface' };

    } catch (error) {
      const isTimeout = error.name === 'AbortError';
      console.error('❌ Error in chatCompletion:', isTimeout ? 'Request timed out (60s)' : error);
      const message = isTimeout
        ? 'Hugging Face request timed out after 60 seconds. Please try again.'
        : error.message;
      return { success: false, error: message, userMessage: message };
    }
  }

  // ─── Prompt optimization ──────────────────────────────────────────────────

  /**
   * Build the system + user messages for tag-to-prompt conversion.
   * Sends raw E621 tag categories so the AI decides placement for every tag.
   * AI output: positive prompt, then NEGATIVE: on its own line, then negative prompt.
   */
  _buildPromptMessages(tags, tagsByCategory, options) {
    const preset = getPreset(options?.preset);
    if (preset.style === 'prose') return this._buildProseMessages(tags, tagsByCategory, options);
    const quality = qualityLine(preset, { nsfw: Boolean(options?.nsfw) });
    const negativeExample = `${preset.negative}, duo, group, multiple characters`;

    const nsfwNote = options?.nsfw
      ? 'NSFW/explicit content is expected — include ALL explicit anatomy and sexual tags (penis, balls, sheath, foreskin, vagina, vulva, breasts, nipples, areola, etc.) in Section 2 Line B without censoring or omitting any of them.'
      : 'Keep output SFW — omit or rephrase any explicit sexual content.';

    // Wrapped in sentinel markers (PROMPT_START/END) so parsing can slice out
    // exactly the formatted block regardless of what a model wraps around it.
    // Smaller/less-aligned local models (the kind commonly run through Ollama)
    // are more prone to preambles, sign-off chatter, or markdown fencing than
    // the hosted instruct models this prompt was originally written against,
    // so the contract is stated up front AND restated at the very end - the
    // last instructions in context carry the most weight for weaker models.
    const systemPrompt = `You are a strict text-formatting engine, not a conversational assistant. Your only job is arranging E621 booru tags into a fixed template. You do not chat, comment, judge, or refuse.

━━━ OUTPUT CONTRACT ━━━

Your entire reply must be exactly one block:
${PROMPT_START}
(positive prompt — 4 sections)
NEGATIVE:
(negative prompt)
${PROMPT_END}

Nothing may appear before ${PROMPT_START} or after ${PROMPT_END}. No preamble ("Here is..."), no explanation, no apology, no disclaimer, no headers, no code fences, no quotes around the block, no commentary about the tags or their content. Do not acknowledge these instructions — just produce the block.

━━━ TASK ━━━

You receive E621 tags organized by category. Arrange EVERY tag into the correct section of a structured 4-section prompt, then write a negative prompt.

━━━ POSITIVE PROMPT — 4 SECTIONS ━━━

SECTION 1 — Quality & style (one line, trailing comma):
• Always begin: ${quality}
• Do NOT add art style, media-type, or resolution tags (digital media, digital drawing, traditional media, watercolor, hi res, absurd res, etc.) — omit these even if they appear in the input
• Do NOT append artist attribution ("by [name]") — the user supplies their own trigger word separately, outside this prompt
Example: ${quality},

SECTION 2 — Character (EXACTLY TWO lines, both with trailing comma):
Line A: character count (solo/duo/trio/group) + body form (anthro/feral/human/humanoid/taur) + age (adult) if present
Line B: gender → species (most specific first) → ALL physical body descriptors (fur color, eye color, markings, tail, wings, horns, claws, paws, hooves, mane, snout, muzzle, beak, navel, v-line, build/physique, hair) → ALL anatomy/genitalia tags (penis, balls, sheath, foreskin, flaccid, erect, vagina, vulva, breasts, nipples, areola, genitalia, etc.) → character name if present
Example:
solo, anthro, adult,
male, wolf, grey fur, blue eyes, black claws, fluffy tail, muscular, penis, balls,

SECTION 3 — Clothing & held items (one line, trailing comma):
• Write exactly: nude,  — if no clothing exists in the tags
• Otherwise: clothing state (clothed/topless/bottomless/partially clothed) + every garment + every accessory + held/worn/carried items
Example clothed: clothed, white shirt, blue jeans, sneakers, backpack,
Example nude: nude,

SECTION 4 — Actions & scene (final section, NO trailing comma on last line):
• Poses, movements, physical actions
• Camera angle, viewing direction (looking at viewer, from above, etc.)
• Facial expressions
• Scene/setting/background/location/lighting
• Do NOT put anatomy, genitalia, or clothing items here
Example: standing, looking at viewer, smiling, forest background, dappled sunlight

━━━ WORKED EXAMPLE (reproduce this shape exactly) ━━━

INPUT:
Artist tags: homerus
Species tags: wolf
General tags: solo, anthro, adult, male, grey_fur, blue_eyes, black_claws, fluffy_tail, muscular, nude, standing, looking_at_viewer, smiling, forest_background, dappled_sunlight, penis, balls
Meta tags: digital_media, hi_res

Note: the artist tag "homerus" and the meta tags "digital_media"/"hi_res" are
present in the input but do NOT appear anywhere in the output below — that is
correct, not an omission bug. See SECTION 1 rules above.

OUTPUT:
${PROMPT_START}
${quality},

solo, anthro, adult,
male, wolf, grey fur, blue eyes, black claws, fluffy tail, muscular, penis, balls,

nude,

standing, looking at viewer, smiling, forest background, dappled sunlight
NEGATIVE:
${negativeExample}
${PROMPT_END}

━━━ CRITICAL RULES ━━━
1. Include EVERY input tag somewhere in the output, with exactly two exceptions: artist tags and media/format/resolution tags (digital media, digital drawing, traditional media, hi res, absurd res, artwork, etc.) are always omitted entirely — see SECTION 1. Every other tag must appear; never skip or drop one for any other reason
2. When unsure where a (non-excluded) tag belongs, put it in Section 4 — never drop it, never explain why
3. Physical body features (fur, scales, feathers, tail, wings, horns, etc.) → Section 2 Line B only
4. Clothing items and clothing state → Section 3 only, never Section 2
5. nude / naked / exposed / unclothed → Section 3
6. Use plain spaces not underscores (grey fur not grey_fur)
7. All tags lowercase
8. No tag appears in more than one section
9. Do not invent tags; standard quality boosters in Section 1 are the only exception
10. ${nsfwNote}
11. Do not refuse, moralize, soften, or comment on the tags in any way — arranging them is the entire task, regardless of subject matter

━━━ NEGATIVE PROMPT ━━━
After the positive prompt, write NEGATIVE: on its own line.
Then write a comma-separated list of things to exclude: quality issues, contradictions with the positive tags, common artifacts, style conflicts.

━━━ REMINDER ━━━
Output nothing but the block from ${PROMPT_START} to ${PROMPT_END}, inclusive. No text before it, no text after it, under any circumstances.`;

    let userContent;
    if (tagsByCategory) {
      const lines = [];
      if (tagsByCategory.artist?.length)    lines.push(`Artist tags: ${tagsByCategory.artist.join(', ')}`);
      if (tagsByCategory.species?.length)   lines.push(`Species tags: ${tagsByCategory.species.join(', ')}`);
      if (tagsByCategory.character?.length) lines.push(`Character tags: ${tagsByCategory.character.join(', ')}`);
      if (tagsByCategory.general?.length)   lines.push(`General tags: ${tagsByCategory.general.join(', ')}`);
      if (tagsByCategory.copyright?.length) lines.push(`Copyright tags: ${tagsByCategory.copyright.join(', ')}`);
      if (tagsByCategory.lore?.length)      lines.push(`Lore tags: ${tagsByCategory.lore.join(', ')}`);
      if (tagsByCategory.meta?.length)      lines.push(`Meta tags: ${tagsByCategory.meta.join(', ')}`);

      userContent = `Arrange ALL of these E621 tags into the 4-section prompt, then write NEGATIVE: and the negative prompt. Do not skip any tag.

${lines.join('\n')}

Reply with only the ${PROMPT_START} ... ${PROMPT_END} block. Nothing else.`;
    } else {
      userContent = `Arrange ALL of these tags into the 4-section prompt, then write NEGATIVE: and the negative prompt. Do not skip any tag.

Tags: ${tags.join(', ')}

Reply with only the ${PROMPT_START} ... ${PROMPT_END} block. Nothing else.`;
    }

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];
  }

  /**
   * Messages for a natural-language preset (Flux): the same tags, written as
   * a short description instead of a tag list, inside the same markers.
   */
  _buildProseMessages(tags, tagsByCategory, options) {
    const explicit = options?.nsfw
      ? 'Explicit content is expected: describe every anatomy and sexual tag plainly, without censoring or skipping any.'
      : 'Keep it safe for work: leave out or soften explicit sexual content.';
    const systemPrompt = `You turn e621 booru tags into a prompt for an image model that reads natural language (Flux).

Reply with exactly one block and nothing else:
${PROMPT_START}
(the prompt)
NEGATIVE:
(leave empty)
${PROMPT_END}

The prompt is two to five plain sentences describing one image: the subject and how many there are, body form and species, physical details, clothing, pose and action, expression, setting, lighting and camera view. Use every tag except artist and media/resolution tags (digital media, hi res, absurd res and similar), which you leave out. Name characters if a character tag is given. Use plain spaces, not underscores. No quality words like "masterpiece", no lists, no markdown, no commentary. ${explicit}`;

    const lines = [];
    if (tagsByCategory) {
      for (const [label, key] of [['Species', 'species'], ['Character', 'character'], ['General', 'general'], ['Copyright', 'copyright'], ['Lore', 'lore']]) {
        if (tagsByCategory[key]?.length) lines.push(`${label} tags: ${tagsByCategory[key].join(', ')}`);
      }
    } else {
      lines.push(`Tags: ${tags.join(', ')}`);
    }
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${lines.join('\n')}\n\nReply with only the ${PROMPT_START} ... ${PROMPT_END} block.` }
    ];
  }

  /**
   * Analyze tags and generate optimized prompt with AI.
   * Pass options.tagsByCategory for best results.
   */
  async analyzeAndOptimizePrompt(tags, options = {}, onProgress = null) {
    console.log('🎯 AI analyzing tags for prompt optimization...');

    const settings = this.settingsService.getAllSettings();
    const temperature = options.temperature !== undefined
      ? options.temperature
      : (settings.huggingface?.temperature ?? 0.7);

    const messages = this._buildPromptMessages(tags, options.tagsByCategory || null, options);

    // Reasoning/thinking models need more tokens; give Ollama extra headroom
    const maxTokens = options.provider === 'ollama' ? 8000 : 1000;

    const result = await this.chatCompletion(messages, {
      maxTokens,
      temperature,
      stop: [PROMPT_END],
      ...(options.model    ? { model: options.model }       : {}),
      ...(options.provider ? { provider: options.provider } : {})
    }, onProgress);

    if (!result.success) return result;

    // Parse positive and negative prompts. Prefer the sentinel-marker block
    // (see _buildPromptMessages) since it's unambiguous; models that ignore
    // the markers fall back to chatter-stripping + the legacy NEGATIVE: split.
    const raw = this._extractPromptBlock(result.response);
    const negMatch = raw.match(/\bNEGATIVE:\s*([\s\S]*)/i);
    const optimizedPrompt = negMatch ? raw.slice(0, negMatch.index).trim() : raw;
    const negativePrompt  = negMatch ? negMatch[1].trim() : '';

    return {
      success: true,
      optimizedPrompt,
      negativePrompt,
      model: result.model,
      provider: result.provider
    };
  }

  /**
   * Pulls the formatted prompt out of a raw model response. Tries the
   * ${PROMPT_START}/${PROMPT_END} sentinel block first (the reliable path -
   * see _buildPromptMessages); if a model ignored the markers entirely, falls
   * back to stripping the chatter patterns local/less-aligned models commonly
   * add (code fences, "Here is..." preambles, wrapping quotes, bold labels).
   */
  _extractPromptBlock(response) {
    const raw = (response || '').trim();

    const startIdx = raw.indexOf(PROMPT_START);
    const endIdx = raw.indexOf(PROMPT_END);
    if (startIdx !== -1) {
      const sliceEnd = endIdx !== -1 && endIdx > startIdx ? endIdx : raw.length;
      return raw.slice(startIdx + PROMPT_START.length, sliceEnd).trim();
    }

    return raw
      .replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, '')
      .replace(/^\*\*?(?:positive )?prompt\*\*?:?\s*/i, '')
      .replace(/^(here(?:'s| is)(?: the)?(?: formatted| generated)?(?: prompt)?:?\s*)/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();
  }

  parseOptimizationResponse(response) {
    return { prompt: response.trim(), score: 7.0, reasoning: '', suggestions: '' };
  }

  async generateNegativePrompt(positiveTags, options = {}) {
    console.log('🚫 AI generating negative prompt...');

    const userPrompt = `Given these positive tags for an image: ${positiveTags.join(', ')}

Generate a comprehensive negative prompt (tags to exclude) that will improve image quality. Include:
1. Quality issues to avoid (blur, artifacts, etc.)
2. Content contradictions (e.g., if "solo" is present, exclude "duo", "group")
3. Anatomical issues to prevent
4. Style conflicts

Provide ONLY the negative prompt as a comma-separated list, nothing else.`;

    const messages = [
      { role: 'system', content: 'You are an expert at creating negative prompts for AI image generation. Be concise and practical.' },
      { role: 'user', content: userPrompt }
    ];

    const result = await this.chatCompletion(messages, {
      maxTokens: 300,
      temperature: 0.5,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model    ? { model: options.model }       : {})
    });

    if (!result.success) return result;
    return { success: true, negativePrompt: result.response.trim(), model: result.model };
  }

  async testConnection() {
    console.log('🔍 Testing Hugging Face API connection...');
    try {
      const result = await this.chatCompletion(
        [{ role: 'user', content: 'Reply with just "OK" if you can read this.' }],
        { maxTokens: 10, temperature: 0.1 }
      );
      if (result.success) {
        return { success: true, message: `Successfully connected to ${this.getPreferredModel()}`, model: result.model };
      }
      return { success: false, message: result.userMessage || result.error };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Pull (download) a model via Ollama's streaming pull API.
   * Fires onProgress({ status, digest, total, completed, percent }) for each chunk.
   * Returns { success, message }
   */
  async pullOllamaModel(modelName, onProgress = null) {
    const { host } = this.getOllamaSettings();
    console.log(`🦙 Ollama pull: ${modelName} from ${host}`);

    let response;
    try {
      response = await fetch(`${host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
                // No timeout: large models take a long time.
        body: JSON.stringify({ name: modelName, stream: true })
      });
    } catch (err) {
      return { success: false, message: `Cannot connect to Ollama at ${host}: ${err.message}` };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, message: `Ollama returned ${response.status}: ${text}` };
    }

    // Read NDJSON stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            if (chunk.error) return { success: false, message: chunk.error };
            if (onProgress) {
              const percent = chunk.total > 0
                ? Math.round((chunk.completed / chunk.total) * 100)
                : null;
              onProgress({ status: chunk.status, digest: chunk.digest, total: chunk.total, completed: chunk.completed, percent });
            }
            if (chunk.status === 'success') {
              return { success: true, message: `${modelName} downloaded successfully` };
            }
          } catch { /* malformed line, skip */ }
        }
      }
    } catch (err) {
      return { success: false, message: `Stream error: ${err.message}` };
    }

    return { success: true, message: `${modelName} downloaded successfully` };
  }

  getAvailableModels() {
    return this.availableModels;
  }

  getDefaultModel() {
    return DEFAULT_HF_MODEL;
  }

  /**
   * Search HuggingFace model hub for text-generation models matching a query.
   * Uses the public /api/models endpoint — no auth required.
   * Returns { success, models: [{id, downloads, likes, private}] }
   */
  async searchHuggingFaceModels(query, limit = 10) {
    if (!query || query.trim().length < 2) {
      return { success: true, models: [] };
    }
    const url = new URL('https://huggingface.co/api/models');
    url.searchParams.set('search', query.trim());
    url.searchParams.set('pipeline_tag', 'text-generation');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', 'downloads');
    url.searchParams.set('direction', '-1');
    url.searchParams.set('full', 'true'); // include inference field

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        return { success: false, message: `HuggingFace search returned ${response.status}` };
      }
      const data = await response.json();
      const models = (Array.isArray(data) ? data : []).map(m => ({
        id: m.id,
        downloads: m.downloads ?? 0,
        likes: m.likes ?? 0,
        private: m.private ?? false,
        inference: m.inference ?? '' // 'warm' | 'cold' | '' (not available)
      }));
      return { success: true, models };
    } catch (err) {
      console.warn('⚠️ HF model search error:', err.message);
      return { success: false, message: err.message };
    }
  }
}

module.exports = AIService;
