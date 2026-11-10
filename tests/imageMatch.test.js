const sharp = require('sharp');
const match = require('../src/main/services/imageMatch');
const { pairUp, pairKey } = require('../src/main/services/UpgradeFinder');

/** A test picture: a few shapes on a gradient, so it has real structure. */
function picture(width, height, { variant = 0 } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 400 300">
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#203040"/><stop offset="1" stop-color="#d0c0a0"/></linearGradient></defs>
    <rect width="400" height="300" fill="url(#g)"/>
    <circle cx="${variant === 2 ? 300 : 120}" cy="150" r="70" fill="#f0f0f0"/>
    <rect x="230" y="60" width="110" height="180" fill="#402010"/>
    ${variant === 1 ? '<rect x="0" y="260" width="400" height="40" fill="#ffffff"/>' : ''}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('dhash / hamming', () => {
  test('the same picture at very different sizes matches', async () => {
    const big = await match.dhash(await picture(4000, 3000));
    const small = await match.dhash(await picture(150, 113));
    expect(match.hamming(big, small)).toBeLessThanOrEqual(match.DEFAULT_SURE);
  });

  test('a JPEG copy of the PNG still matches', async () => {
    const png = await picture(1200, 900);
    const jpg = await sharp(png).jpeg({ quality: 60 }).toBuffer();
    expect(match.hamming(await match.dhash(png), await match.dhash(jpg))).toBeLessThanOrEqual(match.DEFAULT_SURE);
  });

  test('a different picture is far apart', async () => {
    const a = await match.dhash(await picture(800, 600));
    const b = await match.dhash(await picture(800, 600, { variant: 2 }));
    expect(match.hamming(a, b)).toBeGreaterThan(match.DEFAULT_SURE);
  });

  test('hamming counts differing bits', () => {
    expect(match.hamming('0000000000000000', '0000000000000000')).toBe(0);
    expect(match.hamming('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(match.hamming('000000000000000f', '0000000000000001')).toBe(3);
  });
});

describe('aspectOff', () => {
  test('same shape is 0, unknown is null', () => {
    expect(match.aspectOff({ width: 1280, height: 960 }, { width: 3840, height: 2880 })).toBeCloseTo(0);
    expect(match.aspectOff({ width: 1000, height: 1000 }, { width: 1000, height: 800 })).toBeCloseTo(0.2);
    expect(match.aspectOff({ width: 0, height: 0 }, { width: 1, height: 1 })).toBeNull();
  });
});

describe('classify', () => {
  const original = { width: 1280, height: 960 };
  const bigger = { width: 3840, height: 2880 };
  const sameSize = { width: 1280, height: 960 };

  test('close, same shape, bigger is an upgrade', () => {
    expect(match.classify({ distance: 2, original, candidate: bigger })).toBe('upgrade');
  });

  test('close, same shape, not bigger is same', () => {
    expect(match.classify({ distance: 0, original, candidate: sameSize })).toBe('same');
  });

  test('close but a different shape is asked about', () => {
    expect(match.classify({ distance: 2, original, candidate: { width: 3840, height: 2000 } })).toBe('ask');
  });

  test('in between is asked about, too far is nothing', () => {
    expect(match.classify({ distance: 8, original, candidate: bigger })).toBe('ask');
    expect(match.classify({ distance: match.LOOSE + 1, original, candidate: bigger })).toBeNull();
  });

  test('an uncertain pair that is not larger is not asked about', () => {
    expect(match.classify({ distance: 8, original, candidate: sameSize })).toBeNull();
    expect(match.classify({ distance: 2, original, candidate: { width: 1280, height: 700 } })).toBeNull();
  });

  test('answers win', () => {
    expect(match.classify({ distance: 12, original, candidate: bigger, answer: 'same' })).toBe('upgrade');
    expect(match.classify({ distance: 0, original, candidate: bigger, answer: 'different' })).toBeNull();
    expect(match.classify({ distance: 0, original, candidate: bigger, answer: 'variant' })).toBe('variant');
  });

  test('a raised cut-off accepts more', () => {
    expect(match.classify({ distance: 7, original, candidate: bigger }, 8)).toBe('upgrade');
  });
});

describe('sureCutoff', () => {
  test('starts at the default', () => {
    expect(match.sureCutoff([])).toBe(match.DEFAULT_SURE);
  });

  const same = (...ds) => ds.map(distance => ({ answer: 'same', distance }));

  test('one answer does not move it', () => {
    expect(match.sureCutoff(same(10))).toBe(match.DEFAULT_SURE);
    expect(match.sureCutoff(same(7, 9))).toBe(match.DEFAULT_SURE);
  });

  test('rises only as far as three answers agree', () => {
    expect(match.sureCutoff(same(5, 6, 7))).toBe(5);
    expect(match.sureCutoff(same(5, 6, 7, 8))).toBe(6);
    expect(match.sureCutoff(same(12, 13, 14))).toBe(match.MAX_SURE);
  });

  test('stays below the closest "different"', () => {
    expect(match.sureCutoff([...same(6, 7, 8), { answer: 'different', distance: 7 }])).toBe(match.DEFAULT_SURE);
    expect(match.sureCutoff([...same(5, 6, 6), { answer: 'different', distance: 9 }])).toBe(5);
    expect(match.sureCutoff([{ answer: 'different', distance: 3 }])).toBe(2);
  });

  test('the case seen in testing: same at 5, different at 10', () => {
    expect(match.sureCutoff([{ answer: 'same', distance: 5 }, { answer: 'different', distance: 10 }])).toBe(match.DEFAULT_SURE);
  });
});

describe('pairUp', () => {
  test('pairs each post with its closest candidate, skipping rejected pairs', () => {
    const originals = [{ postId: '1', fingerprint: '00000000000000ff' }, { postId: '2', fingerprint: 'ffffffffffffffff' }];
    const candidates = [
      { hash: 'a', fingerprint: '00000000000000fe' }, // 1 bit from post 1
      { hash: 'b', fingerprint: '00000000000000f0' }  // 4 bits from post 1
    ];
    const pairs = pairUp(originals, candidates);
    expect(pairs.get('1')).toMatchObject({ distance: 1, candidate: { hash: 'a' } });
    expect(pairs.has('2')).toBe(false);

    const again = pairUp(originals, candidates, { [pairKey('1', 'a')]: { answer: 'different' } });
    expect(again.get('1')).toMatchObject({ distance: 4, candidate: { hash: 'b' } });
  });
});
