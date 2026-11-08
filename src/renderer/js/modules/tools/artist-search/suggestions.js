import { safeJsonParse } from '../../../utils/parsers.js';

// Name suggestions while typing, and recently searched artists.
// Mixed into ArtistSearchTool (see utils/mixMethods.js).
export default class ArtistSearchSuggestions {
  /**
   * Enhanced artist input handler with improved debouncing and caching
 */
async handleArtistInput(value) {
  const query = value.trim();
  
  // Update clear button visibility
  if (this.elements.clear_input_btn) {
    this.elements.clear_input_btn.style.display = value.length > 0 ? 'block' : 'none';
  }

  // Clear suggestions if input is too short
  if (query.length < this.minSuggestionLength) {
    this.hideSuggestions();
    return;
  }
  
  // Cancel any previous request
  if (this.suggestionAbortController) {
    this.suggestionAbortController.abort();
  }
  
  // Clear previous timeout
  if (this.suggestionTimeout) {
    clearTimeout(this.suggestionTimeout);
  }
  
  // Check cache first for instant response
  const cachedSuggestions = this.getSuggestionsFromCache(query);
  if (cachedSuggestions) {
    if (this.elements.input_spinner) this.elements.input_spinner.style.display = 'none';
    this.showSuggestions(cachedSuggestions, true); // true = from cache
    return;
  }
  
  // Show loading spinner
  if (this.elements.input_spinner) {
    this.elements.input_spinner.style.display = 'block';
  }
  
  // Debounce the API call - Increased to 300ms for smoother experience
  this.suggestionTimeout = setTimeout(async () => {
    await this.fetchArtistSuggestions(query);
  }, 300);
}

/**
 * Get suggestions from cache with partial matching
 */
getSuggestionsFromCache(query) {
  const queryLower = query.toLowerCase();
  
  // First try exact cache hit
  if (this.suggestionCache.has(queryLower)) {
    return this.suggestionCache.get(queryLower);
  }
  
  // Try partial matching from longer cached queries
  for (const [cachedQuery, suggestions] of this.suggestionCache.entries()) {
    if (cachedQuery.startsWith(queryLower) && suggestions.length > 0) {
      // Filter suggestions to match current query
      const filtered = suggestions.filter(artist => 
        artist.toLowerCase().includes(queryLower)
      );
      
      if (filtered.length > 0) {
        return filtered.slice(0, this.maxSuggestions);
      }
    }
  }
  
  return null;
}

/**
 * Enhanced API fetch with abort controller and better error handling
 */
async fetchArtistSuggestions(query) {
  try {
    // Abort any previous request
    if (this.suggestionAbortController) {
      this.suggestionAbortController.abort();
    }
    
    // Create new abort controller for this request
    this.suggestionAbortController = new AbortController();
    
    console.log(`🎨 Fetching ${this.searchMode} suggestions for: "${query}"`);
    
    // Validate query
    if (!query || typeof query !== 'string' || query.trim().length < this.minSuggestionLength) {
      this.hideSuggestions();
      return;
    }
    
    const normalizedQuery = query.trim().toLowerCase();
    
    let result;
    try {
      if (this.searchMode === 'artist') {
        result = await window.electronAPI.e621.getArtistSuggestions(normalizedQuery, this.maxSuggestions);
      } else {
        // For character search, we use tag suggestions with character category
        result = await window.electronAPI.e621.getTagSuggestions(normalizedQuery, {
          limit: this.maxSuggestions,
          category: 'character'
        });
      }
    } catch (apiError) {
      console.warn('⚠️ API error fetching suggestions:', apiError);
      this.showSuggestionError('Unable to fetch suggestions');
      return;
    }
    
    // Check if request was aborted
    if (this.suggestionAbortController.signal.aborted) {
      return;
    }
    
    // Validate API response
    if (!result) {
      console.warn('⚠️ No response from API');
      this.showNoSuggestions();
      return;
    }
    
    if (!result.success) {
      console.warn('⚠️ API returned error:', result.message || 'Unknown error');
      this.showSuggestionError('Search failed');
      return;
    }
    
    if (!result.suggestions || !Array.isArray(result.suggestions)) {
      console.warn('⚠️ Invalid suggestions format from API');
      this.showNoSuggestions();
      return;
    }
    
    if (result.suggestions.length > 0) {
      // Normalize suggestions format - handle both string arrays and object arrays
      let normalizedSuggestions;
      try {
        if (this.searchMode === 'artist') {
          // Artist suggestions come as string array
          normalizedSuggestions = result.suggestions
            .filter(suggestion => suggestion && typeof suggestion === 'string')
            .map(suggestion => suggestion.trim())
            .filter(suggestion => suggestion.length > 0);
        } else {
          // Tag suggestions come as object array, extract just the names
          normalizedSuggestions = result.suggestions
            .filter(suggestion => suggestion && (typeof suggestion === 'string' || suggestion.name))
            .map(suggestion => 
              typeof suggestion === 'string' ? suggestion.trim() : (suggestion.name || '').trim()
            )
            .filter(suggestion => suggestion.length > 0);
        }
        
        if (normalizedSuggestions.length === 0) {
          this.showNoSuggestions();
          return;
        }
        
        // Limit suggestions and remove duplicates
        normalizedSuggestions = [...new Set(normalizedSuggestions)].slice(0, this.maxSuggestions);
        
        // Cache the results for future use
        this.cacheSuggestions(normalizedQuery, normalizedSuggestions);
        
        // Show suggestions
        this.showSuggestions(normalizedSuggestions, false);
        
        console.log(`✅ Found ${normalizedSuggestions.length} ${this.searchMode} suggestions`);
        
      } catch (processingError) {
        console.error('❌ Error processing suggestions:', processingError);
        this.showSuggestionError('Error processing suggestions');
      }
    } else {
      // No suggestions found
      this.showNoSuggestions();
      console.log(`ℹ️ No ${this.searchMode} suggestions found for: "${query}"`);
    }
    
  } catch (error) {
    // Don't show error if request was aborted
    if (error.name === 'AbortError' || this.suggestionAbortController?.signal.aborted) {
      return;
    }
    
    console.error('❌ Unexpected error fetching artist suggestions:', error);
    this.showSuggestionError('Unexpected error occurred');
  } finally {
    // Hide spinner if request completed (not aborted)
    if (this.suggestionAbortController && !this.suggestionAbortController.signal.aborted) {
      if (this.elements.input_spinner) {
        this.elements.input_spinner.style.display = 'none';
      }
    }
  }
}

/**
 * Cache suggestions with intelligent cleanup
 */
cacheSuggestions(query, suggestions) {
  const queryLower = query.toLowerCase();
  this.suggestionCache.set(queryLower, [...suggestions]);
  
  // Limit cache size to prevent memory issues
  if (this.suggestionCache.size > 50) {
    // Remove oldest entries
    const keys = Array.from(this.suggestionCache.keys());
    for (let i = 0; i < 10; i++) {
      this.suggestionCache.delete(keys[i]);
    }
  }
}

/**
 * Enhanced suggestions display with better UX
 */
showSuggestions(suggestions, fromCache = false) {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) {
    console.warn('⚠️ Suggestions dropdown element not found');
    return;
  }
  
  if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
    this.hideSuggestions();
    return;
  }
  
  try {
    // Create suggestion items with validation
    const validSuggestions = suggestions.filter(artist => 
      artist && typeof artist === 'string' && artist.trim().length > 0
    );
    
    if (validSuggestions.length === 0) {
      this.showNoSuggestions();
      return;
    }
    
    // Use DocumentFragment for atomic DOM update
    const fragment = document.createDocumentFragment();
    
    validSuggestions.forEach((artist, index) => {
      try {
        const item = this.createSuggestionItem(artist.trim(), index);
        if (item) {
          fragment.appendChild(item);
        }
      } catch (itemError) {
        console.warn('⚠️ Error creating suggestion item:', itemError);
      }
    });
    
    // Clear current content and reset classes
    dropdown.innerHTML = '';
    dropdown.className = 'suggestions-dropdown';
    
    // Reset any problematic styles
    dropdown.style.removeProperty('width');
    dropdown.style.removeProperty('min-width');
    dropdown.style.removeProperty('max-width');
    
    // Add cache indicator for development
    if (fromCache) {
      dropdown.classList.add('from-cache');
    }
    
    dropdown.appendChild(fragment);
    
    // Show dropdown with better positioning
    dropdown.style.display = 'block';
    dropdown.classList.add('suggestions-visible');
    
    // Reset selection index
    this.currentSuggestionIndex = -1;
    
    console.log(`📋 Displaying ${validSuggestions.length} suggestions${fromCache ? ' (cached)' : ''}`);
    
  } catch (error) {
    console.error('❌ Error showing suggestions:', error);
    this.hideSuggestions();
  }
}

/**
 * Create individual suggestion item with enhanced styling
 */
createSuggestionItem(artist, index) {
  try {
    // Validate input
    if (!artist || typeof artist !== 'string') {
      console.warn('⚠️ Invalid artist data for suggestion item');
      return null;
    }
    
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.setAttribute('data-index', index);
    item.setAttribute('data-artist', artist);
    
    // Truncate long artist names to prevent overflow
    const maxLength = 50;
    const displayName = artist.length > maxLength ? `${artist.substring(0, maxLength)}...` : artist;
    
    // Highlight matching text
    const query = this.elements.artist_input?.value.trim().toLowerCase() || '';
    const highlightedText = this.highlightMatchingText(displayName, query);
    
    // Create content with proper text overflow handling
    item.innerHTML = `
      <div class="suggestion-name" title="${this.escapeHtml(artist)}">${highlightedText}</div>
    `;
    
    // Enhanced event handlers with error handling
    item.addEventListener('mouseenter', (e) => {
      try {
        this.highlightSuggestion(index);
      } catch (error) {
        console.warn('⚠️ Error highlighting suggestion:', error);
      }
    });
    
    item.addEventListener('mouseleave', (e) => {
      try {
        this.unhighlightSuggestion(index);
      } catch (error) {
        console.warn('⚠️ Error unhighlighting suggestion:', error);
      }
    });
    
    item.addEventListener('click', (e) => {
      try {
        e.preventDefault();
        e.stopPropagation();
        this.selectArtist(artist); // Use full artist name, not truncated
      } catch (error) {
        console.error('❌ Error selecting artist suggestion:', error);
      }
    });
    
    return item;
    
  } catch (error) {
    console.error('❌ Error creating suggestion item:', error);
    return null;
  }
}

/**
 * Helper method to escape HTML to prevent XSS (including attribute/quote breakout)
 */
escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Highlight matching text in suggestions
 */
highlightMatchingText(text, query) {
  if (!query || query.length < 2) {
    return text;
  }
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Show loading state with better visual feedback
 */
showSuggestionsLoading() {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  const searchType = this.searchMode === 'artist' ? 'artists' : 'characters';
  
  dropdown.innerHTML = `
    <div class="suggestions-loading">
      <div class="loading-spinner-small"></div>
      <span>Finding ${searchType}...</span>
    </div>
  `;
  dropdown.style.display = 'block';
  dropdown.className = 'suggestions-dropdown suggestions-loading-state';
}

/**
 * Show no suggestions state
 */
showNoSuggestions() {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  const query = this.elements.artist_input?.value.trim() || '';
  const searchType = this.searchMode === 'artist' ? 'artists' : 'characters';
  
  dropdown.innerHTML = `
    <div class="suggestions-empty">
      <i class="fas fa-search"></i>
      <span>No ${searchType} found for "${query}"</span>
      <small>Try a different search term</small>
    </div>
  `;
  dropdown.style.display = 'block';
  dropdown.className = 'suggestions-dropdown suggestions-empty-state';
  
  // Do not auto-hide, let the user decide when to close or change input
}

/**
 * Show suggestion error state
 */
showSuggestionError() {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  dropdown.innerHTML = `
    <div class="suggestions-error">
      <i class="fas fa-exclamation-triangle"></i>
      <span>Failed to load suggestions</span>
      <small>Check your connection</small>
    </div>
  `;
  dropdown.style.display = 'block';
  dropdown.className = 'suggestions-dropdown suggestions-error-state';
  
  // Do not auto-hide
}

/**
 * Enhanced hide suggestions with animation
 */
hideSuggestions() {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  // Cancel any pending requests
  if (this.suggestionAbortController) {
    this.suggestionAbortController.abort();
    this.suggestionAbortController = null;
  }
  
  // Hide spinner
  if (this.elements.input_spinner) {
    this.elements.input_spinner.style.display = 'none';
  }
  
  dropdown.classList.remove('suggestions-visible');
  dropdown.style.display = 'none';
  dropdown.className = 'suggestions-dropdown';
  
  this.currentSuggestionIndex = -1;
}

/**
 * Enhanced suggestion navigation with better UX
 */
handleSuggestionNavigation(event) {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown || dropdown.style.display === 'none') return;
  
  const suggestions = dropdown.querySelectorAll('.suggestion-item');
  if (suggestions.length === 0) return;
  
  event.preventDefault();
  
  // Remove previous highlighting
  this.clearSuggestionHighlights();
  
  if (event.key === 'ArrowDown') {
    this.currentSuggestionIndex = Math.min(this.currentSuggestionIndex + 1, suggestions.length - 1);
  } else if (event.key === 'ArrowUp') {
    this.currentSuggestionIndex = Math.max(this.currentSuggestionIndex - 1, -1);
  } else if (event.key === 'Enter') {
    if (this.currentSuggestionIndex >= 0) {
      this.selectHighlightedSuggestion();
      return;
    }
  } else if (event.key === 'Escape') {
    this.hideSuggestions();
    return;
  }
  
  // Highlight current suggestion
  if (this.currentSuggestionIndex >= 0) {
    this.highlightSuggestion(this.currentSuggestionIndex);
    this.scrollSuggestionIntoView(this.currentSuggestionIndex);
  }
}

/**
 * Highlight a specific suggestion
 */
highlightSuggestion(index) {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  const suggestions = dropdown.querySelectorAll('.suggestion-item');
  if (index >= 0 && index < suggestions.length) {
    suggestions[index].classList.add('highlighted');
    this.currentSuggestionIndex = index;
  }
}

/**
 * Remove highlight from a specific suggestion
 */
unhighlightSuggestion(index) {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  const suggestions = dropdown.querySelectorAll('.suggestion-item');
  if (index >= 0 && index < suggestions.length) {
    suggestions[index].classList.remove('highlighted');
  }
}

/**
 * Clear all suggestion highlights
 */
clearSuggestionHighlights() {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  dropdown.querySelectorAll('.suggestion-item.highlighted').forEach(item => {
    item.classList.remove('highlighted');
  });
}

/**
 * Scroll highlighted suggestion into view
 */
scrollSuggestionIntoView(index) {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  const suggestions = dropdown.querySelectorAll('.suggestion-item');
  if (index >= 0 && index < suggestions.length) {
    suggestions[index].scrollIntoView({
      block: 'nearest',
      behavior: 'smooth'
    });
  }
}

/**
 * Select currently highlighted suggestion
 */
selectHighlightedSuggestion() {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown || this.currentSuggestionIndex < 0) return;
  
  const suggestions = dropdown.querySelectorAll('.suggestion-item');
  if (this.currentSuggestionIndex < suggestions.length) {
    const artist = suggestions[this.currentSuggestionIndex].getAttribute('data-artist');
    this.selectArtist(artist);
  }
}

/**
 * Select first available suggestion
 */
selectFirstSuggestion() {
  const dropdown = this.elements.suggestions_dropdown;
  if (!dropdown) return;
  
  const firstSuggestion = dropdown.querySelector('.suggestion-item');
  if (firstSuggestion) {
    const artist = firstSuggestion.getAttribute('data-artist');
    this.selectArtist(artist);
  }
}

/**
 * Check if suggestions are currently visible
 */
hasVisibleSuggestions() {
  const dropdown = this.elements.suggestions_dropdown;
  return dropdown && dropdown.style.display === 'block' && 
         dropdown.querySelectorAll('.suggestion-item').length > 0;
}

/**
 * Check if mouse is over suggestions dropdown
 */
isMouseOverSuggestions() {
  const dropdown = this.elements.suggestions_dropdown;
  return dropdown && dropdown.matches(':hover');
}

/**
 * Show cached suggestions on focus if available
 */
showCachedSuggestions(query) {
  const cached = this.getSuggestionsFromCache(query);
  if (cached && cached.length > 0) {
    this.showSuggestions(cached, true);
  }
}

/**
 * Enhanced artist selection with history tracking
 */
selectArtist(artistName) {
  if (!artistName) return;
  
  console.log(`✅ Selected ${this.searchMode}: ${artistName}`);
  
  if (this.elements.artist_input) {
    this.elements.artist_input.value = artistName;
  }
  
  this.hideSuggestions();
  this.currentArtist = artistName;
  
  // Add to recent searches based on current mode
  if (this.searchMode === 'artist') {
    this.addToRecentArtists(artistName);
  } else {
    this.addToRecentCharacters(artistName);
  }
  
  // Provide user feedback
  this.showToast(`Selected: ${artistName}`, 'info', 1500);
}

/**
 * Add artist to recent searches
 */
addToRecentArtists(artistName) {
  if (!artistName) return;
  
  // Remove if exists (to move to front)
  this.recentArtists.delete(artistName);
  
  // Add to front
  this.recentArtists.add(artistName);
  
  // Limit size
  if (this.recentArtists.size > this.maxRecentArtists) {
    const firstItem = this.recentArtists.values().next().value;
    this.recentArtists.delete(firstItem);
  }
  
  // Save to localStorage
  this.saveRecentArtists();
}

/**
 * Load recent artists from localStorage
 */
loadRecentArtists() {
  const saved = localStorage.getItem('piper-recent-artists');
  if (saved) {
    const artists = safeJsonParse(saved, []);
    this.recentArtists = new Set(artists);
  } else {
    this.recentArtists = new Set();
  }
}

/**
 * Save recent artists to localStorage
 */
saveRecentArtists() {
  try {
    const artists = Array.from(this.recentArtists);
    localStorage.setItem('piper-recent-artists', JSON.stringify(artists));
  } catch (error) {
    console.warn('Failed to save recent artists:', error);
  }
}

/**
 * Show recent searches dropdown based on current mode
 */
showRecentArtists() {
  const recentSearches = this.searchMode === 'artist' ? this.recentArtists : this.recentCharacters;
  const searchType = this.searchMode === 'artist' ? 'artist' : 'character';
  
  if (recentSearches.size === 0) {
    this.showToast(`No recent ${searchType} searches found`, 'info');
    return;
  }
  
  const searches = Array.from(recentSearches).reverse(); // Most recent first
  this.showSuggestions(searches, true);
}
}
