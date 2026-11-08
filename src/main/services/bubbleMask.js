/**
 * Masks for Image Cleanup. A region is { x, y, w, h, mask } with mask a
 * Uint8Array of w * h (1 = repaint), in image pixels.
 *
 * The bubble model gives boxes; a white speech bubble inside a box becomes
 * its real shape (the largest light area, with the lettering filled in),
 * and anything else stays the whole box. Every region is then grown by a
 * margin so the bubble's outline and any anti-aliasing are covered too.
 *
 * Images are { data, width, height } with 3-channel RGB data.
 */

// Brighter than this counts as bubble paper.
const LIGHT = 200;
// A light area covering less of its box than this isn't a white bubble
// (a coloured bubble, a caption on artwork), so the box is used instead.
const MIN_FILL = 0.25;
// A click that floods more of the image than this hit the background, not a bubble.
const MAX_CLICK_SHARE = 0.4;
// A tail is a light area just across the bubble's outline (within this
// share of the bubble's height, the outline's width) that is small and
// thin: no bigger than TAIL_SHARE of the bubble, and filling less than
// TAIL_FILL of its own box, so a round lamp or a diamond of lattice beside
// it isn't one.
const OUTLINE_SHARE = 0.1;
const MIN_OUTLINE_GAP = 6;
const TAIL_SHARE = 0.35;
const TAIL_FILL = 0.4;

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function lightMask(img, x0, y0, w, h) {
  const light = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y + y0) * img.width + x + x0) * 3;
      light[y * w + x] = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2] > LIGHT ? 1 : 0;
    }
  }
  return light;
}

/** Marks the 4-connected area of `on` pixels from `start`; returns its size. */
function flood(on, w, h, start, out) {
  const stack = [start];
  out[start] = 1;
  let size = 0;
  while (stack.length) {
    const i = stack.pop();
    size++;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (on[k] && !out[k]) {
        out[k] = 1;
        stack.push(k);
      }
    }
  }
  return size;
}

/** Fills everything the region encloses (the lettering inside a bubble). */
function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const open = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) open[i] = mask[i] ? 0 : 1;
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) if (open[y * w + x] && !outside[y * w + x]) flood(open, w, h, y * w + x, outside);
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) if (open[y * w + x] && !outside[y * w + x]) flood(open, w, h, y * w + x, outside);
  }
  for (let i = 0; i < w * h; i++) if (!outside[i]) mask[i] = 1;
  return mask;
}

/** Grows a mask by `r` pixels (square), in place of the input. */
function dilate(mask, w, h, r) {
  if (r <= 0) return mask;
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= r) rows[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) rows[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (rows[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (rows[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

/** A region grown by `margin`, its box widened to hold the growth (clipped to the image). */
function grow(region, margin, width, height) {
  const x0 = Math.max(0, region.x - margin);
  const y0 = Math.max(0, region.y - margin);
  const x1 = Math.min(width, region.x + region.w + margin);
  const y1 = Math.min(height, region.y + region.h + margin);
  const w = x1 - x0;
  const h = y1 - y0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      if (region.mask[y * region.w + x]) mask[(y + region.y - y0) * w + x + region.x - x0] = 1;
    }
  }
  return { ...region, x: x0, y: y0, w, h, mask: dilate(mask, w, h, margin) };
}

function clipBox(box, width, height) {
  const x = Math.max(0, Math.floor(box[0]));
  const y = Math.max(0, Math.floor(box[1]));
  const w = Math.min(width, Math.ceil(box[2])) - x;
  const h = Math.min(height, Math.ceil(box[3])) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** The whole box [x0, y0, x1, y1] as a region. */
function boxRegion(img, box) {
  const clip = clipBox(box, img.width, img.height);
  return clip && { ...clip, mask: new Uint8Array(clip.w * clip.h).fill(1), shaped: false };
}

/** Light areas of a box, as [{ size, part }], largest first. */
function lightParts(light, w, h) {
  const seen = new Uint8Array(w * h);
  const parts = [];
  for (let i = 0; i < w * h; i++) {
    if (!light[i] || seen[i]) continue;
    const part = new Uint8Array(w * h);
    const size = flood(light, w, h, i, part);
    for (let k = 0; k < w * h; k++) if (part[k]) seen[k] = 1;
    parts.push({ size, part });
  }
  return parts.sort((a, b) => b.size - a.size);
}

const touchesEdge = (part, w, h) => {
  for (let x = 0; x < w; x++) if (part[x] || part[(h - 1) * w + x]) return true;
  for (let y = 0; y < h; y++) if (part[y * w] || part[y * w + w - 1]) return true;
  return false;
};

/**
 * The bubble inside a detected box, as its shape when it's a white bubble.
 * Detected boxes usually stop at the bubble's edge, so its tail is looked
 * for around it: a small light area just across the outline that doesn't
 * run off into the background.
 */
function bubbleInBox(img, box, pad = 2) {
  const inner = clipBox([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], img.width, img.height);
  if (!inner || inner.w < 4 || inner.h < 4) return null;
  const parts = lightParts(lightMask(img, inner.x, inner.y, inner.w, inner.h), inner.w, inner.h);
  if (!parts.length || parts[0].size < MIN_FILL * inner.w * inner.h) return boxRegion(img, box);

  // The bubble, placed in a wider area that can hold its tail.
  const reach = Math.round(Math.max(inner.w, inner.h) * 0.6);
  const area = clipBox([inner.x - reach, inner.y - reach, inner.x + inner.w + reach, inner.y + inner.h + reach], img.width, img.height);
  const { x, y, w, h } = area;
  const bubble = new Uint8Array(w * h);
  for (let by = 0; by < inner.h; by++) {
    for (let bx = 0; bx < inner.w; bx++) {
      if (parts[0].part[by * inner.w + bx]) bubble[(by + inner.y - y) * w + bx + inner.x - x] = 1;
    }
  }
  fillHoles(bubble, w, h);

  const gap = Math.max(MIN_OUTLINE_GAP, Math.round(Math.min(inner.w, inner.h) * OUTLINE_SHARE));
  const near = dilate(bubble, w, h, gap);
  const mask = Uint8Array.from(bubble);
  const around = lightParts(lightMask(img, x, y, w, h), w, h);

  // Usually the tail is part of the bubble's own paper, cut off where the
  // box ends: the whole light area is the bubble when it stays small and
  // closed (it would spread into a white background otherwise).
  const whole = around.find(({ part }) => part.some((on, i) => on && bubble[i]));
  if (whole && whole.size <= (1 + TAIL_SHARE) * parts[0].size && !touchesEdge(whole.part, w, h)) {
    for (let i = 0; i < w * h; i++) if (whole.part[i]) mask[i] = 1;
    fillHoles(mask, w, h);
  }

  for (const { size, part } of around) {
    if (part === whole?.part || size > TAIL_SHARE * parts[0].size || touchesEdge(part, w, h)) continue;
    let touching = false;
    let overlapsBubble = false;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < w * h && !overlapsBubble; i++) {
      if (!part[i]) continue;
      if (bubble[i]) overlapsBubble = true;
      else if (near[i]) touching = true;
      const px = i % w;
      const py = (i - px) / w;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    const thin = size < TAIL_FILL * (x1 - x0 + 1) * (y1 - y0 + 1);
    if (touching && !overlapsBubble && thin) for (let i = 0; i < w * h; i++) if (part[i]) mask[i] = 1;
  }
  return { x, y, w, h, mask, shaped: true };
}

/**
 * The white bubble under a click, or null when the click isn't on one. A
 * click on the lettering looks a few pixels around for the paper.
 */
function bubbleAt(img, px, py, reach = 6) {
  const { width, height } = img;
  const cx = Math.round(px);
  const cy = Math.round(py);
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) return null;
  const light = lightMask(img, 0, 0, width, height);
  let start = -1;
  for (let r = 0; r <= reach && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height && light[y * width + x]) {
          start = y * width + x;
          break;
        }
      }
    }
  }
  if (start < 0) return null;

  const area = new Uint8Array(width * height);
  const size = flood(light, width, height, start, area);
  if (size > MAX_CLICK_SHARE * width * height) return null;

  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < width * height; i++) {
    if (!area[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) mask[y * w + x] = area[(y + y0) * width + x + x0];
  }
  return { x: x0, y: y0, w, h, mask: fillHoles(mask, w, h), shaped: true };
}

function erode(mask, w, h, r) {
  const inverse = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inverse[i] = mask[i] ? 0 : 1;
  const grown = dilate(inverse, w, h, r);
  for (let i = 0; i < w * h; i++) grown[i] = grown[i] ? 0 : 1;
  return grown;
}

/** Roughly how far (px) every pixel is from the nearest set one. */
function distanceFrom(mask, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 0 : Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + Math.SQRT2);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + Math.SQRT2);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + Math.SQRT2);
        if (x > 0) v = Math.min(v, d[i + w - 1] + Math.SQRT2);
      }
      d[i] = v;
    }
  }
  return d;
}

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1, with features about `cell` px across. */
function noiseAt(x, y, cell, seed) {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const smooth = (t) => t * t * (3 - 2 * t);
  const sx = smooth(fx - ix);
  const sy = smooth(fy - iy);
  const top = hash(ix, iy, seed) + (hash(ix + 1, iy, seed) - hash(ix, iy, seed)) * sx;
  const bottom = hash(ix, iy + 1, seed) + (hash(ix + 1, iy + 1, seed) - hash(ix, iy + 1, seed)) * sx;
  return top + (bottom - top) * sy;
}

/**
 * The mask sent for repair, from the one that was marked (0..255, > 127 is
 * marked). A clean, even outline gives the fill a line to follow, and a
 * thin strip of original left between two marked areas tends to come back
 * as abstract shapes, so:
 * - gaps narrower than twice `edge` between marked areas are filled;
 * - the solid part grows past the outline by a wobbling amount, up to `edge` px;
 * - it then fades out, unevenly, over another `edge` px.
 * Everything marked stays fully marked. A different seed gives a different edge.
 */
function roughEdge(mask, w, h, { edge = 16, seed = 1 } = {}) {
  const r = Math.max(0, Math.round(edge));
  const hard = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) hard[i] = mask[i] > 127 ? 1 : 0;
  const out = new Uint8Array(w * h);
  if (r === 0) {
    for (let i = 0; i < w * h; i++) out[i] = hard[i] * 255;
    return out;
  }
  const closed = erode(dilate(hard, w, h, r), w, h, r);
  for (let i = 0; i < w * h; i++) closed[i] |= hard[i];
  const dist = distanceFrom(closed, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = dist[i];
      if (d === 0) {
        out[i] = 255;
        continue;
      }
      if (d >= 2 * r) continue;
      // Noise stretched so the edge swings between hugging the outline and
      // reaching the full width, rather than staying near the middle.
      const n = 0.65 * noiseAt(x, y, r * 3, seed) + 0.35 * noiseAt(x, y, r, seed + 1);
      const reach = Math.min(1, Math.max(0, (n - 0.5) * 2 + 0.5)) * r;
      const fade = r * (0.4 + 0.6 * noiseAt(x, y, r * 2, seed + 3));
      let a = d <= reach ? 1 : 1 - (d - reach) / fade;
      if (a < 1) a += (noiseAt(x, y, 3, seed + 2) - 0.5) * 0.3; // grain in the fade
      out[i] = Math.round(255 * Math.min(1, Math.max(0, a)));
    }
  }
  return out;
}

// A repainted pixel this far off the original (any channel) is new content,
// not a shift in tone, and isn't used to measure the shift.
const TONE_LIMIT = 48;

/** Bilinear sample of one channel of a push-pull level. */
function sampleLevel(level, x, y, c) {
  const fx = Math.min(level.w - 1, Math.max(0, x));
  const fy = Math.min(level.h - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(level.w - 1, x0 + 1);
  const y1 = Math.min(level.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (xx, yy) => level.v[(yy * level.w + xx) * 3 + c];
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

/**
 * Evens out a repaint's tone. Flux and its VAE shift colours slightly, so a
 * repaint over a flat area comes back a shade off and the marked shape shows
 * as a faint frame. Where the try's mask reaches past what was marked, the
 * repaint should match the original; the difference there is spread over
 * the whole repaint (a push-pull fill) and taken off.
 *
 * `original` is RGBA, `result` RGB (returned corrected, as a new buffer),
 * `marked` the mask as drawn and `soft` the try's mask, both 0..255.
 */
function matchTone(original, result, marked, soft, w, h) {
  const n = w * h;
  const base = { w, h, wt: new Float32Array(n), v: new Float32Array(n * 3) };
  let samples = 0;
  for (let i = 0; i < n; i++) {
    if (soft[i] < 128 || marked[i] > 127) continue;
    const d = [0, 1, 2].map(c => result[i * 3 + c] - original[i * 4 + c]);
    if (d.some(v => Math.abs(v) > TONE_LIMIT)) continue;
    base.wt[i] = 1;
    base.v.set(d, i * 3);
    samples++;
  }
  if (samples < 50) return result;

  // Push: average the known differences down to a single pixel.
  const levels = [base];
  for (let level = base; level.w > 1 || level.h > 1;) {
    const cw = Math.ceil(level.w / 2);
    const ch = Math.ceil(level.h / 2);
    const next = { w: cw, h: ch, wt: new Float32Array(cw * ch), v: new Float32Array(cw * ch * 3) };
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        const i = y * level.w + x;
        const wt = level.wt[i];
        if (!wt) continue;
        const j = (y >> 1) * cw + (x >> 1);
        next.wt[j] += wt;
        for (let c = 0; c < 3; c++) next.v[j * 3 + c] += level.v[i * 3 + c] * wt;
      }
    }
    for (let j = 0; j < cw * ch; j++) {
      if (!next.wt[j]) continue;
      for (let c = 0; c < 3; c++) next.v[j * 3 + c] /= next.wt[j];
      next.wt[j] = Math.min(1, next.wt[j]);
    }
    levels.push(next);
    level = next;
  }
  // Pull: fill each level's gaps from the smoother level above it.
  for (let k = levels.length - 2; k >= 0; k--) {
    const level = levels[k];
    const coarse = levels[k + 1];
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        const i = y * level.w + x;
        const wt = level.wt[i];
        if (wt >= 1) continue;
        for (let c = 0; c < 3; c++) {
          const fill = sampleLevel(coarse, (x + 0.5) / 2 - 0.5, (y + 0.5) / 2 - 0.5, c);
          level.v[i * 3 + c] = level.v[i * 3 + c] * wt + fill * (1 - wt);
        }
      }
    }
  }

  const out = Buffer.from(result);
  for (let i = 0; i < n; i++) {
    if (!soft[i]) continue;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, Math.max(0, Math.round(result[i * 3 + c] - base.v[i * 3 + c])));
  }
  return out;
}

/** Sets every region's pixels in a full-size mask (Uint8Array, 0 or 255). */
function paint(full, width, regions) {
  for (const region of regions) {
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        if (region.mask[y * region.w + x]) full[(y + region.y) * width + x + region.x] = 255;
      }
    }
  }
  return full;
}

module.exports = { LIGHT, dilate, fillHoles, grow, boxRegion, bubbleInBox, bubbleAt, paint, roughEdge, matchTone };
