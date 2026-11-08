const path = require('path');
const { buildGraph, removeTextTags, maskPath, tryPath } = require('../src/main/services/comfyCleanup');

describe('comfyCleanup', () => {
  test('the graph loads the mask from the image and saves nothing on the server', () => {
    const graph = buildGraph({ image: 'up.png', seed: 7 });
    expect(graph[5].inputs.mask).toEqual(['1', 1]);
    expect(graph[8].inputs.seed).toBe(7);
    expect(graph[11].class_type).toBe('PreviewImage');
    expect(Object.values(graph).some(node => node.class_type.startsWith('Save'))).toBe(false);
  });

  test('a .gguf model uses the GGUF loader, anything else the core one', () => {
    expect(buildGraph({ image: 'a', seed: 1 })[17].class_type).toBe('UnetLoaderGGUF');
    const core = buildGraph({ image: 'a', seed: 1, models: { unet: 'flux1-fill-dev.safetensors' } })[17];
    expect(core).toEqual({ class_type: 'UNETLoader', inputs: { unet_name: 'flux1-fill-dev.safetensors', weight_dtype: 'default' } });
  });

  test('every link points at a node in the graph', () => {
    const graph = buildGraph({ image: 'a', seed: 1 });
    for (const node of Object.values(graph)) {
      for (const value of Object.values(node.inputs)) {
        if (Array.isArray(value)) expect(graph[value[0]]).toBeDefined();
      }
    }
  });

  test('lettering tags are dropped and the rest keep their order', () => {
    expect(removeTextTags('wolf, dialogue, speech_bubble, smiling, english text')).toEqual({
      text: 'wolf, smiling',
      removed: ['dialogue', 'speech_bubble', 'english text']
    });
  });

  test('cleanup files sit in bak/cleanup next to the image', () => {
    const file = path.join('F:', 'set', 'page_p01.png');
    expect(maskPath(file)).toBe(path.join('F:', 'set', 'bak', 'cleanup', 'page_p01.png.mask.png'));
    expect(tryPath(file, 2)).toBe(path.join('F:', 'set', 'bak', 'cleanup', 'page_p01.try2.png'));
  });
});
