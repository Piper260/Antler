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
    await this.setupModelsSection();

  } catch (error) {
    console.error('❌ Error setting up settings page:', error);
    this.showError('Failed to load settings', error);
  }
}

  /**
   * Load current settings into the form
   */
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
      
      if (themeSelect) this.setupThemePicker(themeSelect, settings.app?.theme);
      if (notificationsCheck) notificationsCheck.checked = settings.app?.notifications !== false;
      if (autoSaveCheck) autoSaveCheck.checked = settings.app?.autoSave !== false;
      if (debugModeCheck) debugModeCheck.checked = settings.advanced?.debugMode === true;
      if (cacheEnabledCheck) cacheEnabledCheck.checked = settings.advanced?.cacheEnabled !== false;
      
      console.log('⚙️ App settings loaded:', settings);

      // Load Hugging Face AI settings
      const aiEnableCheckbox = document.getElementById('ai-enable-checkbox');
      const hfTokenInput = document.getElementById('hf-api-token');
      const hfModelSelect = document.getElementById('hf-model-select');
      
      if (aiEnableCheckbox) {
        const enableAI = settings.huggingface?.enableAI || false;
        aiEnableCheckbox.checked = enableAI;
        this.toggleAISettings(enableAI);
      }
      
      if (hfTokenInput) hfTokenInput.value = settings.huggingface?.apiToken || '';
      if (hfModelSelect) hfModelSelect.value = settings.huggingface?.preferredModel || 'Qwen/Qwen2.5-72B-Instruct';

      // Populate custom models into the select and list
      this._loadCustomModelsUI(settings.huggingface?.customModels || [], settings.huggingface?.preferredModel);
      
      const tempSlider = document.getElementById('ai-temperature-slider');
      const tempValue = document.getElementById('temp-value');
      if (tempSlider && tempValue) {
        const temp = settings.huggingface?.temperature || 0.7;
        tempSlider.value = temp;
        tempValue.textContent = temp;
      }
      
      console.log('🤖 AI settings loaded:', {
        enabled: settings.huggingface?.enableAI,
        hasToken: settings.huggingface?.apiToken ? 'Set' : 'Missing',
        model: settings.huggingface?.preferredModel,
        temperature: settings.huggingface?.temperature
      });

      // Load storage paths
      const artistsPathInput = document.getElementById('artists-path-input');
      const charactersPathInput = document.getElementById('characters-path-input');
      
      if (artistsPathInput) artistsPathInput.value = settings.storage?.artistsPath || '';
      if (charactersPathInput) charactersPathInput.value = settings.storage?.charactersPath || '';
      
      console.log('📁 Storage paths loaded:', {
        artists: settings.storage?.artistsPath || 'Using default',
        characters: settings.storage?.charactersPath || 'Using default'
      });
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
    const testAIBtn = document.getElementById('test-ai-btn');
    
    if (testE621Btn) {
      testE621Btn.addEventListener('click', () => this.testE621Credentials());
    }
    
    if (testAIBtn) {
      testAIBtn.addEventListener('click', () => this.testAIConnection());
    }

    // Master Save All button
    const saveAllBtn = document.getElementById('save-all-settings-btn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', () => this.saveAllSettings());
    }

    // AI settings event listeners
    const aiEnableCheckbox = document.getElementById('ai-enable-checkbox');
    const hfLearnMore = document.getElementById('hf-learn-more');
    
    if (aiEnableCheckbox) {
      aiEnableCheckbox.addEventListener('change', (e) => {
        this.toggleAISettings(e.target.checked);
      });
    }
    
    if (hfLearnMore) {
      hfLearnMore.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.utils.openExternal('https://huggingface.co/docs/api-inference/index');
      });
    }

    // HuggingFace models explorer link
    const hfModelsLink = document.getElementById('hf-models-link');
    if (hfModelsLink) {
      hfModelsLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.utils.openExternal('https://huggingface.co/models?pipeline_tag=text-generation&sort=trending');
      });
    }

    // Custom model live-search autocomplete
    this._setupHFModelSearch();

    // Temperature slider
    const tempSlider = document.getElementById('ai-temperature-slider');
    const tempValue = document.getElementById('temp-value');
    if (tempSlider && tempValue) {
      tempSlider.addEventListener('input', (e) => {
        tempValue.textContent = e.target.value;
      });
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

    // Storage paths buttons
    const browseArtistsBtn = document.getElementById('browse-artists-btn');
    const browseCharactersBtn = document.getElementById('browse-characters-btn');
    
    if (browseArtistsBtn) {
      browseArtistsBtn.addEventListener('click', () => this.browseStorageDirectory('artists'));
    }
    
    if (browseCharactersBtn) {
      browseCharactersBtn.addEventListener('click', () => this.browseStorageDirectory('characters'));
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
   * Save all settings at once (unified save)
   */
  async saveAllSettings() {
    console.log('💾 Saving all settings...');
    const saveBtn = document.getElementById('save-all-settings-btn');
    const statusDiv = document.getElementById('settings-save-status');
    
    // Get all form values
    const e621Username = document.getElementById('e621-username')?.value.trim() || '';
    const e621ApiKey = document.getElementById('e621-api-key')?.value.trim() || '';
    const aiEnabled = document.getElementById('ai-enable-checkbox')?.checked || false;
    const aiToken = document.getElementById('hf-api-token')?.value.trim() || '';
    const aiModel = document.getElementById('hf-model-select')?.value || 'Qwen/Qwen2.5-72B-Instruct';
    const aiTemp = parseFloat(document.getElementById('ai-temperature-slider')?.value) || 0.7;
    const aiCustomModels = this._getCustomModelsFromUI();
    const artistsPath = document.getElementById('artists-path-input')?.value.trim() || '';
    const charactersPath = document.getElementById('characters-path-input')?.value.trim() || '';
    
    console.log('📝 Form values being saved:', {
      e621Username,
      e621ApiKey: e621ApiKey ? '***' : '(empty)',
      aiEnabled,
      aiToken: aiToken ? '***' : '(empty)',
      aiModel,
      aiTemp,
      artistsPath,
      charactersPath
    });
    
    const settings = {
      e621: {
        username: e621Username,
        apiKey: e621ApiKey
      },
      huggingface: {
        apiToken: aiToken,
        enableAI: aiEnabled,
        preferredModel: aiModel,
        temperature: aiTemp,
        customModels: aiCustomModels
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
      },
      storage: {
        artistsPath: artistsPath,
        charactersPath: charactersPath
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

  /**
   * Toggle AI settings visibility
   */
  toggleAISettings(enabled) {
    const tokenGroup = document.getElementById('ai-token-group');
    const modelGroup = document.getElementById('ai-model-group');
    const customModelGroup = document.getElementById('ai-custom-model-group');
    const temperatureGroup = document.getElementById('ai-temperature-group');
    const actionsGroup = document.getElementById('ai-actions-group');
    
    if (tokenGroup) tokenGroup.style.display = enabled ? 'block' : 'none';
    if (modelGroup) modelGroup.style.display = enabled ? 'block' : 'none';
    if (customModelGroup) customModelGroup.style.display = enabled ? 'block' : 'none';
    if (temperatureGroup) temperatureGroup.style.display = enabled ? 'block' : 'none';
    if (actionsGroup) actionsGroup.style.display = enabled ? 'flex' : 'none';
    
    if (!enabled) {
      const statusEl = document.getElementById('ai-status');
      if (statusEl) statusEl.style.display = 'none';
    }
  }

  /**
   * Test AI connection
   */
  async testAIConnection() {
    console.log('🧪 Testing AI connection...');
    
    const testBtn = document.getElementById('test-ai-btn');
    const statusEl = document.getElementById('ai-status');
    
    // Get current token from input
    const tokenInput = document.getElementById('hf-api-token');
    const token = tokenInput?.value.trim();
    
    if (!token) {
      this.showAIStatus('Please enter your Hugging Face API token first', 'warning');
      return;
    }
    
    // Show loading state
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
    this.showAIStatus('Testing AI connection...', 'info');
    
    try {
      // Save token temporarily to test
      const modelSelect = document.getElementById('hf-model-select');
      const settings = {
        huggingface: {
          apiToken: token,
          enableAI: true,
          preferredModel: modelSelect?.value || 'Qwen/Qwen2.5-72B-Instruct'
        }
      };
      
      await window.electronAPI.settings.save(settings);
      
      // Test the connection
      const result = await window.electronAPI.ai.testConnection();
      
      if (result.success) {
        this.showAIStatus(`Connection successful! Using ${result.model}`, 'success');
        this.showToast('AI connection test successful!', 'success');
        // Reflect the enabled state in the UI checkbox so Save All doesn't revert it
        const enableCheckbox = document.getElementById('ai-enable-checkbox');
        if (enableCheckbox && !enableCheckbox.checked) {
          enableCheckbox.checked = true;
          this.toggleAISettings(true);
        }
      } else {
        this.showAIStatus(`Connection failed: ${result.message}`, 'error');
        this.showToast('AI connection failed', 'error');
      }
      
    } catch (error) {
      console.error('❌ Error testing AI connection:', error);
      this.showAIStatus('Error testing connection', 'error');
      this.showToast('Error testing AI connection', 'error');
    } finally {
      // Restore button state
      testBtn.disabled = false;
      testBtn.innerHTML = '<i class="fas fa-flask"></i> Test AI Connection';
    }
  }

  /**
   * Save AI settings
   */
  async saveAISettings() {
    console.log('💾 Saving AI settings...');
    
    const saveBtn = document.getElementById('save-ai-settings-btn');
    const enableCheckbox = document.getElementById('ai-enable-checkbox');
    const tokenInput = document.getElementById('hf-api-token');
    const modelSelect = document.getElementById('hf-model-select');
    const tempSlider = document.getElementById('ai-temperature-slider');
    
    const settings = {
      huggingface: {
        apiToken: tokenInput?.value.trim() || '',
        enableAI: enableCheckbox?.checked || false,
        preferredModel: modelSelect?.value || 'Qwen/Qwen2.5-72B-Instruct',
        temperature: parseFloat(tempSlider?.value) || 0.7,
        customModels: this._getCustomModelsFromUI()
      }
    };
    
    // Show loading state
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    try {
      const result = await window.electronAPI.settings.save(settings);
      
      if (result.success) {
        this.showAIStatus('AI settings saved successfully!', 'success');
        this.showToast('AI settings saved!', 'success');
      } else {
        this.showAIStatus('Failed to save AI settings', 'error');
        this.showToast('Failed to save AI settings', 'error');
      }
      
    } catch (error) {
      console.error('❌ Error saving AI settings:', error);
      this.showAIStatus('Error saving settings', 'error');
      this.showToast('Error saving AI settings', 'error');
    } finally {
      // Restore button state
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save AI Settings';
    }
  }

  /**
   * Show AI status message
   */
  showAIStatus(message, type = 'info') {
    const statusEl = document.getElementById('ai-status');
    if (!statusEl) return;
    
    statusEl.style.display = 'block';
    statusEl.className = `credentials-status status-${type}`;
    statusEl.textContent = message;
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 10000);
  }

  /**
   * Returns the current list of custom model IDs from the UI list.
   */
  _getCustomModelsFromUI() {
    const list = document.getElementById('hf-custom-models-list');
    if (!list) return [];
    return Array.from(list.querySelectorAll('[data-model-id]')).map(el => el.dataset.modelId);
  }

  /**
   * Populate the custom-models list and inject options into the model <select>.
   */
  _loadCustomModelsUI(customModels = [], selectedModel = '') {
    const list = document.getElementById('hf-custom-models-list');
    const select = document.getElementById('hf-model-select');
    if (!list || !select) return;

    // Remove any previously injected custom options
    select.querySelectorAll('[data-custom]').forEach(opt => opt.remove());

    // Re-render list and inject options
    list.innerHTML = '';
    for (const modelId of customModels) {
      this._addCustomModelToUI(modelId, select, list);
    }

    // Restore selection after re-populating
    if (selectedModel) select.value = selectedModel;
  }

  /**
   * Add a single custom model to the list widget and the <select>.
   */
  _addCustomModelToUI(modelId, select, list) {
    if (!modelId) return;
    // Avoid duplicates in the select
    if (select.querySelector(`option[value="${CSS.escape(modelId)}"]`)) return;

    const shortName = modelId.split('/').pop();

    // Add option to select
    const opt = document.createElement('option');
    opt.value = modelId;
    opt.textContent = `${shortName} (custom)`;
    opt.dataset.custom = '1';
    select.appendChild(opt);

    // Add row to list
    const row = document.createElement('div');
    row.dataset.modelId = modelId;
    row.className = 'settings-model-row';
    row.innerHTML = `
      <span title="${this.escapeHtml(modelId)}">${this.escapeHtml(modelId)}</span>
      <button class="btn-icon" title="Remove">
        <i class="fas fa-times"></i>
      </button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      select.querySelector(`option[value="${CSS.escape(modelId)}"]`)?.remove();
      // If selected was this model, reset to first
      if (select.value === modelId) select.selectedIndex = 0;
    });
    list.appendChild(row);
  }

  /**
   * Wire up the debounced live-search autocomplete for the HF custom model input.
   */
  _setupHFModelSearch() {
    const input    = document.getElementById('hf-custom-model-input');
    const dropdown = document.getElementById('hf-model-search-dropdown');
    const addBtn   = document.getElementById('hf-add-custom-model-btn');
    if (!input || !dropdown) return;

    let debounceTimer = null;

    const closeDropdown = () => {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    };

    const selectModel = (modelId) => {
      input.value = modelId;
      closeDropdown();
      // Auto-add to the list
      const select = document.getElementById('hf-model-select');
      const list   = document.getElementById('hf-custom-models-list');
      this._addCustomModelToUI(modelId, select, list);
      select.value = modelId;
      input.value  = '';
    };

    const showDropdownMessage = (msg) => {
      dropdown.innerHTML = `<div class="settings-dropdown-message">${msg}</div>`;
      dropdown.style.display = 'block';
    };

    const renderResults = (models) => {
      dropdown.innerHTML = '';
      if (!models.length) {
        showDropdownMessage('No models found. Try a different query.');
        return;
      }
      for (const m of models) {
        const item = document.createElement('div');
        item.className = 'settings-dropdown-item';
        const dlStr = m.downloads >= 1000
          ? `${(m.downloads / 1000).toFixed(1)}k`
          : String(m.downloads);

        // Inference API availability, as plain coloured text
        let inference = '<span class="settings-dropdown-meta text-danger" title="No Inference API - Ollama only">No API</span>';
        if (m.inference === 'warm') {
          inference = '<span class="settings-dropdown-meta text-success" title="Inference API: active">API ready</span>';
        } else if (m.inference === 'cold') {
          inference = '<span class="settings-dropdown-meta text-warning" title="Inference API: cold start (slower)">API cold</span>';
        }

        item.innerHTML = `
          <span class="settings-dropdown-name">${this.escapeHtml(m.id)}</span>
          ${inference}
          <span class="settings-dropdown-meta" title="Downloads">${dlStr} downloads</span>
        `;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // prevent input blur before click
          selectModel(m.id);
        });
        dropdown.appendChild(item);
      }
      dropdown.style.display = 'block';
    };

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q.length < 2) {
        closeDropdown();
        return;
      }
      showDropdownMessage('Searching...');
      debounceTimer = setTimeout(async () => {
        try {
          const result = await window.electronAPI.ai.searchHfModels(q, 10);
          if (result.success) {
            renderResults(result.models);
          } else {
            showDropdownMessage('Search unavailable. Paste the model ID manually.');
          }
        } catch {
          showDropdownMessage('Search unavailable. Paste the model ID manually.');
        }
      }, 350);
    });

    // Close dropdown when focus leaves the input (unless clicking a result)
    input.addEventListener('blur', () => {
      setTimeout(closeDropdown, 150);
    });

    // Enter key: add whatever is in the input directly
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const modelId = input.value.trim();
        if (modelId) selectModel(modelId);
      }
      if (e.key === 'Escape') closeDropdown();
    });

    // "Add" button: add the raw typed value (with colon-strip validation)
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        let modelId = input.value.trim();
        if (!modelId) return;
        if (modelId.includes(':')) {
          const stripped = modelId.split(':')[0].trim();
          this.showToast(`Stripped Ollama tag — using: ${stripped}`, 'warning');
          modelId = stripped;
        }
        if (!modelId.includes('/')) {
          this.showToast('Use the format "owner/model-name"', 'error');
          return;
        }
        selectModel(modelId);
      });
    }
  }

  /**
   * Browse for storage directory
   */
  async browseStorageDirectory(type) {
    try {
      const result = await window.electronAPI.tagEditor.browseCustomFolder();
      
      if (result.success && result.folderPath) {
        let inputId;
        if (type === 'artists') inputId = 'artists-path-input';
        else if (type === 'characters') inputId = 'characters-path-input';
        
        const input = document.getElementById(inputId);
        
        if (input) {
          input.value = result.folderPath;
          console.log(`📁 Selected ${type} path:`, result.folderPath);
        }
      }
    } catch (error) {
      console.error('❌ Error browsing directory:', error);
      this.showToast('Failed to open directory browser', 'error');
    }
  }

  /**
   * Save storage paths
   */
  async saveStoragePaths() {
    console.log('💾 Saving storage paths...');
    
    const saveBtn = document.getElementById('save-storage-paths-btn');
    const artistsPathInput = document.getElementById('artists-path-input');
    const charactersPathInput = document.getElementById('characters-path-input');
    
    const settings = {
      storage: {
        artistsPath: artistsPathInput?.value.trim() || '',
        charactersPath: charactersPathInput?.value.trim() || ''
      }
    };
    
    // Show loading state
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    try {
      const result = await window.electronAPI.settings.save(settings);
      
      if (result.success) {
        this.showStorageStatus('Storage paths saved successfully!', 'success');
        this.showToast('Storage paths saved!', 'success');
      } else {
        this.showStorageStatus('Failed to save storage paths', 'error');
        this.showToast('Failed to save storage paths', 'error');
      }
      
    } catch (error) {
      console.error('❌ Error saving storage paths:', error);
      this.showStorageStatus('Error saving paths', 'error');
      this.showToast('Error saving storage paths', 'error');
    } finally {
      // Restore button state
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Storage Paths';
    }
  }

  /**
   * Show storage status message
   */
  showStorageStatus(message, type = 'info') {
    const statusEl = document.getElementById('storage-status');
    if (!statusEl) return;
    
    statusEl.style.display = 'block';
    statusEl.className = `credentials-status status-${type}`;
    statusEl.textContent = message;
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 10000);
  }
}
