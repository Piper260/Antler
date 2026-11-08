const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLibraries, datasetType, findDataset, datasetPath } = require('../src/main/utils/datasetLibraries');

describe('dataset libraries', () => {
  let root;
  const dir = (...parts) => {
    const full = path.join(root, ...parts);
    fs.mkdirSync(full, { recursive: true });
    return full;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-libs-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('resolveLibraries', () => {
    test('a fresh install gets one Datasets library in the default place', () => {
      const result = resolveLibraries({}, { defaultRoot: path.join(root, 'Antler') });
      expect(result.libraries).toEqual([{ id: 'datasets', name: 'Datasets', path: path.join(root, 'Antler'), type: null }]);
      expect(result.defaultId).toBe('datasets');
      expect(result.migrated).toBe(true);
    });

    test('old separate folders become typed libraries', () => {
      const result = resolveLibraries(
        { artistsPath: dir('A'), charactersPath: dir('C') },
        { defaultRoot: path.join(root, 'Antler') }
      );
      expect(result.libraries.map((l) => [l.name, l.type])).toEqual([['Artists', 'artist'], ['Characters', 'character']]);
      expect(result.defaultId).toBe('artists');
    });

    test('one old folder used for both becomes a single mixed library', () => {
      const shared = dir('Datasets');
      const result = resolveLibraries({ artistsPath: shared, charactersPath: shared }, { defaultRoot: root });
      expect(result.libraries).toHaveLength(1);
      expect(result.libraries[0]).toMatchObject({ name: 'Datasets', type: null, path: path.resolve(shared) });
    });

    test('the old built-in folders are kept when they exist', () => {
      const legacy = dir('downloads');
      dir('downloads', 'characters');
      const result = resolveLibraries({}, { defaultRoot: path.join(root, 'Antler'), legacyRoot: legacy });
      expect(result.libraries.map((l) => l.name)).toEqual(['Characters']);
    });

    test('saved libraries are used as they are, duplicates dropped, default kept', () => {
      const a = dir('One');
      const b = dir('Two');
      const result = resolveLibraries({
        libraries: [{ id: 'one', name: 'One', path: a }, { id: 'two', name: 'Two', path: b }, { id: 'dup', name: 'Again', path: a }],
        defaultLibrary: 'two'
      }, { defaultRoot: root });
      expect(result.libraries.map((l) => l.id)).toEqual(['one', 'two']);
      expect(result.defaultId).toBe('two');
      expect(result.migrated).toBe(false);
    });

    test('an unknown default falls back to the first library', () => {
      const result = resolveLibraries({ libraries: [{ id: 'x', name: 'X', path: dir('X') }], defaultLibrary: 'gone' }, { defaultRoot: root });
      expect(result.defaultId).toBe('x');
    });
  });

  describe('finding and placing datasets', () => {
    test('a download goes to the library that already has the dataset', () => {
      const libs = [
        { id: 'main', name: 'Main', path: dir('Main'), type: null },
        { id: 'ssd', name: 'SSD', path: dir('SSD'), type: null }
      ];
      dir('SSD', 'artists_twang');
      expect(datasetPath(libs, 'main', 'twang', 'artist')).toBe(path.join(root, 'SSD', 'artists_twang'));
      // A new dataset goes to the default library, with its type prefix.
      expect(datasetPath(libs, 'main', 'Drift', 'character')).toBe(path.join(root, 'Main', 'characters_Drift'));
    });

    test('names match loosely: underscores, spaces and case', () => {
      const libs = [{ id: 'm', name: 'M', path: dir('M'), type: null }];
      dir('M', 'characters_Alpha_(Zaush)');
      expect(findDataset(libs, 'alpha (zaush)', 'character').folder).toBe(path.join(root, 'M', 'characters_Alpha_(Zaush)'));
    });

    test('unprefixed folders keep the type of the library they came from', () => {
      const chars = { id: 'c', name: 'Characters', path: dir('C'), type: 'character' };
      const mixed = { id: 'm', name: 'Mixed', path: dir('M'), type: null };
      dir('C', 'Drift');
      expect(datasetType(chars, 'Drift')).toBe('character');
      expect(datasetType(mixed, 'Drift')).toBe('artist');
      expect(datasetType(mixed, 'characters_Drift')).toBe('character');
      expect(findDataset([chars], 'Drift', 'character').folder).toBe(path.join(root, 'C', 'Drift'));
      expect(findDataset([chars], 'Drift', 'artist')).toBeNull();
    });

    test('a missing library folder is skipped, not an error', () => {
      const libs = [{ id: 'gone', name: 'Gone', path: path.join(root, 'unplugged'), type: null }, { id: 'm', name: 'M', path: dir('M'), type: null }];
      dir('M', 'artists_x');
      expect(findDataset(libs, 'x', 'artist').library.id).toBe('m');
    });
  });
});
