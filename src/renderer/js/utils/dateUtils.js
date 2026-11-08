/**
 * dateUtils.js
 * Date and time utilities
 * Consolidated from: preload.js, various tools
 */

/**
 * Get current timestamp in ISO format
 * @returns {string} ISO timestamp string
 */
export function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Format ISO date string to locale format
 * @param {string} isoString - ISO date string
 * @param {boolean} includeTime - Include time (default true)
 * @returns {string} Formatted date string
 */
export function formatISODate(isoString, includeTime = true) {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    if (includeTime) {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
    return date.toLocaleDateString();
  } catch (e) {
    return 'Invalid date';
  }
}

/**
 * Format date to relative time (e.g., "2 hours ago")
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Relative time string
 */
export function formatRelativeTime(date) {
  const now = new Date();
  const then = date instanceof Date ? date : new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  if (diffDay < 365) {
    const months = Math.floor(diffDay / 30);
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(diffDay / 365);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Format date to specific format
 * @param {Date} date - Date object
 * @param {string} format - Format string (YYYY-MM-DD, DD/MM/YYYY, etc.)
 * @returns {string} Formatted date string
 */
export function formatDate(date, format = 'YYYY-MM-DD') {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * Get timestamp for filename (safe for filesystems)
 * @returns {string} Timestamp like "2024-03-15_14-30-45"
 */
export function getFilenameTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Parse date from various formats
 * @param {string} dateString - Date string to parse
 * @returns {Date|null} Date object or null if invalid
 */
export function parseDate(dateString) {
  if (!dateString) return null;
  
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Check if date is today
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if date is today
 */
export function isToday(date) {
  const d = date instanceof Date ? date : new Date(date);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

/**
 * Check if date is within last N days
 * @param {Date|string} date - Date to check
 * @param {number} days - Number of days
 * @returns {boolean} True if within range
 */
export function isWithinDays(date, days) {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days && diffDays >= 0;
}

/**
 * Add days to a date
 * @param {Date} date - Starting date
 * @param {number} days - Days to add (can be negative)
 * @returns {Date} New date
 */
export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Get start of day (00:00:00)
 * @param {Date} date - Date to process
 * @returns {Date} Date at start of day
 */
export function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day (23:59:59)
 * @param {Date} date - Date to process
 * @returns {Date} Date at end of day
 */
export function endOfDay(date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Calculate duration between two dates
 * @param {Date|string} start - Start date
 * @param {Date|string} end - End date (default now)
 * @returns {Object} Duration object with days, hours, minutes, seconds
 */
export function getDuration(start, end = new Date()) {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  const diffMs = endDate - startDate;
  
  return {
    milliseconds: diffMs,
    seconds: Math.floor(diffMs / 1000),
    minutes: Math.floor(diffMs / (1000 * 60)),
    hours: Math.floor(diffMs / (1000 * 60 * 60)),
    days: Math.floor(diffMs / (1000 * 60 * 60 * 24))
  };
}
