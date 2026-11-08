const { getPreset, qualityLine, list, DEFAULT_PRESET } = require('../src/shared/promptPresets');
const mod = require('../src/main/services/AIService');
const AIService = mod.AIService || mod;

const service = (huggingface = {}) => new AIService({ getAllSettings: () => ({ huggingface }) });

describe('prompt presets', () => {
  test('unknown presets fall back to Illustrious', () => {
    expect(getPreset('nope').id).toBe(DEFAULT_PRESET);
    expect(list().map((p) => p.id)).toEqual(['illustrious', 'pony', 'sdxl', 'flux']);
  });

  test('Pony adds a rating that follows the NSFW switch', () => {
    expect(qualityLine(getPreset('pony'), { nsfw: true })).toMatch(/score_9.*rating_explicit$/);
    expect(qualityLine(getPreset('pony'), { nsfw: false })).toMatch(/rating_safe$/);
    expect(qualityLine(getPreset('illustrious'))).toBe('masterpiece, best quality, newest, very awa');
  });

  test('tag presets put their own quality line and negative into the instructions', () => {
    const [system] = service()._buildPromptMessages(['wolf'], null, { preset: 'pony', nsfw: true });
    expect(system.content).toContain('Always begin: score_9, score_8_up, score_7_up, source_furry, rating_explicit');
    expect(system.content).toContain('score_4, score_5, score_6');
    expect(system.content).not.toContain('very awa');
  });

  test('the default keeps the original Illustrious instructions', () => {
    const [system] = service()._buildPromptMessages(['wolf'], null, {});
    expect(system.content).toContain('Always begin: masterpiece, best quality, newest, very awa');
  });

  test('Flux asks for sentences, without quality words or artist tags', () => {
    const [system, user] = service()._buildPromptMessages([], { artist: ['someone'], species: ['wolf'], general: ['solo'] }, { preset: 'flux' });
    expect(system.content).toMatch(/plain sentences/);
    expect(user.content).toContain('Species tags: wolf');
    expect(user.content).not.toContain('someone');
  });
});

describe('Hugging Face model choice', () => {
  test('a withdrawn or stale model gives way to the current default', () => {
    expect(service({ preferredModel: 'mistralai/Mistral-Nemo-Instruct-2407' }).getPreferredModel()).toBe('Qwen/Qwen3.8-27B');
    expect(service({ preferredModel: 'Qwen/Qwen2.5-72B-Instruct' }).getPreferredModel()).toBe('Qwen/Qwen3.8-27B');
    expect(service({}).getPreferredModel()).toBe('Qwen/Qwen3.8-27B');
  });

  test('a current or custom model is kept', () => {
    expect(service({ preferredModel: 'deepseek-ai/DeepSeek-V3.2' }).getPreferredModel()).toBe('deepseek-ai/DeepSeek-V3.2');
    expect(service({ preferredModel: 'Qwen/Qwen2.5-72B-Instruct', customModels: ['Qwen/Qwen2.5-72B-Instruct'] }).getPreferredModel())
      .toBe('Qwen/Qwen2.5-72B-Instruct');
  });
});
