/**
 * Hydra heatmap values (one per 16px patch, row by row) turned into what the
 * Tag Editor paints: each value is averaged with its neighbours (a 3 x 3
 * weighted blur), and anything under a quarter of the strongest is left
 * out. Hydra's raw map scatters small, alternating values over the whole
 * image for most tags; averaging cancels those out while the area the tag is
 * really about, where neighbours agree, stays.
 */
(function (root) {
  const CUTOFF = 0.25;
  const MAX_ALPHA = 0.75;
  const KERNEL = [1, 2, 1, 2, 4, 2, 1, 2, 1];

  /** The blurred values, same length and order. Edges repeat the nearest cell. */
  function smooth(values, rows, cols) {
    const out = new Float32Array(values.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let weight = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = Math.min(rows - 1, Math.max(0, r + dr));
            const cc = Math.min(cols - 1, Math.max(0, c + dc));
            const k = KERNEL[(dr + 1) * 3 + (dc + 1)];
            sum += k * values[rr * cols + cc];
            weight += k;
          }
        }
        out[r * cols + c] = sum / weight;
      }
    }
    return out;
  }

  /**
   * Per cell: sign (1 supports the tag, -1 argues against it, 0 not shown)
   * and opacity 0..MAX_ALPHA.
   * @returns {{sign: Int8Array, alpha: Float32Array}}
   */
  function heatmapCells(values, rows, cols) {
    const smoothed = smooth(values, rows, cols);
    let max = 0;
    for (const v of smoothed) max = Math.max(max, Math.abs(v));
    const sign = new Int8Array(smoothed.length);
    const alpha = new Float32Array(smoothed.length);
    if (max === 0) return { sign, alpha };
    for (let i = 0; i < smoothed.length; i++) {
      const strength = Math.abs(smoothed[i]) / max;
      if (strength < CUTOFF) continue;
      sign[i] = smoothed[i] > 0 ? 1 : -1;
      alpha[i] = strength * MAX_ALPHA;
    }
    return { sign, alpha };
  }

  const api = { CUTOFF, MAX_ALPHA, smooth, heatmapCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeatmapCells = api;
})(typeof window !== 'undefined' ? window : globalThis);
