// src/main/utils/pathGuard.js - checks on paths, names and URLs coming from the renderer
//
// The renderer is treated as untrusted: if a page ever ran injected script
// (say an e621 description shown without escaping), the IPC handlers are all
// it could reach. These checks keep each handler to the files it is for:
// a caption handler only touches .txt files, a download only lands inside
// its download folder.
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif']);
// Everything e621 serves, for downloads.
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, '.webm', '.mp4', '.swf']);
const TEXT_EXTENSIONS = new Set(['.txt']);

/** An absolute local file path with one of `extensions`; throws otherwise. */
function requireFile(filePath, extensions, label = 'file') {
  const resolved = requireLocalPath(filePath, `${label} path`);
  if (!extensions.has(path.extname(resolved).toLowerCase())) throw new Error(`Not a ${label}: ${path.basename(resolved)}`);
  return resolved;
}

/** An absolute path on a local or mapped drive (not \\server\share); throws otherwise. */
function requireLocalPath(filePath, label = 'path') {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) throw new Error(`Invalid ${label}`);
  if (!path.isAbsolute(filePath) || /^[\\/]{2}/.test(filePath)) throw new Error(`Invalid ${label}`);
  return path.resolve(filePath);
}

/** A single file or folder name, no separators or traversal; throws otherwise. */
function requireName(name, label = 'name') {
  if (typeof name !== 'string') throw new Error(`Invalid ${label}`);
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('\0')
    || /[\\/]/.test(trimmed) || path.basename(trimmed) !== trimmed) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
  return trimmed;
}

/** A file name with one of `extensions`. */
function requireFileName(name, extensions, label = 'file name') {
  const clean = requireName(name, label);
  if (!extensions.has(path.extname(clean).toLowerCase())) throw new Error(`Invalid ${label}: ${name}`);
  return clean;
}

/** An http(s) URL; anything else (file:, custom protocols) is refused. */
function requireWebUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Refused to open a ${parsed.protocol} link`);
  return parsed.toString();
}

module.exports = {
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  TEXT_EXTENSIONS,
  requireFile,
  requireLocalPath,
  requireName,
  requireFileName,
  requireWebUrl
};
