const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

// Read from package.json rather than hardcoding, so this stays correct if
// productName is ever renamed.
const PRODUCT_NAME = require('../package.json').build.productName;
const PRODUCT_EXE = `${PRODUCT_NAME}.exe`;

// ANSI Colors
const RESET = '\x1b[0m';
const BRIGHT = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

// ASCII Art
console.log(`
${CYAN}${BRIGHT}  ____  _                  _    ___ ___  ${RESET}
${CYAN}${BRIGHT} |  _ \\(_)_ __   ___ _ __ / \\  |_ _/ _ \\ ${RESET}
${CYAN}${BRIGHT} | |_) | | '_ \\ / _ \\ '__/ _ \\  | | | | |${RESET}
${CYAN}${BRIGHT} |  __/| | |_) |  __/ | / ___ \\ | | |_| |${RESET}
${CYAN}${BRIGHT} |_|   |_| .__/ \\___|_|/_/   \\_\\___\\___/ ${RESET}
${CYAN}${BRIGHT}         |_|                             ${RESET}
`);

console.log(`${BLUE}=============================================${RESET}`);
console.log(`${BLUE}   Antler Build System (Node.js)          ${RESET}`);
console.log(`${BLUE}=============================================${RESET}\n`);

// Spinner animation
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let i = 0;
let spinnerInterval;

function startSpinner(text) {
    process.stdout.write('\x1b[?25l'); // Hide cursor
    spinnerInterval = setInterval(() => {
        process.stdout.write(`\r${CYAN}${frames[i]} ${RESET}${text}`);
        i = (i + 1) % frames.length;
    }, 80);
}

function stopSpinner(symbol = '✅', text = 'Done') {
    clearInterval(spinnerInterval);
    process.stdout.write(`\r${GREEN}${symbol} ${RESET}${text}\n`);
    process.stdout.write('\x1b[?25h'); // Show cursor
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finds PIDs of any currently running instance of the packaged app. Electron
 * apps run as several processes sharing the same image name (main, renderer,
 * GPU, utility - four showed up for a single running window in testing), so
 * this can return multiple PIDs for what looks like "one" running app.
 */
async function findRunningInstances() {
    if (process.platform === 'win32') {
        try {
            // CSV + no header is unambiguous to parse regardless of spaces in the name
            const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${PRODUCT_EXE}" /FO CSV /NH`);
            if (!stdout || stdout.includes('INFO: No tasks')) return [];
            return stdout.trim().split(/\r?\n/)
                .map((line) => line.split('","')[1])
                .filter(Boolean);
        } catch {
            return []; // tasklist failing shouldn't block the build
        }
    }

    // macOS / Linux
    try {
        const { stdout } = await execAsync(`pgrep -f "${PRODUCT_NAME}"`);
        return stdout.trim().split(/\r?\n/).filter(Boolean);
    } catch {
        return []; // pgrep exits non-zero when nothing matches - that's fine, not an error
    }
}

/**
 * Closes every running instance so electron-builder can overwrite
 * dist/win-unpacked without hitting a file lock on the running .exe/.dll
 * files. Tries a plain close first (lets Electron's normal quit path run),
 * then force-kills anything still alive after a short grace period.
 */
async function closeRunningInstances() {
    console.log(`${YELLOW}⚠️  ${PRODUCT_NAME} is currently running - closing it before building...${RESET}`);

    if (process.platform === 'win32') {
        // /T also closes any child windows/processes under the same image name.
        // No /F yet - this is the polite request.
        await execAsync(`taskkill /IM "${PRODUCT_EXE}" /T`).catch(() => {});
    } else {
        await execAsync(`pkill -TERM -f "${PRODUCT_NAME}"`).catch(() => {});
    }

    await sleep(1500);

    let remaining = await findRunningInstances();
    if (remaining.length === 0) {
        console.log(`${GREEN}✅ Closed running instance.${RESET}\n`);
        return;
    }

    console.log(`${YELLOW}   Still running - forcing it closed...${RESET}`);
    if (process.platform === 'win32') {
        await execAsync(`taskkill /IM "${PRODUCT_EXE}" /T /F`).catch(() => {});
    } else {
        for (const pid of remaining) {
            try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
        }
    }

    await sleep(500);
    remaining = await findRunningInstances();
    if (remaining.length > 0) {
        throw new Error(
            `Could not close ${PRODUCT_NAME} (PID${remaining.length > 1 ? 's' : ''} ${remaining.join(', ')} still running). ` +
            `Close it manually and re-run the build.`
        );
    }

    console.log(`${GREEN}✅ Closed running instance.${RESET}\n`);
}

// electron-builder's Windows tooling (rcedit, signtool). Must match the
// version electron-builder asks for, which is part of the cache folder name.
const WIN_CODE_SIGN_VERSION = '2.6.0';
const WIN_CODE_SIGN_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${WIN_CODE_SIGN_VERSION}/winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`;

/**
 * Pre-extracts electron-builder's winCodeSign archive into its cache.
 *
 * The archive contains two macOS symlinks. Creating symlinks on Windows needs
 * administrator rights or Developer Mode, so on a normal account
 * electron-builder's own extraction fails with "Cannot create symbolic link:
 * A required privilege is not held by the client" and the whole build aborts.
 * Those macOS files are never used for a Windows build, so we extract the
 * archive ourselves without them; electron-builder then finds the folder
 * already in place and skips its own download.
 */
async function ensureWinCodeSign() {
    if (process.platform !== 'win32') return;

    const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
        || path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
    const cacheDir = path.join(cacheRoot, 'winCodeSign');
    const target = path.join(cacheDir, `winCodeSign-${WIN_CODE_SIGN_VERSION}`);
    if (fs.existsSync(path.join(target, 'rcedit-x64.exe'))) return;

    console.log(`${YELLOW}ℹ️  Preparing electron-builder's Windows tools (first build only)...${RESET}`);
    fs.mkdirSync(cacheDir, { recursive: true });

    const archive = path.join(cacheDir, `winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`);
    if (!fs.existsSync(archive)) {
        const response = await fetch(WIN_CODE_SIGN_URL);
        if (!response.ok) throw new Error(`Could not download winCodeSign (HTTP ${response.status})`);
        fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    }

    const sevenZip = require('7zip-bin').path7za;
    fs.rmSync(target, { recursive: true, force: true });
    await execAsync(`"${sevenZip}" x -bd -y "${archive}" "-o${target}" "-xr!darwin"`);
    fs.rmSync(archive, { force: true });

    // Leftovers from earlier failed attempts: randomly numbered folders and archives.
    for (const entry of fs.readdirSync(cacheDir)) {
        if (/^\d+(\.7z)?$/.test(entry)) fs.rmSync(path.join(cacheDir, entry), { recursive: true, force: true });
    }
    console.log(`${GREEN}✅ Windows build tools ready.${RESET}
`);
}

const ROOT = path.join(__dirname, '..');
const { INSTALLER_EXCLUDES } = require('./modelHooks');
const LOG_FILE = path.join(ROOT, 'logs', 'build.log');
const GB = 1024 ** 3;

/** Total size of a folder in bytes. */
function folderSize(folder) {
    if (!fs.existsSync(folder)) return 0;
    return fs.readdirSync(folder, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile())
        .reduce((total, entry) => total + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0);
}

/**
 * Stops early when the drive can't hold the build. Models kept from the last
 * build (in dist/win-unpacked or dist/.model-cache, see modelHooks.js) are
 * reused, so only missing ones need room. Model weights barely compress, so
 * the installer also needs room for both its archive and the installer
 * itself, each about the size of the models it holds. The rest of the old
 * dist/win-unpacked is replaced, so its space counts as free.
 */
function checkDiskSpace(buildType) {
    const dist = path.join(ROOT, 'dist');
    const models = folderSize(path.join(ROOT, 'resources', 'models'));
    const kept = folderSize(path.join(dist, 'win-unpacked', 'resources', 'models')) + folderSize(path.join(dist, '.model-cache'));
    const excluded = [...INSTALLER_EXCLUDES].map((file) => path.join(ROOT, 'resources', 'models', file));
    const installerModels = models - excluded.reduce((sum, file) => sum + (fs.existsSync(file) ? fs.statSync(file).size : 0), 0);
    const needed = Math.max(0, models - kept) + (buildType === 'dir' ? 0 : 2 * installerModels) + 1 * GB;
    const { bavail, bsize } = fs.statfsSync(ROOT);
    const free = bavail * bsize + folderSize(path.join(dist, 'win-unpacked')) - folderSize(path.join(dist, 'win-unpacked', 'resources', 'models'));
    if (free < needed) {
        throw new Error(`Not enough disk space: about ${(needed / GB).toFixed(1)} GB needed, ${(free / GB).toFixed(1)} GB free. ` +
            `Delete old installers in the 'dist' folder or free up space on the drive.`);
    }
}

/** The installer this build wrote, or the folder for a folder build. */
function builtOutput(buildType, startedAt) {
    const dist = path.join(ROOT, 'dist');
    if (buildType === 'dir') return path.join(dist, 'win-unpacked');
    const installer = fs.readdirSync(dist)
        .filter((name) => name.endsWith('.exe'))
        .map((name) => path.join(dist, name))
        .find((file) => fs.statSync(file).mtimeMs >= startedAt);
    return installer || dist;
}

function fail(title, message) {
    console.log(`\n${RED}=============================================${RESET}`);
    console.log(`${RED}   ${title}${RESET}`);
    console.log(`${RED}=============================================${RESET}\n`);
    console.log(`${RED}❌ ${message}${RESET}\n`);
    process.exitCode = 1;
}

async function runBuild() {
    const buildType = process.argv.slice(2).includes('--dir') ? 'dir' : 'installer';
    const npmCommand = buildType === 'dir' ? 'build-dir' : 'build';
    const buildDescription = buildType === 'dir'
        ? "This will create a portable folder with every model in 'dist/win-unpacked'."
        : "This will create an installer in the 'dist' folder. It leaves out the ONNX models: Antler offers to download them on first launch.";

    console.log(`${BRIGHT}🚀 Starting build process...${RESET}`);
    console.log(`${YELLOW}ℹ️  ${buildDescription}${RESET}\n`);

    try {
        checkDiskSpace(buildType);
    } catch (error) {
        fail('BUILD ABORTED', error.message);
        return;
    }

    // electron-builder needs to overwrite dist/win-unpacked - a running
    // instance launched from there holds its .exe/.dll files locked and the
    // build fails partway through, so clear that out first.
    const runningPids = await findRunningInstances();
    if (runningPids.length > 0) {
        try {
            await closeRunningInstances();
        } catch (error) {
            fail('BUILD ABORTED', error.message);
            return;
        }
    }

    try {
        await ensureWinCodeSign();
    } catch (error) {
        // Not fatal on its own: electron-builder will still try, and succeeds
        // when the account is allowed to create symlinks.
        console.log(`${YELLOW}⚠️  Could not prepare Windows build tools: ${error.message}${RESET}\n`);
    }

    startSpinner(`Building ${buildType === 'dir' ? 'portable folder' : 'installer'} with electron-builder...`);

    const startedAt = Date.now();
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const log = fs.createWriteStream(LOG_FILE);
    const build = spawn(`npm run ${npmCommand}`, {
        cwd: ROOT,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' }
    });

    let output = '';
    const collect = (data) => {
        output += data.toString();
        log.write(data);
    };
    build.stdout.on('data', collect);
    build.stderr.on('data', collect);

    const code = await new Promise((resolve) => build.on('close', resolve));
    log.end();

    if (code !== 0) {
        stopSpinner('❌', 'Build failed!');
        console.log(`\n${YELLOW}--- Build Output (last 60 lines) ---${RESET}`);
        console.log(output.trim().split(/\r?\n/).slice(-60).join('\n'));
        fail(`BUILD FAILED (Exit Code: ${code})`, `Full output: ${LOG_FILE}`);
        return;
    }

    stopSpinner('✅', 'Build successful!');
    const result = builtOutput(buildType, startedAt);
    const size = fs.statSync(result).isFile() ? fs.statSync(result).size : folderSize(result);

    console.log(`\n${GREEN}=============================================${RESET}`);
    console.log(`${GREEN}   BUILD COMPLETED SUCCESSFULLY              ${RESET}`);
    console.log(`${GREEN}=============================================${RESET}\n`);
    console.log(`${CYAN}📦 ${buildType === 'dir' ? 'Folder' : 'Installer'}:${RESET} ${result} (${(size / GB).toFixed(2)} GB)`);
    if (buildType === 'installer') {
        console.log(`${YELLOW}ℹ️  The installer has no ONNX models; Antler offers to download them on first launch.${RESET}`);
    }
    console.log(`${CYAN}📝 Build log:${RESET} ${LOG_FILE}\n`);
}

runBuild().catch((error) => {
    console.log(`\n${RED}❌ Unexpected error: ${error.message}${RESET}\n`);
    process.exitCode = 1;
});
