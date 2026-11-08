const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseDatasetFolderName,
  buildDatasetFolderName,
  resolveDatasetFolderName
} = require('../src/main/utils/datasetFolders');

describe('parseDatasetFolderName', () => {
  test('reads the type from the prefix', () => {
    expect(parseDatasetFolderName('artists_twang')).toEqual({ type: 'artist', name: 'twang' });
    expect(parseDatasetFolderName('characters_Alpha_(Zaush)')).toEqual({ type: 'character', name: 'Alpha_(Zaush)' });
    expect(parseDatasetFolderName('Characters_Drift')).toEqual({ type: 'character', name: 'Drift' });
  });

  test('leaves unprefixed names alone', () => {
    expect(parseDatasetFolderName('twang')).toEqual({ type: null, name: 'twang' });
    expect(parseDatasetFolderName('artists_')).toEqual({ type: null, name: 'artists_' });
  });
});

describe('buildDatasetFolderName', () => {
  test('adds the prefix for the type once', () => {
    expect(buildDatasetFolderName('twang', 'artist')).toBe('artists_twang');
    expect(buildDatasetFolderName('Drift', 'character')).toBe('characters_Drift');
    expect(buildDatasetFolderName('artists_twang', 'artist')).toBe('artists_twang');
  });
});

describe('resolveDatasetFolderName', () => {
  let root;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'datasets-'));
    for (const name of ['artists_twang', 'characters_Alpha_(Zaush)', 'characters_twang', 'oldartist']) {
      fs.mkdirSync(path.join(root, name));
    }
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test('finds the existing prefixed folder for the type', () => {
    expect(resolveDatasetFolderName(root, 'twang', 'artist')).toBe('artists_twang');
    expect(resolveDatasetFolderName(root, 'twang', 'character')).toBe('characters_twang');
  });

  test('matches spaces against underscores and ignores case', () => {
    expect(resolveDatasetFolderName(root, 'alpha (zaush)', 'character')).toBe('characters_Alpha_(Zaush)');
  });

  test('falls back to an unprefixed folder from the older layout', () => {
    expect(resolveDatasetFolderName(root, 'oldartist', 'artist')).toBe('oldartist');
  });

  test('names a new folder with the prefix', () => {
    expect(resolveDatasetFolderName(root, 'newcomer', 'character')).toBe('characters_newcomer');
    expect(resolveDatasetFolderName(path.join(root, 'missing'), 'x', 'artist')).toBe('artists_x');
  });
});
