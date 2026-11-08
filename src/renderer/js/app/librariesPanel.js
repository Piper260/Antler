// Settings > Storage: the dataset libraries. Each change saves straight away
// (storage:save-libraries checks every folder in the main process).
// Mixed into AntlerApp (see utils/mixMethods.js).
class AppLibraries {
  async setupLibrariesSection() {
    const section = document.getElementById('libraries-settings');
    if (!section || !window.electronAPI?.storage) return;
    section.querySelector('[data-libraries-add]').onclick = () => this.addLibrary();
    const result = await window.electronAPI.storage.getLibraries();
    if (result?.success) this.renderLibraries(result.libraries, result.defaultId);
    else this.showToast(result?.message || 'Could not read the storage settings', 'error');
  }

  renderLibraries(libraries, defaultId) {
    this.libraries = libraries;
    this.defaultLibraryId = defaultId;
    const list = document.querySelector('#libraries-settings [data-libraries-list]');
    if (!list) return;
    const esc = (value) => {
      const div = document.createElement('div');
      div.textContent = String(value ?? '');
      return div.innerHTML;
    };
    const typeNote = { artist: 'Older folders here count as artists', character: 'Older folders here count as characters' };

    list.innerHTML = `
      <div class="library-list">
        ${libraries.map((lib) => `
          <div class="library-row" data-id="${esc(lib.id)}">
            <label class="library-default" title="New downloads go here">
              <input type="radio" name="default-library" value="${esc(lib.id)}" ${lib.id === defaultId ? 'checked' : ''}>
              <span>${lib.id === defaultId ? 'Default' : 'Use for new'}</span>
            </label>
            <div class="library-main">
              <input type="text" class="form-input library-name" value="${esc(lib.name)}" maxlength="60" aria-label="Library name">
              <span class="library-path${lib.exists ? '' : ' is-missing'}" title="${esc(lib.path)}">${esc(lib.path)}${lib.exists ? '' : ' (not found)'}</span>
              ${lib.type ? `<span class="library-note">${typeNote[lib.type]}</span>` : ''}
            </div>
            <div class="library-actions">
              <button class="btn btn-sm btn-secondary" data-library-open title="Open this folder">Open</button>
              <button class="btn btn-sm btn-secondary" data-library-remove ${libraries.length < 2 ? 'disabled' : ''}
                title="Take it off the list. No files are deleted.">Remove</button>
            </div>
          </div>`).join('')}
      </div>`;

    list.querySelectorAll('.library-row').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('input[type="radio"]').onchange = () => this.saveLibraries(this.libraries, id, 'Default library changed');
      row.querySelector('.library-name').onchange = (event) => {
        const name = event.target.value.trim();
        if (!name) {
          event.target.value = this.libraries.find((lib) => lib.id === id)?.name || '';
          return;
        }
        this.saveLibraries(this.libraries.map((lib) => (lib.id === id ? { ...lib, name } : lib)), this.defaultLibraryId, 'Library renamed');
      };
      row.querySelector('[data-library-open]').onclick = async () => {
        const result = await window.electronAPI.storage.openLibrary(id);
        if (!result?.success) this.showToast(result?.message || 'Could not open the folder', 'error');
      };
      row.querySelector('[data-library-remove]').onclick = () => {
        const rest = this.libraries.filter((lib) => lib.id !== id);
        const nextDefault = id === this.defaultLibraryId ? rest[0].id : this.defaultLibraryId;
        this.saveLibraries(rest, nextDefault, 'Library removed from the list; its files are untouched');
      };
    });
  }

  async addLibrary() {
    const picked = await window.electronAPI.dialog.openDirectory();
    if (!picked?.success || !picked.path) return;
    const folder = picked.path;
    if (this.libraries.some((lib) => lib.path.toLowerCase() === folder.toLowerCase())) {
      this.showToast('That folder is already a library', 'info');
      return;
    }
    const taken = new Set(this.libraries.map((lib) => lib.id));
    let id = `library-${Date.now().toString(36)}`;
    while (taken.has(id)) id += 'x';
    const name = folder.split(/[\\/]/).filter(Boolean).pop() || 'Library';
    await this.saveLibraries([...this.libraries, { id, name, path: folder, type: null }], this.defaultLibraryId, `Added ${name}`);
  }

  async saveLibraries(libraries, defaultId, message) {
    const result = await window.electronAPI.storage.saveLibraries(libraries, defaultId);
    if (!result?.success) {
      this.showToast(result?.message || 'Could not save the storage settings', 'error');
      // Put the list back as it was saved.
      const current = await window.electronAPI.storage.getLibraries();
      if (current?.success) this.renderLibraries(current.libraries, current.defaultId);
      return;
    }
    const current = await window.electronAPI.storage.getLibraries();
    if (current?.success) this.renderLibraries(current.libraries, current.defaultId);
    if (message) this.showToast(message, 'success', 2500);
  }
}
