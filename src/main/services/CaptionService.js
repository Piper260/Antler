// src/main/services/CaptionService.js
// Natural-language captions from a local vision model (Ollama). Each image
// is sent with the tags it already has, which the model treats as ground
// truth, so captions name characters and species the way the tags do.
//
// Output modes:
//   sidecar  <name>.caption beside the image; the .txt tags are untouched
//   hybrid   the .txt becomes "<sentence>, <tags>" (good for Flux)
//   replace  the .txt becomes the sentence alone
// Before a .txt is changed for the first time its original goes to
// bak/captions/, the same bak/ every scan already skips.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { writeFileSafe } = require('../utils/safeWrite');

const LENGTHS = {
  short: 'one sentence',
  medium: 'two or three sentences',
  detailed: 'four to six sentences'
};
const MODES = new Set(['sidecar', 'hybrid', 'replace']);
const MAX_EDGE = 1024;
const REQUEST_TIMEOUT = 3 * 60 * 1000;

const SYSTEM_PROMPT = [
  'You write captions for an image-generation training dataset.',
  'Describe only what is visible: subjects, species, body and colours, clothing, pose and action, expression, setting, composition and camera view, and the art style and medium.',
  'You are given the image\'s tags. Treat them as correct: use the character names and species they give, and do not contradict them. Leave out tags you cannot see.',
  'Write plain, factual prose in the present tense. No opinions, no "This image shows", no lists, no markdown, no quotation marks. Reply with the caption only.'
].join(' ');

/** Tags as a short readable list, without underscores. */
function tagList(tags) {
  return (tags || []).map((t) => String(t).trim().replace(/_/g, ' ')).filter(Boolean).join(', ');
}

/** The model's reply cut down to the caption itself. */
function cleanCaption(text) {
  let out = String(text || '');
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/^\s*(?:here(?:'s| is) (?:the|a) caption[^:]*:|caption\s*:)\s*/i, '');
  out = out.replace(/[*_`#]+/g, '').replace(/\s*\n+\s*/g, ' ').trim();
  out = out.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return out;
}

/** What goes into the file for an output mode. */
function composeOutput(mode, caption, tags, trigger = '') {
  const lead = trigger ? `${trigger.trim()}, ` : '';
  if (mode === 'replace' || mode === 'sidecar') return `${lead}${caption}`;
  const rest = (tags || []).filter((t) => String(t).trim() && String(t).trim().toLowerCase() !== trigger.trim().toLowerCase());
  return `${lead}${caption}${rest.length ? `, ${rest.join(', ')}` : ''}`;
}

class CaptionService {
  constructor(settingsService, { fetchImpl = globalThis.fetch } = {}) {
    this.settingsService = settingsService;
    this.fetch = fetchImpl;
  }

  host() {
    const settings = this.settingsService?.getAllSettings?.() || {};
    return (settings.ollama?.host || 'http://localhost:11434').replace(/\/+$/, '');
  }

  /** Ollama models that can see images, smallest first. */
  async listVisionModels() {
    const tags = await this._json('/api/tags');
    const models = [];
    for (const model of tags.models || []) {
      try {
        const info = await this._json('/api/show', { model: model.name });
        if ((info.capabilities || []).includes('vision')) {
          models.push({ name: model.name, size: model.size || 0, family: model.details?.family || '' });
        }
      } catch {
        // a model Ollama can't describe is simply left out
      }
    }
    return models.sort((a, b) => a.size - b.size);
  }

  messages({ tags, length = 'medium', image }) {
    const known = tagList(tags);
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Write a caption of ${LENGTHS[length] || LENGTHS.medium} for this image.${known ? `\nIts tags: ${known}` : '\nIt has no tags; describe what you see.'}`,
        images: [image]
      }
    ];
  }

  /** A caption for one image. `imagePath` must already be checked by the caller. */
  async caption({ imagePath, tags = [], model, length = 'medium', signal }) {
    if (!model) throw new Error('Choose a vision model first');
    const image = (await sharp(imagePath, { failOn: 'none' })
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#808080' })
      .jpeg({ quality: 88 })
      .toBuffer()).toString('base64');

    const body = {
      model,
      stream: false,
      keep_alive: '10m',
      // Thinking models would otherwise reason at length before a short answer.
      think: false,
      messages: this.messages({ tags, length, image }),
      options: { temperature: 0.4, num_predict: 400 }
    };
    let reply;
    try {
      reply = await this._json('/api/chat', body, signal);
    } catch (error) {
      if (!/think/i.test(error.message)) throw error;
      delete body.think; // a model that can't think rejects the option
      reply = await this._json('/api/chat', body, signal);
    }
    const caption = cleanCaption(reply.message?.content);
    if (!caption) throw new Error('The model returned an empty caption');
    return caption;
  }

  /**
   * Writes a caption for the image at `imagePath` in the given mode. The tag
   * file is always <image name>.txt beside the image.
   */
  async write({ imagePath, mode, caption, tags = [], trigger = '' }) {
    if (!MODES.has(mode)) throw new Error(`Unknown caption mode: ${mode}`);
    const dir = path.dirname(imagePath);
    const stem = path.parse(imagePath).name;
    const text = `${composeOutput(mode, caption, tags, trigger)}\n`;

    if (mode === 'sidecar') {
      const target = path.join(dir, `${stem}.caption`);
      await writeFileSafe(target, text);
      return target;
    }

    const target = path.join(dir, `${stem}.txt`);
    const backup = path.join(dir, 'bak', 'captions', `${stem}.txt`);
    if (fs.existsSync(target) && !fs.existsSync(backup)) {
      await fs.promises.mkdir(path.dirname(backup), { recursive: true });
      await fs.promises.copyFile(target, backup);
    }
    await writeFileSafe(target, text);
    return target;
  }

  async _json(route, body, signal) {
    const signals = [AbortSignal.timeout(REQUEST_TIMEOUT), signal].filter(Boolean);
    let response;
    try {
      response = await this.fetch(`${this.host()}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0]
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`Can't reach Ollama at ${this.host()}. Is it running?`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ollama returned ${response.status}`);
    return data;
  }
}

module.exports = { CaptionService, cleanCaption, composeOutput, tagList, LENGTHS };
