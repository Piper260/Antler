/**
 * electron-builder hooks that keep the models between builds.
 *
 * The models are about 3.8 GB, and electron-builder empties the output
 * folder (dist/win-unpacked) on every build. So the models are left out of
 * extraResources; before packing they are moved out of the old output into
 * dist/.model-cache, and after packing each one is moved back, copied from
 * resources/models only when it is new or has changed. Moving within the
 * same drive is instant.
 *
 * The installer leaves out every model listed in src/shared/models.json.
 * Antler offers to download those on first launch, from their authors'
 * pages or Antler's own ONNX conversions, so a public installer doesn't
 * redistribute anyone's model and stays small. Only the small ncnn
 * upscalers tracked in git ship with it. The portable folder keeps every
 * model, for personal use.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'resources', 'models');
const MANIFEST = require('../src/shared/models.json');
// Paths relative to resources/models, as listFiles() returns them.
const INSTALLER_EXCLUDES = new Set(
  MANIFEST.packs.flatMap(pack => pack.files.map(file => path.join(...file.path.split('/'))))
);

const cacheDir = (context) => path.join(context.outDir, '.model-cache');
const modelsDir = (context) => path.join(context.appOutDir, 'resources', 'models');
const isInstaller = (context) => context.targets.some(target => target.name !== 'dir');

/** Files under a folder, as paths relative to it. */
function listFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(folder, path.join(entry.parentPath, entry.name)));
}

/** Same file if size and modified time (to the second) match; copies keep the source's time. */
function sameFile(a, b) {
  const [statA, statB] = [fs.statSync(a), fs.statSync(b)];
  return statA.size === statB.size && Math.floor(statA.mtimeMs / 1000) === Math.floor(statB.mtimeMs / 1000);
}

exports.INSTALLER_EXCLUDES = INSTALLER_EXCLUDES;

/** Moves the previous build's models into the cache before the output folder is emptied. */
exports.beforePack = async (context) => {
  const from = modelsDir(context);
  for (const file of listFiles(from)) {
    const to = path.join(cacheDir(context), file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(path.join(from, file), to);
  }
};

/** Puts each model this build needs into the output, reusing the cached copy when it is unchanged. */
exports.afterPack = async (context) => {
  const wanted = listFiles(SOURCE).filter(file => !(isInstaller(context) && INSTALLER_EXCLUDES.has(file)));
  let reused = 0;
  let copied = 0;
  for (const file of wanted) {
    const source = path.join(SOURCE, file);
    const cached = path.join(cacheDir(context), file);
    const target = path.join(modelsDir(context), file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(cached) && sameFile(cached, source)) {
      fs.renameSync(cached, target);
      reused++;
    } else {
      fs.copyFileSync(source, target);
      const { atime, mtime } = fs.statSync(source);
      fs.utimesSync(target, atime, mtime);
      fs.rmSync(cached, { force: true });
      copied++;
    }
  }
  console.log(`  • models  reused=${reused} copied=${copied}${isInstaller(context) ? ' (downloadable models left out of the installer)' : ''}`);
};
