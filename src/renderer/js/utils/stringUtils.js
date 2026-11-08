/**
 * stringUtils.js (Renderer)
 * String manipulation utilities for the renderer process
 * Consolidated from: ArtistSearchTool.js, PostLookupTool.js
 */

/**
 * Sanitize string for use in filesystem paths
 * Removes special characters, keeps alphanumeric, spaces, dashes
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeForFilesystem(str) {
  if (!str) return '';
  return str.replace(/[^\w\s\-]/g, '').toLowerCase();
}

/**
 * Convert underscores to spaces
 * @param {string} str - String with underscores
 * @returns {string} String with spaces
 */
export function underscoresToSpaces(str) {
  if (!str) return '';
  return str.replace(/_/g, ' ');
}

/**
 * Convert spaces to underscores
 * @param {string} str - String with spaces
 * @returns {string} String with underscores
 */
export function spacesToUnderscores(str) {
  if (!str) return '';
  return str.replace(/\s+/g, '_');
}

/**
 * Capitalize first letter of each word
 * @param {string} str - String to capitalize
 * @returns {string} Title cased string
 */
export function toTitleCase(str) {
  if (!str) return '';
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

/**
 * Truncate string to specified length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add (default '...')
 * @returns {string} Truncated string
 */
export function truncate(str, maxLength, suffix = '...') {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Remove multiple consecutive spaces
 * @param {string} str - String to clean
 * @returns {string} Cleaned string
 */
export function normalizeWhitespace(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Escape special regex characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for regex
 */
export function escapeRegex(str) {
  if (!str) return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert kebab-case to camelCase
 * @param {string} str - Kebab-case string
 * @returns {string} camelCase string
 */
export function kebabToCamel(str) {
  if (!str) return '';
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

/**
 * Convert camelCase to kebab-case
 * @param {string} str - camelCase string
 * @returns {string} kebab-case string
 */
export function camelToKebab(str) {
  if (!str) return '';
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Generate slug from string (URL-friendly)
 * @param {string} str - String to slugify
 * @returns {string} URL-friendly slug
 */
export function slugify(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Remove HTML tags from string
 * @param {string} str - String with HTML
 * @returns {string} Plain text
 */
export function stripHtmlTags(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '');
}

/**
 * Count words in a string
 * @param {string} str - String to count
 * @returns {number} Word count
 */
export function wordCount(str) {
  if (!str) return 0;
  return str.trim().split(/\s+/).length;
}

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string|null} Domain or null if invalid
 */
export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    return null;
  }
}
