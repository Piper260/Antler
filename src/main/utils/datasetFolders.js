// src/main/utils/datasetFolders.js - Naming rules for artist/character dataset folders.
//
// Dataset folders carry their type in the name: "artists_<name>" or
// "characters_<name>". That lets artists and characters share one storage
// folder (Settings > Storage can point both at the same path). Folders
// without a prefix still work: they take the type of the storage path
// they were found in.
const fs = require('fs');
const path = require('path');

const TYPE_PREFIXES = {
  artist: 'artists_',
  character: 'characters_'
};

/**
 * Split a folder name into its type and bare name.
 * "characters_Alpha_(Zaush)" -> { type: 'character', name: 'Alpha_(Zaush)' }
 * "twang"                    -> { type: null, name: 'twang' }
 */
function parseDatasetFolderName(folderName) {
  const raw = String(folderName || '');
  const lower = raw.toLowerCase();
  for (const [type, prefix] of Object.entries(TYPE_PREFIXES)) {
    if (lower.startsWith(prefix) && raw.length > prefix.length) {
      return { type, name: raw.slice(prefix.length) };
    }
  }
  return { type: null, name: raw };
}

/** "twang" + 'character' -> "characters_twang". A name already prefixed is left alone. */
function buildDatasetFolderName(name, type = 'artist') {
  const parsed = parseDatasetFolderName(name);
  if (parsed.type) return String(name);
  const prefix = TYPE_PREFIXES[type === 'character' ? 'character' : 'artist'];
  return `${prefix}${name}`;
}

/** Loose comparison key: "Alpha_(Zaush)" and "alpha (zaush)" match. */
function nameKey(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find the folder in `basePath` that holds the dataset `name` of `type`.
 * Prefers an existing "<prefix><name>" folder, then an existing unprefixed
 * "<name>" folder (older layout), and otherwise returns the prefixed name
 * for a new folder. Returns the folder name, not the full path.
 */
function resolveDatasetFolderName(basePath, name, type = 'artist') {
  const wantedType = type === 'character' ? 'character' : 'artist';
  const parsedInput = parseDatasetFolderName(name);
  const key = nameKey(parsedInput.name);

  let entries = [];
  try {
    entries = fs.readdirSync(basePath, { withFileTypes: true }).filter(entry => entry.isDirectory());
  } catch {
    // Storage folder doesn't exist yet: the caller creates it.
  }

  let unprefixed = null;
  for (const entry of entries) {
    const parsed = parseDatasetFolderName(entry.name);
    if (nameKey(parsed.name) !== key) continue;
    if (parsed.type === wantedType) return entry.name;
    if (!parsed.type && !unprefixed) unprefixed = entry.name;
  }
  if (unprefixed) return unprefixed;

  return buildDatasetFolderName(parsedInput.name, wantedType);
}

/** Full path version of resolveDatasetFolderName. */
function resolveDatasetFolderPath(basePath, name, type = 'artist') {
  return path.join(basePath, resolveDatasetFolderName(basePath, name, type));
}

module.exports = {
  TYPE_PREFIXES,
  parseDatasetFolderName,
  buildDatasetFolderName,
  resolveDatasetFolderName,
  resolveDatasetFolderPath
};
