/**
 * Antler's build script: an animated banner, a menu (with --menu), then the
 * build as numbered steps, and a summary with the installer's SHA-256.
 *
 *   node scripts/build.js            installer
 *   node scripts/build.js --dir      portable folder
 *   node scripts/build.js --menu     ask which (installer, portable, both)
 *   add --open to open the output folder afterwards, --no-anim to skip the
 *   animation (it is skipped anyway when output isn't a terminal or in CI)
 */
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { c, banner, menu, createSteps, box, formatTime, showCursor } = require('./build-ui');

const execAsync = promisify(exec);

const ROOT = path.join(__dirname, '..');
const PACKAGE = require('../package.json');
const PRODUCT_NAME = PACKAGE.build.productName;
const PRODUCT_EXE = `${PRODUCT_NAME}.exe`;
const LOG_FILE = path.join(ROOT, 'logs', 'build.log');

// What a build on this machine produces. electron-builder builds for the
// platform it runs on; the release workflow builds each on its own runner.
const PLATFORMS = {
  win32: { name: 'Windows', unpacked: 'win-unpacked', installer: '.exe', installerName: 'setup .exe' },
  darwin: { name: 'macOS', unpacked: 'mac-arm64', installer: '.dmg', installerName: '.dmg' },
  linux: { name: 'Linux', unpacked: 'linux-unpacked', installer: '.AppImage', installerName: 'AppImage' }
};
const PLATFORM = PLATFORMS[process.platform] || PLATFORMS.linux;
const UNPACKED = path.join(ROOT, 'dist', PLATFORM.unpacked);
const GB = 1024 ** 3;
const args = process.argv.slice(2);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rel = (file) => path.relative(ROOT, file) || '.';
const formatSize = (bytes) => (bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);

let child = null;
process.on('SIGINT', () => {
  if (child) child.kill();
  showCursor();
  process.stdout.write(`\n\n  ${c.amber('Build cancelled.')}\n\n`);
  process.exit(130);
});

/* ---------- checks ---------- */

/** Total size of a folder in bytes. */
function folderSize(folder) {
  if (!fs.existsSync(folder)) return 0;
  return fs.readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0);
}

/**
 * Stops early when something the build needs is missing. Returns a short
 * note, plus warnings that shouldn't stop the build.
 */
function checkSetup(buildType) {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) throw new Error(`Node ${process.versions.node} is too old; Antler needs Node 20 or newer`);
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'electron-builder'))) throw new Error('Dependencies are missing; run npm install first');
  const required = ['build/icon.png', 'src/shared/models.json'];
  if (process.platform === 'win32') required.push('resources/win/bin/upscayl-bin.exe');
  for (const file of required) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${file} is missing`);
  }

  const warnings = [];
  if (buildType === 'dir') {
    // The portable folder is meant to carry every model.
    const manifest = require('../src/shared/models.json');
    const missing = manifest.packs.flatMap((p) => p.files).filter((f) => !fs.existsSync(path.join(ROOT, 'resources', 'models', ...f.path.split('/'))));
    if (missing.length) warnings.push(`${missing.length} model file${missing.length > 1 ? 's' : ''} not in resources/models; the portable folder won't have them`);
  }
  return { note: `${PLATFORM.name}, Node ${process.versions.node}, Electron ${PACKAGE.devDependencies.electron}`, warnings };
}

/**
 * Stops early when the drive can't hold the build. Models kept from the last
 * build (in the unpacked folder or dist/.model-cache, see modelHooks.js) are
 * reused, so only missing ones need room. The installer leaves models out,
 * so it needs little. The rest of the old unpacked folder is replaced, so
 * its space counts as free.
 */
function checkDiskSpace(buildType) {
  const dist = path.join(ROOT, 'dist');
  const models = folderSize(path.join(ROOT, 'resources', 'models'));
  const kept = folderSize(path.join(UNPACKED, 'resources', 'models')) + folderSize(path.join(dist, '.model-cache'));
  const needed = (buildType === 'dir' ? Math.max(0, models - kept) : 0) + 1 * GB;
  const { bavail, bsize } = fs.statfsSync(ROOT);
  const free = bavail * bsize + folderSize(UNPACKED) - folderSize(path.join(UNPACKED, 'resources', 'models'));
  if (free < needed) {
    throw new Error(`Not enough disk space: about ${(needed / GB).toFixed(1)} GB needed, ${(free / GB).toFixed(1)} GB free`);
  }
  return `${(free / GB).toFixed(0)} GB free`;
}

/* ---------- running copies ---------- */

/**
 * PIDs of any running copy of the packaged app. Electron runs several
 * processes under one image name, so one window can mean several PIDs.
 */
async function findRunningInstances() {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${PRODUCT_EXE}" /FO CSV /NH`);
      if (!stdout || stdout.includes('INFO: No tasks')) return [];
      return stdout.trim().split(/\r?\n/).map((line) => line.split('","')[1]).filter(Boolean);
    } catch {
      return []; // tasklist failing shouldn't block the build
    }
  }
  try {
    const { stdout } = await execAsync(`pgrep -f "${PRODUCT_NAME}"`);
    return stdout.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return []; // pgrep exits non-zero when nothing matches
  }
}

/**
 * Closes running copies so electron-builder can overwrite the unpacked folder
 * without hitting a locked .exe or .dll. Asks politely first, then forces.
 */
async function closeRunningInstances(update) {
  update(`asking ${PRODUCT_NAME} to close`);
  if (process.platform === 'win32') await execAsync(`taskkill /IM "${PRODUCT_EXE}" /T`).catch(() => {});
  else await execAsync(`pkill -TERM -f "${PRODUCT_NAME}"`).catch(() => {});
  await sleep(1500);

  let remaining = await findRunningInstances();
  if (remaining.length === 0) return;

  update('still running, forcing it closed');
  if (process.platform === 'win32') await execAsync(`taskkill /IM "${PRODUCT_EXE}" /T /F`).catch(() => {});
  else for (const pid of remaining) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ } }
  await sleep(500);

  remaining = await findRunningInstances();
  if (remaining.length > 0) {
    throw new Error(`Could not close ${PRODUCT_NAME} (PID ${remaining.join(', ')}); close it and run the build again`);
  }
}

/**
 * Waits until nothing holds the unpacked app folder (dist/win-unpacked on
 * Windows), which electron-builder has to
 * delete. A closed Antler takes a moment to let go of its files, and a File
 * Explorer window or terminal open inside the folder holds it too. Renaming
 * the folder fails while anything has it open, so that is the test. Also
 * clears the half-built folder a failed build leaves behind.
 */
async function waitForOutputFolder(update, timeoutMs = 20000) {
  fs.rmSync(`${UNPACKED}.tmp`, { recursive: true, force: true });
  const folder = UNPACKED;
  if (!fs.existsSync(folder)) return false;

  const probe = `${folder}.unlock-check`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.renameSync(folder, probe);
      fs.renameSync(probe, folder);
      return true;
    } catch (error) {
      if (fs.existsSync(probe) && !fs.existsSync(folder)) fs.renameSync(probe, folder);
      if (Date.now() > deadline) {
        throw new Error(`${rel(folder)} is still in use; close any file manager window or terminal open inside it and run the build again`);
      }
      update(`waiting for ${rel(folder)} to be released`);
      await sleep(500);
    }
  }
}

/* ---------- Windows build tools ---------- */

// electron-builder's Windows tooling (rcedit, signtool). Must match the
// version electron-builder asks for, which is part of the cache folder name.
const WIN_CODE_SIGN_VERSION = '2.6.0';
const WIN_CODE_SIGN_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${WIN_CODE_SIGN_VERSION}/winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`;

/**
 * Pre-extracts electron-builder's winCodeSign archive into its cache.
 *
 * The archive contains two macOS symlinks. Creating symlinks on Windows needs
 * administrator rights or Developer Mode, so on a normal account
 * electron-builder's own extraction fails with "Cannot create symbolic link"
 * and the build aborts. Those macOS files are never used for a Windows build,
 * so we extract the archive without them; electron-builder then finds the
 * folder in place and skips its own download. Returns false if already done.
 */
async function ensureWinCodeSign(update) {
  if (process.platform !== 'win32') return false;

  const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
    || path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  const cacheDir = path.join(cacheRoot, 'winCodeSign');
  const target = path.join(cacheDir, `winCodeSign-${WIN_CODE_SIGN_VERSION}`);
  if (fs.existsSync(path.join(target, 'rcedit-x64.exe'))) return false;

  fs.mkdirSync(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, `winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`);
  if (!fs.existsSync(archive)) {
    update('downloading winCodeSign');
    const response = await fetch(WIN_CODE_SIGN_URL);
    if (!response.ok) throw new Error(`Could not download winCodeSign (HTTP ${response.status})`);
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }

  update('extracting');
  const sevenZip = require('7zip-bin').path7za;
  fs.rmSync(target, { recursive: true, force: true });
  await execAsync(`"${sevenZip}" x -bd -y "${archive}" "-o${target}" "-xr!darwin"`);
  fs.rmSync(archive, { force: true });

  // Leftovers from earlier failed attempts: randomly numbered folders and archives.
  for (const entry of fs.readdirSync(cacheDir)) {
    if (/^\d+(\.7z)?$/.test(entry)) fs.rmSync(path.join(cacheDir, entry), { recursive: true, force: true });
  }
  return true;
}

/* ---------- electron-builder ---------- */

// electron-builder's "• <phase>  key=value" lines, in plain words.
const PHASES = [
  [/^electron-builder\s+version/, 'starting electron-builder'],
  [/^loaded configuration/, 'reading configuration'],
  [/^executing @electron\/rebuild|^installing native dependencies/, 'preparing native modules'],
  [/^packaging/, 'packing app files'],
  [/^downloading|^downloaded/, 'downloading Electron'],
  [/^updating asar integrity/, 'sealing the app archive'],
  [/^models/, 'placing models'],
  [/^executing @electron\/fuses/, 'locking down Electron'],
  [/^no code signing|^signing/, 'code signing (skipped, no certificate)'],
  [/^building\s+target=nsis|^building\b/, 'building the installer'],
  [/^building block map/, 'writing the update block map']
];

function describePhase(line) {
  const match = /^\s*•\s+(.*)$/.exec(line);
  if (!match) return null;
  const text = match[1].trim();
  for (const [pattern, label] of PHASES) if (pattern.test(text)) return label;
  return text.split(/\s{2,}/)[0];
}

/** Runs electron-builder through npm, logging everything to logs/build.log. */
async function runElectronBuilder(buildType, update) {
  const npmScript = buildType === 'dir' ? 'build-dir' : 'build';
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const log = fs.createWriteStream(LOG_FILE);
  let tail = '';

  child = spawn(`npm run ${npmScript}`, { cwd: ROOT, shell: true, env: { ...process.env, FORCE_COLOR: '0' } });
  const collect = (data) => {
    const text = data.toString();
    log.write(data);
    tail = (tail + text).slice(-20000);
    for (const line of text.split(/\r?\n/)) {
      const phase = describePhase(line);
      if (phase) update(phase);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const code = await new Promise((resolve) => child.on('close', resolve));
  child = null;
  log.end();

  if (code !== 0) {
    const error = new Error(`electron-builder exited with code ${code}`);
    error.tail = tail;
    throw error;
  }
  return buildType === 'dir' ? 'portable folder packed' : 'installer written';
}

/* ---------- output ---------- */

/** The installer this build wrote, or the folder for a portable build. */
function builtOutput(buildType, startedAt) {
  const dist = path.join(ROOT, 'dist');
  if (buildType === 'dir') return UNPACKED;
  return fs.readdirSync(dist)
    .filter((name) => name.endsWith(PLATFORM.installer))
    .map((name) => path.join(dist, name))
    .find((file) => fs.statSync(file).mtimeMs >= startedAt) || null;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

/** Checks the output is really there and, for an installer, writes its SHA-256 beside it. */
async function verifyOutput(buildType, startedAt, update) {
  const output = builtOutput(buildType, startedAt);
  if (!output) throw new Error('electron-builder finished but no new installer is in dist');
  if (buildType === 'dir') {
    const app = { win32: PRODUCT_EXE, darwin: `${PRODUCT_NAME}.app` }[process.platform] || PACKAGE.build.linux?.executableName || PRODUCT_NAME;
    if (!fs.existsSync(path.join(output, app))) throw new Error(`${app} is missing from ${rel(output)}`);
    return { output, size: folderSize(output) };
  }
  update('hashing the installer');
  const digest = await sha256(output);
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`);
  return { output, size: fs.statSync(output).size, digest };
}

/* ---------- main ---------- */

async function build(buildType) {
  const kind = buildType === 'dir' ? 'portable folder' : 'installer';
  process.stdout.write(`  ${c.bone('Building the')} ${c.bold(c.moss(`${PLATFORM.name} ${kind}`))}${c.bark(buildType === 'dir'
    ? ' with every model, for your own use'
    : ', models download on first launch')}\n\n`);

  const step = createSteps(5);
  const started = Date.now();
  let result;

  await step('Checking the setup', async () => {
    const { note, warnings } = checkSetup(buildType);
    const space = checkDiskSpace(buildType);
    return warnings.length ? { status: 'warn', note: warnings.join('; ') } : { note: `${note}, ${space}` };
  });

  await step('Freeing the output folder', async (update) => {
    const wasRunning = (await findRunningInstances()).length > 0;
    if (wasRunning) await closeRunningInstances(update);
    await waitForOutputFolder(update);
    return { note: wasRunning ? `closed the running ${PRODUCT_NAME}` : 'ready' };
  });

  await step('Preparing build tools', async (update) => {
    if (process.platform !== 'win32') return { status: 'skipped', note: `not needed on ${PLATFORM.name}` };
    try {
      return (await ensureWinCodeSign(update)) ? { note: 'ready' } : { status: 'skipped', note: 'already in place' };
    } catch (error) {
      // Not fatal: electron-builder still tries, and succeeds when the account may create symlinks.
      return { status: 'warn', note: `${error.message}; continuing` };
    }
  });

  const packStart = Date.now();
  await step(`Packaging the ${kind}`, (update) => runElectronBuilder(buildType, update));

  await step('Verifying the output', async (update) => {
    result = await verifyOutput(buildType, packStart, update);
    return { note: formatSize(result.size) };
  });

  const rows = [
    [buildType === 'dir' ? 'Folder' : 'Installer', c.bone(rel(result.output))],
    ['Size', c.bone(formatSize(result.size))]
  ];
  if (result.digest) rows.push(['SHA-256', c.bone(result.digest)], ['', c.bark(`saved as ${path.basename(result.output)}.sha256`)]);
  rows.push(['Log', c.bark(rel(LOG_FILE))]);
  box(`${PRODUCT_NAME} ${PACKAGE.version} ${kind} built in ${formatTime(Date.now() - started)}`, rows, c.moss);
  return result;
}

async function main() {
  await banner({ version: PACKAGE.version, subtitle: 'LoRA dataset workbench' });

  let plan;
  if (args.includes('--menu')) {
    const choice = await menu('What would you like to build?', [
      { value: 'installer', label: 'Installer', hint: `${PLATFORM.installerName} for releases; models download on first launch` },
      { value: 'dir', label: 'Portable folder', hint: `dist/${PLATFORM.unpacked} with every model, for your own use` },
      { value: 'both', label: 'Both', hint: 'the installer first, then the portable folder' }
    ]);
    if (!choice) {
      process.stdout.write(`  ${c.bark('Nothing built.')}\n\n`);
      return;
    }
    // The installer build rewrites the unpacked folder without models, so it goes first.
    plan = choice === 'both' ? ['installer', 'dir'] : [choice];
  } else {
    plan = [args.includes('--dir') ? 'dir' : 'installer'];
  }

  let last = null;
  for (const buildType of plan) last = await build(buildType);

  if (args.includes('--open') && last) {
    const folder = fs.statSync(last.output).isDirectory() ? last.output : path.dirname(last.output);
    const opener = { win32: 'explorer', darwin: 'open' }[process.platform] || 'xdg-open';
    spawn(opener, [folder], { detached: true, stdio: 'ignore' }).unref();
  }
}

main().catch((error) => {
  showCursor();
  if (error.tail) {
    const lines = error.tail.trim().split(/\r?\n/).slice(-40);
    process.stdout.write(`\n  ${c.bark('Last lines from electron-builder:')}\n\n${lines.map((l) => `    ${c.bark(l)}`).join('\n')}\n`);
  }
  box('Build failed', [['Reason', c.red(error.message)], ['Log', c.bark(rel(LOG_FILE))]], c.red);
  process.exitCode = 1;
});
