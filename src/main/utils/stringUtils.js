/**
 * stringUtils.js (Main Process)
 * String manipulation utilities for the main process
 * Consolidated from: TagEditorIPC.js
 */

/**
 * Calculate similarity between two strings using Levenshtein-like algorithm
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score between 0.0 and 1.0
 */
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  // Simple substring check for now
  if (longer.includes(shorter) || shorter.includes(longer)) {
    return 0.9;
  }
  
  // Check for common prefixes/suffixes
  const prefixMatch = commonPrefix(str1, str2);
  const suffixMatch = commonSuffix(str1, str2);
  
  const matchRatio = (prefixMatch + suffixMatch) / Math.max(str1.length, str2.length);
  return matchRatio;
}

/**
 * Find common prefix length between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Length of common prefix
 */
function commonPrefix(str1, str2) {
  let i = 0;
  while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
    i++;
  }
  return i;
}

/**
 * Find common suffix length between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Length of common suffix
 */
function commonSuffix(str1, str2) {
  let i = 0;
  while (i < str1.length && i < str2.length && 
         str1[str1.length - 1 - i] === str2[str2.length - 1 - i]) {
    i++;
  }
  return i;
}

/**
 * Normalize path separators (convert backslashes to forward slashes)
 * @param {string} path - Path string
 * @returns {string} Normalized path
 */
function normalizePath(path) {
  if (!path) return '';
  return path.replace(/\\/g, '/');
}

/**
 * Remove file:// protocol from URL path
 * @param {string} path - Path with file:// protocol
 * @returns {string} Clean path
 */
function sanitizeFilePath(path) {
  if (!path) return '';
  return path.replace(/^file:\/\//, '');
}

/**
 * Sanitize string for use in filesystem paths
 * Removes special characters, keeps alphanumeric, spaces, dashes
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeForFilesystem(str) {
  if (!str) return '';
  return str.replace(/[^\w\s\-]/g, '').toLowerCase();
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Find fuzzy matches in an array of strings
 * @param {string} query - Search query
 * @param {string[]} items - Array of strings to search
 * @param {number} threshold - Similarity threshold (0.0 to 1.0)
 * @returns {Array} Matching items with similarity scores
 */
function fuzzyMatch(query, items, threshold = 0.6) {
  const results = [];
  
  for (const item of items) {
    const similarity = calculateSimilarity(query.toLowerCase(), item.toLowerCase());
    if (similarity >= threshold) {
      results.push({ item, similarity });
    }
  }
  
  return results.sort((a, b) => b.similarity - a.similarity);
}

module.exports = {
  calculateSimilarity,
  commonPrefix,
  commonSuffix,
  normalizePath,
  sanitizeFilePath,
  sanitizeForFilesystem,
  levenshteinDistance,
  fuzzyMatch
};
