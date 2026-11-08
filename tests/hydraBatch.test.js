const { planAdditions, withoutAdded } = require('../src/renderer/js/utils/hydraBatch');

const fileA = { tags: ['solo', 'otter'] };
const fileB = { tags: ['duo', 'Blue Eyes'] };
const scanned = [
  { file: fileA, suggestions: [
    { tag: 'blue eyes', score: 0.95, category: 'general' },
    { tag: 'nick wilde', score: 0.9, category: 'character' },
    { tag: 'smile', score: 0.7, category: 'general' }
  ] },
  { file: fileB, suggestions: [
    { tag: 'blue eyes', score: 0.97, category: 'general' },
    { tag: 'smile', score: 0.88, category: 'general' },
    { tag: 'otter', score: 0.6, category: 'species' }
  ] }
];
const general = new Set(['general', 'species']);

describe('planAdditions', () => {
  test('adds tags at or over the threshold, in the chosen categories, that a file lacks', () => {
    const plan = planAdditions(scanned, { threshold: 0.85, categories: general });
    expect(plan.perFile.get(fileA)).toEqual(['blue eyes']);
    expect(plan.perFile.get(fileB)).toEqual(['smile']); // it already has Blue Eyes
    expect(plan.total).toBe(2);
    expect(plan.perTag).toEqual([
      { tag: 'blue eyes', category: 'general', files: 1 },
      { tag: 'smile', category: 'general', files: 1 }
    ]);
  });

  test('a lower threshold and more categories add more', () => {
    const plan = planAdditions(scanned, { threshold: 0.6, categories: new Set(['general', 'species', 'character']) });
    expect(plan.perFile.get(fileA)).toEqual(['blue eyes', 'nick wilde', 'smile']);
    expect(plan.perFile.get(fileB)).toEqual(['smile', 'otter']);
    expect(plan.total).toBe(5);
  });

  test('hidden tags never count; unticked tags are listed but not added', () => {
    const plan = planAdditions(scanned, { threshold: 0.6, categories: general, hidden: new Set(['smile']), excluded: new Set(['blue eyes']) });
    expect(plan.perTag.map(item => item.tag)).toEqual(['blue eyes', 'otter']);
    expect(plan.perFile.get(fileA)).toBeUndefined();
    expect(plan.perFile.get(fileB)).toEqual(['otter']);
    expect(plan.total).toBe(1);
  });
});

describe('withoutAdded', () => {
  test('removes only the added tags, whatever their case, and keeps later edits', () => {
    expect(withoutAdded(['solo', 'Blue Eyes', 'hat'], ['blue eyes'])).toEqual(['solo', 'hat']);
  });
});

const { planRemovals, removeTags, restoreRemoved } = require('../src/renderer/js/utils/hydraBatch');

describe('planRemovals', () => {
  const a = { tags: ['solo', 'otter', 'hat', 'andy borrego'] };
  const b = { tags: ['duo', 'otter', 'Hat'] };
  const scannedTags = [
    { file: a, scores: { solo: 0.9, otter: 0.02, hat: 0.01, 'andy borrego': null }, categories: { solo: 'general', otter: 'species', hat: 'general' } },
    { file: b, scores: { duo: 0.04, otter: 0.95, Hat: 0.3 }, categories: { duo: 'general', otter: 'species', Hat: 'general' } }
  ];

  test('removes tags Hydra scores under the threshold, never unknown ones', () => {
    const plan = planRemovals(scannedTags, { threshold: 0.05, categories: new Set(['general', 'species']) });
    expect(plan.perFile.get(a)).toEqual(['otter', 'hat']);
    expect(plan.perFile.get(b)).toEqual(['duo']);
    expect(plan.total).toBe(3);
    const otter = plan.perTag.find(item => item.tag === 'otter');
    expect(otter).toEqual({ tag: 'otter', category: 'species', files: 2, agree: 1, remove: 1 });
  });

  test('keeps protected tags, unchosen categories and unticked tags', () => {
    const plan = planRemovals(scannedTags, {
      threshold: 0.05,
      categories: new Set(['general']),
      protectedTags: new Set(['hat']),
      excluded: new Set(['duo'])
    });
    expect(plan.perFile.get(a)).toBeUndefined();
    expect(plan.perFile.get(b)).toBeUndefined();
    expect(plan.perTag.find(item => item.tag === 'duo').remove).toBe(1);
  });

  test('ignores a scored tag the file no longer has', () => {
    const c = { tags: ['solo'] };
    const plan = planRemovals([{ file: c, scores: { solo: 0.9, hat: 0.01 }, categories: { solo: 'general', hat: 'general' } }],
      { threshold: 0.05, categories: new Set(['general']) });
    expect(plan.total).toBe(0);
  });
});

describe('removeTags and restoreRemoved', () => {
  test('put removed tags back where they were', () => {
    const { tags, taken } = removeTags(['a', 'b', 'c', 'd'], ['b', 'D']);
    expect(tags).toEqual(['a', 'c']);
    expect(restoreRemoved(tags, taken)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('do not add a tag back twice', () => {
    const { tags, taken } = removeTags(['a', 'b'], ['b']);
    expect(restoreRemoved([...tags, 'b'], taken)).toEqual(['a', 'b']);
  });
});

const { tagAgreement } = require('../src/renderer/js/utils/hydraBatch');

describe('tagAgreement', () => {
  test('averages the scores per tag over the files that still have it', () => {
    const a = { tags: ['otter', 'Hat'] };
    const b = { tags: ['otter'] };
    const stats = tagAgreement([
      { file: a, scores: { otter: 0.9, Hat: 0.1, artist: null } },
      { file: b, scores: { otter: 0.1, hat: 0.95 } }
    ]);
    expect(stats.get('otter')).toEqual({ scored: 2, mean: 0.5, agree: 1, doubted: 1 });
    // b no longer has "hat", and "artist" is unknown to Hydra.
    expect(stats.get('hat')).toEqual({ scored: 1, mean: 0.1, agree: 0, doubted: 1 });
    expect(stats.has('artist')).toBe(false);
  });
});
