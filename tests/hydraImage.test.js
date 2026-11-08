const sharp = require('sharp');
const { hydraSize, prepareHydraImage, TO_LINEAR, TO_SRGB } = require('../src/main/services/hydraImage');

describe('hydraSize', () => {
  // [height, width] in, and what Hydra's own get_image_size_for_seq gave for
  // the same sizes (real e621 posts and a few made-up shapes).
  test.each([
    [[1999, 1455], [592, 432]],
    [[2964, 5098], [384, 672]],
    [[3080, 4044], [448, 576]],
    [[544, 2048], [256, 976]],
    [[6000, 4000], [624, 416]],
    [[200, 150], [192, 144]],
    [[1400, 120], [1392, 112]],
    [[40, 4000], [32, 4000]]
  ])('%j becomes %j', (input, expected) => {
    expect(hydraSize(...input)).toEqual(expected);
  });

  test('never goes over 1024 patches and keeps at least one each way', () => {
    for (const [h, w] of [[10, 10], [16, 16], [5000, 17], [17, 5000], [3000, 3000], [512, 512], [513, 513]]) {
      const [ph, pw] = hydraSize(h, w);
      expect(ph % 16).toBe(0);
      expect(pw % 16).toBe(0);
      expect(ph).toBeGreaterThanOrEqual(16);
      expect(pw).toBeGreaterThanOrEqual(16);
      expect((ph / 16) * (pw / 16)).toBeLessThanOrEqual(1024);
    }
  });
});

describe('sRGB tables', () => {
  test('match the ends and a few values of Hydra\'s tables', () => {
    expect(TO_LINEAR[0]).toBe(0);
    expect(TO_LINEAR[255]).toBe(65535);
    expect(TO_SRGB[0]).toBe(0);
    expect(TO_SRGB[65535]).toBe(255);
    // Each 8-bit value survives the round trip.
    for (let c = 0; c < 256; c++) expect(TO_SRGB[TO_LINEAR[c]]).toBe(c);
  });
});

describe('prepareHydraImage', () => {
  test('flattens transparency onto white and resizes to whole patches', async () => {
    const png = await sharp({ create: { width: 50, height: 70, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data, height, width } = await prepareHydraImage(png);
    expect([height, width]).toEqual([64, 48]);
    expect(data.length).toBe(64 * 48 * 3);
    expect(Math.min(...data)).toBe(255);
  });

  test('keeps an image that is already whole patches as it is', async () => {
    const raw = Buffer.alloc(32 * 16 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 37) % 256;
    const png = await sharp(raw, { raw: { width: 16, height: 32, channels: 3 } }).png().toBuffer();
    const { data, height, width } = await prepareHydraImage(png);
    expect([height, width]).toEqual([32, 16]);
    expect(Buffer.compare(data, raw)).toBe(0);
  });
});
