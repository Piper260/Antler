/**
 * Spot healing: fills a small marked area (a signature, a stray mark) from
 * the picture around it, on this computer, in about a second. Used by
 * Image Cleanup's healing brush and its signature sign-off; large areas
 * still go to Flux Fill on ComfyUI.
 *
 * The method is exemplar-based inpainting with PatchMatch (Barnes et al.
 * 2009, as in Wexler et al. 2007's completion): on an image pyramid of the
 * area around the mark, every marked pixel's patch looks for the most
 * similar unmarked patch nearby (random search plus propagation from its
 * neighbours), the patches vote on each pixel's colour, and this repeats a
 * few times per level, coarse to fine. Line art and flat colour continue
 * across the gap instead of blurring.
 *
 * Images are { data, width, height } with 3-channel RGB data (Uint8Array).
 * Masks are Uint8Array(width * height), 1 = heal.
 */

const PATCH = 3;          // patch radius: 7 x 7 patches
const CONTEXT = 3;        // the area worked on reaches this many mark-sizes around the mark...
const MIN_CONTEXT = 48;   // ...and at least this many pixels
const COARSEST = 24;      // pyramid stops when the mark's box is about this small
const ITERATIONS = [6, 4, 3, 2]; // EM rounds, coarsest level first; later levels use the last
const SEARCHES = 5;       // PatchMatch rounds per EM round

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** The box around the marked pixels, or null. */
function maskBox(mask, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A float RGB copy of part of an image. */
function crop(img, box) {
  const out = new Float32Array(box.w * box.h * 3);
  for (let y = 0; y < box.h; y++) {
    const src = ((y + box.y) * img.width + box.x) * 3;
    for (let i = 0; i < box.w * 3; i++) out[y * box.w * 3 + i] = img.data[src + i];
  }
  return out;
}

/** Half size, averaging 2 x 2; a pixel is marked if any of its four was. */
function downsample(level) {
  const { w, h, data, mask } = level;
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const nd = new Float32Array(nw * nh * 3);
  const nm = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const o = y * nw + x;
      let count = 0;
      const sum = [0, 0, 0];
      let marked = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(w - 1, x * 2 + dx);
          const sy = Math.min(h - 1, y * 2 + dy);
          const i = sy * w + sx;
          if (mask[i]) marked = 1;
          for (let c = 0; c < 3; c++) sum[c] += data[i * 3 + c];
          count++;
        }
      }
      nm[o] = marked;
      for (let c = 0; c < 3; c++) nd[o * 3 + c] = sum[c] / count;
    }
  }
  return { w: nw, h: nh, data: nd, mask: nm };
}

/** Marked pixels filled in by repeatedly averaging their filled neighbours (the coarsest start). */
function diffuse(level) {
  const { w, h, data, mask } = level;
  const known = Uint8Array.from(mask, m => (m ? 0 : 1));
  let left = mask.reduce((a, b) => a + b, 0);
  for (let pass = 0; left > 0 && pass < w + h; pass++) {
    const next = known.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        const sum = [0, 0, 0];
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !known[ny * w + nx]) continue;
          for (let c = 0; c < 3; c++) sum[c] += data[(ny * w + nx) * 3 + c];
          n++;
        }
        if (!n) continue;
        for (let c = 0; c < 3; c++) data[i * 3 + c] = sum[c] / n;
        next[i] = 1;
        left--;
      }
    }
    known.set(next);
  }
}

/**
 * Where a patch may be copied from: its centre is far enough from the edge
 * that the whole patch fits, and no pixel of it is marked.
 */
function sourceMap(level) {
  const { w, h, mask } = level;
  const ok = new Uint8Array(w * h);
  // Marked pixels grown by the patch radius: a centre there would copy marked pixels.
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -PATCH; dy <= PATCH; dy++) {
        for (let dx = -PATCH; dx <= PATCH; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) near[ny * w + nx] = 1;
        }
      }
    }
  }
  const list = [];
  for (let y = PATCH; y < h - PATCH; y++) {
    for (let x = PATCH; x < w - PATCH; x++) {
      if (!near[y * w + x]) {
        ok[y * w + x] = 1;
        list.push(y * w + x);
      }
    }
  }
  return { ok, list };
}

/** Sum of squared differences between the patches at a and b (clipped at the image edge for a). */
function distance(level, ax, ay, bx, by, limit) {
  const { w, h, data } = level;
  let d = 0;
  for (let dy = -PATCH; dy <= PATCH; dy++) {
    const ya = ay + dy;
    if (ya < 0 || ya >= h) continue;
    const yb = by + dy;
    for (let dx = -PATCH; dx <= PATCH; dx++) {
      const xa = ax + dx;
      if (xa < 0 || xa >= w) continue;
      const pa = (ya * w + xa) * 3;
      const pb = (yb * w + bx + dx) * 3;
      const r = data[pa] - data[pb];
      const g = data[pa + 1] - data[pb + 1];
      const b = data[pa + 2] - data[pb + 2];
      d += r * r + g * g + b * b;
      if (d >= limit) return d;
    }
  }
  return d;
}

/**
 * One level: PatchMatch for every pixel near the mark, then each marked
 * pixel becomes the weighted vote of the patches over it.
 */
function solveLevel(level, nnf, iterations, random) {
  const { w, h, data, mask } = level;
  const { ok, list } = sourceMap(level);
  if (!list.length) return nnf;

  // Targets: every pixel whose patch touches a marked pixel.
  const targets = [];
  const isTarget = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -PATCH; dy <= PATCH; dy++) {
        for (let dx = -PATCH; dx <= PATCH; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const i = ny * w + nx;
          if (!isTarget[i]) {
            isTarget[i] = 1;
            targets.push(i);
          }
        }
      }
    }
  }

  // nnf: for each pixel, the index of its source patch centre; -1 unset.
  const field = nnf && nnf.length === w * h ? nnf : new Int32Array(w * h).fill(-1);
  const cost = new Float64Array(w * h).fill(Infinity);
  const randomSource = () => list[Math.floor(random() * list.length)];
  for (const t of targets) {
    if (field[t] < 0 || !ok[field[t]]) field[t] = randomSource();
  }

  for (let iter = 0; iter < iterations; iter++) {
    for (const t of targets) cost[t] = distance(level, t % w, (t / w) | 0, field[t] % w, (field[t] / w) | 0, Infinity);

    for (let round = 0; round < SEARCHES; round++) {
      const forward = round % 2 === 0;
      const order = forward ? targets : [...targets].reverse();
      const step = forward ? -1 : 1;
      for (const t of order) {
        const tx = t % w;
        const ty = (t / w) | 0;
        const tryCandidate = (s) => {
          if (s < 0 || s >= w * h || !ok[s] || s === field[t]) return;
          const d = distance(level, tx, ty, s % w, (s / w) | 0, cost[t]);
          if (d < cost[t]) {
            cost[t] = d;
            field[t] = s;
          }
        };
        // Propagation: a neighbour's match, shifted back by one.
        for (const [dx, dy] of [[step, 0], [0, step]]) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = field[ny * w + nx];
          if (n < 0) continue;
          const sx = (n % w) - dx;
          const sy = ((n / w) | 0) - dy;
          if (sx >= 0 && sy >= 0 && sx < w && sy < h) tryCandidate(sy * w + sx);
        }
        // Random search in shrinking windows around the current match.
        let radius = Math.max(w, h);
        const cx = field[t] % w;
        const cy = (field[t] / w) | 0;
        while (radius >= 1) {
          const sx = Math.round(cx + (random() * 2 - 1) * radius);
          const sy = Math.round(cy + (random() * 2 - 1) * radius);
          if (sx >= 0 && sy >= 0 && sx < w && sy < h) tryCandidate(sy * w + sx);
          radius >>= 1;
        }
        // An occasional fresh random source keeps it out of a poor corner.
        if (random() < 0.05) tryCandidate(randomSource());
      }
    }

    // Voting: each marked pixel takes the patches over it, the closer matches counting more.
    const sum = new Float64Array(w * h * 3);
    const weight = new Float64Array(w * h);
    let sigma = 0;
    let n = 0;
    for (const t of targets) if (Number.isFinite(cost[t])) { sigma += cost[t]; n++; }
    sigma = Math.max(1, (sigma / Math.max(1, n)) * 0.75);
    for (const t of targets) {
      const tx = t % w;
      const ty = (t / w) | 0;
      const sx = field[t] % w;
      const sy = (field[t] / w) | 0;
      const wt = Math.exp(-cost[t] / (2 * sigma));
      for (let dy = -PATCH; dy <= PATCH; dy++) {
        for (let dx = -PATCH; dx <= PATCH; dx++) {
          const px = tx + dx;
          const py = ty + dy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const p = py * w + px;
          if (!mask[p]) continue;
          const s = ((sy + dy) * w + sx + dx) * 3;
          sum[p * 3] += data[s] * wt;
          sum[p * 3 + 1] += data[s + 1] * wt;
          sum[p * 3 + 2] += data[s + 2] * wt;
          weight[p] += wt;
        }
      }
    }
    for (let p = 0; p < w * h; p++) {
      if (!mask[p] || !weight[p]) continue;
      for (let c = 0; c < 3; c++) data[p * 3 + c] = sum[p * 3 + c] / weight[p];
    }
  }
  return field;
}

/** The finer level's starting colours and match field, from the coarser level just solved. */
function upsample(coarse, fine, field) {
  const { w, h } = fine;
  const next = new Int32Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.min(coarse.w - 1, x >> 1);
      const cy = Math.min(coarse.h - 1, y >> 1);
      const i = y * w + x;
      if (fine.mask[i]) {
        for (let c = 0; c < 3; c++) fine.data[i * 3 + c] = coarse.data[(cy * coarse.w + cx) * 3 + c];
      }
      const m = field[cy * coarse.w + cx];
      if (m >= 0) {
        const sx = Math.min(w - 1, (m % coarse.w) * 2 + (x & 1));
        const sy = Math.min(h - 1, ((m / coarse.w) | 0) * 2 + (y & 1));
        next[i] = sy * w + sx;
      }
    }
  }
  return next;
}

/**
 * Heals the marked pixels of an image, in place.
 * @param {{data: Uint8Array, width: number, height: number}} img - RGB
 * @param {Uint8Array} mask - width * height, 1 = heal
 * @param {{seed?: number}} [options]
 * @returns {{x, y, w, h} | null} the area that changed
 */
function heal(img, mask, { seed = 1 } = {}) {
  const box = maskBox(mask, img.width, img.height);
  if (!box) return null;
  const pad = Math.max(MIN_CONTEXT, Math.round(Math.max(box.w, box.h) * CONTEXT / 2));
  const area = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    w: Math.min(img.width, box.x + box.w + pad) - Math.max(0, box.x - pad),
    h: Math.min(img.height, box.y + box.h + pad) - Math.max(0, box.y - pad)
  };
  const levelMask = new Uint8Array(area.w * area.h);
  for (let y = 0; y < area.h; y++) {
    for (let x = 0; x < area.w; x++) levelMask[y * area.w + x] = mask[(y + area.y) * img.width + x + area.x] ? 1 : 0;
  }

  const pyramid = [{ w: area.w, h: area.h, data: crop(img, area), mask: levelMask }];
  let markSize = Math.max(box.w, box.h);
  while (markSize > COARSEST && pyramid[pyramid.length - 1].w > 4 * (PATCH * 2 + 1) && pyramid[pyramid.length - 1].h > 4 * (PATCH * 2 + 1)) {
    pyramid.push(downsample(pyramid[pyramid.length - 1]));
    markSize /= 2;
  }

  const random = rng(seed);
  let level = pyramid[pyramid.length - 1];
  diffuse(level);
  let field = solveLevel(level, null, ITERATIONS[0], random);
  for (let i = pyramid.length - 2, n = 1; i >= 0; i--, n++) {
    const fine = pyramid[i];
    field = upsample(level, fine, field);
    field = solveLevel(fine, field, ITERATIONS[Math.min(n, ITERATIONS.length - 1)], random);
    level = fine;
  }

  // Back into the image: only the marked pixels change.
  const out = pyramid[0];
  for (let y = 0; y < area.h; y++) {
    for (let x = 0; x < area.w; x++) {
      const i = y * area.w + x;
      if (!levelMask[i]) continue;
      const p = ((y + area.y) * img.width + x + area.x) * 3;
      for (let c = 0; c < 3; c++) img.data[p + c] = Math.max(0, Math.min(255, Math.round(out.data[i * 3 + c])));
    }
  }
  return area;
}

module.exports = { heal, maskBox };
