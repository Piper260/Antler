const fs = require('fs');
const os = require('os');
const path = require('path');
const PanelTagCache = require('../src/main/services/panelTagCache');

describe('PanelTagCache', () => {
  let dir;
  let page;
  const box = { x: 10.4, y: 20, w: 100, h: 50 };
  const other = { x: 200, y: 20, w: 100, h: 50 };
  const facts = { known: { otter: 0.5 } };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-cache-'));
    page = path.join(dir, 'page.png');
    fs.writeFileSync(page, 'image');
    fs.writeFileSync(path.join(dir, 'page.txt'), 'otter');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const touch = (file) => fs.utimesSync(file, new Date(), new Date(Date.now() + 60000));

  test('gives back what was set, by box, and null for the rest', async () => {
    const cache = new PanelTagCache();
    await cache.set(page, 'jtp', [box], [facts]);
    expect(await cache.get(page, 'jtp', [box, other])).toEqual([facts, null]);
    await cache.flush();
  });

  test('survives a restart', async () => {
    const first = new PanelTagCache();
    await first.set(page, 'jtp', [box], [facts]);
    await first.flush();
    expect(await new PanelTagCache().get(page, 'jtp', [box])).toEqual([facts]);
  });

  test('forgets a page when the image, its tag file or the tagger change', async () => {
    const cache = new PanelTagCache();
    await cache.set(page, 'jtp', [box], [facts]);
    expect(await cache.get(page, 'z3d', [box])).toEqual([null]);

    touch(path.join(dir, 'page.txt'));
    expect(await cache.get(page, 'jtp', [box])).toEqual([null]);

    await cache.set(page, 'jtp', [box], [facts]);
    touch(page);
    expect(await cache.get(page, 'jtp', [box])).toEqual([null]);
    await cache.flush();
  });

  test('skips panels with no facts', async () => {
    const cache = new PanelTagCache();
    await cache.set(page, 'jtp', [box, other], [null, facts]);
    expect(await cache.get(page, 'jtp', [box, other])).toEqual([null, facts]);
    await cache.flush();
  });

  test('an unreadable cache file just means tagging again', async () => {
    fs.writeFileSync(path.join(dir, 'panel-tag-facts.json'), 'not json');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await new PanelTagCache().get(page, 'jtp', [box])).toEqual([null]);
    spy.mockRestore();
  });
});
