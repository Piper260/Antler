const { smooth, heatmapCells, CUTOFF, MAX_ALPHA } = require('../src/renderer/js/utils/heatmapCells');

describe('heatmapCells', () => {
  test('averaging cancels a speckle but keeps an area where neighbours agree', () => {
    // 6 x 6: alternating +1/-1 everywhere, and a solid +3 block in one corner.
    const rows = 6;
    const cols = 6;
    const values = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) values.push(r < 3 && c < 3 ? 3 : ((r + c) % 2 ? 1 : -1));
    }
    const { sign, alpha } = heatmapCells(values, rows, cols);
    expect(sign[0]).toBe(1);
    expect(alpha[0]).toBeCloseTo(MAX_ALPHA, 5);
    // The far corner is pure speckle: left out.
    expect(sign[rows * cols - 1]).toBe(0);
    expect(alpha[rows * cols - 1]).toBe(0);
  });

  test('keeps the sign of an area that argues against the tag', () => {
    const values = new Array(16).fill(0);
    values[5] = -2;
    values[6] = -2;
    values[9] = -2;
    values[10] = -2;
    const { sign } = heatmapCells(values, 4, 4);
    expect(sign[5]).toBe(-1);
  });

  test('leaves out cells under the cutoff and handles an all-zero map', () => {
    const smoothed = smooth([0, 0, 0, 1], 2, 2);
    expect(smoothed.length).toBe(4);
    const { sign, alpha } = heatmapCells([0, 0, 0, 0], 2, 2);
    expect([...sign]).toEqual([0, 0, 0, 0]);
    expect([...alpha]).toEqual([0, 0, 0, 0]);
    expect(CUTOFF).toBeGreaterThan(0);
  });
});
