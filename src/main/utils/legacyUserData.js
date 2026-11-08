// src/main/utils/legacyUserData.js
// The app used to be called Piper AIO, and Electron kept its settings, keys,
// thumbnails and models under %APPDATA%\piper-aio. After the rename to Antler
// that folder is %APPDATA%\antler, so move the old one over once, before
// anything reads userData.
//
// Electron creates the new folder (and a few Chromium cache folders in it)
// before the app's own code runs, so "the new folder exists" doesn't mean it
// is in use. It counts as in use only once it has a settings.json.
const fs = require('fs');
const path = require('path');

const LEGACY_DIR_NAME = 'piper-aio';
const IN_USE_MARKER = 'settings.json';

/**
 * Move the contents of <appData>/piper-aio into userDataDir unless the new
 * folder already holds settings. Returns 'moved', 'skipped' or 'failed'.
 * Never throws.
 */
function migrateLegacyUserData(appDataDir, userDataDir) {
  const legacyDir = path.join(appDataDir, LEGACY_DIR_NAME);
  if (path.resolve(legacyDir).toLowerCase() === path.resolve(userDataDir).toLowerCase()) return 'skipped';
  if (!fs.existsSync(legacyDir)) return 'skipped';
  if (fs.existsSync(path.join(userDataDir, IN_USE_MARKER))) return 'skipped';

  try {
    if (!fs.existsSync(userDataDir)) {
      fs.renameSync(legacyDir, userDataDir);
    } else {
      // Only fresh Chromium state is here (no settings yet), so the old
      // copy of anything wins.
      // settings.json goes last: if anything fails before it, the new
      // folder still doesn't count as in use and the next launch retries.
      const names = fs.readdirSync(legacyDir)
        .sort((a, b) => (a === IN_USE_MARKER) - (b === IN_USE_MARKER));
      for (const name of names) {
        const target = path.join(userDataDir, name);
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(path.join(legacyDir, name), target);
      }
      fs.rmdirSync(legacyDir);
    }
    console.log(`[INFO] Moved user data from ${legacyDir} to ${userDataDir}`);
    return 'moved';
  } catch (error) {
    // Usually the old app is still running and holds a lock. What already
    // moved stays moved; the next launch moves the rest.
    console.warn(`[WARN] Could not move ${legacyDir}: ${error.message}`);
    return 'failed';
  }
}

module.exports = { migrateLegacyUserData, LEGACY_DIR_NAME };
