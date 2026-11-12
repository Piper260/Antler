// The Settings page: e621 credentials, app and AI settings, storage paths, import and export.
// Mixed into AntlerApp (see utils/mixMethods.js).
class AppSettingsPage {
  /** Fills the theme dropdown from js/app/themes.js and applies a choice straight away. */
  setupThemePicker(select, savedTheme) {
    const themes = window.AntlerThemes;
    select.innerHTML = themes.list
      .map(theme => `<option value="${theme.id}">${theme.name}</option>`)
      .join('');
    select.value = themes.normalize(savedTheme || themes.current());
    select.onchange = async () => {
      const theme = themes.apply(select.value);
      const result = await window.electronAPI.settings.set('app.theme', theme);
      if (result && result.success === false) this.showToast('Theme applied but not saved', 'warning');
    };
  }

  /** At startup: the saved setting wins over the copy kept for the first paint. */
  async applySavedTheme() {
    const result = await window.electronAPI.settings.getAll();
    const saved = result?.success ? result.settings?.app?.theme : null;
    if (saved) window.AntlerThemes.apply(saved);
  }

  /**
   * Setup settings page functionality
   */
  async setupSettingsPage() {
  console.log('⚙️ Setting up settings page...');

  try {
    await this.loadCurrentSettings();
    this.setupSettingsEventListeners();
    await this.setupLibrariesSection();
    await this.setupModelsSection();

  } catch (error) {
    console.error('❌ Error setting up settings page:', error);
    this.showError('Failed to load settings', error);
  }
}

  /**
   * Load current settings into the form
   */
  /**
   * Credentials save as soon as a field is left (which includes clicking its
   * Test button), instead of waiting for Save All at the bottom of the page:
   * credentials typed and tested used to be lost on leaving Settings. A blank
   * key field keeps the saved key (main/services/SettingsService.js); the
   * Clear button removes one.
   */
  bindCredentialAutosave() {
    const fields = {
      'e621-username': 'e621.username',
      'e621-api-key': 'e621.apiKey',
      'inkbunny-username': 'inkbunny.username',
      'inkbunny-password': 'inkbunny.password'
    };
    const secrets = new Set(['e621.apiKey', 'inkbunny.password']);
    for (const [id, settingPath] of Object.entries(fields)) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.addEventListener('change', async () => {
        const value = settingPath.endsWith('password') ? input.value : input.value.trim();
        // A blank key field means "keep the saved key": nothing to save.
        if (secrets.has(settingPath) && !value) return;
        const result = await window.electronAPI.settings.set(settingPath, value);
        if (result?.success === false) {
          this.showToast(`Could not save: ${result.message || 'unknown error'}`, 'error');
          return;
        }
        this.showToast(secrets.has(settingPath) ? 'Saved (stored encrypted on this computer)' : 'Saved', 'success');
        if (secrets.has(settingPath)) {
          const saved = await window.electronAPI.settings.getAll().catch(() => null);
          if (saved?.success) this.showSecretClearButtons(saved.settings);
        }
      });
    }
  }

  /** Shows each key field's Clear button only while a key is saved. */
  showSecretClearButtons(settings) {
    document.querySelectorAll('.secret-clear-btn').forEach((btn) => {
      const saved = btn.dataset.secret.split('.').reduce((o, k) => o?.[k], settings);
      btn.style.display = saved ? '' : 'none';
    });
  }

  /**
   * Removes a saved key. Blank fields keep the saved key when settings are
   * saved, so this is the only way to remove one.
   */
  async clearSecret(btn) {
    const input = btn.parentElement.querySelector('input');
    if (!confirm('Remove this saved key from Antler? You will need to enter it again to use it.')) return;
    const result = await window.electronAPI.settings.clearSecret(btn.dataset.secret);
    if (result?.success === false) {
      this.showToast(result.message || 'Could not clear the key', 'error');
      return;
    }
    if (input) input.value = '';
    btn.style.display = 'none';
    this.showToast('Saved key removed', 'success');
  }

  async loadCurrentSettings() {
  try {
    // Load E621 credentials
    const credentialsResult = await window.electronAPI.settings.e621.getCredentials();
    if (credentialsResult.success) {
      const { credentials } = credentialsResult;
      
      const usernameInput = document.getElementById('e621-username');
      const apiKeyInput = document.getElementById('e621-api-key');
      
      if (usernameInput) usernameInput.value = credentials.username || '';
      if (apiKeyInput) apiKeyInput.value = credentials.apiKey || '';
      
      // Show status if credentials are configured
      if (credentials.isConfigured) {
        this.showCredentialsStatus('Credentials configured and ready', 'success');
      } else {
        this.showCredentialsStatus('Please configure your E621 credentials', 'info');
      }
      
      console.log('🔐 Credentials loaded:', {
        username: credentials.username ? 'Set' : 'Missing',
        apiKey: credentials.apiKey ? 'Set' : 'Missing',
        isConfigured: credentials.isConfigured
      });
    }

    // Load other settings
    const settingsResult = await window.electronAPI.settings.getAll();
    if (settingsResult.success) {
      const { settings } = settingsResult;
      
      // Apply settings to form
      const themeSelect = document.getElementById('app-theme');
      const notificationsCheck = document.getElementById('enable-notifications');
      const autoSaveCheck = document.getElementById('auto-save');
      const debugModeCheck = document.getElementById('debug-mode');
      const cacheEnabledCheck = document.getElementById('cache-enabled');
      
      const ibUser = document.getElementById('inkbunny-username');
      const ibPass = document.getElementById('inkbunny-password');
      if (ibUser) ibUser.value = settings.inkbunny?.username || '';
      if (ibPass) ibPass.value = settings.inkbunny?.password || '';

      if (themeSelect) this.setupThemePicker(themeSelect, settings.app?.theme);
      if (notificationsCheck) notificationsCheck.checked = settings.app?.notifications !== false;
      if (autoSaveCheck) autoSaveCheck.checked = settings.app?.autoSave !== false;
      if (debugModeCheck) debugModeCheck.checked = settings.advanced?.debugMode === true;
      if (cacheEnabledCheck) cacheEnabledCheck.checked = settings.advanced?.cacheEnabled !== false;
      
      console.log('⚙️ App settings loaded:', settings);

      this.showSecretClearButtons(settings);
    }

  } catch (error) {
    console.error('❌ Error loading settings:', error);
    this.showCredentialsStatus('Error loading credentials', 'error');
  }
}

  /**
   * Setup event listeners for settings page
   */
  setupSettingsEventListeners() {
    // Test buttons (don't save, just test)
    const testE621Btn = document.getElementById('test-credentials-btn');
    
    if (testE621Btn) {
      testE621Btn.addEventListener('click', () => this.testE621Credentials());
    }

    const testInkbunnyBtn = document.getElementById('test-inkbunny-btn');
    if (testInkbunnyBtn) {
      testInkbunnyBtn.addEventListener('click', () => this.testInkbunnyLogin());
    }

    document.querySelectorAll('.secret-clear-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.clearSecret(btn));
    });
    this.bindCredentialAutosave();

    document.getElementById('x-sign-in-btn')?.addEventListener('click', () => this.xSignIn());
    document.getElementById('x-sign-out-btn')?.addEventListener('click', () => this.xSignOut());
    this.showXStatus();

    // Master Save All button
    const saveAllBtn = document.getElementById('save-all-settings-btn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', () => this.saveAllSettings());
    }

    // App settings button
    const saveAppSettingsBtn = document.getElementById('save-app-settings-btn');
    if (saveAppSettingsBtn) {
      saveAppSettingsBtn.addEventListener('click', () => this.saveAppSettings());
    }

    // Settings management buttons
    const exportBtn = document.getElementById('export-settings-btn');
    const importBtn = document.getElementById('import-settings-btn');
    const resetBtn = document.getElementById('reset-settings-btn');
    const fileInput = document.getElementById('import-file-input');
    
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportSettings());
    }
    
    if (importBtn) {
      importBtn.addEventListener('click', () => fileInput?.click());
    }
    
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.importSettings(e));
    }
    
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetSettings());
    }
  }

  /**
   * Test E621 credentials
   */
  async testE621Credentials() {
  const testBtn = document.getElementById('test-credentials-btn');
  const usernameInput = document.getElementById('e621-username');
  const apiKeyInput = document.getElementById('e621-api-key');
  
  if (!usernameInput || !apiKeyInput) return;
  
  const username = usernameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  
  if (!username || !apiKey) {
    this.showCredentialsStatus('Please enter both username and API key', 'error');
    return;
  }

  // Show loading state
  testBtn.disabled = true;
  testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
  this.showCredentialsStatus('Testing credentials...', 'info');

  try {
    console.log(`🧪 Testing E621 credentials for user: ${username}`);
    
    const result = await window.electronAPI.settings.e621.testCredentials(username, apiKey);
    
    console.log('🧪 Test result:', result);
    
    if (result.success) {
      this.showCredentialsStatus(result.message, 'success');
      this.showToast('E621 credentials are valid!', 'success');
    } else {
      this.showCredentialsStatus(result.message, 'error');
      this.showToast('E621 credentials test failed', 'error');
      console.error('❌ Credential test failed:', result.message);
    }
    
  } catch (error) {
    console.error('❌ Error testing credentials:', error);
    this.showCredentialsStatus('Error testing credentials', 'error');
    this.showToast('Error testing credentials', 'error');
  } finally {
    // Restore button state
    testBtn.disabled = false;
    testBtn.innerHTML = '<i class="fas fa-flask"></i> Test Credentials';
  }
}

  /**
   * Test the Inkbunny username and password in the form (not saved).
   */
  async testInkbunnyLogin() {
    const button = document.getElementById('test-inkbunny-btn');
    const status = document.getElementById('inkbunny-status');
    const username = document.getElementById('inkbunny-username')?.value.trim() || '';
    const password = document.getElementById('inkbunny-password')?.value || '';
    const show = (message, type) => {
      if (!status) return;
      status.style.display = 'block';
      status.className = `credentials-status text-${type}`;
      status.textContent = message;
    };
    if (!username || !password) {
      show('Enter both username and password', 'error');
      return;
    }
    if (button) button.disabled = true;
    show('Testing login...', 'info');
    try {
      const result = await window.electronAPI.inkbunny.testLogin(username, password);
      show(result.message, result.success ? 'success' : 'error');
    } catch (error) {
      show(`Could not test the login: ${error.message}`, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /** Shows whether X is signed in, and the matching button. */
  async showXStatus(state) {
    const status = document.getElementById('x-status');
    const signIn = document.getElementById('x-sign-in-btn');
    const signOut = document.getElementById('x-sign-out-btn');
    if (!status) return;
    const { signedIn } = state || await window.electronAPI.x.status().catch(() => ({ signedIn: false }));
    status.style.display = 'block';
    status.className = `credentials-status text-${signedIn ? 'success' : 'muted'}`;
    status.textContent = signedIn ? 'Signed in to X' : 'Not signed in';
    if (signIn) signIn.textContent = signedIn ? 'Sign in again' : 'Sign in to X';
    if (signOut) signOut.style.display = signedIn ? '' : 'none';
  }

  async xSignIn() {
    const button = document.getElementById('x-sign-in-btn');
    if (button) button.disabled = true;
    try {
      const result = await window.electronAPI.x.signIn();
      await this.showXStatus(result);
      if (result?.signedIn) this.showToast('Signed in to X', 'success');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async xSignOut() {
    await this.showXStatus(await window.electronAPI.x.signOut());
    this.showToast('Signed out of X', 'info');
  }

  /**
   * Save all settings at once (unified save)
   */
  async saveAllSettings() {
    console.log('💾 Saving all settings...');
    const saveBtn = document.getElementById('save-all-settings-btn');
    const statusDiv = document.getElementById('settings-save-status');
    
    // Get all form values
    const e621Username = document.getElementById('e621-username')?.value.trim() || '';
    const e621ApiKey = document.getElementById('e621-api-key')?.value.trim() || '';
    const inkbunnyUsername = document.getElementById('inkbunny-username')?.value.trim() || '';
    const inkbunnyPassword = document.getElementById('inkbunny-password')?.value || '';
    
    console.log('📝 Form values being saved:', {
      e621Username,
      e621ApiKey: e621ApiKey ? '***' : '(empty)'
    });
    
    const settings = {
      e621: {
        username: e621Username,
        apiKey: e621ApiKey
      },
      inkbunny: {
        username: inkbunnyUsername,
        password: inkbunnyPassword
      },
      app: {
        theme: window.AntlerThemes.current(),
        autoStart: false,
        notifications: true,
        autoSave: true
      },
      advanced: {
        debugMode: false,
        logLevel: 'info',
        cacheEnabled: true
      }
    };

    // Show loading state
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
      console.log('📦 Settings to save:', settings);
      const result = await window.electronAPI.settings.save(settings);
      console.log('✅ Save result:', result);
      
      if (result.success) {
        if (statusDiv) {
          statusDiv.style.display = 'block';
          statusDiv.className = 'credentials-status success';
          statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> All settings saved';
          
          setTimeout(() => {
            statusDiv.style.display = 'none';
          }, 5000);
        }
        this.showToast('All settings saved!', 'success');
        const saved = await window.electronAPI.settings.getAll().catch(() => null);
        if (saved?.success) this.showSecretClearButtons(saved.settings);
      } else {
        throw new Error(result.message || 'Save failed');
      }
      
    } catch (error) {
      console.error('❌ Error saving settings:', error);
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.className = 'credentials-status error';
        statusDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> Failed to save settings';
        
        setTimeout(() => {
          statusDiv.style.display = 'none';
        }, 5000);
      }
      this.showToast('Failed to save settings', 'error');
    } finally {
      // Restore button state
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save All Settings';
      }
    }
  }

  /**
   * Save E621 credentials (DEPRECATED - use saveAllSettings)
   */
  async saveE621Credentials() {
  console.log('🔵 saveE621Credentials() called');
  const saveBtn = document.getElementById('save-credentials-btn');
  const usernameInput = document.getElementById('e621-username');
  const apiKeyInput = document.getElementById('e621-api-key');
  
  console.log('🔵 Found elements:', { saveBtn: !!saveBtn, usernameInput: !!usernameInput, apiKeyInput: !!apiKeyInput });
  
  if (!usernameInput || !apiKeyInput) {
    console.log('❌ Missing input elements!');
    return;
  }
  
  const username = usernameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  // Show loading state
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    console.log(`💾 Saving E621 credentials for user: ${username}`);
    
    const result = await window.electronAPI.settings.e621.setCredentials(username, apiKey);
    
    console.log('💾 Save result:', result);
    
    if (result.success) {
      this.showCredentialsStatus(result.message, 'success');
      this.showToast('E621 credentials saved!', 'success');
      
      // Refresh the Post ID tool's API status if it's currently loaded
      if (this.currentTool && this.currentTool.id === 'post-lookup') {
        this.currentTool.loadInitialState();
      }
    } else {
      this.showCredentialsStatus(result.message, 'error');
      this.showToast('Failed to save credentials', 'error');
    }
    
  } catch (error) {
    console.error('❌ Error saving credentials:', error);
    this.showCredentialsStatus('Error saving credentials', 'error');
    this.showToast('Error saving credentials', 'error');
  } finally {
    // Restore button state
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Credentials';
  }
}

  /**
   * Save app settings
   */
  async saveAppSettings() {
    const saveBtn = document.getElementById('save-app-settings-btn');
    
    // Get form values
    const themeSelect = document.getElementById('app-theme');
    const notificationsCheck = document.getElementById('enable-notifications');
    const autoSaveCheck = document.getElementById('auto-save');
    const debugModeCheck = document.getElementById('debug-mode');
    const cacheEnabledCheck = document.getElementById('cache-enabled');
    
    const settings = {
      app: {
        theme: window.AntlerThemes.current(),
        notifications: notificationsCheck?.checked !== false,
        autoSave: autoSaveCheck?.checked !== false
      },
      advanced: {
        debugMode: debugModeCheck?.checked === true,
        cacheEnabled: cacheEnabledCheck?.checked !== false
      }
    };

    // Show loading state
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const result = await window.electronAPI.settings.save(settings);
      
      if (result.success) {
        this.showToast('Settings saved successfully!', 'success');
      } else {
        this.showToast('Failed to save settings', 'error');
      }
      
    } catch (error) {
      console.error('❌ Error saving app settings:', error);
      this.showToast('Error saving settings', 'error');
    } finally {
      // Restore button state
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
    }
  }

  /**
   * Export settings to file
   */
  async exportSettings() {
    try {
      const result = await window.electronAPI.settings.export();
      
      if (result.success) {
        // Create download link
        const dataStr = JSON.stringify(result.data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = 'antler-settings.json';
        link.click();
        
        URL.revokeObjectURL(link.href);
        this.showToast('Settings exported successfully!', 'success');
      } else {
        this.showToast('Failed to export settings', 'error');
      }
      
    } catch (error) {
      console.error('❌ Error exporting settings:', error);
      this.showToast('Error exporting settings', 'error');
    }
  }

  /**
   * Import settings from file
   */
  async importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const fileContent = await file.text();
      const importData = JSON.parse(fileContent);
      
      const result = await window.electronAPI.settings.import(importData);
      
      if (result.success) {
        this.showToast('Settings imported successfully!', 'success');
        // Reload the settings page
        setTimeout(() => {
          this.loadCurrentSettings();
        }, 1000);
      } else {
        this.showToast('Failed to import settings', 'error');
      }
      
    } catch (error) {
      console.error('❌ Error importing settings:', error);
      this.showToast('Invalid settings file', 'error');
    } finally {
      // Clear file input
      event.target.value = '';
    }
  }

  /**
   * Reset settings to defaults
   */
  async resetSettings() {
    if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
      return;
    }

    try {
      const result = await window.electronAPI.settings.reset();
      
      if (result.success) {
        this.showToast('Settings reset to defaults!', 'success');
        // Reload the settings page
        setTimeout(() => {
          this.loadCurrentSettings();
        }, 1000);
      } else {
        this.showToast('Failed to reset settings', 'error');
      }
      
    } catch (error) {
      console.error('❌ Error resetting settings:', error);
      this.showToast('Error resetting settings', 'error');
    }
  }

  getStatusIcon(type) {
    const icons = {
      success: 'check-circle',
      error: 'exclamation-circle',
      info: 'info-circle'
    };
    return icons[type] || icons.info;
  }

  /**
   * Show credentials status
   */
  showCredentialsStatus(message, type) {
  const statusEl = document.getElementById('credentials-status');
  if (!statusEl) return;
  
  statusEl.style.display = 'block';
  statusEl.className = `credentials-status text-${type}`;
  statusEl.innerHTML = `<i class="fas fa-${this.getStatusIcon(type)}"></i> ${message}`;
  
  console.log(`📊 Credentials status: ${message} (${type})`);
  
  // Auto-hide after 10 seconds for non-success messages
  if (type !== 'success') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 10000);
  }
}
}
