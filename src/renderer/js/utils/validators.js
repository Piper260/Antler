/**
 * validators.js
 * Common validation utilities for input validation
 * Consolidated from: PostLookupTool.js, preload.js, various tools
 */

/**
 * Validate if a string is a valid E621 post ID
 * @param {string|number} postId - Post ID to validate
 * @returns {boolean} True if valid post ID
 */
export function validatePostId(postId) {
  if (typeof postId !== 'string' && typeof postId !== 'number') {
    return false;
  }
  const normalized = String(postId).trim();
  return /^\d+$/.test(normalized) && parseInt(normalized) > 0;
}

/**
 * Validate if a string is a valid URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
export function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validate if a string is a valid email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate if a string is empty or only whitespace
 * @param {string} str - String to validate
 * @returns {boolean} True if empty
 */
export function isEmpty(str) {
  return !str || str.trim().length === 0;
}

/**
 * Validate if a value is a positive number
 * @param {any} value - Value to validate
 * @returns {boolean} True if positive number
 */
export function isPositiveNumber(value) {
  const num = Number(value);
  return !isNaN(num) && num > 0;
}

/**
 * Validate if a value is within a range
 * @param {number} value - Value to check
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {boolean} True if within range
 */
export function isInRange(value, min, max) {
  const num = Number(value);
  return !isNaN(num) && num >= min && num <= max;
}

/**
 * Validate if a string matches a filename pattern (alphanumeric, dashes, underscores)
 * @param {string} filename - Filename to validate
 * @returns {boolean} True if valid filename
 */
export function isValidFilename(filename) {
  if (isEmpty(filename)) return false;
  // Allow alphanumeric, dashes, underscores, dots
  const filenameRegex = /^[a-zA-Z0-9._-]+$/;
  return filenameRegex.test(filename);
}

/**
 * Validate if a string is a valid hex color code
 * @param {string} color - Color code to validate
 * @returns {boolean} True if valid hex color
 */
export function isValidHexColor(color) {
  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexRegex.test(color);
}

/**
 * Check if a value is not null or undefined
 * @param {any} value - Value to check
 * @returns {boolean} True if value exists
 */
export function exists(value) {
  return value !== null && value !== undefined;
}
