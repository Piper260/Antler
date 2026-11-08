// src/shared/promptPresets.js - prompt styles per base model.
//
// The Auto Prompter turns e621 tags into a prompt. Different model families
// expect different prompts: Illustrious/NoobAI and generic SDXL want booru
// tags with their own quality words, Pony wants its score_ tags and a rating,
// and Flux wants plain sentences. A preset says which.
//
// Used by the main process (AIService builds the instructions) and the
// renderer (the preset menu), so it is plain data with no dependencies.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromptPresets = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const PRESETS = {
    illustrious: {
      name: 'Illustrious / NoobAI',
      style: 'tags',
      quality: 'masterpiece, best quality, newest, very awa',
      negative: 'lowres, bad anatomy, bad hands, extra fingers, extra limbs, text, watermark, signature, jpeg artifacts'
    },
    pony: {
      name: 'Pony Diffusion',
      style: 'tags',
      quality: 'score_9, score_8_up, score_7_up, source_furry',
      rating: true,
      negative: 'score_4, score_5, score_6, lowres, bad anatomy, bad hands, extra fingers, extra limbs, text, watermark, signature, jpeg artifacts'
    },
    sdxl: {
      name: 'SDXL (general)',
      style: 'tags',
      quality: 'masterpiece, best quality, highly detailed',
      negative: 'lowres, worst quality, low quality, bad anatomy, bad hands, extra fingers, extra limbs, blurry, text, watermark, signature, jpeg artifacts'
    },
    flux: {
      name: 'Flux (natural language)',
      style: 'prose',
      quality: '',
      negative: ''
    }
  };
  const DEFAULT_PRESET = 'illustrious';

  function getPreset(id) {
    return PRESETS[id] ? { id, ...PRESETS[id] } : { id: DEFAULT_PRESET, ...PRESETS[DEFAULT_PRESET] };
  }

  /** The quality line a tag preset starts with; Pony adds a rating. */
  function qualityLine(preset, { nsfw = false } = {}) {
    if (!preset.quality) return '';
    return preset.rating ? `${preset.quality}, ${nsfw ? 'rating_explicit' : 'rating_safe'}` : preset.quality;
  }

  const list = () => Object.keys(PRESETS).map((id) => ({ id, name: PRESETS[id].name, style: PRESETS[id].style }));

  return { PRESETS, DEFAULT_PRESET, getPreset, qualityLine, list };
});
