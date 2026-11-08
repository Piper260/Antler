// App updates: a notice when a new version is ready (or, on macOS, out), and
// the About page's "Check for updates". The work happens in the main process
// (services/UpdateService.js); this only shows its status.
// Mixed into AntlerApp (see utils/mixMethods.js).
class AppUpdates {
  /** Called once at startup: show the notice whenever the status calls for it. */
  async setupUpdates() {
    const api = window.electronAPI?.update;
    if (!api?.onStatus) return;
    this.updateDismissed = null; // version the user said "Later" to this session
    api.onStatus((status) => this.renderUpdateNotice(status));
    const result = await api.getStatus();
    if (result?.success) this.renderUpdateNotice(result.status);
  }

  /** The About page button. Says what happened, whatever the outcome. */
  async checkForUpdates() {
    const api = window.electronAPI?.update;
    if (!api) return;
    this.updateDismissed = null;
    this.showToast('Checking for updates...', 'info', 2000);
    const result = await api.checkForUpdates();
    const status = result?.status || {};
    if (!result?.success) {
      this.showToast(result?.message || 'Could not check for updates', 'error');
    } else if (status.state === 'unsupported') {
      this.showToast('Running from source: update with git pull', 'info', 6000);
    } else if (status.state === 'up-to-date') {
      this.showToast(`You have the latest version (${status.currentVersion})`, 'success');
    } else if (status.state === 'downloading') {
      this.showToast(`Downloading Antler ${status.version} in the background`, 'info');
    } else if (status.state === 'error') {
      this.showToast(`Update check failed: ${status.error}`, 'error', 8000);
    }
    // 'ready' and 'available' show the notice through renderUpdateNotice.
  }

  /** One persistent notice in the toast corner, replaced as the status changes. */
  renderUpdateNotice(status) {
    let notice = document.getElementById('update-notice');
    const show = (status.state === 'ready' || status.state === 'available') && this.updateDismissed !== status.version;
    if (!show) {
      notice?.remove();
      return;
    }

    const ready = status.state === 'ready';
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'update-notice';
      notice.className = 'toast toast-info update-toast';
      this.toastContainer?.appendChild(notice);
    }
    const version = this.escapeUpdateText(status.version);
    notice.innerHTML = `
      <div class="toast-message">
        <div class="toast-title">${ready ? `Antler ${version} is ready` : `Antler ${version} is available`}</div>
        <div class="toast-desc">${ready
          ? 'Restart to update now, or it installs the next time you quit.'
          : `You have ${this.escapeUpdateText(status.currentVersion)}. Download the new version from GitHub.`}</div>
      </div>
      <div class="toast-actions">
        <button class="btn btn-sm btn-secondary" data-update-later>Later</button>
        <button class="btn btn-sm btn-primary" data-update-go>${ready ? 'Restart now' : 'Download'}</button>
      </div>`;

    notice.querySelector('[data-update-later]').onclick = () => {
      this.updateDismissed = status.version;
      notice.remove();
    };
    notice.querySelector('[data-update-go]').onclick = async () => {
      if (ready) {
        const result = await window.electronAPI.update.install();
        if (!result?.success) this.showToast('Could not start the update; it installs when you quit', 'warning');
      } else {
        await window.electronAPI.update.openRelease();
      }
    };
    requestAnimationFrame(() => notice.classList.add('show'));
  }

  escapeUpdateText(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }
}
