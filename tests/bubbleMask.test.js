const { dilate, fillHoles, grow, bubbleInBox, bubbleAt, paint, roughEdge, matchTone } = require('../src/main/services/bubbleMask');

/** A w x h RGB image, filled with `fill`, with `draw(set)` painting pixels. */
function image(w, h, fill, draw) {
  const data = Buffer.alloc(w * h * 3, fill);
  const set = (x, y, value) => data.fill(value, (y * w + x) * 3, (y * w + x) * 3 + 3);
  if (draw) draw(set);
  return { data, width: w, height: h };
}

/** Dark background with a white ellipse at (30, 20), radii 14 x 8, black text in the middle. */
const bubblePage = () => image(80, 50, 40, (set) => {
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 80; x++) {
      if (((x - 30) / 14) ** 2 + ((y - 20) / 8) ** 2 <= 1) set(x, y, 255);
    }
  }
  for (let x = 24; x <= 36; x++) set(x, 20, 0); // a line of "text"
});

const count = (mask) => mask.reduce((sum, v) => sum + (v ? 1 : 0), 0);

describe('bubbleMask', () => {
  test('dilate grows a single pixel into a square', () => {
    const mask = new Uint8Array(25);
    mask[12] = 1;
    expect(count(dilate(mask, 5, 5, 1))).toBe(9);
  });

  test('fillHoles fills what a ring encloses, not what is outside it', () => {
    const w = 7;
    const mask = new Uint8Array(49);
    for (let i = 1; i <= 5; i++) {
      mask[1 * w + i] = mask[5 * w + i] = mask[i * w + 1] = mask[i * w + 5] = 1;
    }
    fillHoles(mask, 7, 7);
    expect(mask[3 * w + 3]).toBe(1);
    expect(mask[0]).toBe(0);
  });

  test('a box around a white bubble becomes the bubble shape, text included', () => {
    const region = bubbleInBox(bubblePage(), [16, 12, 44, 28], 2);
    expect(region.shaped).toBe(true);
    const at = (x, y) => region.mask[(y - region.y) * region.w + x - region.x];
    expect(at(30, 20)).toBe(1); // the text
    expect(at(17, 13)).toBe(0); // box corner, outside the ellipse
  });

  test('a tail outside the detected box is added, the background is not', () => {
    // Bubble at (30, 20) with a black outline ring, and a white tail below
    // it, past the outline, which the box doesn't reach.
    const page = image(80, 60, 40, (set) => {
      for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 80; x++) {
          const d = ((x - 30) / 14) ** 2 + ((y - 20) / 8) ** 2;
          if (d <= 1) set(x, y, 255);
          else if (d <= 1.4) set(x, y, 0);
        }
      }
      // A thin, slanted spike, two pixels wide so its steps stay joined.
      for (let y = 31; y <= 40; y++) {
        set(30 + Math.floor((y - 31) / 2), y, 255);
        set(31 + Math.floor((y - 31) / 2), y, 255);
      }
    });
    const region = bubbleInBox(page, [16, 12, 44, 28]);
    const at = (x, y) => (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h
      ? 0 : region.mask[(y - region.y) * region.w + x - region.x]);
    expect(at(31, 34)).toBe(1); // the tail
    expect(at(70, 50)).toBe(0); // background
  });

  test('a tail joined to the bubble past the box edge is kept with it', () => {
    // No outline: the tail's paper runs straight on from the bubble's.
    const page = image(80, 60, 40, (set) => {
      for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 80; x++) if (((x - 30) / 14) ** 2 + ((y - 20) / 8) ** 2 <= 1) set(x, y, 255);
      }
      for (let y = 27; y <= 40; y++) for (let x = 29; x <= 31; x++) set(x, y, 255);
    });
    const region = bubbleInBox(page, [16, 12, 44, 28]);
    expect(region.mask[(38 - region.y) * region.w + 30 - region.x]).toBe(1);
  });

  test('a box with no white bubble in it stays the whole box', () => {
    const region = bubbleInBox(image(40, 40, 90), [5, 5, 20, 20], 0);
    expect(region.shaped).toBe(false);
    expect(count(region.mask)).toBe(region.w * region.h);
  });

  test('a click on the lettering finds the bubble around it', () => {
    const region = bubbleAt(bubblePage(), 30, 20);
    expect(region).not.toBeNull();
    expect(region.x).toBeLessThanOrEqual(17);
    expect(region.x + region.w).toBeGreaterThanOrEqual(43);
  });

  test('a click on a large white background is refused', () => {
    expect(bubbleAt(image(40, 40, 255), 20, 20)).toBeNull();
  });

  describe('roughEdge', () => {
    // Two 20 x 20 squares, 6 px apart, in a 100 x 60 mask.
    const w = 100;
    const h = 60;
    const twoSquares = () => {
      const mask = new Uint8Array(w * h);
      for (let y = 20; y < 40; y++) {
        for (let x = 20; x < 40; x++) mask[y * w + x] = 255;
        for (let x = 46; x < 66; x++) mask[y * w + x] = 255;
      }
      return mask;
    };

    test('keeps everything marked and fills the thin gap between areas', () => {
      const mask = twoSquares();
      const out = roughEdge(mask, w, h, { edge: 6, seed: 3 });
      for (let i = 0; i < mask.length; i++) if (mask[i]) expect(out[i]).toBe(255);
      expect(out[30 * w + 43]).toBe(255); // middle of the gap
      expect(out[5 * w + 90]).toBe(0); // far away
    });

    test('fades out past the edge, differently for each seed', () => {
      const a = roughEdge(twoSquares(), w, h, { edge: 6, seed: 1 });
      const b = roughEdge(twoSquares(), w, h, { edge: 6, seed: 2 });
      expect(a.some(v => v > 0 && v < 255)).toBe(true);
      expect(a.some((v, i) => v !== b[i])).toBe(true);
      // Nothing reaches further than twice the edge.
      for (let x = 0; x < w; x++) expect(a[7 * w + x]).toBe(0);
    });

    test('an edge of 0 gives the mask as drawn', () => {
      const mask = twoSquares();
      const out = roughEdge(mask, w, h, { edge: 0 });
      expect(out.every((v, i) => v === mask[i])).toBe(true);
    });
  });

  test('matchTone takes a repaint\'s shift in tone back off', () => {
    // A flat grey image; the repaint came back 10 brighter over the try's mask.
    const w = 80;
    const h = 60;
    const original = Buffer.alloc(w * h * 4, 100);
    const marked = new Uint8Array(w * h);
    const soft = new Uint8Array(w * h);
    const result = Buffer.alloc(w * h * 3, 100);
    for (let y = 10; y < 50; y++) {
      for (let x = 10; x < 70; x++) {
        const i = y * w + x;
        soft[i] = 255;
        if (x >= 20 && x < 60 && y >= 20 && y < 40) marked[i] = 255;
        result.fill(110, i * 3, i * 3 + 3);
      }
    }
    const out = matchTone(original, result, marked, soft, w, h);
    expect(Math.abs(out[(30 * w + 40) * 3] - 100)).toBeLessThanOrEqual(1); // middle of the marked area
    expect(out[(5 * w + 5) * 3]).toBe(100); // outside the mask, untouched
  });

  test('grow adds the margin and paint places it in the full mask', () => {
    const region = { x: 10, y: 10, w: 2, h: 2, mask: new Uint8Array(4).fill(1) };
    const grown = grow(region, 3, 30, 30);
    expect(grown.x).toBe(7);
    expect(grown.w).toBe(8);
    const full = paint(new Uint8Array(900), 30, [grown]);
    expect(count(full)).toBe(64);
    expect(full[7 * 30 + 7]).toBe(255);
  });
});
