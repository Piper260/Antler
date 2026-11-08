// src/renderer/js/utils/logger.js - Conditional logging utility

const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = {
  // Only log in development mode
  debug: (...args) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  
  // Always log warnings
  warn: (...args) => {
    console.warn(...args);
  },
  
  // Always log errors
  error: (...args) => {
    console.error(...args);
  },
  
  // Always log important info
  info: (...args) => {
    console.log(...args);
  }
};
