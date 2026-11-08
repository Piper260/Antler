/**
 * domUtils.js
 * DOM manipulation and HTML utilities
 * Consolidated from: preload.js, various tools
 */

/**
 * Sanitize HTML content to prevent XSS (including attribute/quote breakout)
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
export function sanitizeHTML(html) {
  if (html === null || html === undefined) return '';
  return String(html)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Create element with attributes and content
 * @param {string} tag - Element tag name
 * @param {Object} attributes - Element attributes
 * @param {string|Node} content - Inner content
 * @returns {HTMLElement} Created element
 */
export function createElement(tag, attributes = {}, content = '') {
  const element = document.createElement(tag);
  
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        element.dataset[dataKey] = dataValue;
      }
    } else if (key.startsWith('on')) {
      const eventName = key.slice(2).toLowerCase();
      element.addEventListener(eventName, value);
    } else {
      element.setAttribute(key, value);
    }
  }
  
  if (typeof content === 'string') {
    element.innerHTML = content;
  } else if (content instanceof Node) {
    element.appendChild(content);
  }
  
  return element;
}

/**
 * Add multiple classes to an element
 * @param {HTMLElement} element - Target element
 * @param {...string} classes - Classes to add
 */
export function addClasses(element, ...classes) {
  element.classList.add(...classes);
}

/**
 * Remove multiple classes from an element
 * @param {HTMLElement} element - Target element
 * @param {...string} classes - Classes to remove
 */
export function removeClasses(element, ...classes) {
  element.classList.remove(...classes);
}

/**
 * Toggle classes on an element
 * @param {HTMLElement} element - Target element
 * @param {...string} classes - Classes to toggle
 */
export function toggleClasses(element, ...classes) {
  classes.forEach(cls => element.classList.toggle(cls));
}

/**
 * Check if element has class
 * @param {HTMLElement} element - Element to check
 * @param {string} className - Class name
 * @returns {boolean} True if has class
 */
export function hasClass(element, className) {
  return element.classList.contains(className);
}

/**
 * Get all elements matching selector
 * @param {string} selector - CSS selector
 * @param {HTMLElement} parent - Parent element (default document)
 * @returns {HTMLElement[]} Array of elements
 */
export function queryAll(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

/**
 * Get single element matching selector
 * @param {string} selector - CSS selector
 * @param {HTMLElement} parent - Parent element (default document)
 * @returns {HTMLElement|null} Element or null
 */
export function query(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Remove all children from element
 * @param {HTMLElement} element - Element to clear
 */
export function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

/**
 * Set multiple attributes on element
 * @param {HTMLElement} element - Target element
 * @param {Object} attributes - Attributes object
 */
export function setAttributes(element, attributes) {
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
}

/**
 * Get element's offset position relative to document
 * @param {HTMLElement} element - Target element
 * @returns {Object} {top, left} position
 */
export function getOffset(element) {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + window.pageYOffset,
    left: rect.left + window.pageXOffset
  };
}

/**
 * Check if element is in viewport
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if in viewport
 */
export function isInViewport(element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Scroll element into view smoothly
 * @param {HTMLElement} element - Element to scroll to
 * @param {string} behavior - Scroll behavior (smooth, auto)
 * @param {string} block - Vertical alignment (start, center, end)
 */
export function scrollToElement(element, behavior = 'smooth', block = 'center') {
  element.scrollIntoView({ behavior, block });
}

/**
 * Wait for element to appear in DOM
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in ms (default 5000)
 * @returns {Promise<HTMLElement>} Promise resolving to element
 */
export function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

/**
 * Create document fragment from HTML string
 * @param {string} html - HTML string
 * @returns {DocumentFragment} Fragment
 */
export function htmlToFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<void>} Promise resolving when copied
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Generate unique ID for elements
 * @param {string} prefix - ID prefix
 * @returns {string} Unique ID
 */
export function generateId(prefix = 'el') {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}
