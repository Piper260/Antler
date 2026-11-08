// src/main/services/UpdateService.js
// Keeps Antler up to date from its GitHub Releases.
//
// Windows (NSIS installer) and Linux (AppImage) update themselves with
// electron-updater: a new version downloads in the background and installs
// on restart, or the next time Antler quits. macOS can't replace an unsigned
// app, so there Antler only says a new version is out and links to it.
// Running from source never updates itself; use git pull.
const { app } = require('electron');

const OWNER = 'Piper260';
const REPO = 'Antler';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const FIRST_CHECK_DELAY = 15 * 1000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** -1, 0 or 1, comparing dotted version numbers ("1.2.10" > "1.2.9"). */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** How this copy of Antler can be updated. */
function updateMode({ packaged = app.isPackaged, platform = process.platform, env = process.env } = {}) {
  if (!packaged) return 'source';
  if (platform === 'win32') return 'auto';
  if (platform === 'linux') return env.APPIMAGE ? 'auto' : 'notify';
  return 'notify'; // macOS: unsigned builds can't update themselves
}

class UpdateService {
  constructor({ mode = updateMode(), fetchImpl = globalThis.fetch, currentVersion = app.getVersion() } = {}) {
    this.mode = mode;
    this.fetch = fetchImpl;
    this.listeners = new Set();
    this.timer = null;
    this.updater = null;
    this.status = { state: 'idle', mode, currentVersion, releaseUrl: RELEASES_URL };
  }

  /** Called with every status change; returns a function that stops listening. */
  onStatus(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (error) {
        console.error('Update listener failed:', error);
      }
    }
  }

  /** Starts background checks: shortly after launch, then every few hours. */
  start() {
    if (this.mode === 'source') return;
    if (this.mode === 'auto') this.setupUpdater();
    setTimeout(() => this.check().catch(() => {}), FIRST_CHECK_DELAY);
    this.timer = setInterval(() => this.check().catch(() => {}), CHECK_INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setupUpdater() {
    const { autoUpdater } = require('electron-updater');
    this.updater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: (m) => console.log('[update]', m),
      warn: (m) => console.warn('[update]', m),
      error: (m) => console.error('[update]', m),
      debug: () => {}
    };

    autoUpdater.on('checking-for-update', () => this.setStatus({ state: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => this.setStatus({ state: 'up-to-date', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (info) => this.setStatus({ state: 'downloading', version: info.version, percent: 0, checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.setStatus({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => this.setStatus({ state: 'ready', version: info.version, percent: 100 }));
    autoUpdater.on('error', (error) => this.reportError(error));
  }

  /** Before the first release there is nothing to update to: that's not a failure. */
  reportError(error) {
    const message = error?.message || String(error);
    if (/no published versions|unable to find latest version|latest\.yml.*404|HttpError: 404/i.test(message)) {
      this.setStatus({ state: 'up-to-date', checkedAt: Date.now(), error: null });
    } else {
      this.setStatus({ state: 'error', error: message.split('\n')[0] });
    }
  }

  /** Checks for a new version now. Resolves with the status afterwards. */
  async check() {
    if (this.mode === 'source') {
      this.setStatus({ state: 'unsupported' });
      return this.status;
    }
    // Don't restart a download in progress, or ask again once one is ready.
    if (['checking', 'downloading', 'ready'].includes(this.status.state)) return this.status;

    if (this.mode === 'auto') {
      try {
        await this.updater.checkForUpdates();
      } catch (error) {
        this.reportError(error);
      }
      return this.status;
    }

    // notify: ask GitHub for the latest release and compare versions.
    this.setStatus({ state: 'checking', error: null });
    try {
      const response = await this.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Antler-App' },
        signal: AbortSignal.timeout(15000)
      });
      if (response.status === 404) {
        this.setStatus({ state: 'up-to-date', checkedAt: Date.now() });
        return this.status;
      }
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = await response.json();
      const latest = String(release.tag_name || '').replace(/^v/, '');
      if (latest && compareVersions(latest, this.status.currentVersion) > 0) {
        this.setStatus({ state: 'available', version: latest, releaseUrl: release.html_url || RELEASES_URL, checkedAt: Date.now() });
      } else {
        this.setStatus({ state: 'up-to-date', checkedAt: Date.now() });
      }
    } catch (error) {
      this.setStatus({ state: 'error', error: error.message });
    }
    return this.status;
  }

  /** Restarts into the downloaded update. */
  install() {
    if (this.mode !== 'auto' || this.status.state !== 'ready') return false;
    // isSilent=false shows the installer's progress; isForceRunAfter reopens Antler.
    setImmediate(() => this.updater.quitAndInstall(false, true));
    return true;
  }
}

module.exports = { UpdateService, compareVersions, updateMode, RELEASES_URL };
