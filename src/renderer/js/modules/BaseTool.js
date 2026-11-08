class BaseTool {
  constructor(metadata = {}) {
    if (!metadata.id) {
      throw new Error('BaseTool requires an "id" in metadata');
    }

    this.metadata = {
      version: '1.0.0',
      category: 'General',
      ...metadata
    };

    this.id = this.metadata.id;
    this.name = this.metadata.name || this.id;
    this.icon = this.metadata.icon || 'fas fa-toolbox';
    this.description = this.metadata.description || '';
    this.version = this.metadata.version;
    this.category = this.metadata.category;

    this.root = null;
    this.app = null;
    this.boundEvents = [];
    this.documentEvents = [];
    this.headerActions = [];
  }

  getMetadata() {
    return { ...this.metadata };
  }

  setAppContext(appInstance) {
    this.app = appInstance;
  }

  setRoot(container) {
    this.root = container;
  }

  /**
   * Scoped element lookup helper
   */
  query(selector) {
    if (!selector) return null;
    if (this.root) {
      return this.root.querySelector(selector);
    }
    return document.querySelector(selector);
  }

  /**
   * Cache elements by ID within this tool's root container
   */
  cacheElements(elementIds = []) {
    if (!Array.isArray(elementIds)) return {};

    const cache = {};
    elementIds.forEach((id) => {
      const key = id.replace(/-/g, '_');
      cache[key] = this.root
        ? this.root.querySelector(`#${id}`)
        : document.getElementById(id);
    });

    return cache;
  }

  /**
   * Register DOM event listener that will automatically be cleaned up on destroy
   */
  on(target, eventName, handler, options) {
    if (!target || typeof handler !== 'function') {
      return () => {};
    }

    target.addEventListener(eventName, handler, options);
    const off = () => target.removeEventListener(eventName, handler, options);
    this.boundEvents.push(off);
    return off;
  }

  /**
   * Register document-level listeners with cleanup
   */
  onDocument(eventName, handler, options) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    document.addEventListener(eventName, handler, options);
    const off = () => document.removeEventListener(eventName, handler, options);
    this.documentEvents.push(off);
    return off;
  }

  /**
   * Helper for announcing tool-specific status in the global footer
   */
  updateStatus(message, statusType) {
    if (this.app && typeof this.app.updateFooterStatus === 'function') {
      const type = statusType || this.#inferStatusType(message);
      this.app.updateFooterStatus(message, type);
    }
  }

  showToast(message, type = 'info', duration = 4000) {
    if (this.app && typeof this.app.showToast === 'function') {
      this.app.showToast(message, type, duration);
    } else {
      console.log(`Toast [${type}]: ${message}`);
    }
  }

  /**
   * Register buttons for the header action bar
   */
  setHeaderActions(actions = []) {
    this.headerActions = Array.isArray(actions) ? actions : [];
    if (this.app && typeof this.app.setToolActions === 'function') {
      this.app.setToolActions(this.id, this.headerActions);
    }
  }

  clearHeaderActions() {
    this.headerActions = [];
    if (this.app && typeof this.app.setToolActions === 'function') {
      this.app.setToolActions(this.id, []);
    }
  }

  /**
   * Clean up listeners and header state when tool unloads
   */
  destroy() {
    this.boundEvents.forEach((off) => off());
    this.boundEvents = [];

    this.documentEvents.forEach((off) => off());
    this.documentEvents = [];

    this.clearHeaderActions();
    this.root = null;
  }

  #inferStatusType(message = '') {
    const normalized = message.toLowerCase();
    if (/\b(error|fail(ed|ure|s)?)\b/.test(normalized)) {
      return 'error';
    }
    // Only messages about something still in progress count as "working";
    // "Post 123 loaded successfully" is a finished state, not a busy one.
    if (/\b(loading|fetching|searching|downloading|saving|working)\b/.test(normalized)
      || normalized.endsWith('...') || normalized.endsWith('…')) {
      return 'working';
    }
    return 'ready';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseTool;
} else {
  window.BaseTool = BaseTool;
}
