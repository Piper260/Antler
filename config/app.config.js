// config/app.config.js - Core application configuration
const path = require('path');

// Environment detection
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const isTesting = process.env.NODE_ENV === 'test';

const config = {
  // Application metadata
  app: {
    name: 'Antler',
    version: '1.0.0',
    description: 'Desktop workbench for building LoRA training datasets from e621',
    author: 'Piper260',
    environment: process.env.NODE_ENV || 'development',
    isDevelopment,
    isProduction,
    isTesting
  },

  // Main window configuration
  window: {
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    maxWidth: 2560,
    maxHeight: 1600,
    frame: false,
    backgroundColor: '#2C313C',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true, // Renderer never makes direct network requests (all API calls go through main), so this stays on in every environment
      backgroundThrottling: false, // Keep background tabs responsive
      offscreen: false // Disable offscreen rendering for better performance
    }
  },

  // Feature flags
  features: {
    devTools: isDevelopment,
    autoUpdater: isProduction,
    crashReporter: isProduction,
    hotReload: isDevelopment,
    analytics: isProduction,
    errorReporting: true,
    performanceMonitoring: isProduction
  },

  // Paths configuration
  // Note: logs, temp, and userdata paths are dynamically resolved at runtime using app.getPath('userData')
  // This follows industry standards for user data storage
  paths: {
    root: path.resolve(__dirname, '..'),
    src: path.resolve(__dirname, '..', 'src'),
    config: __dirname,
    preload: path.resolve(__dirname, '..', 'src', 'preload', 'preload.js'),
    renderer: path.resolve(__dirname, '..', 'src', 'renderer', 'index.html')
  },

  // API configuration
  api: {
    e621: {
      baseUrl: 'https://e621.net',
      rateLimit: 500, // milliseconds between requests
      timeout: 10000,
      retries: 3,
      userAgent: 'Antler/1.0',
      cache: {
        enabled: true,
        ttl: 5 * 60 * 1000, // 5 minutes
        maxSize: 100
      }
    }
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    file: {
      enabled: true,
      maxsize: 5242880, // 5MB
      maxFiles: 5
      // Note: Actual log file paths are configured in logging.config.js using app.getPath('userData')
    },
    console: {
      enabled: true,
      colorize: isDevelopment,
      timestamp: true
    }
  },

  // Security configuration
  security: {
    csp: {
      enabled: isProduction,
      policy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;"
    },
    encryption: {
      algorithm: 'aes-256-gcm',
      keyLength: 32
    }
  },

  // Performance configuration
  performance: {
    cache: {
      enabled: true,
      maxAge: 1000 * 60 * 60, // 1 hour
      maxSize: 50 * 1024 * 1024 // 50MB
    },
    lazyLoading: {
      enabled: true,
      threshold: 1000 // milliseconds
    },
    memoryManagement: {
      gcInterval: 30000, // 30 seconds
      maxMemoryUsage: 512 * 1024 * 1024 // 512MB
    }
  },

  // Development configuration
  development: {
    hotReload: {
      enabled: isDevelopment,
      ignored: /logs|node_modules|\.git/
    },
    debugging: {
      enabled: isDevelopment,
      verboseLogging: isDevelopment,
      showPerformanceMetrics: isDevelopment
    }
  },

  // Tool system configuration
  tools: {
    autoLoad: true,
    loadPath: path.join(process.cwd(), 'src', 'renderer', 'js', 'modules', 'tools'),
    defaultTool: 'PostIDTool',
    maxConcurrentTools: 5
  }
};

// Environment-specific overrides
if (isDevelopment) {
  config.logging.level = 'debug';
  config.api.e621.timeout = 30000; // Longer timeout for debugging
}

if (isProduction) {
  config.logging.level = 'warn';
  config.window.webPreferences.webSecurity = true;
}

if (isTesting) {
  config.logging.level = 'error';
  config.api.e621.baseUrl = 'http://localhost:3000'; // Mock server
}

// Validation function
function validateConfig() {
  const errors = [];

  // Check required paths exist
  const requiredPaths = ['root', 'src', 'config'];
  requiredPaths.forEach(pathKey => {
    if (!config.paths[pathKey]) {
      errors.push(`Missing required path: ${pathKey}`);
    }
  });

  // Validate window dimensions
  if (config.window.width < config.window.minWidth) {
    errors.push('Window width cannot be less than minWidth');
  }
  if (config.window.height < config.window.minHeight) {
    errors.push('Window height cannot be less than minHeight');
  }

  // Validate API configuration
  if (!config.api.e621.baseUrl) {
    errors.push('E621 API base URL is required');
  }
  if (config.api.e621.rateLimit < 500) {
    errors.push('E621 API rate limit cannot be less than 500ms');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

// Get configuration value with dot notation
function get(path, defaultValue = undefined) {
  return path.split('.').reduce((obj, key) => 
    (obj && obj[key] !== undefined) ? obj[key] : defaultValue, config
  );
}

// Set configuration value with dot notation
function set(path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((obj, key) => {
    if (!obj[key]) obj[key] = {};
    return obj[key];
  }, config);
  target[lastKey] = value;
}

// Export configuration with utility functions
module.exports = {
  ...config,
  get,
  set,
  validate: validateConfig,
  isDevelopment,
  isProduction,
  isTesting
};