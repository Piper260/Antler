// src/renderer/js/app.js - Main application controller
class AntlerApp {
  constructor() {
    this.isInitialized = false;
    this.currentPage = 'welcome';
    this.modules = new Map();
    this.tools = new Map(); // ADD THIS LINE
    this.currentTool = null; // ADD THIS LINE
    this.toolActionsContainer = null;
    this.currentToolActionHandlers = [];
    // Containers of tools that keep running while another tool is shown
    // (tools with `keepAlive = true`), by tool id.
    this.toolContainers = new Map();
    // Long jobs shown in the sidebar's Processes section, by process id.
    this.processes = new Map();
    this.nextProcessId = 1;
    
    console.log('🚀 Initializing Antler');
  }

  /**
 * Add these methods to your AntlerApp class
 */

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      console.log('📋 Setting up application...');

      this.setupErrorHandlers();
      this.applySavedTheme().catch(error => console.error('Theme load failed:', error));
      this.setupTitleBar();
      this.setupSidebar();
      this.setupModals();
      this.setupToasts();
      this.setupGlobalFooter();

      await this.loadTools(); // ADD THIS LINE

      await this.loadAppInfo();
      
      // Load the welcome page content
      this.navigateToPage('welcome');

      this.isInitialized = true;
      console.log('✅ Application initialized successfully');

      // Offer the models to a new user; failures here never block the app.
      this.setupModels().catch(error => console.error('Model check failed:', error));
      this.setupUpdates().catch(error => console.error('Update setup failed:', error));

    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      this.showError('Failed to initialize application', error);
    }
  }

  /**
   * Set up global error handlers
   */
  setupErrorHandlers() {
    console.log('🛡️ Setting up error handlers...');

    // Set up global error handlers
    if (window.errorHandler) {
      window.errorHandler.setupGlobalHandlers();
    }

    // Handle uncaught errors
    window.addEventListener('error', (event) => {
      console.error('Global error:', event.error);
      this.showError('An unexpected error occurred', event.error);
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      this.showError('An unexpected error occurred', event.reason);
    });
  }

  async loadTools() {
    console.log('🔧 Loading available tools...');
    
    try {
      // Import tool classes
      // In a production app, this would be dynamically loaded
      const PostLookupTool = window.PostLookupTool;
      const ArtistSearchTool = window.ArtistSearchTool;
      const TagEditorTool = window.TagEditorTool;
      const ImageResizerTool  = window.ImageResizerTool;
      const ImageUpscalerTool = window.ImageUpscalerTool;
      
      if (PostLookupTool) {
        const postLookupTool = new PostLookupTool();
        this.tools.set(postLookupTool.id, postLookupTool);
        console.log(`✅ Loaded tool: ${postLookupTool.name}`);
      }

      // Import the ArtistSearchTool class
      if (ArtistSearchTool) {
        const artistSearchTool = new ArtistSearchTool();
        this.tools.set(artistSearchTool.id, artistSearchTool);
        console.log(`✅ Loaded tool: ${artistSearchTool.name}`);
      }

      // Import the TagEditorTool class
      if (TagEditorTool) {
        const tagEditorTool = new TagEditorTool();
        this.tools.set(tagEditorTool.id, tagEditorTool);
        console.log(`✅ Loaded tool: ${tagEditorTool.name}`);
      }

      // Import the ImageResizerTool class
      if (ImageResizerTool) {
        const imageResizerTool = new ImageResizerTool();
        this.tools.set(imageResizerTool.id, imageResizerTool);
        console.log(`✅ Loaded tool: ${imageResizerTool.name}`);
      }

      // Import the ImageUpscalerTool class
      if (ImageUpscalerTool) {
        const imageUpscalerTool = new ImageUpscalerTool();
        this.tools.set(imageUpscalerTool.id, imageUpscalerTool);
        console.log(`✅ Loaded tool: ${imageUpscalerTool.name}`);
      }

      // Comic Panels Tool
      const ComicPanelTool = window.ComicPanelTool;
      if (ComicPanelTool) {
        const comicPanelTool = new ComicPanelTool();
        this.tools.set(comicPanelTool.id, comicPanelTool);
        console.log(`✅ Loaded tool: ${comicPanelTool.name}`);
      }

      // Video Frames Tool
      const VideoFrameTool = window.VideoFrameTool;
      if (VideoFrameTool) {
        const videoFrameTool = new VideoFrameTool();
        this.tools.set(videoFrameTool.id, videoFrameTool);
        console.log(`✅ Loaded tool: ${videoFrameTool.name}`);
      }

      // Image Cleanup Tool
      const ImageCleanupTool = window.ImageCleanupTool;
      if (ImageCleanupTool) {
        const imageCleanupTool = new ImageCleanupTool();
        this.tools.set(imageCleanupTool.id, imageCleanupTool);
        console.log(`✅ Loaded tool: ${imageCleanupTool.name}`);
      }

      // Image Organizer Tool
      const ImageOrganizerTool = window.ImageOrganizerTool;
      if (ImageOrganizerTool) {
        const imageOrganizerTool = new ImageOrganizerTool();
        this.tools.set(imageOrganizerTool.id, imageOrganizerTool);
        console.log(`✅ Loaded tool: ${imageOrganizerTool.name}`);
      }

      // Add more tools here as they're developed
      
      // Update navigation with loaded tools
      this.updateToolsNavigation();
      
    } catch (error) {
      console.error('❌ Error loading tools:', error);
    }
  }

  updateToolsNavigation() {
    const toolsNav = document.getElementById('tools-nav');
    if (!toolsNav) return;
    
    toolsNav.innerHTML = '';
    
    // Add loaded tools first
    for (const [toolId, tool] of this.tools) {
      const toolMetadata = tool.getMetadata();
      
      const navItem = document.createElement('li');
      navItem.className = 'nav-item';
      navItem.id = `${toolId}-nav`;
      navItem.innerHTML = `
        <i class="${toolMetadata.icon} nav-icon"></i>
        <span class="nav-text">${toolMetadata.name}</span>
      `;
      
      navItem.addEventListener('click', () => {
        this.loadTool(toolId);
      });
      
      toolsNav.appendChild(navItem);
    }
    
    console.log(`📋 Updated navigation with ${this.tools.size} active tools`);
  }

  getToolActionsContainer() {
    if (!this.toolActionsContainer) {
      this.toolActionsContainer = document.querySelector('.content-actions');
    }
    return this.toolActionsContainer;
  }

  clearToolActionHandlers() {
    if (!this.currentToolActionHandlers.length) return;
    this.currentToolActionHandlers.forEach((off) => {
      try {
        off();
      } catch (error) {
        console.warn('⚠️ Failed to remove tool action listener:', error);
      }
    });
    this.currentToolActionHandlers = [];
  }

  setToolActions(toolId, actions = [], options = {}) {
    const container = this.getToolActionsContainer();
    if (!container) return;

    const force = options.force === true;
    if (!force && this.currentTool && this.currentTool.id !== toolId) {
      return;
    }

    this.clearToolActionHandlers();
    container.innerHTML = '';

    if (!Array.isArray(actions) || actions.length === 0) {
      return;
    }

    actions.forEach((action) => {
      if (!action || !action.label) return;

      const button = document.createElement('button');
      const variant = action.variant ? `btn-${action.variant}` : 'btn-secondary';
      button.className = `btn ${variant}`;
      button.disabled = !!action.disabled;
      if (action.id) {
        button.id = action.id;
      }

      const iconHtml = action.icon ? `<i class="${action.icon}"></i> ` : '';
      button.innerHTML = `${iconHtml}${action.label}`.trim();

      if (typeof action.onClick === 'function') {
        const handler = action.onClick;
        button.addEventListener('click', handler);
        this.currentToolActionHandlers.push(() => button.removeEventListener('click', handler));
      }

      container.appendChild(button);
    });
  }

  clearToolActions(force = true) {
    const targetId = this.currentTool ? this.currentTool.id : null;
    this.setToolActions(targetId, [], { force });
  }

  async loadTool(toolId) {
  console.log(`🔧 Loading tool: ${toolId}`);
  
  const tool = this.tools.get(toolId);
  if (!tool) {
    console.error(`❌ Tool not found: ${toolId}`);
    return;
  }
  
  try {
    // Update navigation state
    this.updateActiveNavigation(`${toolId}-nav`);
    
    // Update page title
    const toolMetadata = tool.getMetadata();
    this.updatePageTitle(toolMetadata.name);
    
    const previousTool = this.currentTool;
    this.currentTool = tool;

    // Load tool content
    await this.loadToolContent(tool, previousTool);
    
    this.currentPage = toolId;
    
  } catch (error) {
    console.error(`❌ Error loading tool ${toolId}:`, error);
    this.showError(`Failed to load ${tool.getMetadata().name}`, error);
  }
}

  /**
   * Put away whatever the content area shows before something else is
   * shown. A keep-alive tool's container is only hidden, so its work and
   * screen carry on in the background; any other tool is destroyed, and
   * everything that is not a kept container is removed.
   */
  leaveCurrentContent(previousTool) {
    const contentBody = document.getElementById('content-body');
    if (!contentBody) return;

    this.clearToolActions();
    if (previousTool && !previousTool.keepAlive && typeof previousTool.destroy === 'function') {
      try {
        previousTool.destroy();
      } catch (destroyError) {
        console.warn('⚠️ Error while destroying previous tool:', destroyError);
      }
    }

    const kept = new Set(this.toolContainers.values());
    Array.from(contentBody.children).forEach(child => {
      if (kept.has(child)) child.style.display = 'none';
      else child.remove();
    });
    if (previousTool?.keepAlive && typeof previousTool.onHide === 'function') {
      previousTool.onHide();
    }

    // The status bardescribes the current tool, so the previous tool's last
    // message must not linger after switching.
    this.updateFooterStatus('Ready', 'ready');
  }

  async loadToolContent(tool, previousTool = null) {
    const contentBody = document.getElementById('content-body');
    if (!contentBody) return;

    this.leaveCurrentContent(previousTool);

    const existing = this.toolContainers.get(tool.id);
    if (existing) {
      existing.style.display = '';
      if (typeof tool.onShow === 'function') tool.onShow();
      return;
    }

    const toolContainer = document.createElement('div');
    toolContainer.className = 'tool-content-container';
    toolContainer.dataset.tool = tool.id;
    contentBody.appendChild(toolContainer);
    if (tool.keepAlive) this.toolContainers.set(tool.id, toolContainer);

    if (typeof tool.setAppContext === 'function') {
      tool.setAppContext(this);
    }

    // Initialize the tool
    await tool.initialize(toolContainer);
  }

  /**
   * Register a long-running job in the sidebar's Processes section.
   * @param {{toolId: string, label: string, total?: number}} info
   * @returns {{update: Function, finish: Function}} call update({done, current, detail})
   *   as work progresses (`current` is 0..1 progress within the item being
   *   worked on), and finish({message, failed, warning}) once at the end:
   *   `failed` when nothing succeeded, `warning` when only some items did.
   *   update({waiting: reason, onRunNow}) shows the job as held back, with a
   *   "Run now" link calling onRunNow; update({waiting: ''}) clears it.
   */
  startProcess({ toolId, label, total = 0 }) {
    const id = this.nextProcessId++;
    const process = { id, toolId, label, total, done: 0, current: 0, detail: '', state: 'running', message: '', waiting: '', onRunNow: null };
    this.processes.set(id, process);
    this.renderProcesses();

    return {
      update: ({ done, current, detail, waiting, onRunNow } = {}) => {
        if (process.state !== 'running') return;
        if (Number.isFinite(done)) process.done = done;
        if (Number.isFinite(current)) process.current = Math.min(1, Math.max(0, current));
        if (typeof detail === 'string') process.detail = detail;
        if (typeof waiting === 'string') {
          process.waiting = waiting;
          process.onRunNow = waiting ? (onRunNow || null) : null;
        }
        this.renderProcesses();
      },
      finish: ({ message = '', failed = false, warning = false } = {}) => {
        if (process.state !== 'running') return;
        process.state = failed ? 'failed' : warning ? 'warning' : 'done';
        process.message = message;
        process.done = process.total;
        process.current = 0;
        this.renderProcesses();
        // Finished rows stay briefly so the result can be read, then go.
        setTimeout(() => {
          this.processes.delete(id);
          this.renderProcesses();
        }, 8000);
      }
    };
  }

  renderProcesses() {
    const list = document.getElementById('processes-nav');
    if (!list) return;
    if (!list.dataset.bound) {
      list.dataset.bound = '1';
      list.addEventListener('click', (event) => {
        const runNow = event.target.closest('.process-run-now');
        if (runNow) {
          this.processes.get(Number(runNow.dataset.process))?.onRunNow?.();
          return;
        }
        const item = event.target.closest('.process-item');
        if (item && this.tools.has(item.dataset.tool)) this.loadTool(item.dataset.tool);
      });
    }

    if (this.processes.size === 0) {
      list.innerHTML = '<li class="process-empty">Nothing running</li>';
      return;
    }

    const escape = (text) => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    list.innerHTML = Array.from(this.processes.values()).map(process => {
      const tool = this.tools.get(process.toolId);
      const toolName = tool ? tool.getMetadata().name : '';
      const fraction = process.total > 0 ? Math.min(1, (process.done + process.current) / process.total) : 0;
      const count = process.state === 'running'
        ? (process.total > 0 ? `${process.done} of ${process.total}` : '')
        : (process.message || (process.state === 'failed' ? 'Failed' : 'Done'));
      if (process.state === 'running' && process.waiting) {
        return `
        <li class="process-item process-waiting" data-tool="${escape(process.toolId)}" title="${escape(`${process.label} · waiting: ${process.waiting}`)}">
          <div class="process-label">${escape(process.label)}</div>
          <div class="process-bar"><div class="process-bar-fill" style="width:${fraction * 100}%"></div></div>
          <div class="process-row">
            <span class="process-detail">Waiting: ${escape(process.waiting)}</span>
            ${process.onRunNow ? `<button class="process-run-now" data-process="${process.id}">Run now</button>` : ''}
          </div>
        </li>
      `;
      }
      return `
        <li class="process-item process-${process.state}" data-tool="${escape(process.toolId)}" title="${escape([process.label, toolName, process.detail].filter(Boolean).join(' · '))}">
          <div class="process-label">${escape(process.label)}</div>
          <div class="process-bar"><div class="process-bar-fill" style="width:${(process.state === 'running' ? fraction : 1) * 100}%"></div></div>
          <div class="process-row">
            <span class="process-detail">${escape(toolName)}</span>
            <span class="process-count">${escape(count)}</span>
          </div>
        </li>
      `;
    }).join('');
  }

  /**
   * Set up title bar functionality
   */
  setupTitleBar() {
    console.log('🪟 Setting up title bar...');

    // Window control buttons
    const closeBtn = document.getElementById('close-btn');
    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const devToolsBtn = document.getElementById('dev-tools-btn');

    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        console.log('🔴 Close button clicked');
        window.electronAPI.app.close();
      });
    }

    // Minimize button
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        console.log('⬇️ Minimize button clicked');
        window.electronAPI.app.minimize();
      });
    }

    // Maximize/Restore button
    if (maximizeBtn) {
      maximizeBtn.addEventListener('click', () => {
        console.log('⬆️ Maximize/Restore button clicked');
        window.electronAPI.app.maximizeRestore();
      });
    }

    // Show dev tools button in development
    if (window.devAPI && devToolsBtn) {
      devToolsBtn.style.display = 'block';
      devToolsBtn.addEventListener('click', () => {
        console.log('🔧 Dev tools requested');
        // Dev tools are handled by main process
      });
    }

    // Window state listeners
    if (window.electronAPI.window) {
      window.electronAPI.window.onMaximized(() => {
        console.log('📏 Window maximized');
        this.updateMaximizeButton(true);
      });

      window.electronAPI.window.onRestored(() => {
        console.log('📐 Window restored');
        this.updateMaximizeButton(false);
      });
    }
  }

  /**
   * Update maximize button appearance
   */
  updateMaximizeButton(isMaximized) {
    const maximizeBtn = document.getElementById('maximize-btn');
    if (maximizeBtn) {
      const icon = maximizeBtn.querySelector('i');
      if (icon) {
        icon.className = isMaximized ? 'fas fa-window-restore' : 'fas fa-window-maximize';
      }
      maximizeBtn.title = isMaximized ? 'Restore' : 'Maximize';
    }
  }

  /**
   * Set up sidebar functionality
   */
  setupSidebar() {
    console.log('📱 Setting up sidebar...');

    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');

    // Sidebar toggle
    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        console.log('📱 Sidebar toggled');
      });
    }

    // Navigation items
    const settingsNav = document.getElementById('settings-nav');
    const aboutNav = document.getElementById('about-nav');

    if (settingsNav) {
      settingsNav.addEventListener('click', () => {
        this.navigateToPage('settings');
      });
    }

    if (aboutNav) {
      aboutNav.addEventListener('click', () => {
        this.navigateToPage('about');
      });
    }
  }

  /**
   * Set up modal functionality
   */
  setupModals() {
    console.log('📋 Setting up modals...');

    const errorModal = document.getElementById('error-modal');
    const errorModalClose = document.getElementById('error-modal-close');
    const errorCloseBtn = document.getElementById('error-close-btn');
    const errorRetryBtn = document.getElementById('error-retry-btn');

    // Close modal handlers
    [errorModalClose, errorCloseBtn].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          this.hideModal('error-modal');
        });
      }
    });

    // Click outside to close
    if (errorModal) {
      errorModal.addEventListener('click', (e) => {
        if (e.target === errorModal) {
          this.hideModal('error-modal');
        }
      });
    }

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideAllModals();
      }
      
      // Ctrl+Shift+P to toggle performance monitor
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        if (window.performanceMonitor) {
          window.togglePerformanceMonitor();
        }
      }
    });
  }

  /**
   * Set up toast notifications
   */
  setupToasts() {
    console.log('🍞 Setting up toast notifications...');
    
    // Create or get existing toast container
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
    
    this.toastContainer = toastContainer;
  }

  /**
   * Set up global footer
   */
  setupGlobalFooter() {
    console.log('🦶 Setting up global footer...');
    
    // Cache footer elements
    this.footerElements = {
      statusIndicator: document.getElementById('global-status-indicator'),
      statusText: document.getElementById('global-status-text'),
      statusNote: document.getElementById('global-status-note'),
      cacheInfo: document.getElementById('footer-cache-info'),
      apiStatus: document.getElementById('footer-api-status'),
      downloads: document.getElementById('footer-downloads'),
      version: document.getElementById('footer-version')
    };

    // Initialize footer
    this.updateFooterVersion();
    this.updateFooterStatus('Ready', 'ready');
    
    // Clear any existing interval
    if (this.footerUpdateInterval) {
      clearInterval(this.footerUpdateInterval);
    }
    
    // Update footer data periodically (every 30 seconds instead of 5)
    this.footerUpdateInterval = setInterval(() => {
      this.updateFooterData();
    }, 30000);

    // Initial update
    this.updateFooterData();
  }

  /**
   * Update footer version
   */
  async updateFooterVersion() {
    try {
      const appInfo = await window.electronAPI.app.getInfo();
      if (this.footerElements.version) {
        if (appInfo.displayVersion) {
          this.footerElements.version.textContent = appInfo.displayVersion;
          // Add tooltip with full info
          const tooltip = `Branch: ${appInfo.branch || 'unknown'}\nCommit: ${appInfo.commit || 'unknown'}\nBuild: ${new Date(appInfo.buildDate).toLocaleString()}`;
          this.footerElements.version.title = tooltip;
        } else {
          this.footerElements.version.textContent = 'unknown';
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not load version for footer:', error);
    }
  }

  /**
   * Update footer status
   */
  updateFooterStatus(text, status = 'ready') {
    if (this.footerElements.statusText) {
      this.footerElements.statusText.textContent = text;
    }
    
    if (this.footerElements.statusIndicator) {
      this.footerElements.statusIndicator.className = 'fas fa-circle status-indicator';
      if (status === 'ready') {
        this.footerElements.statusIndicator.classList.add('status-ready');
      } else if (status === 'working') {
        this.footerElements.statusIndicator.classList.add('status-working');
      } else if (status === 'error') {
        this.footerElements.statusIndicator.classList.add('status-error');
      }
    }
  }

  /**
   * Update footer data
   */
  async updateFooterData() {
    try {
      // Update API status
      if (this.footerElements.apiStatus) {
        try {
          const result = await window.electronAPI.settings.e621.getCredentials();
          if (result && result.success && result.credentials) {
            const { username, apiKey } = result.credentials;
            if (username && apiKey) {
              this.footerElements.apiStatus.innerHTML = '<i class="fas fa-server"></i> API: Configured';
            } else {
              this.footerElements.apiStatus.innerHTML = '<i class="fas fa-server"></i> API: Not Configured';
            }
          } else {
            this.footerElements.apiStatus.innerHTML = '<i class="fas fa-server"></i> API: Not Configured';
          }
        } catch (error) {
          console.warn('⚠️ Could not get credentials:', error);
          this.footerElements.apiStatus.innerHTML = '<i class="fas fa-server"></i> API: Unknown';
        }
      }

      // Update downloads count
      if (this.footerElements.downloads) {
        try {
          const stats = await window.electronAPI.utils.getDownloadStats();
          if (stats && stats.success !== false) {
            this.footerElements.downloads.innerHTML = `<i class="fas fa-download"></i> Downloads: ${stats.totalFiles || 0}`;
          } else {
            this.footerElements.downloads.innerHTML = '<i class="fas fa-download"></i> Downloads: 0';
          }
        } catch (error) {
          console.warn('⚠️ Could not get download stats:', error);
          this.footerElements.downloads.innerHTML = '<i class="fas fa-download"></i> Downloads: 0';
        }
      }

      // Update cache info (this could be enhanced based on your cache implementation)
      if (this.footerElements.cacheInfo) {
        // For now, just show a static value - you can enhance this later
        this.footerElements.cacheInfo.innerHTML = '<i class="fas fa-database"></i> Cache: Ready';
      }
    } catch (error) {
      console.warn('⚠️ Error updating footer data:', error);
    }
  }

  /**
   * Load application information
   */
  async loadAppInfo() {
  console.log('ℹ️ Loading app information...');

  try {
    // Load version info
    if (window.versions) {
      const platformEl = document.getElementById('app-platform');
      if (platformEl) {
        platformEl.textContent = `${window.versions.platform} (${window.versions.arch})`;
      }
      
      // Also update About page if it's currently loaded
      const aboutPlatformEl = document.getElementById('platform-info');
      if (aboutPlatformEl) {
        aboutPlatformEl.textContent = this.capitalize(window.versions.platform);
      }
    }

    // Load app info from main process
    if (window.electronAPI.app.getInfo) {
      const appInfo = await window.electronAPI.app.getInfo();
      
      const versionEl = document.getElementById('app-version');
      if (versionEl && appInfo.version) {
        versionEl.textContent = appInfo.version;
      }
      
      // Also update About page version if it's currently loaded
      const aboutVersionEls = document.querySelectorAll('#about-version, #app-version-detail');
      aboutVersionEls.forEach(el => {
        if (el && appInfo.version) {
          el.textContent = appInfo.version;
        }
      });

      console.log('📊 App info loaded:', appInfo);
    }

  } catch (error) {
    console.error('❌ Failed to load app info:', error);
  }
}

  /**
   * Navigate to a specific page
   */
  navigateToPage(pageName) {
    console.log(`🧭 Navigating to page: ${pageName}`);

    // ADD THESE LINES AT THE BEGINNING:
    if (this.tools.has(pageName)) {
      this.loadTool(pageName);
      return;
    }

    // Keep your existing code below:
    this.leaveCurrentContent(this.currentTool);
    this.currentTool = null;
    this.updateActiveNavigation(pageName);
    this.updatePageTitle(pageName);
    this.loadPageContent(pageName);
    this.currentPage = pageName;
  }

  /**
   * Update active navigation item
   */
  updateActiveNavigation(pageName) {
    // Remove active class from all nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });

    // Add active class to current page/tool nav item
    let navItem;
    
    // Check if it's a tool navigation ID (ends with -nav)
    if (pageName.endsWith('-nav')) {
      navItem = document.getElementById(pageName);
    } else {
      navItem = document.getElementById(`${pageName}-nav`);
    }
    
    if (navItem) {
      navItem.classList.add('active');
    }
  }

  /**
   * Update page title in header
   */
  updatePageTitle(pageName) {
    const titleElement = document.getElementById('current-page-title');
    if (titleElement) {
      const titles = {
        welcome: 'Welcome',
        settings: 'Settings',
        about: 'About'
      };
      titleElement.textContent = titles[pageName] || pageName;
    }
  }

  /**
   * Load page content
   */
  loadPageContent(pageName) {
  const contentBody = document.getElementById('content-body');
  if (!contentBody) return;

  // Clear existing content, keeping hidden keep-alive tools
  const kept = new Set(this.toolContainers.values());
  Array.from(contentBody.children).forEach(child => {
    if (!kept.has(child)) child.remove();
  });

  // Create fresh container
  const pageContainer = document.createElement('div');
  pageContainer.className = 'page-content-container';
  
  // Add content to container
  const pages = {
    welcome: this.getWelcomePage(),
    settings: this.getSettingsPage(),
    about: this.getAboutPage()
  };

  pageContainer.innerHTML = pages[pageName] || pages.welcome;
  contentBody.appendChild(pageContainer);
  
  // Setup page-specific functionality
  if (pageName === 'settings') {
    this.setupSettingsPage();
  } else if (pageName === 'about') {
    this.setupAboutPage();
  } else if (pageName === 'welcome') {
    this.setupWelcomePage();
  }
}

  animateElements(selector, delay = 100) {
    const elements = document.querySelectorAll(selector);
    elements.forEach((element, index) => {
      setTimeout(() => {
        element.classList.add('fade-in-up');
      }, index * delay);
    });
  }

  /**
   * Show error modal
   */
  showError(message, error = null) {
    console.error('🚨 Showing error:', message, error);

    const errorModal = document.getElementById('error-modal');
    const errorMessage = document.getElementById('error-message');
    const errorDetails = document.getElementById('error-details');
    const errorStack = document.getElementById('error-stack');

    if (errorMessage) {
      errorMessage.textContent = message;
    }

    if (error && errorDetails && errorStack) {
      errorDetails.style.display = 'block';
      errorStack.textContent = error.stack || error.toString();
    }

    this.showModal('error-modal');
  }

  /**
   * Show modal by ID
   */
  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
      // Use setTimeout for smooth animation
      setTimeout(() => {
        modal.classList.add('show');
      }, 10);
    }
  }

  /**
   * Hide modal by ID
   */
  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    }
  }

  /**
   * Hide all modals
   */
  hideAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    });
  }

  /**
   * Tells the user something. Routine news (info, success) is a note in the
   * status bar, where it doesn't cover the page; warnings and errors are a
   * small card in the corner, since those shouldn't be missed. Repeats of the
   * same card merge, at most two cards show, and a card closes on click and
   * stays while the mouse is over it.
   */
  showToast(message, type = 'info', duration = 4000) {
    const text = String(message ?? '');
    if (type === 'info' || type === 'success') {
      this.showStatusNote(text, type, duration);
      return;
    }
    this.showToastCard(text, type, duration);
  }

  /** A note in the status bar's message slot, then back to the bar's own status. */
  showStatusNote(text, type, duration) {
    const note = this.footerElements?.statusNote;
    const status = this.footerElements?.statusText;
    if (!note || !status) {
      this.showToastCard(text, type, duration);
      return;
    }
    // Long enough to read: about 15 characters a second, 3 to 8 seconds.
    const shown = Math.min(8000, Math.max(3000, duration, text.length * 65));
    note.textContent = text.replace(/<[^>]*>/g, '');
    note.title = note.textContent;
    note.className = `status-note status-note-${type}`;
    note.hidden = false;
    status.hidden = true;
    clearTimeout(this.statusNoteTimer);
    this.statusNoteTimer = setTimeout(() => {
      note.hidden = true;
      status.hidden = false;
    }, shown);
  }

  showToastCard(text, type, duration) {
    const container = this.toastContainer;
    if (!container) return;
    const shown = Math.max(type === 'error' ? 7000 : 5000, duration);
    const plain = text.replace(/<[^>]*>/g, '');

    // The same message again: keep the one card and restart its clock.
    let toast = [...container.querySelectorAll('.toast:not(.update-toast)')].find(t => t.dataset.message === plain);
    if (!toast) {
      toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.dataset.message = plain;
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
      toast.title = 'Click to close';
      toast.innerHTML = `<div class="toast-content"><i class="fas ${this.getToastIcon(type)}"></i><span></span></div>`;
      toast.querySelector('span').textContent = plain;
      toast.addEventListener('click', () => this.closeToast(toast));
      toast.addEventListener('mouseenter', () => clearTimeout(toast.closeTimer));
      toast.addEventListener('mouseleave', () => this.scheduleToastClose(toast, 2500));
      container.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
      // At most two cards: the oldest goes, errors last.
      const cards = [...container.querySelectorAll('.toast:not(.update-toast):not(.closing)')];
      const order = [...cards.filter(card => !card.classList.contains('toast-error')), ...cards.filter(card => card.classList.contains('toast-error'))]
        .filter(card => card !== toast);
      order.slice(0, Math.max(0, cards.length - 2)).forEach(card => this.closeToast(card));
    }
    this.scheduleToastClose(toast, shown);
  }

  scheduleToastClose(toast, delay) {
    clearTimeout(toast.closeTimer);
    toast.closeTimer = setTimeout(() => this.closeToast(toast), delay);
  }

  closeToast(toast) {
    clearTimeout(toast.closeTimer);
    toast.classList.add('closing');
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }

  /**
   * Get appropriate icon for toast type
   */
  getToastIcon(type) {
    const icons = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle'
    };
    return icons[type] || icons.info;
  }
}

// The page methods live in js/app/ (loaded before this file).
mixMethods(AntlerApp, AppPageTemplates, AppInfoPages, AppSettingsPage, AppModels, AppUpdates, AppLibraries);

/**
 * Initialize the application when DOM is ready
 */
let app;

document.addEventListener('DOMContentLoaded', () => {
  console.log('📄 DOM Content Loaded');
  
  app = new AntlerApp();
  // Several tools reach the shell through window.app (toasts, status bar);
  // a top-level `let` alone does not create that property.
  window.app = app;
  app.initialize().catch(error => {
    console.error('💥 Failed to initialize app:', error);
  });
});