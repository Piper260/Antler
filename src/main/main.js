// src/main/main.js - Enhanced with setup window
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Must run before any service touches userData (see the file for why).
const { migrateLegacyUserData } = require('./utils/legacyUserData');
migrateLegacyUserData(app.getPath('appData'), app.getPath('userData'));

// Import services
const SettingsService = require('./services/SettingsService');
const SettingsIPC = require('./ipc/SettingsIPC');
const E621Service = require('./services/E621Service');
const E621IPC = require('./ipc/E621IPC');
const UtilsIPC = require('./ipc/UtilsIPC');
const TagEditorIPC = require('./ipc/TagEditorIPC');
const { UpdateService } = require('./services/UpdateService');
const UpdateIPC = require('./ipc/UpdateIPC');
const AIService = require('./services/AIService');
const AIHandlers = require('./ipc/AIHandlers');
const DialogIPC = require('./ipc/DialogIPC');
const SystemIPC = require('./ipc/SystemIPC');
const ImageUpscalerIPC = require('./ipc/ImageUpscalerIPC');
const ImageOrganizerIPC = require('./ipc/ImageOrganizerIPC');
const ComicPanelIPC = require('./ipc/ComicPanelIPC');
const VideoFrameIPC = require('./ipc/VideoFrameIPC');
const CleanupIPC = require('./ipc/CleanupIPC');
const ModelsIPC = require('./ipc/ModelsIPC');
const versionInfo = require('../shared/version');

// Log version information on startup
console.log('[INFO] Antler Starting...');
versionInfo.log();

// Try to load config, fall back to defaults if not available
let config;
try {
  config = require('../../config/app.config');
  console.log('[INFO] Config loaded successfully');
} catch (error) {
  console.log('[WARN] Config not found, using defaults');
  config = {
    window: {
      width: 1200,
      height: 680,
      minWidth: 940,
      minHeight: 560,
      frame: false,
      backgroundColor: '#2C313C'
    },
    paths: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      renderer: path.join(__dirname, '..', 'renderer', 'index.html')
    }
  };
}

let mainWindow;
let settingsService;
let settingsIPC;
let e621Service;
let e621IPC;
let utilsIPC;
let tagEditorIPC;
let updateService;
let updateIPC;
let aiService;
let aiHandlers;

console.log('🚀 Starting Antler...');

function configureCachePath() {
  try {
    const userDataPath = app.getPath('userData');
    const cachePath = path.join(userDataPath, 'GPUCache');
    
    // Ensure directories exist with proper permissions
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true });
    }
    
    console.log('🗂️ Cache configured at', userDataPath);
  } catch (error) {
    console.error('❌ Failed to configure cache path:', error);
  }
}

// e621's image CDN rejects (403) cross-site no-cors requests that lack an
// e621 Referer. The renderer is loaded from file://, so <img> requests carry
// no Referer and every thumbnail fails. Supply one for e621 image hosts.
function configureImageReferer() {
  const filter = { urls: ['https://static1.e621.net/*', 'https://static1.e926.net/*'] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders, Referer: 'https://e621.net/' };
    callback({ requestHeaders });
  });
}

const createMainWindow = () => {
  console.log('🪟 Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    minWidth: config.window.minWidth,
    minHeight: config.window.minHeight,
    frame: config.window.frame,
    backgroundColor: config.window.backgroundColor,
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    show: false, // Hidden until ready-to-show fires to prevent flash
    webPreferences: {
      ...(config.window.webPreferences || {}),
      // Security-critical flags are enforced here regardless of config
      // contents so they can never be silently disabled.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: config.paths.preload,
    },
  });

  // The window only ever shows the app's own page. Links that would open a
  // new window go to the default browser (web links only), and anything that
  // tries to navigate the app away from its page is stopped.
  const appUrl = require('url').pathToFileURL(config.paths.renderer).toString();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(error => console.error('Failed to open link:', error));
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== appUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // Show window only once fully rendered to avoid the startup flash/flicker
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('🪟 Window ready and shown');
  });

  // Load the HTML file
  mainWindow.loadFile(config.paths.renderer)
    .then(() => {
      console.log('✅ HTML loaded successfully');
    })
    .catch((error) => {
      console.error('❌ Failed to load HTML:', error);
    });

  // Setup window controls and events
  setupWindowControls();
  setupWindowEvents();
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
  
  return mainWindow;
};

async function setupServices() {
  console.log('⚙️ Setting up services...');
  
  // Initialize settings service
  settingsService = new SettingsService();
  
  // Initialize E621 service
  e621Service = new E621Service(settingsService);

  // Initialize Update service
  updateService = new UpdateService();

  // Initialize AI service
  aiService = new AIService(settingsService);
  
  // Initialize IPC handlers
  settingsIPC = new SettingsIPC(settingsService);
  e621IPC = new E621IPC(e621Service);
  utilsIPC = new UtilsIPC(settingsService);
  tagEditorIPC = new TagEditorIPC(settingsService);
  updateIPC = new UpdateIPC(updateService);
  aiHandlers = new AIHandlers(aiService);
  new DialogIPC();
  new SystemIPC();
  new ImageUpscalerIPC();
  new ImageOrganizerIPC();
  new ComicPanelIPC();
  new VideoFrameIPC();
  new CleanupIPC();
  new ModelsIPC();

  console.log('✅ Services initialized');
}

function setupWindowControls() {
  console.log('🎛️ Setting up window controls...');

  ipcMain.on('app:close', () => {
    console.log('🔴 Close app requested');
    if (mainWindow) {
      mainWindow.close();
    }
  });

  ipcMain.on('app:minimize', () => {
    console.log('⬇️ Minimize app requested');
    if (mainWindow) {
      mainWindow.minimize();
    }
  });

  ipcMain.on('app:maximize-restore', () => {
    console.log('⬆️ Maximize/restore app requested');
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  // App info handler with version info
  ipcMain.handle('app:get-info', () => {
    const version = versionInfo.toObject();
    return {
      version: version.version,
      fullVersion: version.fullVersion,
      displayVersion: version.displayVersion,
      shortVersion: version.shortVersion,
      commit: version.commit,
      branch: version.branch,
      tag: version.tag,
      dirty: version.dirty,
      buildDate: version.buildDate,
      buildInfo: version.buildInfo,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      v8Version: process.versions.v8
    };
  });

  // Get commit history
  ipcMain.handle('app:get-commit-history', (event, limit = 10) => {
    try {
      const commits = versionInfo.getCommitHistory(limit);
      return {
        success: true,
        commits
      };
    } catch (error) {
      console.error('❌ Error getting commit history:', error);
      return {
        success: false,
        message: error.message,
        commits: []
      };
    }
  });
}

function setupWindowEvents() {
  console.log('📡 Setting up window events...');

  mainWindow.on('maximize', () => {
    console.log('📏 Window maximized');
    mainWindow.webContents.send('window:maximized');
  });

  mainWindow.on('unmaximize', () => {
    console.log('📐 Window restored');
    mainWindow.webContents.send('window:restored');
  });

  mainWindow.on('closed', () => {
    console.log('🗑️ Window closed');
    mainWindow = null;
  });
}

// Disable hardware acceleration — this is a UI-only app with no 3D/GPU needs.
// Prevents repeated GPU process crashes (exit_code=-1073740791) on Windows
// which cause the startup flash and fallback software rendering anyway.
app.disableHardwareAcceleration();

// Optional: force ANGLE backend (try: d3d11, d3d9, gl)
if (process.env.ANTLER_USE_ANGLE) {
  console.log('🎮 Forcing ANGLE backend via ANTLER_USE_ANGLE=', process.env.ANTLER_USE_ANGLE);
  app.commandLine.appendSwitch('use-angle', process.env.ANTLER_USE_ANGLE);
}

// Optional: enable extra GPU diagnostics
if (process.env.ANTLER_GPU_LOGGING === '1') {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1');
}

// App events
app.whenReady().then(async () => {
  console.log('⚡ Electron app ready');

  try {
    console.log('🧪 GPU feature status:', app.getGPUFeatureStatus());
  } catch (e) {
    console.warn('⚠️ Unable to read GPU feature status:', e?.message || e);
  }

  // Ensure Chromium disk cache lives in a writable location
  configureCachePath();
  configureImageReferer();

  // Create and show main window
  createMainWindow();
  
  // Set up services
  await setupServices();

  // Look for new versions in the background (installed builds only).
  updateService.start();

  console.log('✅ Application ready');
});

app.on('window-all-closed', () => {
  console.log('🚪 All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    console.log('🔄 Recreating window');
    createMainWindow();
  }
});

console.log('✅ Main process setup complete');