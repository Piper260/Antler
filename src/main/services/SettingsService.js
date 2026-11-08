// src/main/services/SettingsService.js - Settings management service
const fs = require('fs');
const { writeFileSafeSync } = require('../utils/safeWrite');
const path = require('path');
const { app, safeStorage } = require('electron');

// Dot-paths of settings fields that hold sensitive secrets (API keys/tokens).
// These are encrypted at rest via Electron's OS-backed safeStorage; the
// in-memory `this.settings` object always holds plaintext values so the
// rest of the app doesn't need to know about encryption.
const SECRET_PATHS = ['e621.apiKey', 'huggingface.apiToken'];
// What the renderer sees in place of a saved secret. Secrets never leave the
// main process: the settings form shows this mask, and a mask sent back
// means "keep the saved value" (see redactSecrets / unmaskSecrets).
const SECRET_MASK = '••••••••';

/**
 * User Data Directory Structure (Industry Standard):
 * 
 * Windows: %APPDATA%\antler\
 * macOS:   ~/Library/Application Support/antler/
 * Linux:   ~/.config/antler/
 * 
 * Contents:
 *   ├── settings.json          (User preferences and API keys)
 *   ├── logs/                  (Application logs)
 *   │   ├── combined.log
 *   │   └── error.log
 *   └── Cache/                 (Electron managed cache)
 */
class SettingsService {
  constructor() {
    // Store settings in user data directory
    this.userDataPath = app.getPath('userData');
    this.settingsPath = path.join(this.userDataPath, 'settings.json');
    
    console.log('📂 SettingsService initialized');
    console.log('📂 User data path:', this.userDataPath);
    console.log('📂 Settings file path:', this.settingsPath);
    
    // Default settings
    this.defaultSettings = {
      e621: {
        username: '',
        apiKey: ''
      },
      huggingface: {
        apiToken: '',
        enableAI: false,
        preferredModel: 'Qwen/Qwen2.5-72B-Instruct',
        temperature: 0.7,
        customModels: []
      },
      ollama: {
        host: 'http://localhost:11434',
        preferredModel: ''
      },
      app: {
        theme: 'moss',
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
        artistsPath: '',
        charactersPath: ''
      }
    };

    this.settings = this.loadSettings();
    console.log('⚙️ Settings service initialized');
    console.log('📁 Settings file:', this.settingsPath);
  }

  /**
   * Load settings from file
   */
  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const fileContent = fs.readFileSync(this.settingsPath, 'utf8');
        const loadedSettings = JSON.parse(fileContent);
        
        // Merge with defaults to ensure all properties exist
        const settings = this.mergeWithDefaults(loadedSettings);

        // Secrets are stored encrypted on disk (see SECRET_PATHS); decrypt
        // them into memory so the rest of the app keeps working with
        // plaintext values. Legacy plaintext values are passed through
        // unchanged and will be encrypted on the next save.
        this._decryptSecrets(settings);
        
        console.log('✅ Settings loaded from file');
        return settings;
      } else {
        console.log('📝 No settings file found, using defaults');
        return { ...this.defaultSettings };
      }
    } catch (error) {
      console.error('❌ Error loading settings:', error);
      console.log('🔄 Using default settings');
      return { ...this.defaultSettings };
    }
  }

  /**
   * Get a nested value from an arbitrary object by dot path
   */
  _getPath(obj, pathStr) {
    return pathStr.split('.').reduce((o, key) => (o && o[key] !== undefined ? o[key] : undefined), obj);
  }

  /**
   * Set a nested value on an arbitrary object by dot path
   */
  _setPath(obj, pathStr, value) {
    const keys = pathStr.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((o, key) => {
      if (!o[key]) o[key] = {};
      return o[key];
    }, obj);
    target[lastKey] = value;
  }

  /**
   * Encrypt a secret value at rest using Electron's OS-backed safeStorage.
   * Falls back to plaintext if encryption isn't available on this platform
   * (e.g. no OS keyring), matching the previous behavior in that case.
   */
  _encryptSecret(value) {
    if (!value) return '';
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return `enc:${safeStorage.encryptString(String(value)).toString('base64')}`;
      }
    } catch (error) {
      console.warn('⚠️ Encryption unavailable, storing secret as plaintext:', error.message);
    }
    return value;
  }

  /**
   * Decrypt a secret value previously encrypted with _encryptSecret.
   * Transparently accepts legacy plaintext values (pre-encryption settings
   * files) and returns them unchanged.
   */
  _decryptSecret(value) {
    if (!value || typeof value !== 'string') return value || '';
    if (!value.startsWith('enc:')) return value; // legacy plaintext
    try {
      const buffer = Buffer.from(value.slice(4), 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('❌ Failed to decrypt stored secret, clearing it:', error.message);
      return '';
    }
  }

  /**
   * Decrypt all secret fields in-place on a loaded settings object
   */
  _decryptSecrets(settings) {
    for (const secretPath of SECRET_PATHS) {
      const value = this._getPath(settings, secretPath);
      if (value) this._setPath(settings, secretPath, this._decryptSecret(value));
    }
    return settings;
  }

  /**
   * Return a deep-cloned copy of settings with secret fields encrypted,
   * suitable for writing to disk.
   */
  _encryptSecretsForStorage(settings) {
    const clone = JSON.parse(JSON.stringify(settings));
    for (const secretPath of SECRET_PATHS) {
      const value = this._getPath(clone, secretPath);
      if (value) this._setPath(clone, secretPath, this._encryptSecret(value));
    }
    return clone;
  }

    /** A copy of `settings` for the renderer, with saved secrets masked. */
  redactSecrets(settings) {
    const clone = JSON.parse(JSON.stringify(settings));
    for (const secretPath of SECRET_PATHS) {
      if (this._getPath(clone, secretPath)) this._setPath(clone, secretPath, SECRET_MASK);
    }
    return clone;
  }

  /** A copy of settings from the renderer, with masks put back to the saved secrets. */
  unmaskSecrets(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    const clone = JSON.parse(JSON.stringify(settings));
    for (const secretPath of SECRET_PATHS) {
      if (this._getPath(clone, secretPath) === SECRET_MASK) this._setPath(clone, secretPath, this._getPath(this.settings, secretPath));
    }
    return clone;
  }

  /** A secret value from the renderer: the mask stands for the saved one. */
  unmaskSecret(secretPath, value) {
    return value === SECRET_MASK ? this._getPath(this.settings, secretPath) : value;
  }

  /**
   * Save settings to file
   */
  async saveSettings(newSettings = null) {
    try {
      // If new settings provided, deep merge with existing settings
      if (newSettings) {
        this.settings = this.deepMerge(this.settings, newSettings);
      }
      
      const settingsToSave = this.settings;
      
      // Ensure user data directory exists
      if (!fs.existsSync(this.userDataPath)) {
        fs.mkdirSync(this.userDataPath, { recursive: true });
      }

      // Write settings to file (secrets encrypted at rest, see SECRET_PATHS)
      const settingsForDisk = this._encryptSecretsForStorage(settingsToSave);
      const jsonString = JSON.stringify(settingsForDisk, null, 2);
      console.log('📝 About to write settings to:', this.settingsPath);
      console.log('📝 JSON string length:', jsonString.length);
      console.log('📝 E621 username being written:', settingsToSave.e621?.username || '(empty)');
      
            // The previous settings are kept in bak/settings.json.
      writeFileSafeSync(this.settingsPath, jsonString, { backup: true });
      
      console.log('✅ fs.writeFileSync completed');
      
      // Verify the write by reading it back
      const verifyRead = fs.readFileSync(this.settingsPath, 'utf8');
      const verifyParsed = JSON.parse(verifyRead);
      console.log('✅ Verification read - E621 username:', verifyParsed.e621?.username || '(empty)');

      console.log('💾 Settings saved successfully to:', this.settingsPath);
      return { success: true, message: 'Settings saved successfully' };

    } catch (error) {
      console.error('❌ Error saving settings:', error);
      return { success: false, message: `Failed to save settings: ${error.message}` };
    }
  }

  /**
   * Deep merge two objects, with source overwriting target
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }

  /**
   * Check if value is an object (not array, not null)
   */
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Get all settings
   */
  getAllSettings() {
    return { ...this.settings };
  }

  /**
   * Get specific setting by path (e.g., 'e621.username')
   */
  getSetting(path) {
    return path.split('.').reduce((obj, key) => obj && obj[key], this.settings);
  }

  /**
   * Backwards compatible alias for getSetting
   */
  get(path) {
    if (!path) {
      return this.getAllSettings();
    }
    return this.getSetting(path);
  }

  /**
   * Set specific setting by path
   */
  setSetting(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {};
      return obj[key];
    }, this.settings);
    
    target[lastKey] = value;
    return this.saveSettings();
  }

  /**
   * Backwards compatible alias for setSetting
   */
  set(path, value) {
    return this.setSetting(path, value);
  }

  /**
   * Backwards compatible alias for saveSettings
   */
  async save(newSettings = null) {
    return this.saveSettings(newSettings);
  }

  /**
   * Get E621 credentials
   */
  getE621Credentials() {
    return {
      username: this.settings.e621.username || '',
      apiKey: this.settings.e621.apiKey || '',
      isConfigured: !!(this.settings.e621.username && this.settings.e621.apiKey)
    };
  }

  getStorageSettings() {
    const storage = this.settings.storage || {};
    return {
      artistsPath: storage.artistsPath || '',
      charactersPath: storage.charactersPath || ''
    };
  }

  getResolvedStoragePaths() {
    const baseDownloads = path.join(process.cwd(), 'downloads');
    const storage = this.getStorageSettings();

    const normalize = (value, fallback) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
      return fallback;
    };

    const artistsPath = normalize(storage.artistsPath, path.join(baseDownloads, 'artists'));
    const charactersPath = normalize(storage.charactersPath, path.join(baseDownloads, 'characters'));

    return {
      baseDownloads,
      artistsPath,
      charactersPath,
      isCustom: {
        artists: !!(storage.artistsPath && storage.artistsPath.trim().length > 0),
        characters: !!(storage.charactersPath && storage.charactersPath.trim().length > 0)
      }
    };
  }

  /**
   * Set E621 credentials
   */
  async setE621Credentials(username, apiKey) {
    try {
            apiKey = this.unmaskSecret('e621.apiKey', apiKey);
      this.settings.e621.username = username || '';
      this.settings.e621.apiKey = apiKey || '';

      
      const result = await this.saveSettings();
      
      if (result.success) {
        console.log('🔐 E621 credentials updated and saved');
        return { 
          success: true, 
          message: 'E621 credentials saved successfully',
          isConfigured: !!(username && apiKey)
        };
      } else {
        console.error('❌ Save failed:', result);
        return result;
      }
    } catch (error) {
      console.error('❌ Error setting E621 credentials:', error);
      return { success: false, message: `Failed to save credentials: ${error.message}` };
    }
  }

 /**
 * Test E621 credentials with better error handling
 */
async testE621Credentials(username = null, apiKey = null) {
    const testUsername = username || this.settings.e621.username;
  const testApiKey = this.unmaskSecret('e621.apiKey', apiKey) || this.settings.e621.apiKey;

  if (!testUsername || !testApiKey) {
    return { 
      success: false, 
      message: 'Username and API key are required' 
    };
  }

  try {
    

    console.log(`🧪 Testing E621 credentials for user: ${testUsername}`);
    
    const auth = Buffer.from(`${testUsername}:${testApiKey}`).toString('base64');
    const userAgent = `Antler/1.0 (by ${testUsername} on e621)`;
    
    console.log(`🌐 Making request to: https://e621.net/posts.json`);
    console.log(`👤 User-Agent: ${userAgent}`);
    
    // Use posts.json instead of posts/1.json for better compatibility
    const response = await fetch('https://e621.net/posts.json?limit=1', {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    });

    console.log(`📊 Response status: ${response.status} ${response.statusText}`);
    
    // Log response headers for debugging
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    console.log('📋 Response headers:', headers);

    if (response.ok) {
      console.log('✅ E621 credentials test successful');
      return { 
        success: true, 
        message: 'E621 credentials are valid and working!' 
      };
    } else {
      // Get response body for better error details
      let errorDetails = '';
      try {
        const responseText = await response.text();
        errorDetails = responseText;
        console.log('❌ Error response body:', responseText);
      } catch (err) {
        console.log('❌ Could not read error response body');
      }

      switch (response.status) {
        case 401:
          return { 
            success: false, 
            message: 'Invalid username or API key. Please check your credentials.' 
          };
        case 403:
          return { 
            success: false, 
            message: 'Access forbidden. Your account may not have API access enabled.' 
          };
        case 404:
          return { 
            success: false, 
            message: 'API endpoint not found. This might be a temporary issue with e621.' 
          };
        case 429:
          return { 
            success: false, 
            message: 'Rate limited. Please wait a moment before trying again.' 
          };
        case 503:
          return { 
            success: false, 
            message: 'E621 service temporarily unavailable. Please try again later.' 
          };
        default:
          return { 
            success: false, 
            message: `E621 API error: ${response.status} ${response.statusText}` 
          };
      }
    }

  } catch (error) {
    console.error('❌ E621 credentials test failed:', error);
    
    if (error.code === 'ENOTFOUND') {
      return { 
        success: false, 
        message: 'Network error: Cannot reach e621.net. Check your internet connection.' 
      };
    } else if (error.name === 'FetchError' && error.message.includes('timeout')) {
      return { 
        success: false, 
        message: 'Request timed out. E621 may be slow or unreachable.' 
      };
    } else {
      return { 
        success: false, 
        message: `Connection error: ${error.message}` 
      };
    }
  }
}

  /**
   * Reset settings to defaults
   */
  async resetSettings() {
    try {
      this.settings = { ...this.defaultSettings };
      const result = await this.saveSettings();
      
      if (result.success) {
        console.log('🔄 Settings reset to defaults');
        return { success: true, message: 'Settings reset to defaults' };
      } else {
        return result;
      }
    } catch (error) {
      console.error('❌ Error resetting settings:', error);
      return { success: false, message: `Failed to reset settings: ${error.message}` };
    }
  }

  /**
   * Merge loaded settings with defaults
   */
  mergeWithDefaults(loadedSettings) {
    const merged = JSON.parse(JSON.stringify(this.defaultSettings));
    
    // Deep merge function
    const deepMerge = (target, source) => {
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) target[key] = {};
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };

    deepMerge(merged, loadedSettings);
    return merged;
  }

  /**
   * Export settings for backup
   */
  exportSettings() {
    return {
      settings: this.settings,
      exported: new Date().toISOString(),
      version: '1.0.0'
    };
  }

  /**
   * Import settings from backup
   */
  async importSettings(importData) {
    try {
      if (importData.settings) {
        const result = await this.saveSettings(importData.settings);
        if (result.success) {
          console.log('📥 Settings imported successfully');
          return { success: true, message: 'Settings imported successfully' };
        } else {
          return result;
        }
      } else {
        return { success: false, message: 'Invalid settings file format' };
      }
    } catch (error) {
      console.error('❌ Error importing settings:', error);
      return { success: false, message: `Failed to import settings: ${error.message}` };
    }
  }
}

module.exports = SettingsService;