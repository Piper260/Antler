const { letterbox, decodeOutput, nonMaxSuppression, meanScore, pickMostConfident } = require('../src/main/services/panelModel');

/** Build a [5, anchors] output from rows of [cx, cy, w, h, score]. */
function output(rows) {
  const n = rows.length;
  const data = new Float32Array(5 * n);
  rows.forEach((row, i) => row.forEach((value, k) => { data[k * n + i] = value; }));
  return { data, n };
}

describe('letterbox', () => {
  test('fits a tall page centred horizontally', () => {
    const fit = letterbox(1000, 2000, 640);
    expect(fit.scale).toBeCloseTo(0.32);
    expect(fit.nh).toBe(640);
    expect(fit.nw).toBe(320);
    expect(fit.dx).toBe(160);
    expect(fit.dy).toBe(0);
  });
});

describe('decodeOutput', () => {
  test('maps boxes back to page pixels and drops weak ones', () => {
    const fit = letterbox(1000, 2000, 640);
    // A box covering the top half of the page, and one below the score cut.
    const { data, n } = output([
      [160 + 160, 160, 320, 320, 0.9],
      [320, 480, 100, 100, 0.1]
    ]);
    const boxes = decodeOutput(data, n, fit, 1000, 2000);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBeCloseTo(0);
    expect(boxes[0].y).toBeCloseTo(0);
    expect(boxes[0].w).toBeCloseTo(1000);
    expect(boxes[0].h).toBeCloseTo(1000);
  });

  test('clips boxes that reach into the padding', () => {
    const fit = letterbox(1000, 2000, 640);
    const { data, n } = output([[160, 320, 200, 200, 0.8]]);
    const [box] = decodeOutput(data, n, fit, 1000, 2000);
    expect(box.x).toBe(0);
    expect(box.x + box.w).toBeCloseTo(((160 + 100) - 160) / 0.32);
  });
});

describe('nonMaxSuppression', () => {
  test('keeps the best of overlapping boxes and separate ones', () => {
    const kept = nonMaxSuppression([
      { x: 0, y: 0, w: 100, h: 100, score: 0.6 },
      { x: 5, y: 5, w: 100, h: 100, score: 0.9 },
      { x: 300, y: 0, w: 100, h: 100, score: 0.5 }
    ]);
    expect(kept.map(box => box.score)).toEqual([0.9, 0.5]);
  });
});

describe('pickMostConfident', () => {
  test('prefers the run with the higher mean score', () => {
    const a = [{ score: 0.9 }, { score: 0.3 }];
    const b = [{ score: 0.8 }, { score: 0.7 }, { score: 0.75 }];
    expect(pickMostConfident([a, b])).toBe(b);
    expect(meanScore([])).toBe(0);
    expect(pickMostConfident([[], []])).toEqual([]);
  });
});
