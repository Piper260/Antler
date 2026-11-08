const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ThumbnailCache, EDGE } = require('../src/main/services/thumbnailCache');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const makeImage = (file, width, height) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toFile(file);

describe('ThumbnailCache', () => {
  test('makes a small JPEG once and reuses it', async () => {
    const image = path.join(dir, 'big.png');
    await makeImage(image, 2000, 1000);
    const cache = new ThumbnailCache(path.join(dir, 'cache'));

    const first = await cache.get(image);
    const meta = await sharp(first).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width, meta.height)).toBe(EDGE);

    const made = fs.statSync(first).birthtimeMs;
    const again = await cache.get(image);
    expect(again).toBe(first);
    expect(fs.statSync(again).birthtimeMs).toBe(made);
  });

  test('a changed image gets a new thumbnail', async () => {
    const image = path.join(dir, 'a.png');
    await makeImage(image, 100, 100);
    const cache = new ThumbnailCache(path.join(dir, 'cache'));
    const before = await cache.get(image);
    await makeImage(image, 300, 120);
    fs.utimesSync(image, new Date(), new Date(Date.now() + 5000));
    const after = await cache.get(image);
    expect(after).not.toBe(before);
  });

  test('the same image asked for at once is made once', async () => {
    const image = path.join(dir, 'b.png');
    await makeImage(image, 800, 800);
    const cache = new ThumbnailCache(path.join(dir, 'cache'));
    const results = await Promise.all([cache.get(image), cache.get(image), cache.get(image)]);
    expect(new Set(results).size).toBe(1);
    expect(fs.readdirSync(path.join(dir, 'cache')).filter(name => name.endsWith('.jpg')).length).toBe(1);
  });

  test('prune removes the least recently used thumbnails first', async () => {
    const folder = path.join(dir, 'cache');
    fs.mkdirSync(folder);
    for (const [name, age] of [['old.jpg', 3000], ['mid.jpg', 2000], ['new.jpg', 1000]]) {
      const file = path.join(folder, name);
      fs.writeFileSync(file, Buffer.alloc(100));
      const time = new Date(Date.now() - age * 1000);
      fs.utimesSync(file, time, time);
    }
    // 300 bytes against a 250 limit: down to 80% (200), so only the oldest goes.
    expect(await new ThumbnailCache(folder).prune(250)).toBe(1);
    expect(fs.readdirSync(folder).sort()).toEqual(['mid.jpg', 'new.jpg']);
    // Under the limit: nothing goes.
    expect(await new ThumbnailCache(folder).prune(250)).toBe(0);
  });
});
