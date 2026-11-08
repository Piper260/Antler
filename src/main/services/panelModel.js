/**
 * Pre- and post-processing for the YOLOv8 panel detector
 * (resources/models/comic/inkwell-panels.onnx, single class "panel").
 * Inference itself lives in the comic worker; these pieces are pure so they
 * can be tested without onnxruntime.
 *
 * The page is letterboxed into a square input (grey 114 padding, as the
 * model was trained). The output is [1, 5, anchors]: cx, cy, w, h and a
 * score per anchor, in input pixels, with overlapping duplicates still in.
 */

// Neither size wins on every page: 640 suits small or simple pages, 1024
// resolves thin gutters and slanted splits on large ones. Both are run and
// the more confident result is kept.
const INPUT_SIZES = [640, 1024];
const MIN_SCORE = 0.25;
const NMS_IOU = 0.45;

/** Scale and offsets that fit a width x height page centred in size x size. */
function letterbox(width, height, size) {
  const scale = Math.min(size / width, size / height);
  const nw = Math.round(width * scale);
  const nh = Math.round(height * scale);
  return { scale, nw, nh, dx: Math.floor((size - nw) / 2), dy: Math.floor((size - nh) / 2) };
}

/**
 * Candidate boxes above `minScore`, mapped back to page pixels and clipped.
 * @param {Float32Array} data - output0 flattened, [5, anchors]
 * @param {number} anchors
 * @param {{scale, dx, dy}} fit - from letterbox()
 */
function decodeOutput(data, anchors, fit, pageWidth, pageHeight, minScore = MIN_SCORE) {
  const boxes = [];
  for (let i = 0; i < anchors; i++) {
    const score = data[4 * anchors + i];
    if (score < minScore) continue;
    const cx = data[i];
    const cy = data[anchors + i];
    const w = data[2 * anchors + i];
    const h = data[3 * anchors + i];
    const x1 = Math.max(0, (cx - w / 2 - fit.dx) / fit.scale);
    const y1 = Math.max(0, (cy - h / 2 - fit.dy) / fit.scale);
    const x2 = Math.min(pageWidth, (cx + w / 2 - fit.dx) / fit.scale);
    const y2 = Math.min(pageHeight, (cy + h / 2 - fit.dy) / fit.scale);
    if (x2 > x1 && y2 > y1) boxes.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, score });
  }
  return boxes;
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Greedy non-maximum suppression: best-scoring box wins each overlap. */
function nonMaxSuppression(boxes, threshold = NMS_IOU) {
  const kept = [];
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    if (!kept.some(other => iou(other, box) > threshold)) kept.push(box);
  }
  return kept;
}

function meanScore(boxes) {
  return boxes.length ? boxes.reduce((sum, box) => sum + box.score, 0) / boxes.length : 0;
}

/** Of several runs' box lists, the one with the highest mean score. */
function pickMostConfident(runs) {
  return runs.reduce((best, boxes) => (meanScore(boxes) > meanScore(best) ? boxes : best), []);
}

module.exports = {
  INPUT_SIZES,
  letterbox,
  decodeOutput,
  nonMaxSuppression,
  meanScore,
  pickMostConfident
};
