const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { heal, maskBox } = require('../src/main/services/spotHeal');
const { HealSessions } = require('../src/main/services/healSessions');

// Vertical stripes with a vertical gradient: a pattern healing has to continue.
function stripes(width, height) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([Math.floor(x / 10) % 2 ? 200 : 120, Math.round((y / height) * 200), 80], (y * width + x) * 3);
  }
  return data;
}

describe('spotHeal', () => {
  test('a black box over stripes is filled with the stripes', () => {
    const width = 300;
    const height = 200;
    const original = stripes(width, height);
    const data = original.slice();
    const mask = new Uint8Array(width * height);
    for (let y = 80; y < 120; y++) {
      for (let x = 120; x < 190; x++) {
        mask[y * width + x] = 1;
        data.set([0, 0, 0], (y * width + x) * 3);
      }
    }
    heal({ data, width, height }, mask);
    let error = 0;
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) {
        expect(data[i * 3]).toBe(original[i * 3]);
        continue;
      }
      for (let c = 0; c < 3; c++) error += Math.abs(data[i * 3 + c] - original[i * 3 + c]);
      count += 3;
    }
    expect(error / count).toBeLessThan(6);
  });

  test('maskBox finds the marked area, or null', () => {
    const mask = new Uint8Array(100);
    expect(maskBox(mask, 10, 10)).toBeNull();
    mask[23] = mask[45] = 1;
    expect(maskBox(mask, 10, 10)).toEqual({ x: 3, y: 2, w: 3, h: 3 });
  });
});

describe('HealSessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-heal-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const load = async (filePath) => {
    const { data, info } = await sharp(filePath).rotate().flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };

  test('heal, undo, heal and save: only healed pixels change, transparency stays, the original is kept', async () => {
    const width = 200;
    const height = 120;
    const raw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      raw.set([Math.floor(x / 8) % 2 ? 220 : 90, 120, 60, x < 10 ? 0 : 255], i * 4);
    }
    for (let y = 50; y < 70; y++) for (let x = 90; x < 140; x++) raw.set([0, 0, 0, 255], (y * width + x) * 4);
    const file = path.join(dir, 'a.png');
    await sharp(raw, { raw: { width, height, channels: 4 } }).png().toFile(file);

    const sessions = new HealSessions(load);
    const region = { x: 88, y: 48, w: 54, h: 24, mask: new Uint8Array(54 * 24).fill(1) };
    expect((await sessions.heal(file, region)).edits).toBe(1);
    expect((await sessions.undo(file)).edits).toBe(0);
    await sessions.heal(file, region);
    expect(await sessions.save(file)).toEqual({ saved: true });
    expect(fs.existsSync(path.join(dir, 'bak', 'cleanup', 'a.png'))).toBe(true);

    const after = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    expect(after.info.channels).toBe(4);
    let outside = 0;
    let black = 0;
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      const inside = x >= 88 && x < 142 && y >= 48 && y < 72;
      const a = after.data.subarray(i * 4, i * 4 + 4);
      const b = raw.subarray(i * 4, i * 4 + 4);
      if (!inside && (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3])) outside++;
      if (inside && a[0] < 30) black++;
    }
    expect(outside).toBe(0);
    expect(black).toBe(0);
  });
});
