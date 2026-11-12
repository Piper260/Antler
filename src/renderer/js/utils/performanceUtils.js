/**
 * performanceUtils.js
 * Performance optimization utilities (debounce, throttle, etc.)
 * Consolidated from: preload.js, ArtistSearchTool.js
 */

/**
 * Debounce function - delays execution until after a wait period
 * Useful for search inputs, resize events, etc.
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function - limits execution to once per time period
 * Useful for scroll events, mousemove, etc.
 * @param {Function} func - Function to throttle
 * @param {number} limit - Milliseconds between executions
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Create a timeout-based throttle (used in ArtistSearchTool pattern)
 * This version cancels pending calls and reschedules
 * @param {Function} func - Function to throttle
 * @param {number} delay - Milliseconds to delay
 * @returns {Object} Object with execute() method and timeout reference
 */
export function createThrottleTimeout(func, delay) {
  let timeoutId = null;
  
  return {
    execute(...args) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        func(...args);
        timeoutId = null;
      }, delay);
    },
    cancel() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
    get pending() {
      return timeoutId !== null;
    }
  };
}

/**
 * Request animation frame throttle for smooth animations
 * @param {Function} func - Function to throttle
 * @returns {Function} RAF-throttled function
 */
export function rafThrottle(func) {
  let rafId = null;
  return function executedFunction(...args) {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      func(...args);
      rafId = null;
    });
  };
}

/**
 * Create a debouncer with immediate option
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @param {boolean} immediate - Execute immediately on leading edge
 * @returns {Function} Debounced function
 */
export function debounceImmediate(func, wait, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      if (!immediate) func(...args);
    }, wait);
    if (callNow) func(...args);
  };
}

/**
 * Batch multiple calls into a single execution
 * @param {Function} func - Function to batch
 * @param {number} wait - Milliseconds to wait before executing batch
 * @returns {Function} Batched function
 */
export function batch(func, wait) {
  let timeout;
  let argsQueue = [];
  
  return function executedFunction(...args) {
    argsQueue.push(args);
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func(argsQueue);
      argsQueue = [];
    }, wait);
  };
}

/**
 * Memoize function results for performance
 * @param {Function} func - Function to memoize
 * @param {Function} keyGen - Optional key generator function
 * @returns {Function} Memoized function
 */
export function memoize(func, keyGen = (...args) => JSON.stringify(args)) {
  const cache = new Map();
  
  return function memoized(...args) {
    const key = keyGen(...args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = func(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Execute function only once
 * @param {Function} func - Function to execute once
 * @returns {Function} Once-wrapped function
 */
export function once(func) {
  let called = false;
  let result;
  
  return function executedOnce(...args) {
    if (!called) {
      called = true;
      result = func(...args);
    }
    return result;
  };
}
