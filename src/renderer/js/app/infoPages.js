// The Welcome and About pages: version, commit history and system information.
// Mixed into AntlerApp (see utils/mixMethods.js).
class AppInfoPages {
  /**
   * Setup welcome page with dynamic data
   */
  async setupWelcomePage() {
    console.log('🏠 Setting up welcome page...');

    try {
      // Load app version and build info
      await this.loadWelcomeVersion();
      
      // Load commit history
      await this.loadCommitHistory();
      
      console.log('✅ Welcome page setup complete');
    } catch (error) {
      console.error('❌ Error setting up welcome page:', error);
    }
  }

  /**
   * Load version information for welcome page
   */
  async loadWelcomeVersion() {
    try {
      const appInfo = await window.electronAPI.app.getInfo();
      
      // Update version badge with just commit hash
      const versionBadge = document.getElementById('app-version-badge');
      if (versionBadge) {
        if (appInfo.displayVersion) {
          versionBadge.textContent = appInfo.displayVersion;
          if (appInfo.dirty) {
            versionBadge.title = 'Uncommitted changes present (*)';
          } else {
            versionBadge.title = `Commit: ${appInfo.commit}`;
          }
        } else {
          versionBadge.textContent = 'unknown';
        }
      }
      
      // Update build info with branch
      const buildInfo = document.getElementById('app-build-info');
      if (buildInfo) {
        if (appInfo.branch && appInfo.branch !== 'unknown') {
          buildInfo.textContent = appInfo.branch;
        } else {
          const platform = appInfo.platform || 'Unknown';
          const arch = appInfo.arch || 'Unknown';
          buildInfo.textContent = `${platform}-${arch}`;
        }
      }

      // Load commit history
      await this.loadCommitHistory();
    } catch (error) {
      console.warn('⚠️ Could not load version info:', error);
    }
  }

  /**
   * Load Git commit history for changelog
   */
  async loadCommitHistory() {
    try {
      // Load ALL commits (999 should get everything)
      const result = await window.electronAPI.app.getCommitHistory(999);
      
      if (result && result.success && result.commits && result.commits.length > 0) {
        const changelogList = document.getElementById('changelog-list');
        const commitCountEl = document.getElementById('commit-count');
        
        if (commitCountEl) {
          commitCountEl.textContent = `${result.commits.length} commits`;
        }
        
        if (changelogList) {
          // Clear existing changelog
          changelogList.innerHTML = '';
          
          // Add commits
          result.commits.forEach(commit => {
            const changelogItem = document.createElement('div');
            changelogItem.className = 'changelog-item';
            if (commit.isCurrent) {
              changelogItem.classList.add('changelog-current');
            }
            
            // Make commit clickable to open in GitHub
            changelogItem.style.cursor = 'pointer';
            changelogItem.title = 'Click to open in GitHub';
            changelogItem.addEventListener('click', () => {
              const githubUrl = `https://github.com/Piper260/Antler/commit/${commit.hash}`;
              window.electronAPI.utils.openExternal(githubUrl);
            });
            
            // Determine badge type based on commit message
            let badgeClass = 'changelog-improved';
            let badgeText = 'COMMIT';
            
            if (commit.message.match(/^(feat|feature):/i)) {
              badgeClass = 'changelog-new';
              badgeText = 'NEW';
            } else if (commit.message.match(/^(fix|bugfix):/i)) {
              badgeClass = 'changelog-fixed';
              badgeText = 'FIX';
            } else if (commit.message.match(/^(improve|enhancement|refactor):/i)) {
              badgeClass = 'changelog-improved';
              badgeText = 'IMPROVED';
            } else if (commit.message.match(/^(docs|doc):/i)) {
              badgeClass = 'changelog-docs';
              badgeText = 'DOCS';
            }
            
            changelogItem.innerHTML = `
              <div class="changelog-badge ${badgeClass}">${badgeText}</div>
              <div class="changelog-text">
                <div class="changelog-title">${this.escapeHtml(commit.message)}</div>
                <div class="changelog-meta">
                  <span class="changelog-hash">${commit.shortHash}</span>
                  <span class="changelog-separator">•</span>
                  <span class="changelog-date">${commit.date}</span>
                  <span class="changelog-separator">•</span>
                  <span class="changelog-author">${this.escapeHtml(commit.author)}</span>
                  ${commit.isCurrent ? '<span class="changelog-current-badge">CURRENT</span>' : ''}
                </div>
              </div>
              <i class="fas fa-external-link-alt changelog-link-icon"></i>
            `;
            
            changelogList.appendChild(changelogItem);
          });
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not load commit history:', error);
    }
  }

  /**
   * Escape HTML to prevent XSS (including attribute/quote breakout)
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async setupAboutPage() {
  console.log('ℹ️ Setting up about page...');

  try {
    // Load system information
    await this.loadSystemInformation();
    
    // Setup about page event listeners
    this.setupAboutEventListeners();
    
    console.log('✅ About page setup complete');
    
  } catch (error) {
    console.error('❌ Error setting up about page:', error);
  }
}

async loadSystemInformation() {
  try {
    // Load app info from main process
    if (window.electronAPI.app.getInfo) {
      const appInfo = await window.electronAPI.app.getInfo();
      
      // Update version information with Git info
      const versionElements = document.querySelectorAll('#about-version, #app-version-detail');
      versionElements.forEach(el => {
        if (el) {
          if (appInfo.displayVersion) {
            el.textContent = appInfo.displayVersion;
          } else {
            el.textContent = appInfo.version || '1.0.0';
          }
        }
      });

      // Update commit info if element exists
      const commitEl = document.getElementById('git-commit');
      if (commitEl && appInfo.commit && appInfo.commit !== 'unknown') {
        commitEl.textContent = appInfo.commit;
      }

      // Update branch info if element exists
      const branchEl = document.getElementById('git-branch');
      if (branchEl && appInfo.branch && appInfo.branch !== 'unknown') {
        branchEl.textContent = appInfo.branch;
      }

      // Update build date if element exists
      const buildDateEl = document.getElementById('build-date');
      if (buildDateEl && appInfo.buildDate) {
        const date = new Date(appInfo.buildDate);
        buildDateEl.textContent = date.toLocaleString();
      }
    }

    // Load version info from window.versions
    if (window.versions) {
      const platformEl = document.getElementById('platform-info');
      const archEl = document.getElementById('arch-info');
      const nodeVersionEl = document.getElementById('node-version');
      const electronVersionEl = document.getElementById('electron-version');
      const chromeVersionEl = document.getElementById('chrome-version');
      const v8VersionEl = document.getElementById('v8-version');

      if (platformEl) {
        platformEl.textContent = this.capitalize(window.versions.platform);
      }
      
      if (archEl) {
        archEl.textContent = window.versions.arch.toUpperCase();
      }
      
      if (nodeVersionEl) {
        nodeVersionEl.textContent = window.versions.node;
      }
      
      if (electronVersionEl) {
        electronVersionEl.textContent = window.versions.electron;
      }
      
      if (chromeVersionEl) {
        chromeVersionEl.textContent = window.versions.chrome;
      }
      
      if (v8VersionEl) {
        // V8 version is usually part of Chrome version, but let's show it if available
        v8VersionEl.textContent = window.versions.v8 || 'N/A';
      }
    }

    console.log('📊 System information loaded');

  } catch (error) {
    console.error('❌ Error loading system information:', error);
  }
}

setupAboutEventListeners() {
  console.log('📡 Setting up About page event listeners...');

  // System info button
  const systemInfoBtn = document.getElementById('system-info-btn');
  if (systemInfoBtn) {
    systemInfoBtn.addEventListener('click', () => {
      this.showDetailedSystemInfo();
    });
  }

  // Check for updates button
  const checkUpdatesBtn = document.getElementById('check-updates-btn');
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', async (e) => {
      // Ctrl+Click for test notification
      if (e.ctrlKey) {
        e.preventDefault();
        console.log('🧪 Testing update notification...');
        const result = await window.electronAPI.update.testNotification();
        if (result.success && result.update) {
          this.showUpdateNotification(result.update);
        }
      } else {
        // Normal click for real check
        this.checkForUpdates(true);
      }
    });
  }
}

// Show detailed system information
async showDetailedSystemInfo() {
  try {
    let systemInfo = 'System Information:\n\n';
    
    // Add version info
    if (window.versions) {
      systemInfo += `Platform: ${this.capitalize(window.versions.platform)}\n`;
      systemInfo += `Architecture: ${window.versions.arch}\n`;
      systemInfo += `Node.js: ${window.versions.node}\n`;
      systemInfo += `Electron: ${window.versions.electron}\n`;
      systemInfo += `Chrome: ${window.versions.chrome}\n\n`;
    }
    
    // Add app info
    if (window.electronAPI.app.getInfo) {
      const appInfo = await window.electronAPI.app.getInfo();
      systemInfo += `App Version: ${appInfo.version}\n`;
      systemInfo += `Node Version: ${appInfo.nodeVersion}\n`;
    }
    
    // Add memory info if available
    if (performance && performance.memory) {
      systemInfo += `\nMemory Usage:\n`;
      systemInfo += `Used: ${Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)} MB\n`;
      systemInfo += `Total: ${Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)} MB\n`;
    }
    
    alert(systemInfo);
    this.showToast('System information displayed', 'info');
    
  } catch (error) {
    console.error('❌ Error getting system info:', error);
    this.showToast('Could not gather system information', 'error');
  }
}

// Add this method to show thanks message
// Utility method to capitalize strings
capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
}
