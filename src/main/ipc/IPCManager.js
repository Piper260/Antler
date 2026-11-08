// src/main/ipc/IPCManager.js - IPC Management System
const { ipcMain } = require('electron');
const { loggers } = require('../../../config/logging.config');

const log = loggers.ipc;

/**
 * Centralized IPC Management System
 */
class IPCManager {
  constructor() {
    this.handlers = new Map();
    this.listeners = new Map();
    
    log.info('🔗 Initializing IPC Manager...');
    this.setupDefaultHandlers();
  }

  /**
   * Set up default IPC handlers
   */
  setupDefaultHandlers() {
    log.debug('📡 Setting up default IPC handlers...');
    
    // App control handlers
    this.registerListener('app:close', () => {
      log.info('📞 IPC: App close requested');
      require('electron').app.quit();
    });

    this.registerListener('app:minimize', () => {
      log.info('📞 IPC: App minimize requested');
      const mainWindow = require('electron').BrowserWindow.getFocusedWindow();
      if (mainWindow) {
        mainWindow.minimize();
      }
    });

    this.registerListener('app:maximize-restore', () => {
      log.info('📞 IPC: App maximize/restore requested');
      const mainWindow = require('electron').BrowserWindow.getFocusedWindow();
      if (mainWindow) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
      }
    });

    // System info handler
    this.registerHandler('app:get-info', async () => {
      log.debug('📞 IPC: App info requested');
      return {
        version: require('../../../package.json').version,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron
      };
    });

    log.info('✅ Default IPC handlers registered');
  }

  /**
   * Register an async IPC handler (handle/invoke pattern)
   * @param {string} channel - IPC channel name
   * @param {Function} handler - Handler function
   */
  registerHandler(channel, handler) {
    if (this.handlers.has(channel)) {
      log.warn(`⚠️ IPC handler for channel '${channel}' already exists. Overriding...`);
      ipcMain.removeHandler(channel);
    }

    const wrappedHandler = async (event, ...args) => {
      const startTime = Date.now();
      log.debug(`📞 IPC Handler called: ${channel}`, { args });

      try {
        const result = await handler(event, ...args);
        const duration = Date.now() - startTime;
        
        log.debug(`✅ IPC Handler completed: ${channel}`, { 
          duration: `${duration}ms`,
          success: true 
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        log.error(`❌ IPC Handler failed: ${channel}`, {
          duration: `${duration}ms`,
          error: error.message,
          stack: error.stack
        });
        
        // Return structured error to renderer
        throw {
          message: error.message,
          code: error.code || 'UNKNOWN_ERROR',
          type: 'ipc-handler-error'
        };
      }
    };

    ipcMain.handle(channel, wrappedHandler);
    this.handlers.set(channel, wrappedHandler);
    
    log.debug(`📝 Registered IPC handler: ${channel}`);
  }

  /**
   * Register an IPC listener (send/on pattern)
   * @param {string} channel - IPC channel name
   * @param {Function} listener - Listener function
   */
  registerListener(channel, listener) {
    if (this.listeners.has(channel)) {
      log.warn(`⚠️ IPC listener for channel '${channel}' already exists. Overriding...`);
      ipcMain.removeAllListeners(channel);
    }

    const wrappedListener = (event, ...args) => {
      log.debug(`📞 IPC Listener called: ${channel}`, { args });

      try {
        listener(event, ...args);
        log.debug(`✅ IPC Listener completed: ${channel}`);
      } catch (error) {
        log.error(`❌ IPC Listener failed: ${channel}`, {
          error: error.message,
          stack: error.stack
        });
      }
    };

    ipcMain.on(channel, wrappedListener);
    this.listeners.set(channel, wrappedListener);
    
    log.debug(`📝 Registered IPC listener: ${channel}`);
  }

  /**
   * Unregister an IPC handler
   * @param {string} channel - IPC channel name
   */
  unregisterHandler(channel) {
    if (this.handlers.has(channel)) {
      ipcMain.removeHandler(channel);
      this.handlers.delete(channel);
      log.debug(`🗑️ Unregistered IPC handler: ${channel}`);
    } else {
      log.warn(`⚠️ Attempted to unregister non-existent handler: ${channel}`);
    }
  }

  /**
   * Unregister an IPC listener
   * @param {string} channel - IPC channel name
   */
  unregisterListener(channel) {
    if (this.listeners.has(channel)) {
      ipcMain.removeAllListeners(channel);
      this.listeners.delete(channel);
      log.debug(`🗑️ Unregistered IPC listener: ${channel}`);
    } else {
      log.warn(`⚠️ Attempted to unregister non-existent listener: ${channel}`);
    }
  }

  /**
   * Send message to all renderer processes
   * @param {string} channel - IPC channel name
   * @param {*} data - Data to send
   */
  broadcast(channel, data) {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    
    log.debug(`📺 Broadcasting to ${windows.length} windows: ${channel}`, { data });
    
    windows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    });
  }

  /**
   * Get statistics about registered handlers and listeners
   */
  getStats() {
    return {
      handlers: Array.from(this.handlers.keys()),
      listeners: Array.from(this.listeners.keys()),
      handlerCount: this.handlers.size,
      listenerCount: this.listeners.size
    };
  }

  /**
   * Cleanup all IPC handlers and listeners
   */
  cleanup() {
    log.info('🧹 Cleaning up IPC Manager...');
    
    // Remove all handlers
    for (const channel of this.handlers.keys()) {
      ipcMain.removeHandler(channel);
    }
    this.handlers.clear();
    
    // Remove all listeners
    for (const channel of this.listeners.keys()) {
      ipcMain.removeAllListeners(channel);
    }
    this.listeners.clear();
    
    log.info('✅ IPC Manager cleanup complete');
  }
}

module.exports = IPCManager;