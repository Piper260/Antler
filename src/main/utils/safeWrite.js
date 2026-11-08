// src/main/utils/safeWrite.js - writes that can't leave a file half-written
//
// Data goes to a temporary file next to the target, which is then renamed
// over it, so a crash or full disk mid-write leaves the old file intact.
// With `backup`, the file being replaced is first copied to a "bak" folder
// beside it (one step back: each save replaces the previous backup). Dataset
// scans already skip "bak" folders, as the Image Upscaler keeps its
// originals there too.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Windows refuses a rename while another program (antivirus, a viewer) has
// the target open; that usually clears within moments.
const RETRIES = 5;
const RETRY_DELAY = 100;
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

const tempPathFor = (filePath) => `${filePath}.${process.pid}.${Date.now()}.tmp`;
const backupPathFor = (filePath) => path.join(path.dirname(filePath), 'bak', path.basename(filePath));

async function writeFileSafe(filePath, data, { encoding = 'utf8', backup = false } = {}) {
  if (backup) {
    try {
      await fsp.mkdir(path.dirname(backupPathFor(filePath)), { recursive: true });
      await fsp.copyFile(filePath, backupPathFor(filePath));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // nothing to back up yet
    }
  }

  const tempPath = tempPathFor(filePath);
  await fsp.writeFile(tempPath, data, typeof data === 'string' ? encoding : undefined);
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tempPath, filePath);
      return;
    } catch (error) {
      if (!BUSY.has(error.code) || attempt >= RETRIES) {
        await fsp.unlink(tempPath).catch(() => {});
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
    }
  }
}

/** The same, for code that can't await (settings, workers). */
function writeFileSafeSync(filePath, data, { encoding = 'utf8', backup = false } = {}) {
  if (backup && fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(backupPathFor(filePath)), { recursive: true });
    fs.copyFileSync(filePath, backupPathFor(filePath));
  }

  const tempPath = tempPathFor(filePath);
  fs.writeFileSync(tempPath, data, typeof data === 'string' ? encoding : undefined);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (error) {
      if (!BUSY.has(error.code) || attempt >= RETRIES) {
        try { fs.unlinkSync(tempPath); } catch { /* already gone */ }
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY * (attempt + 1));
    }
  }
}

module.exports = { writeFileSafe, writeFileSafeSync, backupPathFor };
