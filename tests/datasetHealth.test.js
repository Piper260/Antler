const fs = require('fs');
const os = require('os');
const path = require('path');
const health = require('../src/main/services/datasetHealth');

let root;
const write = (rel, data = '') => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-health-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('dataset check', () => {
  test('finds each kind of problem, and skips bak', async () => {
    write('1.png', 'image-one');
    write('1.txt', 'trig, fox, solo');
    write('2.png', 'image-two');                 // no caption
    write('3.png', 'image-three');
    write('3.txt', '   ');                        // empty caption
    write('4.txt', 'trig, gone');                 // image deleted
    write('5.png', 'image-five');
    write('5.txt', 'trig, fox, Fox, solo');       // repeated tag
    write('6.png', 'image-one');                  // same bytes as 1.png
    write('6.txt', 'trig, copy');
    write('7.webm', 'video');
    write('7.txt', 'trig, video');                // belongs to the video
    write('8.png.part', 'half');
    write('cat/9.png', 'image-nine');             // category subfolder, no caption
    write('bak/10.png', 'ignored');

    const result = await health.checkDataset(root);
    const names = (kind) => result.findings[kind].map(f => path.relative(root, f).replace(/\\/g, '/')).sort();
    expect(names('missing-caption')).toEqual(['2.png', 'cat/9.png']);
    expect(names('empty-caption')).toEqual(['3.png']);
    expect(names('orphan-caption')).toEqual(['4.txt']);
    expect(names('duplicate-tags')).toEqual(['5.txt']);
    expect(names('duplicate')).toEqual(['6.png']);
    expect(names('video')).toEqual(['7.webm']);
    expect(names('temp')).toEqual(['8.png.part']);
    expect(result.images).toBe(6);
    expect(result.triggerTag).toBe('trig');
  });

  test('small images are found with the size reader given', async () => {
    write('a.png', 'a');
    write('a.txt', 'x');
    write('b.png', 'b');
    write('b.txt', 'x');
    const sizes = { 'a.png': { width: 300, height: 900 }, 'b.png': { width: 1024, height: 1024 } };
    const result = await health.checkDataset(root, { minSide: 512, imageSize: async f => sizes[path.basename(f)] });
    expect(result.findings['low-res'].map(f => path.basename(f))).toEqual(['a.png']);
  });

  test('a trigger tag needs most captions to share it', () => {
    expect(health.commonFirstTag([['a', 'x'], ['a', 'y'], ['b', 'z']])).toBe('a');
    expect(health.commonFirstTag([['a'], ['b'], ['c']])).toBeNull();
    expect(health.commonFirstTag([['a'], ['a']])).toBeNull(); // too few to tell
  });

  test('the same image in two datasets is found', async () => {
    write('one/1.png', 'same-bytes');
    write('two/9.png', 'same-bytes');
    write('two/8.png', 'other-byte');
    const a = await health.checkDataset(path.join(root, 'one'));
    const b = await health.checkDataset(path.join(root, 'two'));
    const groups = await health.crossDuplicates([{ name: 'one', ...a }, { name: 'two', ...b }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map(f => f.dataset).sort()).toEqual(['one', 'two']);
  });
});

describe('dataset fixes', () => {
  test('moving to bak keeps the place under the dataset and takes the caption along', async () => {
    const image = write('cat/9.png', 'x');
    write('cat/9.txt', 'tags');
    const result = await health.moveToBak(root, [image], 'duplicates');
    expect(result).toEqual({ moved: 1, failed: [] });
    expect(fs.existsSync(path.join(root, 'bak', 'duplicates', 'cat', '9.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'bak', 'duplicates', 'cat', '9.txt'))).toBe(true);
    expect(fs.existsSync(image)).toBe(false);
  });

  test('a name already in bak gets a number instead of being overwritten', async () => {
    write('bak/temp/a.part', 'old');
    const file = write('a.part', 'new');
    await health.moveToBak(root, [file], 'temp');
    expect(fs.readFileSync(path.join(root, 'bak', 'temp', 'a.part'), 'utf8')).toBe('old');
    expect(fs.readFileSync(path.join(root, 'bak', 'temp', 'a-2.part'), 'utf8')).toBe('new');
  });

  test('repeated tags are removed, first place kept', async () => {
    const file = write('5.txt', 'trig, fox, Fox, solo, fox_tail, fox tail');
    let written = null;
    await health.dedupeCaption(file, async (target, text) => { written = text; });
    expect(written).toBe('trig, fox, solo, fox_tail');
  });

  test('a caption from Hydra starts with the trigger tag and leaves out hidden tags and other categories', () => {
    const suggestions = [
      { tag: 'solo', score: 0.9, category: 'general' },
      { tag: 'fox', score: 0.95, category: 'species' },
      { tag: 'signature', score: 0.8, category: 'meta' },
      { tag: 'smile', score: 0.4, category: 'general' },
      { tag: 'simple background', score: 0.7, category: 'general' }
    ];
    expect(health.buildCaption(suggestions, { triggerTag: 'trig', hidden: ['simple_background'] })).toBe('trig, fox, solo');
    expect(health.buildCaption(suggestions, { triggerTag: 'trig', maxTags: 2 })).toBe('trig, fox');
  });

  test('the usual caption length is the median of the dataset\'s captions', () => {
    expect(health.typicalLength([['a'], ['a', 'b', 'c'], ['a', 'b']])).toBe(2);
    expect(health.typicalLength([])).toBeNull();
  });
});
