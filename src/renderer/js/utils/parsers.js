/**
 * parsers.js
 * Safe parsing utilities with error handling and fallbacks
 * Consolidated from: Various tools with JSON.parse, parseInt, parseFloat
 */

/**
 * Safe JSON parse with fallback
 * @param {string} jsonString - JSON string to parse
 * @param {any} fallback - Fallback value if parse fails (default null)
 * @returns {any} Parsed object or fallback
 */
export function safeJsonParse(jsonString, fallback = null) {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.warn('JSON parse failed:', e.message);
    return fallback;
  }
}

/**
 * Safe parseInt with fallback
 * @param {any} value - Value to parse
 * @param {number} fallback - Fallback value if parse fails (default 0)
 * @param {number} radix - Radix for parsing (default 10)
 * @returns {number} Parsed integer or fallback
 */
export function safeParseInt(value, fallback = 0, radix = 10) {
  const parsed = parseInt(value, radix);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Safe parseFloat with fallback
 * @param {any} value - Value to parse
 * @param {number} fallback - Fallback value if parse fails (default 0.0)
 * @returns {number} Parsed float or fallback
 */
export function safeParseFloat(value, fallback = 0.0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse boolean from string (handles 'true', 'false', '1', '0', etc.)
 * @param {any} value - Value to parse as boolean
 * @param {boolean} fallback - Fallback value (default false)
 * @returns {boolean} Parsed boolean
 */
export function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return fallback;
  
  const lower = value.toLowerCase().trim();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return fallback;
}

/**
 * Parse comma-separated string into array
 * @param {string} str - Comma-separated string
 * @param {boolean} trim - Whether to trim whitespace (default true)
 * @returns {string[]} Array of strings
 */
export function parseCommaSeparated(str, trim = true) {
  if (!str || typeof str !== 'string') return [];
  const items = str.split(',');
  return trim ? items.map(item => item.trim()).filter(item => item.length > 0) : items;
}

/**
 * Parse query string into object
 * @param {string} queryString - Query string (with or without ?)
 * @returns {Object} Parsed query parameters
 */
export function parseQueryString(queryString) {
  if (!queryString) return {};
  
  const clean = queryString.startsWith('?') ? queryString.slice(1) : queryString;
  const params = new URLSearchParams(clean);
  const result = {};
  
  for (const [key, value] of params) {
    result[key] = value;
  }
  
  return result;
}

/**
 * Parse number with units (e.g., "10k" -> 10000, "5.5M" -> 5500000)
 * @param {string} str - String with number and unit
 * @returns {number|null} Parsed number or null if invalid
 */
export function parseNumberWithUnits(str) {
  if (typeof str !== 'string') return null;
  
  const match = str.match(/^([\d.]+)([kmb])?$/i);
  if (!match) return null;
  
  const num = parseFloat(match[1]);
  const unit = match[2] ? match[2].toLowerCase() : '';
  
  const multipliers = { k: 1000, m: 1000000, b: 1000000000 };
  return num * (multipliers[unit] || 1);
}

/**
 * Parse duration string into milliseconds (e.g., "1h 30m" -> 5400000)
 * @param {string} str - Duration string
 * @returns {number} Milliseconds
 */
export function parseDuration(str) {
  if (!str || typeof str !== 'string') return 0;
  
  let total = 0;
  const pattern = /(\d+)([smhd])/g;
  let match;
  
  const multipliers = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };
  
  while ((match = pattern.exec(str)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2];
    total += value * (multipliers[unit] || 0);
  }
  
  return total;
}

/**
 * Parse hex color to RGB object
 * @param {string} hex - Hex color code (with or without #)
 * @returns {Object|null} {r, g, b} object or null if invalid
 */
export function parseHexColor(hex) {
  if (!hex || typeof hex !== 'string') return null;
  
  const clean = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean) && !/^[0-9A-Fa-f]{3}$/.test(clean)) {
    return null;
  }
  
  // Expand shorthand (e.g., "03F" -> "0033FF")
  const full = clean.length === 3 
    ? clean.split('').map(c => c + c).join('')
    : clean;
  
  return {
    r: parseInt(full.substr(0, 2), 16),
    g: parseInt(full.substr(2, 2), 16),
    b: parseInt(full.substr(4, 2), 16)
  };
}

/**
 * Try multiple parsers until one succeeds
 * @param {any} value - Value to parse
 * @param {Function[]} parsers - Array of parser functions
 * @param {any} fallback - Fallback if all parsers fail
 * @returns {any} First successful parse result or fallback
 */
export function tryParsers(value, parsers, fallback = null) {
  for (const parser of parsers) {
    try {
      const result = parser(value);
      if (result !== null && result !== undefined) {
        return result;
      }
    } catch (e) {
      // Continue to next parser
    }
  }
  return fallback;
}
