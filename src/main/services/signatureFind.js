/**
 * Finding artist signatures and watermarks, for Image Cleanup's spot healing.
 *
 * Two models already in Antler are combined:
 *  - Hydra's heatmap (CAM) for its `signature` and `watermark` tags says
 *    roughly where in the image the tag was seen, one value per 16px patch;
 *  - the comic text model (comic-bubbles.onnx) boxes lettering outside
 *    speech bubbles ("text_free"), which is what a signature looks like.
 *
 * A lettering box backed by the heatmap is a strong find; a lettering box
 * on its own, or a heatmap blob with no lettering in it, is weaker. Hydra's
 * own score for the tags gates the whole image: with both near zero, only a
 * very strong lettering box near an edge survives.
 *
 * Everything here is pure (no models, no files) so it can be tested and
 * benchmarked; the worker (workers/comicVisionWorker.js 'signatures') runs
 * the models and calls findSignatures.
 *
 * Boxes are { x, y, w, h } in image pixels.
 */

const { fillHoles } = require('./bubbleMask');

const DEFAULTS = {
  // Heatmap cells count when above this share of the image's strongest cell...
  camShare: 0.45,
  // ...and above this absolute value (CAM units).
  camFloor: 0.02,
  // Lettering boxes from the text model at or above this score are looked at.
  // Signatures are faint, so this is low; the edge rule does the sorting.
  textScore: 0.15,
  // Final candidates below this score are dropped.
  minScore: 0.3,
  // Image-level gate: below this Hydra probability for both tags, only very
  // strong evidence survives.
  gateProb: 0.08,
  // A candidate covering more of the image than this is not a signature...
  maxArea: 0.12,
  // ...nor one taller than this share of the image's height (on the bench
  // the tallest real one was 8%; taller lettering was titles and dialogue).
  maxHeight: 0.1,
  // Heatmap blobs are grown by this many cells before boxing (the CAM is coarse).
  camPad: 1,
  // Signatures sit at the edge. Lettering must be at least this far out
  // (edgeness, 0 centre to 1 border): on the bench every signature marked
  // was at 0.87 or more, and lettering further in was dialogue.
  textEdge: 0.85,
  // A heatmap blob with no lettering only counts this close to the border:
  // Hydra's heatmap for the tags also lights up the subject.
  camOnlyEdge: 0.85,
  // Blocky lettering (about as tall as it is wide) is dialogue or a sound
  // effect; signatures run along a line, across or (at the side) down. Small
  // blocks (a page number) are kept: below this share of the image's height.
  minAspect: 1.25,
  smallBlock: 0.045,
  // Square lettering in a corner is a logo, up to this share of the height.
  cornerBlock: 0.08,
  // Small lettering centred at the top or bottom (a page number) gets this much extra.
  pageNumberBonus: 0.1,
  // The text model calls some signatures speech bubbles or bubble text; near
  // the edge, every kind of lettering box is looked at.
  labels: ['text_free', 'text_bubble', 'bubble']
};

const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function iou(a, b) {
  const i = intersect(a, b);
  if (!i) return 0;
  return area(i) / (area(a) + area(b) - area(i));
}

/** How close a box is to the image's edge: 1 touching it, 0 at the centre. */
function edgeness(b, width, height) {
  const cx = (b.x + b.w / 2) / width;
  const cy = (b.y + b.h / 2) / height;
  return Math.max(Math.abs(cx - 0.5), Math.abs(cy - 0.5)) * 2;
}

/**
 * Connected blobs of strong heatmap cells, as image boxes with their peak
 * and mean value. `values` is row by row, `grid` is { rows, cols }; the
 * grid covers the whole image (Hydra stretches the image onto it).
 */
function camBlobs(values, grid, width, height, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { rows, cols } = grid;
  if (!values?.length || values.length !== rows * cols) return [];
  let max = 0;
  for (const v of values) if (v > max) max = v;
  const cut = Math.max(o.camFloor, max * o.camShare);
  if (max <= o.camFloor) return [];

  const seen = new Uint8Array(rows * cols);
  const blobs = [];
  for (let start = 0; start < values.length; start++) {
    if (seen[start] || values[start] < cut) continue;
    const stack = [start];
    seen[start] = 1;
    let minR = rows, maxR = -1, minC = cols, maxC = -1, peak = 0, sum = 0, count = 0;
    while (stack.length) {
      const i = stack.pop();
      const r = Math.floor(i / cols);
      const c = i % cols;
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      peak = Math.max(peak, values[i]);
      sum += values[i];
      count++;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const k = nr * cols + nc;
        if (!seen[k] && values[k] >= cut) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    const r0 = Math.max(0, minR - o.camPad);
    const r1 = Math.min(rows - 1, maxR + o.camPad);
    const c0 = Math.max(0, minC - o.camPad);
    const c1 = Math.min(cols - 1, maxC + o.camPad);
    const cw = width / cols;
    const ch = height / rows;
    blobs.push({
      x: Math.round(c0 * cw), y: Math.round(r0 * ch),
      w: Math.round((c1 - c0 + 1) * cw), h: Math.round((r1 - r0 + 1) * ch),
      peak: peak / max, mean: sum / count / max, cells: count
    });
  }
  return blobs.sort((a, b) => b.peak - a.peak);
}

/** The mean of the heatmap's positive values inside a box, as a share of the image's peak. */
function camSupport(values, grid, width, height, box) {
  const { rows, cols } = grid;
  if (!values?.length) return 0;
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max <= 0) return 0;
  const c0 = Math.max(0, Math.floor(box.x / width * cols));
  const c1 = Math.min(cols - 1, Math.floor((box.x + box.w - 1) / width * cols));
  const r0 = Math.max(0, Math.floor(box.y / height * rows));
  const r1 = Math.min(rows - 1, Math.floor((box.y + box.h - 1) / height * rows));
  let best = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) best = Math.max(best, values[r * cols + c]);
  }
  return Math.max(0, best / max);
}

/**
 * Signature and watermark candidates for one image.
 * @param {object} input
 * @param {number} input.width
 * @param {number} input.height
 * @param {{signature?: number, watermark?: number}} input.probs - Hydra's tag probabilities
 * @param {{signature?: {values, grid}, watermark?: {values, grid}}} input.cams - Hydra heatmaps
 * @param {Array<{x,y,w,h,score,label}>} input.texts - text model boxes
 * @returns {Array<{x,y,w,h,score,kind,why}>} strongest first
 */
function findSignatures({ width, height, probs = {}, cams = {}, texts = [] }, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const imageArea = width * height;
  const gate = Math.max(probs.signature || 0, probs.watermark || 0);
  const kinds = ['signature', 'watermark'].filter(kind => cams[kind]?.values?.length);
  const candidates = [];

  // Lettering boxes, scored by the text model and the heatmap under them.
  for (const t of dedupe(texts.filter(t => o.labels.includes(t.label)))) {
    if (!o.labels.includes(t.label) || t.score < o.textScore) continue;
    if (area(t) / imageArea > o.maxArea || t.h / height > o.maxHeight) continue;
    const aspect = t.w / Math.max(1, t.h);
    const cx = (t.x + t.w / 2) / width;
    const cy = (t.y + t.h / 2) / height;
    const corner = Math.abs(cx - 0.5) > 0.35 && Math.abs(cy - 0.5) > 0.35;
    if (aspect < o.minAspect && aspect > 1 / o.minAspect && t.h / height > (corner ? o.cornerBlock : o.smallBlock)) continue;
    let support = 0;
    let kind = 'signature';
    for (const k of kinds) {
      const s = camSupport(cams[k].values, cams[k].grid, width, height, t) * Math.min(1, (probs[k] || 0) / o.gateProb);
      if (s > support) {
        support = s;
        kind = k;
      }
    }
    const edge = edgeness(t, width, height);
    if (edge < o.textEdge) continue;
    const pageNumber = Math.abs(cx - 0.5) < 0.1 && Math.abs(cy - 0.5) > 0.42 && t.h / height < 0.04;
    const score = t.score * 0.45 + support * 0.4 + edge * 0.15 + (pageNumber ? o.pageNumberBonus : 0);
    candidates.push({ x: t.x, y: t.y, w: t.w, h: t.h, score, kind, why: { text: t.score, cam: support, edge } });
  }

  // Heatmap blobs with no lettering box over them.
  for (const k of kinds) {
    if ((probs[k] || 0) < o.gateProb) continue;
    for (const blob of camBlobs(cams[k].values, cams[k].grid, width, height, o)) {
      if (area(blob) / imageArea > o.maxArea || blob.h / height > o.maxHeight) continue;
      if (candidates.some(c => intersect(c, blob))) continue;
      const edge = edgeness(blob, width, height);
      if (edge < o.camOnlyEdge) continue;
      const score = blob.peak * 0.45 * Math.min(1, (probs[k] || 0) / 0.5) + edge * 0.15 + blob.mean * 0.1;
      candidates.push({ x: blob.x, y: blob.y, w: blob.w, h: blob.h, score, kind: k, why: { cam: blob.peak, prob: probs[k], edge } });
    }
  }

  // Without Hydra seeing either tag, only strong lettering at an edge counts.
  const kept = candidates.filter(c => c.score >= o.minScore && (gate >= o.gateProb || (c.why.text >= 0.6 && c.why.edge >= 0.7)));
  return mergeOverlaps(dropContainers(kept)).sort((a, b) => b.score - a.score)
    .map(c => ({ ...c, score: Math.round(c.score * 100) / 100 }));
}

/**
 * A box holding two or more other finds is a strip of several things (a
 * watermark, a subtitle and another watermark along the bottom); the parts
 * are kept and the strip dropped, so each can be signed off and healed alone.
 */
function dropContainers(list) {
  const holds = (outer, inner) => outer !== inner && area(inner) < area(outer) * 0.6
    && intersect(outer, inner) && area(intersect(outer, inner)) >= area(inner) * 0.8;
  return list.filter(c => list.filter(other => holds(c, other)).length < 2);
}

/** The text model often boxes the same lettering under two or three labels: keep the best of each. */
function dedupe(texts) {
  const out = [];
  for (const t of [...texts].sort((a, b) => b.score - a.score)) {
    if (!out.some(o => iou(o, t) > 0.7)) out.push(t);
  }
  return out;
}

/** Overlapping candidates become one, keeping the stronger one's kind. */
function mergeOverlaps(list) {
  const out = [];
  for (const c of [...list].sort((a, b) => b.score - a.score)) {
    const hit = out.find(o => intersect(o, c));
    if (hit) Object.assign(hit, union(hit, c));
    else out.push({ ...c });
  }
  return out;
}

/**
 * Pixels that differ from the mean colour around them (a box of radius r),
 * for an area of the image: a cheap local-contrast stroke finder.
 */
function localInk(img, x0, y0, w, h, r, threshold) {
  // Summed-area table of each channel over the area.
  const W = w + 1;
  const sums = [new Float64Array(W * (h + 1)), new Float64Array(W * (h + 1)), new Float64Array(W * (h + 1))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y + y0) * img.width + x + x0) * 3;
      for (let c = 0; c < 3; c++) {
        const t = sums[c];
        t[(y + 1) * W + x + 1] = img.data[p + c] + t[y * W + x + 1] + t[(y + 1) * W + x] - t[y * W + x];
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + r + 1);
      const n = (yb - ya) * (xb - xa);
      const p = ((y + y0) * img.width + x + x0) * 3;
      let d = 0;
      for (let c = 0; c < 3; c++) {
        const t = sums[c];
        const mean = (t[yb * W + xb] - t[ya * W + xb] - t[yb * W + xa] + t[ya * W + xa]) / n;
        d += Math.abs(img.data[p + c] - mean);
      }
      if (d > threshold) out[y * w + x] = 1;
    }
  }
  return out;
}

/**
 * The ink of a signature: pixels that stand out from the colour around the
 * find's box, grown a little, as a region { x, y, w, h, mask } (mask is
 * w * h, 1 = heal). `img` is { data, width, height } RGB.
 *
 * The text model's box is often a little tight (a logo's top above the
 * lettering), so ink is looked for in a wider area, and the ink connected
 * to the box is kept: a logo poking out is covered, artwork nearby that
 * doesn't touch the signature is left alone. When most of the box stands
 * out (a solid logo plate, or busy artwork) just the whole box is healed.
 */
function inkRegion(img, box, { pad = 6, threshold = 38, grow = 3, reachShare = 0.45 } = {}) {
  const reach = Math.max(pad, Math.round(Math.max(box.h * reachShare, box.w * 0.08)));
  const x0 = Math.max(0, Math.floor(box.x - reach));
  const y0 = Math.max(0, Math.floor(box.y - reach));
  const x1 = Math.min(img.width, Math.ceil(box.x + box.w + reach));
  const y1 = Math.min(img.height, Math.ceil(box.y + box.h + reach));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const at = (x, y) => ((y + y0) * img.width + x + x0) * 3;
  // The box, and the ring just outside it, in this area's coordinates.
  const bx0 = Math.max(0, Math.floor(box.x) - x0);
  const by0 = Math.max(0, Math.floor(box.y) - y0);
  const bx1 = Math.min(w, Math.ceil(box.x + box.w) - x0);
  const by1 = Math.min(h, Math.ceil(box.y + box.h) - y0);
  const rx0 = Math.max(0, bx0 - pad);
  const ry0 = Math.max(0, by0 - pad);
  const rx1 = Math.min(w - 1, bx1 + pad - 1);
  const ry1 = Math.min(h - 1, by1 + pad - 1);

  // Background: the median of each channel along that ring.
  const border = [[], [], []];
  for (let x = rx0; x <= rx1; x++) for (const y of [ry0, ry1]) for (let c = 0; c < 3; c++) border[c].push(img.data[at(x, y) + c]);
  for (let y = ry0; y <= ry1; y++) for (const x of [rx0, rx1]) for (let c = 0; c < 3; c++) border[c].push(img.data[at(x, y) + c]);
  const bg = border.map(list => list.sort((a, b) => a - b)[list.length >> 1]);

  const ink = new Uint8Array(w * h);
  let inBox = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      const d = Math.abs(img.data[p] - bg[0]) + Math.abs(img.data[p + 1] - bg[1]) + Math.abs(img.data[p + 2] - bg[2]);
      if (d > threshold) {
        ink[y * w + x] = 1;
        if (x >= bx0 && x < bx1 && y >= by0 && y < by1) inBox++;
      }
    }
  }
  const boxArea = Math.max(1, (bx1 - bx0) * (by1 - by0));
  let whole = inBox < 4 || inBox > boxArea * 0.7;

  // Lettering over a busy background: most of the box differs from the ring
  // colour, but the strokes still stand out from what's right around them.
  if (whole && inBox >= 4) {
    const local = localInk(img, x0, y0, w, h, Math.max(4, Math.round(box.h * 0.35)), threshold);
    let localInBox = 0;
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) localInBox += local[y * w + x];
    if (localInBox >= 4 && localInBox < boxArea * 0.55) {
      ink.set(local);
      whole = false;
    }
  }

  // Keep the ink connected to the box (flood from the box's ink, or from the whole box).
  const keep = new Uint8Array(w * h);
  const stack = [];
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const i = y * w + x;
      if (whole || ink[i]) {
        keep[i] = 1;
        // A box that's mostly "ink" is busy artwork or a solid plate: following
        // its ink outwards would run into the picture, so it stays the box.
        if (ink[i] && !whole) stack.push(i);
      }
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (ink[k] && !keep[k]) {
          keep[k] = 1;
          stack.push(k);
        }
      }
    }
  }

  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!keep[y * w + x]) continue;
      for (let dy = -grow; dy <= grow; dy++) {
        for (let dx = -grow; dx <= grow; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && dx * dx + dy * dy <= grow * grow) mask[ny * w + nx] = 1;
        }
      }
    }
  }
  // Outlined lettering (a see-through watermark) has faint insides: fill them.
  return { x: x0, y: y0, w, h, mask: whole ? mask : fillHoles(mask, w, h), whole };
}

module.exports = { DEFAULTS, findSignatures, camBlobs, camSupport, inkRegion, iou, intersect, area, edgeness };
