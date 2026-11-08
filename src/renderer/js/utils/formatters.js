/**
 * formatters.js
 * Common formatting utilities for displaying data
 * Consolidated from: PostLookupTool.js, E621Service.js, preload.js
 */

/**
 * Format file size in human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted string like "1.23 MB"
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format date string for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date string in locale format
 */
export function formatDate(dateString) {
  if (!dateString) return 'Unknown';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  } catch (e) {
    return 'Invalid date';
  }
}

/**
 * Shorten URL for display
 * @param {string} url - Full URL
 * @param {number} maxLength - Maximum length (default 50)
 * @returns {string} Shortened URL with ellipsis
 */
export function shortenUrl(url, maxLength = 50) {
  if (!url || url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
}

/**
 * Format number with thousands separators
 * @param {number} num - Number to format
 * @returns {string} Formatted number like "1,234,567"
 */
export function formatNumber(num) {
  if (typeof num !== 'number') return '0';
  return num.toLocaleString();
}

/**
 * Format duration in milliseconds to human readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration like "1h 23m 45s"
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format percentage with specified decimal places
 * @param {number} value - Decimal value (0-1)
 * @param {number} decimals - Number of decimal places (default 1)
 * @returns {string} Formatted percentage like "85.5%"
 */
export function formatPercentage(value, decimals = 1) {
  return (value * 100).toFixed(decimals) + '%';
}
