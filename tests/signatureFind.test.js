const { findSignatures, camBlobs, inkRegion, edgeness } = require('../src/main/services/signatureFind');
const { scoreImage, scoreRun } = require('../scripts/signature-bench/score');

// A 10 x 10 heatmap over a 1000 x 1000 image, hot in the given cells.
const cam = (hot) => {
  const values = new Array(100).fill(0);
  for (const [r, c, v = 1] of hot) values[r * 10 + c] = v;
  return { values, grid: { rows: 10, cols: 10 } };
};
const W = 1000;
const H = 1000;

describe('signatureFind', () => {
  test('camBlobs boxes connected hot cells, padded by a cell', () => {
    const blobs = camBlobs(cam([[9, 8], [9, 9]]).values, { rows: 10, cols: 10 }, W, H);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toMatchObject({ x: 700, y: 800, w: 300, h: 200 });
  });

  test('a lettering box in a corner with heatmap support is found as a signature', () => {
    const found = findSignatures({
      width: W, height: H,
      probs: { signature: 0.9, watermark: 0.01 },
      cams: { signature: cam([[9, 9]]), watermark: cam([]) },
      texts: [{ label: 'text_free', score: 0.7, x: 900, y: 920, w: 90, h: 60 }]
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ x: 900, y: 920, kind: 'signature' });
    expect(found[0].score).toBeGreaterThan(0.6);
  });

  test('a signature the text model calls a bubble still counts at the edge, once', () => {
    const box = { x: 700, y: 950, w: 280, h: 40 };
    const found = findSignatures({
      width: W, height: H, probs: { signature: 0.9 }, cams: { signature: cam([[9, 8]]) },
      texts: [
        { label: 'bubble', score: 0.6, ...box },
        { label: 'text_bubble', score: 0.5, ...box },
        { label: 'text_free', score: 0.4, ...box },
        { label: 'bubble', score: 0.9, x: 400, y: 400, w: 200, h: 150 }
      ]
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject(box);
  });

  test('without Hydra seeing a signature, weak lettering in the middle is dropped', () => {
    const found = findSignatures({
      width: W, height: H, probs: { signature: 0.01, watermark: 0.01 }, cams: { signature: cam([[5, 5]]) },
      texts: [{ label: 'text_free', score: 0.5, x: 450, y: 450, w: 100, h: 50 }]
    });
    expect(found).toEqual([]);
  });

  test('a heatmap blob with no lettering counts only at the border', () => {
    const corner = findSignatures({ width: W, height: H, probs: { signature: 0.95 }, cams: { signature: cam([[0, 0]]) }, texts: [] }, { camPad: 0 });
    expect(corner).toHaveLength(1);
    expect(corner[0].x).toBe(0);
    const middle = findSignatures({ width: W, height: H, probs: { signature: 0.95 }, cams: { signature: cam([[5, 5]]) }, texts: [] });
    expect(middle).toEqual([]);
  });

  test('dialogue in the middle and tall sound effects are not signatures', () => {
    const found = findSignatures({
      width: W, height: H, probs: { signature: 0.9 }, cams: { signature: cam([[9, 9, 0.3]]) },
      texts: [
        { label: 'text_free', score: 0.9, x: 400, y: 600, w: 200, h: 60 },
        { label: 'text_free', score: 0.9, x: 880, y: 860, w: 100, h: 120 }
      ]
    });
    expect(found).toEqual([]);
  });

  test('a strip holding two finds is dropped for its parts', () => {
    const found = findSignatures({
      width: W, height: H, probs: { signature: 0.9 }, cams: { signature: cam([[9, 0], [9, 9]]) },
      texts: [
        { label: 'text_free', score: 0.8, x: 10, y: 950, w: 150, h: 40 },
        { label: 'text_free', score: 0.8, x: 840, y: 950, w: 150, h: 40 },
        { label: 'text_free', score: 0.8, x: 5, y: 945, w: 990, h: 50 }
      ]
    });
    expect(found.map(f => f.w).sort()).toEqual([150, 150]);
  });

  test('huge boxes are not signatures', () => {
    const found = findSignatures({
      width: W, height: H, probs: { signature: 0.9 }, cams: { signature: cam([]) },
      texts: [{ label: 'text_free', score: 0.9, x: 0, y: 0, w: 600, h: 600 }]
    });
    expect(found).toEqual([]);
  });

  test('edgeness is 1 at the border and 0 in the centre', () => {
    expect(edgeness({ x: 450, y: 450, w: 100, h: 100 }, W, H)).toBe(0);
    expect(edgeness({ x: 900, y: 0, w: 100, h: 100 }, W, H)).toBeCloseTo(0.9);
  });

  test('inkRegion masks dark strokes on a light background, not the whole box', () => {
    const w = 40;
    const h = 20;
    const data = new Uint8Array(w * h * 3).fill(240);
    for (let x = 10; x < 30; x++) data.set([20, 20, 20], (10 * w + x) * 3); // a line of ink
    const region = inkRegion({ data, width: w, height: h }, { x: 5, y: 5, w: 30, h: 10 }, { pad: 2, grow: 1 });
    expect(region.whole).toBe(false);
    const marked = region.mask.reduce((a, b) => a + b, 0);
    expect(marked).toBeGreaterThan(20);
    expect(marked).toBeLessThan(region.w * region.h / 2);
  });
});

describe('signature bench scoring', () => {
  const truth = { reviewed: true, boxes: [{ x: 900, y: 900, w: 100, h: 80 }] };

  test('a find over the signature is right and covers it', () => {
    const s = scoreImage([{ x: 890, y: 890, w: 110, h: 100 }], truth);
    expect(s).toMatchObject({ truth: 1, found: 1, covered: 1, finds: 1, right: 1, wrong: 0 });
  });

  test('a find elsewhere is wrong and the signature is missed', () => {
    const s = scoreImage([{ x: 0, y: 0, w: 50, h: 50 }], truth);
    expect(s).toMatchObject({ found: 0, right: 0, wrong: 1 });
  });

  test('a run counts reviewed images and tag hints separately', () => {
    const images = [
      { path: 'a', tagged: true, candidates: [{ x: 900, y: 900, w: 100, h: 80 }] },
      { path: 'b', tagged: false, candidates: [] },
      { path: 'c', tagged: false, candidates: [{ x: 0, y: 0, w: 10, h: 10 }] }
    ];
    const s = scoreRun(images, { a: truth, b: { reviewed: true, boxes: [] } });
    expect(s).toMatchObject({ reviewed: 2, recall: 100, precision: 100, perfectRate: 100 });
    expect(s.tags).toMatchObject({ tagged: 1, taggedHit: 1, untagged: 2, untaggedFlagged: 1 });
  });
});
