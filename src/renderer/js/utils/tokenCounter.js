// tokenCounter.js
// CLIP-accurate BPE-style token counter
// Based on openai/clip-vit-base-patch32 tokenizer behavior

/**
 * Split text into segments that mirror CLIP's tokenization.
 * CLIP's BPE tokenizer treats comma-space sequences specially,
 * and splits words more aggressively than simple character counts suggest.
 */
function segmentText(text) {
  if (!text || !text.trim()) return [];

  const segments = [];
  
  // Split by comma + optional space as a single unit
  // This mimics how CLIP often treats ", " as part of the token boundary
  const tags = text.split(/,\s*/);
  
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i].trim();
    if (!tag) continue;
    
    // Split multi-word tags (spaces, underscores, hyphens)
    const words = tag.split(/[\s_-]+/).filter(w => w.length > 0);
    
    for (const word of words) {
      // Further split leetspeak and mixed alphanumeric
      // "b4n4n4" should be kept together, but check for alternating patterns
      const parts = word.split(/(\d+)/g).filter(p => p.length > 0);
      segments.push(...parts);
    }
    
    // Don't add comma after the last tag
    if (i < tags.length - 1) {
      segments.push(',');
    }
  }
  
  return segments;
}

/**
 * Estimate CLIP BPE token counts matching openai/clip-vit-base-patch32.
 * 
 * Key insights from TagGUI analysis:
 * - Target: ~3.1 tokens per E621 tag on average
 * - Each comma + space counts as its own token
 * - Words 5-9 chars typically = 2 tokens
 * - Longer words split aggressively (every 3-4 chars)
 * 
 * @param {string[]} segments - Array of text segments
 * @param {boolean} verbose - If true, return detailed breakdown
 * @returns {number|object} Token count or {count, details} if verbose
 */
function estimateTokenCount(segments, verbose = false) {
  let count = 0;
  const details = [];

  for (const seg of segments) {
    const s = seg;
    let tokenCount = 0;
    let reason = '';

    // Skip empty segments
    if (!s || s.length === 0) {
      continue;
    }

    // Commas: Count as 1 token (they're in the vocab)
    if (s === ',') {
      tokenCount = 1;
      reason = 'comma separator';
      count += tokenCount;
      if (verbose) details.push({ segment: s, tokens: tokenCount, reason });
      continue;
    }

    // Pure numbers
    if (/^\d+$/.test(s)) {
      if (s.length <= 3) {
        tokenCount = 1;
        reason = `number (≤3 digits)`;
      } else {
        // Longer numbers split
        tokenCount = Math.ceil(s.length / 3);
        reason = `number (${s.length} digits → ${tokenCount} tokens)`;
      }
      count += tokenCount;
      if (verbose) details.push({ segment: s, tokens: tokenCount, reason });
      continue;
    }

    // Pure letters (words) - The most important case
    if (/^[a-zA-Z]+$/.test(s)) {
      const len = s.length;
      
      // Short words: 1-4 chars
      if (len <= 4) {
        tokenCount = 1;
        reason = `short word (≤4 chars)`;
      }
      // 5-6 char words: Usually 1 token for common words
      else if (len <= 6) {
        tokenCount = 1;
        reason = `common word (5-6 chars)`;
      }
      // 7-10 char words: Usually 2 tokens
      else if (len <= 10) {
        tokenCount = 2;
        reason = `medium word (7-10 chars)`;
      }
      // 11-14 char words: Usually 3 tokens
      else if (len <= 14) {
        tokenCount = 3;
        reason = `long word (11-14 chars)`;
      }
      else {
        // Very long words: split every ~4 chars
        tokenCount = Math.ceil(len / 4);
        reason = `very long word (${len} chars → ${tokenCount} tokens)`;
      }
      
      count += tokenCount;
      if (verbose) details.push({ segment: s, tokens: tokenCount, reason });
      continue;
    }

    // Mixed alphanumeric
    if (/^[a-zA-Z0-9]+$/.test(s)) {
      const len = s.length;
      if (len === 1) {
        tokenCount = 1;
        reason = 'single char';
      } else {
        // Mixed content splits more
        tokenCount = Math.ceil(len / 1.5);
        reason = `alphanumeric (${len} chars → ${tokenCount} tokens)`;
      }
      count += tokenCount;
      if (verbose) details.push({ segment: s, tokens: tokenCount, reason });
      continue;
    }

    // Contractions
    if (/^'[a-z]{1,2}$/i.test(s)) {
      tokenCount = 1;
      reason = 'contraction';
      count += tokenCount;
      if (verbose) details.push({ segment: s, tokens: tokenCount, reason });
      continue;
    }

    // Other punctuation/symbols
    if (/^[^\p{L}\p{N}]+$/u.test(s)) {
      tokenCount = 1;
      reason = 'punctuation/symbol';
      count += tokenCount;
      if (verbose) details.push({ segment: s, tokens: tokenCount, reason });
      continue;
    }

    // Fallback
    tokenCount = 1;
    reason = 'fallback';
    count += tokenCount;
    if (verbose) details.push({ segment: s, tokens: tokenCount, reason });
  }

  if (verbose) {
    return { count, details };
  }
  return count;
}

/**
 * Main exported convenience function:
 * Takes text → returns approximate token count.
 * @param {string} text - Text to count tokens for
 * @param {boolean} verbose - If true, returns detailed breakdown
 * @returns {number|object} Token count or {count, details} if verbose
 */
function countTokens(text, verbose = false) {
  const segments = segmentText(text);
  return estimateTokenCount(segments, verbose);
}

/**
 * Check if token count exceeds a limit
 * @param {number} tokenCount - Current token count
 * @param {number} limit - Maximum allowed tokens (default 225 for SD 1.5)
 * @returns {boolean} True if over limit
 */
export function isOverTokenLimit(tokenCount, limit = 225) {
  return tokenCount > limit;
}

/**
 * Format token count for display
 * @param {number} tokenCount - Current token count
 * @param {number} limit - Maximum allowed tokens (default 225)
 * @returns {string} Formatted string like "200 / 225"
 */
export function formatTokenCount(tokenCount, limit = 225) {
  return `${tokenCount} / ${limit}`;
}

export { countTokens };

export default {
  countTokens,
  segmentText,
  estimateTokenCount,
  isOverTokenLimit,
  formatTokenCount,
};
