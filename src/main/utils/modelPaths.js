const fs = require('fs');
const path = require('path');

/**
 * Model folders, in the order they are searched: resources/models in a dev
 * checkout, <resources>/models in a packaged build (extraResources copies
 * resources/ to the resources root), then <user data>/models. The installer
 * leaves out models too large for it, and they can be dropped into the last
 * folder, which survives updates. None of them is kept in git.
 */
function modelFolders() {
  let userData = null;
  try {
    userData = require('electron').app?.getPath('userData') || null;
  } catch {
    // Outside Electron (tests); only the first two folders apply.
  }
  return [
    path.join(__dirname, '..', '..', '..', 'resources', 'models'),
    process.resourcesPath ? path.join(process.resourcesPath, 'models') : null,
    userData ? path.join(userData, 'models') : null
  ].filter(Boolean);
}

/** The full path of a model file (relative to a models folder), or null if no folder has it. */
function findModelFile(file) {
  for (const folder of modelFolders()) {
    const candidate = path.join(folder, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = { modelFolders, findModelFile };
