// src/main/utils/datasetLibraries.js - where datasets live.
//
// A library is a folder that holds dataset folders ("artists_twang",
// "characters_Drift", ...). The user keeps a list of them in Settings and
// picks one for new downloads. A download always goes to the library that
// already has that artist or character, so a dataset never splits in two.
//
// Older settings had one folder for artists and one for characters; they
// become libraries the first time these settings are read. A library made
// that way remembers its old type (`type`), so dataset folders in it without
// an "artists_"/"characters_" prefix keep the type they always had.
const fs = require('fs');
const path = require('path');
const { parseDatasetFolderName, buildDatasetFolderName } = require('./datasetFolders');

const sameFolder = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const nameKey = (name) => String(name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function slug(text, taken) {
  const base = String(text || 'library').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'library';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * The libraries to use, from the storage settings.
 * @param {object} storage - settings.storage
 * @param {{defaultRoot: string, legacyRoot?: string}} places - defaultRoot for a
 *   fresh install; legacyRoot is the old built-in downloads folder.
 * @returns {{libraries: Array<{id, name, path, type}>, defaultId: string, migrated: boolean}}
 */
function resolveLibraries(storage = {}, { defaultRoot, legacyRoot = null }) {
  const taken = new Set();
  const clean = [];
  const add = (name, folder, type = null) => {
    if (typeof folder !== 'string' || !folder.trim()) return;
    const resolved = path.resolve(folder.trim());
    if (clean.some((lib) => sameFolder(lib.path, resolved))) {
      // The same folder twice (artists and characters shared one): it holds both.
      const existing = clean.find((lib) => sameFolder(lib.path, resolved));
      if (existing.type !== type) existing.type = null;
      return;
    }
    clean.push({ id: slug(name, taken), name: String(name || path.basename(resolved)).trim() || path.basename(resolved), path: resolved, type });
  };

  if (Array.isArray(storage.libraries) && storage.libraries.length) {
    for (const lib of storage.libraries) {
      if (!lib || typeof lib !== 'object') continue;
      const type = lib.type === 'artist' || lib.type === 'character' ? lib.type : null;
      const before = clean.length;
      add(lib.name, lib.path, type);
      // Keep a saved id so the default choice survives renames.
      if (clean.length > before && lib.id && !clean.some((other, i) => i < clean.length - 1 && other.id === lib.id)) {
        taken.delete(clean[clean.length - 1].id);
        clean[clean.length - 1].id = String(lib.id);
        taken.add(String(lib.id));
      }
    }
    if (clean.length) {
      const defaultId = clean.some((lib) => lib.id === storage.defaultLibrary) ? storage.defaultLibrary : clean[0].id;
      return { libraries: clean, defaultId, migrated: false };
    }
  }

  // Migrate the old two-folder settings.
  const artists = (storage.artistsPath || '').trim();
  const characters = (storage.charactersPath || '').trim();
  if (artists) add('Artists', artists, 'artist');
  if (characters) add('Characters', characters, 'character');
  // The old built-in default folders, if they were used.
  if (legacyRoot) {
    for (const [sub, name, type] of [['artists', 'Artists', 'artist'], ['characters', 'Characters', 'character']]) {
      const folder = path.join(legacyRoot, sub);
      if (fs.existsSync(folder) && ((type === 'artist' && !artists) || (type === 'character' && !characters))) add(name, folder, type);
    }
  }
  // A single library holding both types is just "Datasets".
  if (clean.length === 1 && clean[0].type === null) Object.assign(clean[0], { id: 'datasets', name: 'Datasets' });
  if (!clean.length) add('Datasets', defaultRoot, null);
  return { libraries: clean, defaultId: clean[0].id, migrated: true };
}

/** The type of a dataset folder found in `library`. */
function datasetType(library, folderName) {
  return parseDatasetFolderName(folderName).type || library.type || 'artist';
}

/**
 * The existing folder of dataset `name` of `type` in any library, or null.
 * A prefixed folder wins over an unprefixed one of the right type.
 */
function findDataset(libraries, name, type = 'artist') {
  const wanted = type === 'character' ? 'character' : 'artist';
  const key = nameKey(parseDatasetFolderName(name).name);
  let fallback = null;
  for (const library of libraries) {
    let entries = [];
    try {
      entries = fs.readdirSync(library.path, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch {
      continue; // library folder missing (e.g. an unplugged drive)
    }
    for (const entry of entries) {
      const parsed = parseDatasetFolderName(entry.name);
      if (nameKey(parsed.name) !== key) continue;
      if (parsed.type === wanted) return { library, folder: path.join(library.path, entry.name) };
      if (!parsed.type && datasetType(library, entry.name) === wanted && !fallback) {
        fallback = { library, folder: path.join(library.path, entry.name) };
      }
    }
  }
  return fallback;
}

/** Where dataset `name` of `type` is, or would go: its existing folder, else the default library. */
function datasetPath(libraries, defaultId, name, type = 'artist') {
  const found = findDataset(libraries, name, type);
  if (found) return found.folder;
  const library = libraries.find((lib) => lib.id === defaultId) || libraries[0];
  return path.join(library.path, buildDatasetFolderName(parseDatasetFolderName(name).name, type));
}

module.exports = { resolveLibraries, datasetType, findDataset, datasetPath };
