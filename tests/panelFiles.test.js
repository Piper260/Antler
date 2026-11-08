const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelFileName, findPanelImage, freePanelName } = require('../src/main/services/panelFiles');

describe('panel files', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-files-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const touch = (name) => fs.writeFileSync(path.join(dir, name), 'x');

  test('numbers panels from two digits', () => {
    expect(panelFileName('page', 3)).toBe('page_p03');
    expect(panelFileName('page', 12)).toBe('page_p12');
  });

  test('finds an image in any format, since upscaling can change it', () => {
    touch('page_p01.webp');
    expect(findPanelImage(dir, 'page_p01')).toBe(path.join(dir, 'page_p01.webp'));
  });

  test('a tag file alone is not an image', () => {
    touch('page_p01.txt');
    expect(findPanelImage(dir, 'page_p01')).toBeNull();
  });

  test('a free name skips names in use and images on disk', () => {
    touch('page_p02.png');
    const taken = new Set(['page_p03']);
    expect(freePanelName('page', 2, dir, taken)).toBe('page_p04');
    expect(freePanelName('page', 2, dir, taken)).toBe('page_p05');
  });
});
