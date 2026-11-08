/**
 * Comic panel detection on raw pixels, with no model involved.
 *
 * Panels sit on a background ("gutter") colour that also runs along the page
 * edge. The gutter is found by flood-filling that colour inward from the
 * border, so the drawn panel frames (a different colour) stop the fill and
 * enclosed white areas inside a panel are never mistaken for gutter.
 *
 * Gutters between panels often never reach the page edge, because art,
 * bubbles or sound effects cross them. So long straight frame edges (the
 * border between gutter colour and a panel) are also found with a Hough
 * transform and drawn in as walls, bridging the places where art covers
 * them. Walls only split a panel off when they close all the way around it,
 * so a stray straight edge inside the art does no harm on its own.
 *
 * The page is then split by recursive XY-cuts along rows/columns that are
 * almost entirely gutter, which also yields reading order. Inside each piece,
 * the remaining non-gutter regions are labelled after a small erosion, so
 * panels joined by a thin bridge (a speech bubble tail, a stray line) still
 * come out separate. Regions that are nearly all gutter colour are leftover
 * gutter boxed in by walls, not panels, and are dropped.
 *
 * Everything works on an RGB(A) buffer so it can be tested without sharp.
 */

const DEFAULTS = {
  tolerance: 40,        // max per-channel difference still counted as gutter
  gutterColor: null,    // [r, g, b] to skip estimation
  minGap: 3,            // px: thinnest gutter an XY-cut will split along
  cutFraction: 0.92,    // share of a row/column that must be gutter to cut there
  bridgeRadius: 2,      // px: links up to ~2 * radius thick are broken
  minAreaRatio: 0.015,  // panels smaller than this share of the page are dropped
  frameLines: true,     // find straight frame edges and wall them off
  frameMinLength: 0.12, // shortest frame edge, as a share of the page's short side
  frameMaxGap: 0.06,    // longest stretch of a frame edge hidden under art, same unit
  rtl: false            // right-to-left reading order (manga)
};

/**
 * Most common colour along the page edge, quantised to 16 levels per
 * channel, then averaged over the pixels in that bucket. The mode is used
 * rather than the median because full-bleed art often covers part of the
 * edge. `confidence` is the share of edge pixels in the winning bucket.
 */
function estimateGutterColor(data, width, height, channels) {
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * width + x) * channels;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const entry = counts.get(key);
    if (entry) {
      entry.n++;
      entry.r += data[i];
      entry.g += data[i + 1];
      entry.b += data[i + 2];
    } else {
      counts.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  };

  for (let x = 0; x < width; x++) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }

  let best = null;
  let total = 0;
  for (const entry of counts.values()) {
    total += entry.n;
    if (!best || entry.n > best.n) best = entry;
  }

  return {
    color: [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)],
    confidence: best.n / total
  };
}

/** 1 where a pixel is within `tolerance` of `color` on every channel. */
function colorMask(data, width, height, channels, color, tolerance) {
  const mask = new Uint8Array(width * height);
  const [r, g, b] = color;
  for (let p = 0, i = 0; p < mask.length; p++, i += channels) {
    if (Math.abs(data[i] - r) <= tolerance
      && Math.abs(data[i + 1] - g) <= tolerance
      && Math.abs(data[i + 2] - b) <= tolerance) {
      mask[p] = 1;
    }
  }
  return mask;
}

/**
 * Pixels of `mask` reachable from the image border through other `mask`
 * pixels (4-connected). Returned as a new mask.
 */
function floodFromBorder(mask, width, height) {
  const reached = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;

  const seed = (p) => {
    if (mask[p] && !reached[p]) {
      reached[p] = 1;
      stack[top++] = p;
    }
  };

  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < width * (height - 1)) seed(p + width);
  }

  return reached;
}

/**
 * Recursive XY-cut over the gutter mask. Rows (then columns) whose gutter
 * share is at least `cutFraction` and that form a run of `minGap` or more
 * split the rectangle; runs touching its edges are trimmed as margins.
 * Leaves are returned in reading order.
 */
function xyCut(gutter, width, rect, options, depth = 0) {
  const trimmed = trimMargins(gutter, width, rect, options.cutFraction);
  if (!trimmed) return [];
  if (depth > 32) return [trimmed];

  for (const axis of ['rows', 'cols']) {
    const pieces = splitAlong(gutter, width, trimmed, axis, options);
    if (pieces.length > 1) {
      const ordered = axis === 'cols' && options.rtl ? pieces.reverse() : pieces;
      return ordered.flatMap(piece => xyCut(gutter, width, piece, options, depth + 1));
    }
  }
  return [trimmed];
}

function lineGutterShare(gutter, width, rect, axis, index) {
  let count = 0;
  if (axis === 'rows') {
    const row = index * width;
    for (let x = rect.x; x < rect.x + rect.w; x++) count += gutter[row + x];
    return count / rect.w;
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) count += gutter[y * width + index];
  return count / rect.h;
}

function trimMargins(gutter, width, rect, cutFraction) {
  let { x, y, w, h } = rect;
  while (h > 0 && lineGutterShare(gutter, width, { x, y, w, h }, 'rows', y) >= cutFraction) { y++; h--; }
  while (h > 0 && lineGutterShare(gutter, width, { x, y, w, h }, 'rows', y + h - 1) >= cutFraction) h--;
  while (w > 0 && h > 0 && lineGutterShare(gutter, width, { x, y, w, h }, 'cols', x) >= cutFraction) { x++; w--; }
  while (w > 0 && h > 0 && lineGutterShare(gutter, width, { x, y, w, h }, 'cols', x + w - 1) >= cutFraction) w--;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function splitAlong(gutter, width, rect, axis, { cutFraction, minGap }) {
  const start = axis === 'rows' ? rect.y : rect.x;
  const length = axis === 'rows' ? rect.h : rect.w;
  const pieces = [];
  let pieceStart = start;
  let run = 0;

  for (let i = start; i < start + length; i++) {
    if (lineGutterShare(gutter, width, rect, axis, i) >= cutFraction) {
      run++;
      continue;
    }
    if (run >= minGap && i - run > pieceStart) {
      pieces.push([pieceStart, i - run]);
      pieceStart = i;
    } else if (run >= minGap) {
      pieceStart = i;
    }
    run = 0;
  }
  pieces.push([pieceStart, start + length - run]);

  return pieces
    .filter(([from, to]) => to > from)
    .map(([from, to]) => (axis === 'rows'
      ? { x: rect.x, y: from, w: rect.w, h: to - from }
      : { x: from, y: rect.y, w: to - from, h: rect.h }));
}

/**
 * Erode the non-gutter area inside `rect` by `radius` (square kernel) using
 * a summed-area table, so thin links between panels disappear. Pixels
 * outside the image count as foreground so panels touching the page edge
 * are not eaten away from that side.
 */
function erodedForeground(gutter, width, height, rect, radius) {
  const { x: rx, y: ry, w, h } = rect;
  const fore = new Uint8Array(w * h);
  if (radius <= 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) fore[y * w + x] = gutter[(ry + y) * width + rx + x] ? 0 : 1;
    }
    return fore;
  }

  const sums = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gutter[(ry + y) * width + rx + x] ? 0 : 1;
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + rowSum;
    }
  }

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const inside = sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0];
      fore[y * w + x] = inside === (x1 - x0) * (y1 - y0) ? 1 : 0;
    }
  }
  return fore;
}

/**
 * Bounding boxes and pixel counts of 4-connected regions of `mask`, plus
 * how many of each region's pixels are set in `countMask` (same size).
 */
function labelRegions(mask, w, h, countMask = null) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const regions = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1, area = 0, counted = 0;
    seen[start] = 1;
    stack[top++] = start;

    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (countMask && countMask[p]) counted++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
      }
    }

    regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area, counted });
  }
  return regions;
}

/**
 * Long straight edges where gutter colour meets something else, as line
 * segments. Edge pixels vote in a Hough accumulator (0.5 degree steps, so
 * slanted gutters count too); each strong line is then walked pixel by pixel
 * and split into segments wherever its edge support stops for longer than
 * `maxGap`. A segment must be at least `minLength` long and mostly supported.
 */
function findFrameSegments(near, width, height, { minLength, maxGap }) {
  const edge = new Uint8Array(width * height);
  const points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (near[p]) continue;
      if ((x > 0 && near[p - 1]) || (x < width - 1 && near[p + 1])
        || (y > 0 && near[p - width]) || (y < height - 1 && near[p + width])) {
        edge[p] = 1;
        points.push(x, y);
      }
    }
  }
  if (points.length === 0) return [];

  const steps = 360;
  const cos = new Float64Array(steps);
  const sin = new Float64Array(steps);
  for (let t = 0; t < steps; t++) {
    cos[t] = Math.cos((t * Math.PI) / steps);
    sin[t] = Math.sin((t * Math.PI) / steps);
  }
  const diag = Math.ceil(Math.hypot(width, height));
  const span = 2 * diag + 1;
  const acc = new Int32Array(steps * span);
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    for (let t = 0; t < steps; t++) acc[t * span + Math.round(x * cos[t] + y * sin[t]) + diag]++;
  }

  // Strong lines: local maxima over neighbouring angles and offsets.
  const minVotes = minLength * 0.6;
  const peaks = [];
  for (let t = 0; t < steps; t++) {
    for (let r = 1; r < span - 1; r++) {
      const v = acc[t * span + r];
      if (v < minVotes) continue;
      let isPeak = true;
      for (let dt = -2; dt <= 2 && isPeak; dt++) {
        const tt = (t + dt + steps) % steps;
        for (let dr = -2; dr <= 2; dr++) {
          if ((dt || dr) && acc[tt * span + Math.min(span - 1, Math.max(0, r + dr))] > v) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ t, rho: r - diag, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);

  const supported = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < width && yi < height && edge[yi * width + xi] === 1;
  };

  const segments = [];
  for (const { t, rho } of peaks.slice(0, 120)) {
    const nx = cos[t];
    const ny = sin[t];
    // Walk along the line; a step counts as supported if an edge pixel lies
    // on it or one pixel to either side (edges are not perfectly straight).
    let start = null;
    let last = null;
    let hits = 0;
    const close = () => {
      if (start !== null && last - start >= minLength && hits / (last - start + 1) >= 0.5) {
        segments.push({
          x1: rho * nx - start * ny, y1: rho * ny + start * nx,
          x2: rho * nx - last * ny, y2: rho * ny + last * nx
        });
      }
      start = null;
      hits = 0;
    };
    for (let s = -diag; s <= diag; s++) {
      const x = rho * nx - s * ny;
      const y = rho * ny + s * nx;
      if (supported(x, y) || supported(x + nx, y + ny) || supported(x - nx, y - ny)) {
        if (start !== null && s - last > maxGap) close();
        if (start === null) start = s;
        last = s;
        hits++;
      }
    }
    close();
  }
  return segments;
}

/**
 * Mark segments in `mask` as 2px walls, extended by `extend` at both ends so
 * walls that stop just short of a frame corner still close it off.
 */
function drawWalls(mask, width, height, segments, extend) {
  for (const { x1, y1, x2, y2 } of segments) {
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const dx = (x2 - x1) / length;
    const dy = (y2 - y1) / length;
    for (let s = -extend; s <= length + extend; s += 0.5) {
      const x = x1 + s * dx;
      const y = y1 + s * dy;
      for (const [ox, oy] of [[0, 0], [-dy, dx]]) {
        const xi = Math.round(x + ox);
        const yi = Math.round(y + oy);
        if (xi >= 0 && yi >= 0 && xi < width && yi < height) mask[yi * width + xi] = 1;
      }
    }
  }
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/**
 * Reading order for boxes that share one XY-cut piece: group into rows by
 * whether a box starts above the middle of the row's first box, then sort
 * each row horizontally.
 */
function sortReadingOrder(boxes, rtl) {
  const byTop = [...boxes].sort((a, b) => a.y - b.y);
  const rows = [];
  for (const box of byTop) {
    const row = rows[rows.length - 1];
    if (row && box.y < row[0].y + row[0].h / 2) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap(row => row.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x)));
}

/**
 * @param {{data: Uint8Array|Buffer, width: number, height: number, channels: number}} image
 * @param {object} [overrides] - see DEFAULTS
 * @returns {{panels: Array<{x,y,w,h}>, segments: Array<{x1,y1,x2,y2}>, gutterColor: number[], gutterConfidence: number, needsReview: boolean}}
 */
function detectPanels(image, overrides = {}) {
  const options = { ...DEFAULTS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null) options[key] = value;
  }
  const { data, width, height, channels } = image;

  const estimate = options.gutterColor
    ? { color: options.gutterColor, confidence: 1 }
    : estimateGutterColor(data, width, height, channels);
  const near = colorMask(data, width, height, channels, estimate.color, options.tolerance);
  const gutter = floodFromBorder(near, width, height);

  // Walls are only worth drawing when the gutter colour is a confident guess.
  // They go into a copy: the XY-cut must not mistake a wall lying on a frame
  // edge for a gutter row and trim it off the panel.
  let segments = [];
  let walled = gutter;
  if (options.frameLines && estimate.confidence >= 0.4) {
    const minDim = Math.min(width, height);
    segments = findFrameSegments(near, width, height, {
      minLength: options.frameMinLength * minDim,
      maxGap: options.frameMaxGap * minDim
    });
    walled = Uint8Array.from(gutter);
    drawWalls(walled, width, height, segments, Math.round(0.02 * minDim));
  }

  const minArea = options.minAreaRatio * width * height;
  const radius = options.bridgeRadius;
  const grow = radius + (segments.length ? 2 : 0);
  const panels = [];

  for (const leaf of xyCut(gutter, width, { x: 0, y: 0, w: width, h: height }, options)) {
    const fore = erodedForeground(walled, width, height, leaf, radius);
    const leafNear = new Uint8Array(leaf.w * leaf.h);
    for (let y = 0; y < leaf.h; y++) {
      for (let x = 0; x < leaf.w; x++) leafNear[y * leaf.w + x] = near[(leaf.y + y) * width + leaf.x + x];
    }
    let boxes = labelRegions(fore, leaf.w, leaf.h, leafNear)
      // Gutter boxed in by walls is nearly all gutter colour; art that broke
      // out into it leaves a sparse, mostly empty shape. Neither is a panel.
      .filter(region => region.counted / region.area < 0.85 && region.area / (region.w * region.h) >= 0.3)
      .map(region => {
        // Grow back by the erosion radius, plus the wall width since walls
        // are drawn over the panel's outermost edge pixels.
        const x0 = Math.max(0, region.x - grow);
        const y0 = Math.max(0, region.y - grow);
        const x1 = Math.min(leaf.w, region.x + region.w + grow);
        const y1 = Math.min(leaf.h, region.y + region.h + grow);
        return { x: leaf.x + x0, y: leaf.y + y0, w: x1 - x0, h: y1 - y0, area: region.area };
      })
      .filter(box => box.w * box.h >= minArea);

    boxes = boxes.filter(box => !boxes.some(other => other !== box && contains(other, box)
      && (other.w * other.h > box.w * box.h || boxes.indexOf(other) < boxes.indexOf(box))));
    panels.push(...sortReadingOrder(boxes, options.rtl).map(({ x, y, w, h }) => ({ x, y, w, h })));
  }

  // One panel covering nearly the whole page usually means there were no
  // gutters to find (borderless art), and an unclear edge colour means the
  // gutter guess itself is shaky. Both are worth a look.
  const pageCovered = panels.length === 1 && panels[0].w * panels[0].h > 0.9 * width * height;
  return {
    panels,
    segments,
    gutterColor: estimate.color,
    gutterConfidence: estimate.confidence,
    needsReview: panels.length === 0 || pageCovered || estimate.confidence < 0.4
  };
}

module.exports = {
  DEFAULTS,
  detectPanels,
  estimateGutterColor,
  sortReadingOrder,
  colorMask,
  floodFromBorder
};
