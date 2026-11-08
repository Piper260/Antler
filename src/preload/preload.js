// src/preload/preload.js - Foundation preload script
const { contextBridge, ipcRenderer, webUtils } = require('electron');

console.log('🔌 Preload script loading...');

/**
 * Safe IPC wrapper functions
 */
const safeInvoke = async (channel, ...args) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    console.error(`IPC invoke error on channel '${channel}':`, error);
    throw error;
  }
};

const safeSend = (channel, ...args) => {
  try {
    ipcRenderer.send(channel, ...args);
  } catch (error) {
    console.error(`IPC send error on channel '${channel}':`, error);
    throw error;
  }
};

const safeOn = (channel, callback) => {
  try {
    const wrappedCallback = (event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`IPC callback error on channel '${channel}':`, error);
      }
    };
    
    ipcRenderer.on(channel, wrappedCallback);
    
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(channel, wrappedCallback);
    };
  } catch (error) {
    console.error(`IPC listener setup error on channel '${channel}':`, error);
    throw error;
  }
};

/**
 * Main API exposed to renderer process
 */
const electronAPI = {
  // App control methods
  app: {
    close: () => safeSend('app:close'),
    minimize: () => safeSend('app:minimize'),
    maximizeRestore: () => safeSend('app:maximize-restore'),
    getInfo: () => safeInvoke('app:get-info'),
    getCommitHistory: (limit) => safeInvoke('app:get-commit-history', limit)
  },

  // Window event listeners
  window: {
    onMaximized: (callback) => safeOn('window:maximized', callback),
    onRestored: (callback) => safeOn('window:restored', callback),
    onMinimized: (callback) => safeOn('window:minimized', callback),
    onFocused: (callback) => safeOn('window:focused', callback),
    onBlurred: (callback) => safeOn('window:blurred', callback)
  },

  // Settings management
  settings: {
    getAll: () => safeInvoke('settings:get-all'),
    get: (path) => safeInvoke('settings:get', path),
    set: (path, value) => safeInvoke('settings:set', path, value),
    save: (settings) => safeInvoke('settings:save', settings),
    reset: () => safeInvoke('settings:reset'),
    export: () => safeInvoke('settings:export'),
    import: (data) => safeInvoke('settings:import', data),
    
    // E621 specific methods
    e621: {
      getCredentials: () => safeInvoke('settings:get-e621-credentials'),
      setCredentials: (username, apiKey) => safeInvoke('settings:set-e621-credentials', username, apiKey),
      testCredentials: (username, apiKey) => safeInvoke('settings:test-e621-credentials', username, apiKey)
    }
  },

  // E621 API methods
  e621: {
    fetchPost: (postId) => safeInvoke('e621:fetch-post', postId),
    searchPosts: (tags, limit) => safeInvoke('e621:search-posts', tags, limit),
    getPopularPosts: (period, limit) => safeInvoke('e621:popular-posts', period, limit),
    clearCache: () => safeInvoke('e621:clear-cache'),
    getCacheStats: () => safeInvoke('e621:cache-stats'),
    getCredentialsStatus: () => safeInvoke('e621:credentials-status'),
    getArtistSuggestions: (query, limit) => safeInvoke('e621:artist-suggestions', query, limit),
    searchByArtist: (artistName, options) => safeInvoke('e621:search-by-artist', artistName, options),
    searchByCharacter: (characterName, options) => safeInvoke('e621:search-by-character', characterName, options),
    getTagSuggestions: (query, options) => safeInvoke('e621:tag-suggestions', query, options),
    getPopularArtists: (limit) => safeInvoke('e621:popular-artists', limit),
    getArtistInfo: (artistName) => safeInvoke('e621:artist-info', artistName),
    searchTags: (query, limit) => safeInvoke('e621:search-tags', query, limit)
  },

  // Update API
  update: {
    getStatus: () => safeInvoke('update:get-status'),
    checkForUpdates: () => safeInvoke('update:check'),
    install: () => safeInvoke('update:install'),
    openRelease: () => safeInvoke('update:open-release'),
    onStatus: (callback) => safeOn('update:status', callback)
  },

  // AI API
  ai: {
    testConnection: () => safeInvoke('ai:test-connection'),
    isEnabled: () => safeInvoke('ai:is-enabled'),
    optimizePrompt: (tags, options) => safeInvoke('ai:optimize-prompt', tags, options),
    generateNegativePrompt: (positiveTags, options) => safeInvoke('ai:generate-negative-prompt', positiveTags, options),
    chatCompletion: (messages, options) => safeInvoke('ai:chat-completion', messages, options),
    getModels: () => safeInvoke('ai:get-models'),
    listOllamaModels: () => safeInvoke('ai:list-ollama-models'),
    checkOllama: () => safeInvoke('ai:check-ollama'),
    searchHfModels: (query, limit) => safeInvoke('ai:search-hf-models', query, limit),
    pullOllamaModel: (modelName) => safeInvoke('ai:pull-ollama-model', modelName),
    onOllamaPullProgress: (callback) => safeOn('ai:ollama-pull-progress', callback),
    onProgress: (callback) => safeOn('ai:progress', callback)
  },

  // Utility functions
  utils: {
    /**
     * Where a dropped or picked File lives on disk ('' if nowhere). Electron
     * removed File.path in v32; this is its replacement.
     */
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file) || '';
      } catch {
        return '';
      }
    },

    /**
     * Validate if a string is a valid post ID
     */
    isValidPostID: (postID) => {
      if (typeof postID !== 'string' && typeof postID !== 'number') {
        return false;
      }
      const normalized = String(postID).trim();
      return /^\d+$/.test(normalized) && parseInt(normalized) > 0;
    },
      downloadImage: (data) => safeInvoke('utils:download-image', data),
      saveToDownloads: (data) => safeInvoke('utils:save-to-downloads', data),
      openDownloadsFolder: (name, type) => safeInvoke('utils:open-downloads-folder', name, type),
      checkPostsExist: (data) => safeInvoke('utils:check-posts-exist', data),
      getCategorySubfolders: (data) => safeInvoke('utils:get-category-subfolders', data),
      getDownloadStats: () => safeInvoke('utils:get-download-stats'),
      openExternal: (url) => safeInvoke('utils:open-external', url),
      showInFolder: (filePath) => safeInvoke('utils:show-in-folder', filePath),
      resizeSaveImage: (filePath, buffer) => safeInvoke('utils:resize-save-image', { filePath, buffer }),
      scanImageFolder: (folderPath) => safeInvoke('utils:scan-image-folder', folderPath),
      readImageFile: (filePath) => safeInvoke('utils:read-image-file', filePath),

    /**
     * Sanitize HTML content to prevent XSS (including attribute/quote breakout)
     */
    sanitizeHTML: (html) => {
      if (html === null || html === undefined) return '';
      return String(html)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /**
     * Format file size in human readable format
     */
    formatFileSize: (bytes) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    /**
     * Debounce function to limit rapid function calls
     */
    debounce: (func, wait) => {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },

    /**
     * Get current timestamp
     */
    timestamp: () => new Date().toISOString(),

    /**
     * Generate random ID
     */
    generateId: () => Math.random().toString(36).substr(2, 9),

    // IPC utils for Tag Editor
    getDownloadedArtists: () => safeInvoke('tag-editor:get-downloaded-artists'),
    getArtistTagData: (artistName) => safeInvoke('tag-editor:get-artist-tag-data', artistName),
    openFolder: (artistName) => safeInvoke('utils:open-downloads-folder', artistName)
  },

  // Tag Editor API
  tagEditor: {
    getAvailableArtists: () => safeInvoke('tag-editor:get-downloaded-artists'),
    getDownloadedArtists: () => safeInvoke('tag-editor:get-downloaded-artists'),
    loadArtistFiles: (artistName) => safeInvoke('tag-editor:get-artist-tag-data', artistName),
    getArtistTagData: (artistName) => safeInvoke('tag-editor:get-artist-tag-data', artistName),
    saveTagData: (artistName, postId, tags, tagPath) => safeInvoke('tag-editor:save-tag-data', artistName, postId, tags, tagPath),
    batchSaveTagData: (artistName, tagDataArray) => safeInvoke('tag-editor:batch-save-tag-data', artistName, tagDataArray),
    exportTagData: (artistName, format) => safeInvoke('tag-editor:export-tag-data', artistName, format),
    analyzeTagFrequency: (artistName) => safeInvoke('tag-editor:analyze-tags', artistName),
    // Custom folder methods
    browseCustomFolder: () => safeInvoke('tag-editor:browse-custom-folder'),
    scanCustomFolder: (folderPath) => safeInvoke('tag-editor:scan-custom-folder', folderPath),
    loadCustomFolder: (customFolderData) => safeInvoke('tag-editor:load-custom-folder', customFolderData),
    saveCustomTagData: (tagFilePath, tags) => safeInvoke('tag-editor:save-custom-tag-data', tagFilePath, tags),
    deleteFile: (imagePath, tagPath) => safeInvoke('tag-editor:delete-file', imagePath, tagPath),
    thumbnail: (imagePath) => safeInvoke('tag-editor:thumbnail', imagePath),
    // Hydra tag check and heatmaps
    hydraAvailable: () => safeInvoke('tag-editor:hydra-available'),
    hydraTags: (imagePath, tags, hidden, options) => safeInvoke('tag-editor:hydra-tags', imagePath, tags, hidden, options),
    hydraHeatmap: (imagePath, tag) => safeInvoke('tag-editor:hydra-heatmap', imagePath, tag)
  },

  // Dialog methods
  dialog: {
    openDirectory: () => safeInvoke('dialog:open-directory')
  },

  // System load
  system: {
    getGpuStatus: () => safeInvoke('system:gpu-status')
  },

  // Image Cleanup API
  cleanup: {
    getStatus: () => safeInvoke('cleanup:status'),
    checkServer: (url, models) => safeInvoke('cleanup:check-server', url, models),
    getState: (filePaths) => safeInvoke('cleanup:state', filePaths),
    loadMask: (filePath) => safeInvoke('cleanup:load-mask', filePath),
    saveMask: (filePath, png) => safeInvoke('cleanup:save-mask', filePath, png),
    findBubbles: (filePath, options) => safeInvoke('cleanup:find-bubbles', filePath, options),
    bubbleAt: (filePath, x, y, options) => safeInvoke('cleanup:bubble-at', filePath, x, y, options),
    repair: (filePath, options) => safeInvoke('cleanup:repair', filePath, options),
    stop: () => safeInvoke('cleanup:stop'),
    keep: (filePath, tryFile, options) => safeInvoke('cleanup:keep', filePath, tryFile, options),
    discard: (filePath) => safeInvoke('cleanup:discard', filePath),
    onProgress: (callback) => safeOn('cleanup:progress', callback)
  },

  // Prompts saved from the Auto Prompter
  prompts: {
    list: () => safeInvoke('prompts:list'),
    save: (entry) => safeInvoke('prompts:save', entry),
    remove: (id) => safeInvoke('prompts:delete', id)
  },

  // Natural-language captions (Tag Editor > Caption with AI)
  captions: {
    models: () => safeInvoke('captions:models'),
    run: (items, options) => safeInvoke('captions:run', items, options),
    cancel: () => safeInvoke('captions:cancel'),
    onProgress: (callback) => safeOn('captions:progress', callback)
  },

  // Dataset libraries (Settings > Storage)
  storage: {
    getLibraries: () => safeInvoke('storage:get-libraries'),
    saveLibraries: (libraries, defaultId) => safeInvoke('storage:save-libraries', libraries, defaultId),
    openLibrary: (id) => safeInvoke('storage:open-library', id)
  },

  // Model downloads (Settings > Models and the first-run prompt)
  models: {
    getStatus: () => safeInvoke('models:status'),
    download: (packIds) => safeInvoke('models:download', packIds),
    cancel: () => safeInvoke('models:cancel'),
    openFolder: () => safeInvoke('models:open-folder'),
    importFromFolder: () => safeInvoke('models:import'),
    onProgress: (callback) => safeOn('models:progress', callback)
  },

  // Video Frames API
  videoFrames: {
    saveFrame: (folder, fileName, data) => safeInvoke('video-frames:save-frame', folder, fileName, data)
  },

  // Image Upscaler API
  imageUpscaler: {
    getStatus: () => safeInvoke('image-upscaler:status'),
    upscale: (filePath, options) => safeInvoke('image-upscaler:upscale', filePath, options),
    upscaleAllModels: (filePath, options) => safeInvoke('image-upscaler:upscale-all-models', filePath, options),
    onProgress: (callback) => safeOn('image-upscaler:progress', callback),
    onModelProgress: (callback) => safeOn('image-upscaler:model-progress', callback)
  },

  // Comic Panels API
  comicPanels: {
    getStatus: () => safeInvoke('comic-panels:status'),
    detect: (filePath, options) => safeInvoke('comic-panels:detect', filePath, options),
    loadLayout: (filePath) => safeInvoke('comic-panels:load-layout', filePath),
    saveLayout: (filePath, layout) => safeInvoke('comic-panels:save-layout', filePath, layout),
    exportPanels: (filePath, panels, options) => safeInvoke('comic-panels:export', filePath, panels, options),
    applyCleaned: (filePath, panels, outputDir) => safeInvoke('comic-panels:apply-cleaned', filePath, panels, outputDir),
    exportedNames: (filePath, count, outputDir) => safeInvoke('comic-panels:exported-names', filePath, count, outputDir),
    previewTags: (filePath, panels) => safeInvoke('comic-panels:tags', filePath, panels),
    panelThumbs: (filePath, panels) => safeInvoke('comic-panels:thumbs', filePath, panels),
    loadLearning: (folder) => safeInvoke('comic-panels:load-learning', folder),
    saveLearning: (folder, learning) => safeInvoke('comic-panels:save-learning', folder, learning)
  },

  // Image Organizer API
  imageOrganizer: {
    scanFolder: (folderPath)                   => safeInvoke('image-organizer:scan-folder', folderPath),
    organize:   (operations, outputPath, mode) => safeInvoke('image-organizer:organize',    operations, outputPath, mode),
    openFolder: (folderPath)                   => safeInvoke('image-organizer:open-folder', folderPath)
  }
};

/**
 * Development and debugging utilities
 */
const devAPI = {
  log: (...args) => console.log('[RENDERER]', ...args),
  warn: (...args) => console.warn('[RENDERER]', ...args),
  error: (...args) => console.error('[RENDERER]', ...args),
  inspect: (obj) => console.dir(obj, { depth: null }),
  time: (label) => console.time(label),
  timeEnd: (label) => console.timeEnd(label)
};

/**
 * Version information
 */
const versions = {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
  platform: process.platform,
  arch: process.arch
};

/**
 * Error handling utilities
 */
const errorHandler = {
  /**
   * Set up global error handlers
   */
  setupGlobalHandlers: () => {
    window.addEventListener('error', (event) => {
      console.error('Global error:', {
        message: event.error?.message || event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection:', {
        reason: event.reason,
        promise: event.promise
      });
    });
  }
};

// Expose APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
contextBridge.exposeInMainWorld('versions', versions);

// Expose development tools only in development
if (process.env.NODE_ENV === 'development') {
  contextBridge.exposeInMainWorld('devAPI', devAPI);
}

// Always expose error handler
contextBridge.exposeInMainWorld('errorHandler', errorHandler);

console.log('✅ Preload script loaded successfully');
console.log('🔗 API exposed:', Object.keys(electronAPI));