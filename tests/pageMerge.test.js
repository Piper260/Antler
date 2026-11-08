const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { cropCandidates, applyPanels } = require('../src/main/services/pageMerge');

const W = 200;
const H = 150;
const BOX = { x: 50, y: 40, w: 60, h: 40, exportName: 'page_p01' };

/** A page with detail everywhere, so a wrong crop doesn't match. */
function pagePixels() {
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set([(x * 7 + y * 3) % 256, (x * x + y * 11) % 256, (x * 5 + y * y) % 256], (y * W + x) * 3);
  }
  return data;
}

describe('pageMerge', () => {
  test('cropCandidates keeps only paddings with the image\'s shape', () => {
    const crops = cropCandidates(BOX, 140, 100, W, H);
    // 60 x 40 padded by 5 is 70 x 50, which is 140 x 100 halved.
    expect(crops).toContainEqual({ left: 45, top: 35, width: 70, height: 50 });
    crops.forEach(crop => expect(Math.abs(crop.width / crop.height - 1.4)).toBeLessThan(0.05));
  });

  describe('applyPanels', () => {
    let dir;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagemerge-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('pastes an edited, upscaled, padded panel back into the page', async () => {
      const pagePath = path.join(dir, 'page.png');
      const panels = path.join(dir, 'panels');
      const page = pagePixels();
      await sharp(page, { raw: { width: W, height: H, channels: 3 } }).png().toFile(pagePath);

      // Exported with 5 px padding, upscaled 2x, then a white block painted
      // where the bubble was (page 70-89, 50-59).
      const exported = await sharp(pagePath).extract({ left: 45, top: 35, width: 70, height: 50 })
        .resize(140, 100, { kernel: 'nearest' }).png().toBuffer();
      const white = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer();
      fs.mkdirSync(panels);
      await sharp(exported).composite([{ input: white, left: 50, top: 30 }]).png().toFile(path.join(panels, 'page_p01.png'));

      const result = await applyPanels({ filePath: pagePath, panels: [BOX], folder: panels });
      expect(result.applied).toBe(1);

      const { data } = await sharp(pagePath).raw().toBuffer({ resolveWithObject: true });
      const at = (x, y) => [...data.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
      expect(at(80, 55)).toEqual([255, 255, 255]);
      expect(at(10, 10)).toEqual([...page.subarray((10 * W + 10) * 3, (10 * W + 10) * 3 + 3)]);
      expect(fs.existsSync(path.join(dir, 'bak', 'cleanup', 'page.png'))).toBe(true);

      // Running again changes nothing.
      const again = await applyPanels({ filePath: pagePath, panels: [BOX], folder: panels });
      expect(again).toMatchObject({ applied: 0, already: 1 });
    });

    test('a panel image that isn\'t from this page is left out', async () => {
      const pagePath = path.join(dir, 'page.png');
      await sharp(pagePixels(), { raw: { width: W, height: H, channels: 3 } }).png().toFile(pagePath);
      fs.mkdirSync(path.join(dir, 'panels'));
      await sharp({ create: { width: 60, height: 40, channels: 3, background: '#3366cc' } }).png().toFile(path.join(dir, 'panels', 'page_p01.png'));
      const before = fs.readFileSync(pagePath);
      const result = await applyPanels({ filePath: pagePath, panels: [BOX], folder: path.join(dir, 'panels') });
      expect(result).toMatchObject({ applied: 0, unplaced: 1 });
      expect(fs.readFileSync(pagePath).equals(before)).toBe(true);
    });
  });
});
