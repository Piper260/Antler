const { detectPanels, estimateGutterColor } = require('../src/main/services/panelDetect');

/** Blank RGB page plus helpers to paint framed panels onto it. */
function page(width, height, background = [255, 255, 255]) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) data.set(background, i);

  const set = (x, y, color) => data.set(color, (y * width + x) * 3);
  const fill = (x0, y0, w, h, color) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, color);
  };
  // A panel: black 2px frame around light-grey art with a white patch, which
  // must not be read as gutter because the frame encloses it.
  const panel = (x, y, w, h) => {
    fill(x, y, w, h, [0, 0, 0]);
    fill(x + 2, y + 2, w - 4, h - 4, [200, 200, 200]);
    fill(x + 6, y + 6, Math.floor(w / 3), Math.floor(h / 3), [255, 255, 255]);
  };

  return { image: { data, width, height, channels: 3 }, set, fill, panel };
}

const near = (box, x, y, w, h, slack = 3) =>
  Math.abs(box.x - x) <= slack && Math.abs(box.y - y) <= slack
  && Math.abs(box.w - w) <= slack && Math.abs(box.h - h) <= slack;

describe('detectPanels', () => {
  test('finds a 2x2 grid in reading order', () => {
    const p = page(400, 400);
    p.panel(20, 20, 170, 170);
    p.panel(210, 20, 170, 170);
    p.panel(20, 210, 170, 170);
    p.panel(210, 210, 170, 170);

    const { panels, needsReview } = detectPanels(p.image);
    expect(panels).toHaveLength(4);
    expect(near(panels[0], 20, 20, 170, 170)).toBe(true);
    expect(near(panels[1], 210, 20, 170, 170)).toBe(true);
    expect(near(panels[2], 20, 210, 170, 170)).toBe(true);
    expect(near(panels[3], 210, 210, 170, 170)).toBe(true);
    expect(needsReview).toBe(false);
  });

  test('ignores options left undefined', () => {
    const p = page(400, 200);
    p.panel(20, 20, 170, 160);
    p.panel(210, 20, 170, 160);

    const { panels } = detectPanels(p.image, { tolerance: undefined, minAreaRatio: undefined, gutterColor: null });
    expect(panels).toHaveLength(2);
  });

  test('reads right to left when asked', () => {
    const p = page(400, 200);
    p.panel(20, 20, 170, 160);
    p.panel(210, 20, 170, 160);

    const { panels } = detectPanels(p.image, { rtl: true });
    expect(panels).toHaveLength(2);
    expect(panels[0].x).toBeGreaterThan(panels[1].x);
  });

  test('orders a tall panel before the two stacked beside it', () => {
    const p = page(400, 400);
    p.panel(20, 20, 170, 360);
    p.panel(210, 20, 170, 170);
    p.panel(210, 210, 170, 170);

    const { panels } = detectPanels(p.image);
    expect(panels).toHaveLength(3);
    expect(near(panels[0], 20, 20, 170, 360)).toBe(true);
    expect(near(panels[1], 210, 20, 170, 170)).toBe(true);
    expect(near(panels[2], 210, 210, 170, 170)).toBe(true);
  });

  test('works with black gutters', () => {
    const p = page(400, 200, [0, 0, 0]);
    p.fill(20, 20, 170, 160, [220, 220, 220]);
    p.fill(210, 20, 170, 160, [220, 220, 220]);

    const { panels, gutterColor } = detectPanels(p.image);
    expect(gutterColor).toEqual([0, 0, 0]);
    expect(panels).toHaveLength(2);
  });

  test('separates panels joined by a thin bridge', () => {
    // Short panels, so the 4px bridge takes enough of the gutter column to
    // block the XY-cut; the erosion step has to split them instead.
    const p = page(300, 80);
    p.panel(10, 20, 130, 40);
    p.panel(160, 20, 130, 40);
    p.fill(140, 38, 20, 4, [0, 0, 0]);

    const { panels } = detectPanels(p.image);
    expect(panels).toHaveLength(2);
    expect(panels[0].x).toBeLessThan(panels[1].x);
  });

  test('splits panels along a slanted gutter', () => {
    const p = page(400, 300);
    for (let y = 20; y < 280; y++) {
      const split = 200 + Math.round((y - 150) * 0.3);
      for (let x = 20; x < 380; x++) {
        if (x < split - 6 || x > split + 6) p.set(x, y, [120, 120, 120]);
      }
    }

    const { panels } = detectPanels(p.image);
    expect(panels).toHaveLength(2);
    expect(panels[0].x).toBeLessThan(panels[1].x);
  });

  test('drops specks such as page numbers', () => {
    const p = page(400, 400);
    p.panel(20, 20, 360, 340);
    p.fill(195, 375, 10, 12, [0, 0, 0]);

    const { panels } = detectPanels(p.image);
    expect(panels).toHaveLength(1);
  });

  test('flags full-bleed pages for review', () => {
    const p = page(200, 200, [90, 60, 30]);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) p.set(x, y, [x, y, (x * y) % 256]);

    const { needsReview } = detectPanels(p.image);
    expect(needsReview).toBe(true);
  });
});

describe('estimateGutterColor', () => {
  test('picks the dominant edge colour even when art touches the edge', () => {
    const p = page(200, 200, [250, 248, 240]);
    p.fill(0, 50, 60, 100, [10, 10, 10]);

    const { color, confidence } = estimateGutterColor(p.image.data, 200, 200, 3);
    expect(color).toEqual([250, 248, 240]);
    expect(confidence).toBeGreaterThan(0.6);
  });
});
