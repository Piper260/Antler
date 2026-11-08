// Chooses the distinct frames from a run of samples taken through a video.
// Each sample carries a small greyscale signature, so the choice can be redone
// instantly at a new difference setting without reading the video again.
(function (root) {
  const SIGNATURE_WIDTH = 64;
  const SIGNATURE_HEIGHT = 36;
  // Grey levels a pixel must move by to count as changed, above video noise.
  const PIXEL_CHANGE = 14;
  // Standard deviation of grey levels below which a frame is a flat colour,
  // such as the black at either end of a fade.
  const BLANK_CONTRAST = 4;

  /** Times to sample at, widening `step` when it would pass `limit` samples. */
  function sampleTimes(duration, step, limit) {
    if (!Number.isFinite(duration) || duration <= 0 || !(step > 0)) return [0];
    const gap = Math.max(step, duration / limit);
    const times = [];
    for (let i = 0; i * gap < duration; i++) times.push(Math.round(i * gap * 1000) / 1000);
    return times;
  }

  function toGrey(rgba) {
    const grey = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < grey.length; i++) {
      const p = i * 4;
      grey[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    }
    return grey;
  }

  function contrast(grey) {
    let sum = 0;
    for (let i = 0; i < grey.length; i++) sum += grey[i];
    const mean = sum / grey.length;
    let spread = 0;
    for (let i = 0; i < grey.length; i++) spread += (grey[i] - mean) ** 2;
    return Math.sqrt(spread / grey.length);
  }

  /** Average step between neighbouring pixels; motion blur lowers it. */
  function sharpness(grey, width) {
    let total = 0;
    let count = 0;
    for (let i = 0; i < grey.length; i++) {
      if ((i + 1) % width !== 0) { total += Math.abs(grey[i] - grey[i + 1]); count++; }
      if (i + width < grey.length) { total += Math.abs(grey[i] - grey[i + width]); count++; }
    }
    return count ? total / count : 0;
  }

  /** Share of pixels, 0 to 1, that changed between two signatures. */
  function difference(a, b) {
    let changed = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > PIXEL_CHANGE) changed++;
    }
    return changed / a.length;
  }

  /**
   * The sharpest frame of each stretch where the picture stays about the same,
   * leaving out any that repeat one already kept. Comparing against everything
   * kept, not just the last frame, is what drops the repeats in a looping clip.
   */
  function pickFrames(samples, minDifference) {
    const best = [];
    let anchor = null;
    for (const sample of samples) {
      if (sample.contrast < BLANK_CONTRAST) continue;
      if (anchor && difference(sample.signature, anchor.signature) < minDifference) {
        if (sample.sharpness > best[best.length - 1].sharpness) best[best.length - 1] = sample;
      } else {
        anchor = sample;
        best.push(sample);
      }
    }

    const kept = [];
    for (const sample of best) {
      if (!kept.some(other => difference(sample.signature, other.signature) < minDifference)) kept.push(sample);
    }
    return kept;
  }

  const api = { SIGNATURE_WIDTH, SIGNATURE_HEIGHT, sampleTimes, toGrey, contrast, sharpness, difference, pickFrames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FrameSelect = api;
})(typeof window !== 'undefined' ? window : globalThis);
