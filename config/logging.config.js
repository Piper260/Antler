// config/logging.config.js - Professional logging system
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Ensure logs directory exists in userData
const logsDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    let logMessage = `${timestamp} [${level}]`;
    
    // Add component name if present
    if (component) {
      logMessage += ` [${component}]`;
    }
    
    logMessage += ` ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    
    return logMessage;
  })
);

// File format (JSON for easy parsing)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create main logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
  format: fileFormat,
  transports: [
    // Error log file (errors only)
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 3
    }),
    
    // Combined log file (all levels)
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Create component-specific loggers
const createComponentLogger = (component) => {
  return {
    debug: (message, meta = {}) => logger.debug(message, { component, ...meta }),
    info: (message, meta = {}) => logger.info(message, { component, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { component, ...meta }),
    error: (message, meta = {}) => logger.error(message, { component, ...meta })
  };
};

// Predefined component loggers
const loggers = {
  main: createComponentLogger('MAIN'),
  renderer: createComponentLogger('RENDERER'),
  ipc: createComponentLogger('IPC'),
  api: createComponentLogger('API'),
  config: createComponentLogger('CONFIG'),
  app: createComponentLogger('APP')
};

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
});

module.exports = {
  logger,
  createLogger: createComponentLogger,
  loggers
};