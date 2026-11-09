import { safeJsonParse, safeParseInt } from '../../utils/parsers.js';
// Groups of methods kept in their own files; mixed in below.
import ArtistSearchTemplate from './artist-search/template.js';
import ArtistSearchSuggestions from './artist-search/suggestions.js';
import ArtistSearchCategories from './artist-search/categories.js';
import ArtistSearchSelection from './artist-search/selection.js';
import ArtistSearchPreview from './artist-search/preview.js';
import ArtistSearchDownloads from './artist-search/downloads.js';

console.log('🔧 ArtistSearchTool module loading...');

class ArtistSearchTool extends BaseTool {
  constructor() {
    super({
      id: 'artist-search',
      name: 'Artist/Character Search',
      icon: 'fas fa-user-alt',
      description: 'Search posts by artist or character with infinite scroll',
      version: '1.0.0',
      category: 'E621 Tools'
    });
    
    // Tool state
    this.currentArtist = null;
    this.currentPosts = [];
    this.selectedPosts = new Set();
    this.isLoading = false;
    this.isLoadingMore = false;
    this.currentPage = 1;
    this.postsPerPage = 100; // Increased for better performance
    this.hasMore = false;
    this.artistSuggestions = [];
    this.suggestionTimeout = null;
    this.currentSuggestionIndex = -1;
    this.recentArtists = new Set();
    this.maxRecentArtists = 10;
    this.totalPostCount = 0;
    
    // Search mode state
    this.searchMode = 'artist'; // 'artist' or 'character'
    this.recentCharacters = new Set();
    
    // Additional tag refinement
    this.currentTagFilter = '';
    
    this.searchFilters = {
      rating: '',
      minScore: null,
      fileType: '',
      sortBy: 'training'
    };
    
    // Infinite scroll
    this.scrollBuffer = 400; // Increased buffer for smoother loading
    this.scrollThrottleDelay = 100;
    this.scrollThrottleTimeout = null;
    
// Batch selection
    this.selectionMode = 'normal'; // 'normal', 'range', 'pattern'
    this.lastSelectedIndex = -1;
    this.selectionPattern = null; // For pattern-based selection
    
    // Download status cache — tracks post IDs confirmed to exist on disk
    this.downloadedPosts = new Set();

    // Category (style/subfolder) assignment — lets an artist's downloads be
    // split across detected subfolders (e.g. jrjresq/flat, /shaded, /sketch)
    // instead of always landing flat in the artist folder.
    this.availableCategories = []; // subfolder names detected for the current artist/character
    this.postCategories = new Map(); // postId -> category name ('' / absent = root, no subfolder)
    
    // Enhanced suggestion system
    this.suggestionCache = new Map(); // Cache suggestions for better performance
    this.suggestionAbortController = null; // To cancel previous requests
    this.minSuggestionLength = 2; // Minimum characters to trigger suggestions
    this.suggestionDebounceDelay = 150; // Faster response than before
    this.maxSuggestions = 8; // Maximum suggestions to show
    
    // DOM elements
    this.elements = {};
    
    // Downloads carry on while other tools are open; see App.loadToolContent.
    this.keepAlive = true;

    console.log('🎨 Artist Search Tool initialized');
  }

  // Called by the app when another tool is shown; this tool stays alive so
  // downloads keep running in the background.
  onHide() {
    this.isVisible = false;
  }

  onShow() {
    this.isVisible = true;
    this.updateSelectionUI();
  }

  // Cleanup method called when navigating away from the tool
  destroy() {
    // Remove modal if it exists
    const modal = document.getElementById('image-preview-modal');
    if (modal) {
      modal.remove();
    }
    
    // Note: Global download button is now managed by the main app and persists
    
    super.destroy();
    console.log('🧹 Artist Search Tool cleaned up');
  }

  async initialize(container) {
    console.log('🔧 Initializing Artist Search Tool...');
    this.setRoot(container);

    try {
      container.innerHTML = this.getTemplate();
      this.initElements();
      this.setupEventListeners();
      await this.loadInitialState();
      
      // Add action buttons to main header
      this.setupHeaderActions();
      
      console.log('✅ Artist Search Tool initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize Artist Search Tool:', error);
      this.showError('Failed to initialize tool', error);
    }
  }

  setupHeaderActions() {
    this.setHeaderActions([
      {
        label: 'Clear',
        icon: 'fas fa-broom',
        onClick: () => this.clearForm()
      },
      {
        label: 'Clear Cache',
        icon: 'fas fa-trash',
        onClick: () => this.clearCache()
      }
    ]);
    console.log('📌 Setup header action buttons');
  }

  initElements() {
    const elementIds = [
      'artist-input', 'search-btn',
      'mode-toggle-input', 'label-artist', 'label-character',
      'search-input-label', 'search-help-text',
      'suggestions-dropdown', 'popular-artists-btn', 'recent-artists-btn',
      'results-section', 'loading-state', 'posts-grid', 'error-state',
      'artist-name-display', 'search-type-text', 'visible-posts-count', 'total-posts-count',
      
      // Enhanced selection controls
      'toggle-selection-mode', 'selection-mode-text',
      'select-all-visible-btn', 'select-range-btn', 'select-pattern-btn', 'invert-selection-btn',
      'select-all-btn', 'select-existed-btn', 'deselect-all-btn',
      'top-n-input', 'select-top-btn',

      // Category (subfolder) assignment
      'category-toolbar-divider', 'bulk-category-select', 'apply-category-btn',
      
      // Input controls
      'input-spinner', 'clear-input-btn',
      
      // Tag refinement filter
      'tag-filter-input', 'clear-tag-filter-btn',

      // Virtual scrolling
      'posts-container', 'posts-grid-content',
      
      // Load more
      'load-more-section', 'load-more-btn', 'loading-more-state', 'no-more-posts',
      'load-more-text',
      
      // Filter elements
      'rating-filter', 'min-score-filter', 'sort-filter',
      'apply-filters-btn',
      
      // Error handling
      'error-message', 'retry-btn', 'clear-error-btn',
      'status-text', 'cache-info', 'api-status',

      // Download bar
      'selected-count-text', 'tags-only-toggle', 'open-folder-btn',
      'download-selected-btn', 'download-selected-text'
    ];

    this.elements = this.cacheElements(elementIds);
    
  }

  setupEventListeners() {
    console.log('📡 Setting up Artist Search Tool event listeners...');

    // Search mode toggle switch
    this.on(this.elements.mode_toggle_input, 'change', (e) => {
      const mode = e.target.checked ? 'character' : 'artist';
      this.setSearchMode(mode);
    });

    // Click handlers for labels to toggle mode
    this.on(this.elements.label_artist, 'click', () => {
      this.setSearchMode('artist');
    });

    this.on(this.elements.label_character, 'click', () => {
      this.setSearchMode('character');
    });

    // Artist input with live suggestions
    this.on(this.elements.artist_input, 'input', (e) => {
      this.handleArtistInput(e.target.value);
    });

    // Clear input button
    this.on(this.elements.clear_input_btn, 'click', () => {
      this.elements.artist_input.value = '';
      this.handleArtistInput('');
      this.hideSuggestions();
    });

    // Search button
    this.on(this.elements.search_btn, 'click', () => {
      this.searchArtist();
    });

    // Enter key support
    this.on(this.elements.artist_input, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // If a suggestion is highlighted, select it; otherwise search
        if (this.currentSuggestionIndex >= 0) {
          this.selectHighlightedSuggestion();
        } else {
          this.searchArtist();
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        this.handleSuggestionNavigation(e);
      } else if (e.key === 'Escape') {
        this.hideSuggestions();
        this.elements.artist_input.blur();
      } else if (e.key === 'Tab') {
        // Tab completion - select first suggestion if available
        if (this.currentSuggestionIndex >= 0) {
          e.preventDefault();
          this.selectHighlightedSuggestion();
        } else if (this.hasVisibleSuggestions()) {
          e.preventDefault();
          this.selectFirstSuggestion();
        }
      }
    });

    // Blur event to hide suggestions when clicking away
    this.on(this.elements.artist_input, 'blur', (e) => {
      // Delay hiding suggestions to allow for clicks
      setTimeout(() => {
        if (!this.isMouseOverSuggestions()) {
          this.hideSuggestions();
        }
      }, 150);
    });

    // Selection buttons
    this.on(this.elements.select_all_btn, 'click', () => {
      this.selectAllPosts();
    });

    this.on(this.elements.select_existed_btn, 'click', () => {
      this.selectExistedPosts();
    });

    this.on(this.elements.deselect_all_btn, 'click', () => {
      this.deselectAllPosts();
    });

    this.on(this.elements.select_top_btn, 'click', () => {
      this.selectTopPosts();
    });

    // Enhanced batch selection tools
    this.on(this.elements.toggle_selection_mode, 'click', () => {
      this.toggleSelectionMode();
    });

    this.on(this.elements.select_all_visible_btn, 'click', () => {
      this.selectAllVisiblePosts();
    });

    this.on(this.elements.select_range_btn, 'click', () => {
      this.startRangeSelection();
    });


    this.on(this.elements.select_pattern_btn, 'click', () => {
      this.startPatternSelection();
    });

    this.on(this.elements.invert_selection_btn, 'click', () => {
      this.invertSelection();
    });

    // Bulk category (subfolder) assignment
    this.on(this.elements.apply_category_btn, 'click', () => {
      this.applyCategoryToSelected();
    });

    // Filter controls
    this.on(this.elements.apply_filters_btn, 'click', () => {
      this.applyFilters();
    });

    // Tag refinement filter
    this.on(this.elements.tag_filter_input, 'input', (e) => {
      const hasValue = e.target.value.trim().length > 0;
      if (this.elements.clear_tag_filter_btn) {
        this.elements.clear_tag_filter_btn.style.display = hasValue ? 'inline-flex' : 'none';
      }
    });

    this.on(this.elements.tag_filter_input, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.searchArtist();
      }
    });

    this.on(this.elements.clear_tag_filter_btn, 'click', () => {
      if (this.elements.tag_filter_input) {
        this.elements.tag_filter_input.value = '';
      }
      if (this.elements.clear_tag_filter_btn) {
        this.elements.clear_tag_filter_btn.style.display = 'none';
      }
      if (this.currentArtist) {
        this.searchArtist();
      }
    });

    // Download bar
    this.on(this.elements.download_selected_btn, 'click', () => this.downloadSelectedPosts());
    this.on(this.elements.open_folder_btn, 'click', () => this.openDatasetFolder());

    // Load more button
    this.on(this.elements.load_more_btn, 'click', () => {
      this.loadMorePosts();
    });

    // Error handling
    this.on(this.elements.retry_btn, 'click', () => {
      this.retryLastSearch();
    });

    this.on(this.elements.clear_error_btn, 'click', () => {
      this.clearError();
    });

    // Infinite scroll
    this.on(this.elements.posts_container, 'scroll', (e) => {
      this.handleScroll(e);
    });

    // Keyboard shortcuts for batch selection
    this.onDocument('keydown', (e) => {
      if (e.target.closest('.artist-search')) {
        this.handleKeyboardShortcuts(e);
      }
    });

    // Click outside suggestions to hide
    this.onDocument('click', (e) => {
      if (!e.target.closest('.input-with-button')) {
        this.hideSuggestions();
      }
    });
  }

  async loadInitialState() {
    // Check API status and load any cached data
    const apiStatus = await this.checkApiStatus();
    this.updateApiStatus(apiStatus);
    
    // Load recent artists and characters from localStorage
    this.loadRecentArtists();
    this.loadRecentCharacters();
    
    // Set initial search mode
    this.setSearchMode('artist');
  }

  /**
   * Set search mode (artist or character)
   */
  setSearchMode(mode) {
    console.log(`🔄 Switching search mode to: ${mode}`);
    
    this.searchMode = mode;
    
    // Update toggle state
    if (this.elements.mode_toggle_input) {
      this.elements.mode_toggle_input.checked = (mode === 'character');
    }
    
    // Update labels
    if (this.elements.label_artist && this.elements.label_character) {
      if (mode === 'artist') {
        this.elements.label_artist.classList.add('active');
        this.elements.label_character.classList.remove('active');
      } else {
        this.elements.label_artist.classList.remove('active');
        this.elements.label_character.classList.add('active');
      }
    }
    
    // Update labels and placeholders
    const label = this.elements.search_input_label;
    const input = this.elements.artist_input;
    const helpText = this.elements.search_help_text;
    const searchTypeText = this.elements.search_type_text;
    
    if (mode === 'artist') {
      if (label) label.textContent = 'Artist Name';
      if (input) input.placeholder = 'Start typing artist name (e.g., narse, dragon...)';
      if (helpText) helpText.textContent = 'Start typing to see artist suggestions, then click Search to view their posts.';
      if (searchTypeText) searchTypeText.textContent = 'by';
    } else if (mode === 'character') {
      if (label) label.textContent = 'Character Name';
      if (input) input.placeholder = 'Start typing character name (e.g., lucario, dragon...)';
      if (helpText) helpText.textContent = 'Start typing to see character suggestions, then click Search to view posts featuring them.';
      if (searchTypeText) searchTypeText.textContent = 'featuring';
    }
    
    // Clear current search if switching modes
    if (input) input.value = '';
    this.hideSuggestions();
    
    // Clear results if any
    if (this.elements.results_section) {
      this.elements.results_section.style.display = 'none';
    }
    
    this.currentArtist = null;
    this.currentPosts = [];
    this.selectedPosts.clear();
    this.postCategories.clear();
    this.availableCategories = [];
    this.updateCategoryToolbarUI();

    this.updateStatus(`Ready - ${mode} search mode`);
  }

  /**
   * Load recent characters from localStorage
   */
  loadRecentCharacters() {
    const saved = localStorage.getItem('piper-recent-characters');
    if (saved) {
      const characters = safeJsonParse(saved, []);
      this.recentCharacters = new Set(characters);
    } else {
      this.recentCharacters = new Set();
    }
  }

  /**
   * Save recent characters to localStorage
   */
  saveRecentCharacters() {
    try {
      const characters = Array.from(this.recentCharacters);
      localStorage.setItem('piper-recent-characters', JSON.stringify(characters));
    } catch (error) {
      console.warn('Failed to save recent characters:', error);
    }
  }

  /**
   * Add character to recent searches
   */
  addToRecentCharacters(characterName) {
    if (!characterName) return;
    
    // Remove if exists (to move to front)
    this.recentCharacters.delete(characterName);
    
    // Add to front
    this.recentCharacters.add(characterName);
    
    // Limit size
    if (this.recentCharacters.size > this.maxRecentArtists) {
      const firstItem = this.recentCharacters.values().next().value;
      this.recentCharacters.delete(firstItem);
    }
    
    // Save to localStorage
    this.saveRecentCharacters();
  }

/**
 * Apply search filters
 */
applyFilters() {
  // Update filter values
  this.searchFilters = {
    rating: this.elements.rating_filter?.value || '',
    minScore: this.elements.min_score_filter?.value ? safeParseInt(this.elements.min_score_filter.value, null) : null,
    sortBy: this.elements.sort_filter?.value || 'training'
  };
  
  // Re-run search with filters
  if (this.currentArtist) {
    this.currentPage = 1;
    this.currentPosts = [];
    this.selectedPosts.clear();
    this.searchArtist();
    
    this.showToast('Filters applied', 'success');
  } else {
    this.showToast('Please search for an artist first', 'warning');
  }
}

/**
 * Search for posts by artist
 */
async searchArtist() {
  const artistName = this.elements.artist_input?.value?.trim();
  
  if (!artistName) {
    const searchType = this.searchMode === 'artist' ? 'artist' : 'character';
    this.showToast(`Please enter a ${searchType} name`, 'warning');
    return;
  }
  
  // Read and store tag refinement filter
  const tagFilterRaw = this.elements.tag_filter_input?.value?.trim() || '';
  this.currentTagFilter = tagFilterRaw;
  const additionalTags = tagFilterRaw
    ? tagFilterRaw.split(/[\s,]+/).map(t => t.trim()).filter(Boolean)
    : [];
  
  console.log(`🎨 Searching for ${this.searchMode}: ${artistName}${additionalTags.length ? ` + tags: ${additionalTags.join(', ')}` : ''}`);
  
  // Reset for new search
  this.currentArtist = artistName;
  this.currentPage = 1;
  this.currentPosts = [];
  this.selectedPosts.clear();
  this.hasMore = false;
  this.totalPostCount = 0;
  this.postCategories.clear();
  this.availableCategories = [];

  // Fetch total count in background
  this.fetchTotalCount(artistName);

  // Detect any existing style/category subfolders under this artist's folder
  // (e.g. jrjresq/flat, /shaded, /sketch) so results can be routed into them
  await this.refreshAvailableCategories();

  this.showLoading();
  this.updateStatus(`Searching for posts ${this.searchMode === 'artist' ? 'by' : 'featuring'} ${artistName}...`);
  
  try {
    const options = {
      limit: this.pageLimit(),
      page: this.currentPage,
      includeFileUrls: true,
      includeMetadata: true,
      ...this.searchFilters,
      ...(additionalTags.length > 0 ? { additionalTags } : {})
    };
    
    let result;
    if (this.searchMode === 'artist') {
      result = await window.electronAPI.e621.searchByArtist(artistName, options);
    } else {
      // For character search, use the character tag search
      result = await window.electronAPI.e621.searchByCharacter(artistName, options);
    }
    
    if (result.success) {
      result.posts = this.prepareResults(result.posts);
      this.currentPosts = result.posts;
      this.currentPagination = result.pagination; // Save pagination data
      this.hasMore = result.pagination.hasMore;
      
      this.displayPosts(result.posts, false); // false = replace existing posts
      this.updateStatus(`Found ${result.posts.length} posts ${this.searchMode === 'artist' ? 'by' : 'featuring'} ${artistName}`);
      
      console.log(`✅ Found ${result.posts.length} posts ${this.searchMode === 'artist' ? 'by' : 'featuring'} ${artistName}`);
      
      // Add to recent searches
      if (this.searchMode === 'artist') {
        this.addToRecentArtists(artistName);
      } else {
        this.addToRecentCharacters(artistName);
      }
      
      // Show load more section if there are more posts
      if (this.hasMore) {
        this.showLoadMoreSection();
      }
      
    } else {
      this.showError(result.message, { 
        type: result.type, 
        details: result.details 
      });
    }
    
  } catch (error) {
    console.error(`❌ Error searching for artist ${artistName}:`, error);
    this.showError('Failed to search for artist posts', error);
  } finally {
    this.hideLoading();
  }
}

/**
 * Posts per request. Training sort pulls e621's maximum so there are more
 * top-scored posts to rank before the first page is shown.
 */
pageLimit() {
  return this.searchFilters.sortBy === 'training' ? 320 : this.postsPerPage;
}

/**
 * Score a batch for training (sets post.training) and, when sorting by
 * training, return it best first.
 */
prepareResults(posts) {
  if (!window.TrainingScore) return posts;
  const ranked = window.TrainingScore.rankPosts(posts, this.searchMode);
  return this.searchFilters.sortBy === 'training' ? ranked : posts;
}

/**
 * Fetch total post count for artist/character
 */
async fetchTotalCount(name) {
  try {
    const category = this.searchMode === 'artist' ? 'artist' : 'character';
    // Fetch suggestions to find the exact tag count
    const results = await window.electronAPI.e621.getTagSuggestions(name, {
      limit: 5,
      category: category
    });
    
    if (results && results.length > 0) {
      // Try to find exact match first
      let match = results.find(tag => tag.name.toLowerCase() === name.toLowerCase());
      
      // If no exact match, but we have results and the first one contains the name, use it
      if (!match && results.length > 0) {
        match = results[0];
      }
      
      if (match) {
        this.totalPostCount = match.post_count;
        console.log(`📊 Total posts for ${name}: ${this.totalPostCount}`);
        
        // Force update UI if load more is visible
        if (this.elements.load_more_section && this.elements.load_more_section.style.display !== 'none') {
          this.showLoadMoreSection();
        }
      }
    }
  } catch (error) {
    console.warn('Failed to fetch total post count:', error);
  }
}

/**
 * Show search results, replacing or adding to the grid
 */
displayPosts(posts, append = false) {
  // Track performance
  window.performanceMonitor?.markStart('displayPosts');
  
  if (!posts || posts.length === 0) {
    this.showNoPosts();
    window.performanceMonitor?.markEnd('displayPosts');
    return;
  }
  
  // Show results section
  this.showResults();
  
  // Update header info
  if (this.elements.artist_name_display) {
    this.elements.artist_name_display.textContent = this.currentArtist;
  }
  
  // Update search type text based on current mode
  if (this.elements.search_type_text) {
    this.elements.search_type_text.textContent = this.searchMode === 'artist' ? 'by' : 'featuring';
  }

  // Update posts count - show visible vs total
  const totalPosts = append ? this.currentPosts.length : posts.length;
  if (this.elements.total_posts_count) {
    this.elements.total_posts_count.textContent = totalPosts;
  }
  
  console.log(`📊 Displaying ${totalPosts} posts (append: ${append})`);
  
  // Every post gets a card; thumbnails use loading="lazy", so off-screen
  // ones don't load until scrolled to.
  this.renderAllPosts();
  
  // Update selection UI
  this.updateSelectionUI();
  
  // Show posts grid
  if (this.elements.posts_grid) {
    this.elements.posts_grid.style.display = 'flex';
  }
  
  // Show selection summary if posts are selected
  if (this.selectedPosts.size > 0) {
    this.showSelectionSummary();
  }
  
  // Ensure load more section is updated
  if (this.hasMore) {
    this.showLoadMoreSection();
  }
  
  // Async: check which posts already exist on disk and highlight those cards
  this.checkDownloadStatus();
  
  window.performanceMonitor?.markEnd('displayPosts');
}

/**
 * Batch-check which posts already exist on disk and highlight those cards.
 * Pass a subset array to check only newly loaded posts (e.g. after load more).
 * Omit the argument to check all currentPosts.
 */
async checkDownloadStatus(postsToCheck = null) {
  const posts = postsToCheck || this.currentPosts;
  if (!posts.length || !this.currentArtist) return;

  try {
    const folderName = this.getDownloadFolderName();
    const downloadType = this.getDownloadType();
    const postIds = posts.map(p => ({
      id: p.id,
      ext: p.metadata?.fileType || 'jpg'
    }));

    const result = await window.electronAPI.utils.checkPostsExist({ postIds, folderName, downloadType });
    if (!result.success) return;

    result.existingIds.forEach(id => {
      this.downloadedPosts.add(id);
      this.updateDownloadStatusUI(id, true);
    });
  } catch (error) {
    console.warn('⚠️ Could not check download status:', error);
  }
}

/**
 * Update the download status highlight on a single post card.
 */
updateDownloadStatusUI(postId, isDownloaded) {
  const postEl = document.querySelector(`[data-post-id="${postId}"]`);
  if (!postEl) return;
  postEl.classList.toggle('downloaded', isDownloaded);
}

/**
 * Render all posts (simplified for better performance)
 */
renderAllPosts() {
  window.performanceMonitor?.markStart('renderAllPosts');
  
  const container = this.elements.posts_container;
  
  if (!container) return;
  
  // Clear container and create grid content directly
  container.innerHTML = '';
  
  // Create posts grid content (layout comes from .posts-grid-content in
  // artist-search.css)
  const content = document.createElement('div');
  content.className = 'posts-grid-content';
  content.id = 'posts-grid-content';
  
  console.log(`🎨 Rendering ${this.currentPosts.length} post elements`);
  
  // Render all posts
  this.currentPosts.forEach((post, index) => {
    const postElement = this.createPostElement(post, index);
    content.appendChild(postElement);
  });
  
  container.appendChild(content);
  
  // Update cache element reference
  this.elements.posts_grid_content = content;
  
  window.performanceMonitor?.markEnd('renderAllPosts');
  
  // Update visible count
  if (this.elements.visible_posts_count) {
    this.elements.visible_posts_count.textContent = this.currentPosts.length;
  }
  
  // Debug logging
  const computedStyle = window.getComputedStyle(content);
  console.log(`🎨 Rendered ${this.currentPosts.length} posts`);
  console.log(`📊 Grid columns: ${computedStyle.gridTemplateColumns}`);
  console.log(`📏 Container width: ${content.offsetWidth}px`);
  
  // Force a reflow to ensure grid is applied
  content.offsetHeight;
}

/**
 * Enhanced create post element with proper image loading
 */
createPostElement(post, index) {
  const postDiv = document.createElement('div');
  postDiv.className = 'post-thumbnail';
  postDiv.setAttribute('data-post-id', post.id);
  postDiv.setAttribute('data-index', index);
  
  // Add selection state
  if (this.selectedPosts.has(post.id)) {
    postDiv.classList.add('selected');
  }

  // Downloaded posts are highlighted with a green card border
  if (this.downloadedPosts.has(post.id)) {
    postDiv.classList.add('downloaded');
  }

  // Create thumbnail image with proper loading
  const img = document.createElement('img');
  const previewUrl = post.fileUrls?.preview || post.fileUrls?.sample || post.fileUrls?.original;
  
  if (previewUrl) {
    // Track image load performance
    const trackLoad = window.performanceMonitor?.trackImageLoad(previewUrl);
    
    img.src = previewUrl;
    img.alt = `Post ${post.id}`;
    img.loading = 'lazy';
    
    // Add loading state
    img.addEventListener('load', () => {
      postDiv.classList.add('image-loaded');
      if (trackLoad) trackLoad(false); // false = not failed
    });
    
    img.addEventListener('error', () => {
      img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5GYWlsZWQ8L3RleHQ+PC9zdmc+';
      postDiv.classList.add('image-error');
      if (trackLoad) trackLoad(true); // true = failed
    });
  } else {
    // Placeholder for posts without images
    img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1zbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5ObyBJbWFnZTwvdGV4dD48L3N2Zz4=';
    img.alt = 'No preview available';
    postDiv.classList.add('no-image');
  }
  
  postDiv.appendChild(img);

  // Training score (bottom-right), with the reasons in the tooltip
  if (post.training) {
    const scoreBadge = document.createElement('div');
    scoreBadge.className = 'post-training-score';
    if (post.training.excluded) scoreBadge.classList.add('excluded');
    scoreBadge.textContent = post.training.excluded ? 'n/a' : post.training.score;
    scoreBadge.title = window.TrainingScore.describe(post.training);
    postDiv.appendChild(scoreBadge);
  }

  // Persistent category badge (bottom-left corner) - only visible once a
  // non-root category has been assigned to this post
  const hasCategories = this.availableCategories.length > 0;
  const assignedCategory = this.postCategories.get(post.id) || '';
  if (hasCategories) {
    const categoryBadge = document.createElement('div');
    categoryBadge.className = 'post-category-badge';
    categoryBadge.textContent = assignedCategory;
    categoryBadge.title = assignedCategory ? `Category: ${assignedCategory}` : '';
    categoryBadge.style.display = assignedCategory ? 'flex' : 'none';
    postDiv.appendChild(categoryBadge);
  }

  // Create overlay with post info
  const overlay = document.createElement('div');
  overlay.className = 'post-overlay';

  // Per-post category dropdown, only shown when subfolders were detected
  // for this artist/character (e.g. jrjresq/flat, /shaded, /sketch)
  const categorySelectHtml = hasCategories ? `
      <select class="post-category-select" title="Assign category folder for this post">
        ${this._buildCategoryOptionsHtml(assignedCategory)}
      </select>` : '';

  // Simplified overlay content
  overlay.innerHTML = `
    <div class="post-quick-actions">
      <button class="post-hover-btn" title="View full size" data-action="view">
        <i class="fas fa-expand"></i>
      </button>
      <button class="post-hover-btn" title="Download this post" data-action="download">
        <i class="fas fa-download"></i>
      </button>
      ${categorySelectHtml}
    </div>
  `;

  postDiv.appendChild(overlay);

  // Category dropdown needs its own handling so opening/choosing it doesn't
  // bubble up into the post-thumbnail's selection click handler below
  const categorySelect = overlay.querySelector('.post-category-select');
  if (categorySelect) {
    categorySelect.addEventListener('click', (e) => e.stopPropagation());
    categorySelect.addEventListener('mousedown', (e) => e.stopPropagation());
    categorySelect.addEventListener('change', (e) => {
      e.stopPropagation();
      this.setPostCategory(post.id, e.target.value);
    });
  }

  // Create selection indicator
  const indicator = document.createElement('div');
  indicator.className = 'post-selection-indicator';
  indicator.innerHTML = '<i class="fas fa-check"></i>';
  postDiv.appendChild(indicator);

  // Enhanced click handler for selection
  postDiv.addEventListener('click', (e) => {
    e.preventDefault();

    // Let the category dropdown handle its own clicks
    if (e.target.closest('.post-category-select')) {
      return;
    }

    // Handle quick actions
    if (e.target.closest('.post-hover-btn')) {
      const action = e.target.closest('.post-hover-btn').dataset.action;
      this.handleQuickAction(action, post);
      return;
    }

    // Handle selection based on mode
    if (this.selectionMode === 'range' && e.shiftKey) {
      this.selectRange(index);
    } else if (e.ctrlKey || e.metaKey) {
      this.togglePostSelection(post.id);
    } else if (this.selectionMode === 'range') {
      this.selectRange(index);
    } else {
      this.togglePostSelection(post.id);
    }
  });
  
  return postDiv;
}

/**
 * Handle quick actions on posts
 */
handleQuickAction(action, post) {
  switch (action) {
    case 'view':
      this.viewFullSizePost(post);
      break;
    case 'download':
      this.downloadSinglePost(post, this.getDownloadFolderPath());
      break;
    default:
      console.warn(`Unknown quick action: ${action}`);
  }
}

/**
 * Show selection summary
 */
showSelectionSummary() {
  // No-op: Selection summary is now always visible in footer
}

/**
 * Hide selection summary
 */
hideSelectionSummary() {
  // No-op: Selection summary is now always visible in footer
}

/**
 * Scroll to top of posts
 */
scrollToTop() {
  const container = this.elements.posts_container;
  if (container) {
    container.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
}

/**
 * Handle keyboard shortcuts
 */
handleKeyboardShortcuts(event) {
  if (event.ctrlKey || event.metaKey) {
    switch (event.key.toLowerCase()) {
      case 'a':
        event.preventDefault();
        this.selectAllPosts();
        break;
      case 'd':
        event.preventDefault();
        this.deselectAllPosts();
        break;
      case 'i':
        event.preventDefault();
        this.invertSelection();
        break;
      case 'enter':
        event.preventDefault();
        if (this.selectedPosts.size > 0) {
          this.downloadSelectedPosts();
        }
        break;
    }
  }
  
  // Non-modifier shortcuts
  switch (event.key) {
    case 'Escape':
      this.deselectAllPosts();
      break;
    case 'Home':
      event.preventDefault();
      this.scrollToTop();
      break;
  }
}

/**
 * Show loading state
 */
showLoading() {
  this.isLoading = true;
  
  if (this.elements.results_section) {
    this.elements.results_section.style.display = 'flex';
  }
  
  if (this.elements.loading_state) {
    this.elements.loading_state.style.display = 'flex';
  }
  
  if (this.elements.posts_grid) {
    this.elements.posts_grid.style.display = 'none';
  }
  
  if (this.elements.error_state) {
    this.elements.error_state.style.display = 'none';
  }
}

/**
 * Hide loading state
 */
hideLoading() {
  this.isLoading = false;
  
  if (this.elements.loading_state) {
    this.elements.loading_state.style.display = 'none';
  }
}

/**
 * Show results section
 */
showResults() {
  if (this.elements.results_section) {
    this.elements.results_section.style.display = 'flex';
  }
  
  if (this.elements.loading_state) {
    this.elements.loading_state.style.display = 'none';
  }
  
  if (this.elements.error_state) {
    this.elements.error_state.style.display = 'none';
  }
}

/**
 * Show no posts message
 */
showNoPosts() {
  this.showError(`No posts found for artist: ${this.currentArtist}`, {
    type: 'no-results'
  });
}

/**
 * Show error state
 */
showError(message, details = null) {
  console.error('🚨 Artist Search Error:', message, details);
  
  if (this.elements.results_section) {
    this.elements.results_section.style.display = 'flex';
  }
  
  if (this.elements.error_state) {
    this.elements.error_state.style.display = 'flex';
  }
  
  if (this.elements.posts_grid) {
    this.elements.posts_grid.style.display = 'none';
  }
  
  if (this.elements.loading_state) {
    this.elements.loading_state.style.display = 'none';
  }
  
  if (this.elements.error_message) {
    this.elements.error_message.textContent = message;
  }
  
  this.updateStatus(`Error: ${message}`);
}

/**
 * Clear form
 */
clearForm() {
  if (this.elements.artist_input) {
    this.elements.artist_input.value = '';
  }
  
  if (this.elements.tag_filter_input) {
    this.elements.tag_filter_input.value = '';
  }
  if (this.elements.clear_tag_filter_btn) {
    this.elements.clear_tag_filter_btn.style.display = 'none';
  }
  this.currentTagFilter = '';
  
  this.hideSuggestions();
  
  if (this.elements.results_section) {
    this.elements.results_section.style.display = 'none';
  }
  
  this.currentArtist = null;
  this.currentPosts = [];
  this.selectedPosts.clear();
  this.downloadedPosts.clear();
  this.postCategories.clear();
  this.availableCategories = [];
  this.updateCategoryToolbarUI();

  this.updateStatus('Ready');
}

/**
 * Clear error
 */
clearError() {
  if (this.elements.error_state) {
    this.elements.error_state.style.display = 'none';
  }
  
  if (this.elements.results_section) {
    this.elements.results_section.style.display = 'none';
  }
  
  this.updateStatus('Ready');
}

/**
 * Retry last search
 */
async retryLastSearch() {
  if (this.currentArtist) {
    await this.searchArtist();
  }
}

/**
 * Check API status
 */
async checkApiStatus() {
  try {
    const result = await window.electronAPI.e621.getCredentialsStatus();
    return result.success ? result : { isConfigured: false, error: true };
  } catch (error) {
    console.error('❌ Error checking API status:', error);
    return { isConfigured: false, error: true };
  }
}

/**
 * Update API status display
 */
updateApiStatus(status) {
  if (this.elements.api_status) {
    if (status.error) {
      this.elements.api_status.textContent = 'API: Error';
      this.elements.api_status.style.color = 'var(--error)';
    } else if (status.isConfigured) {
      this.elements.api_status.textContent = 'API: Ready';
      this.elements.api_status.style.color = 'var(--success)';
    } else {
      this.elements.api_status.textContent = 'API: Not Configured';
      this.elements.api_status.style.color = 'var(--warning)';
    }
  }
}

/**
 * Update status text (now uses global footer)
 */
updateStatus(status) {
  // Update global footer status
  if (window.app && window.app.updateFooterStatus) {
    const statusType = status.toLowerCase().includes('error') ? 'error' : 
                       status.toLowerCase().includes('searching') || status.toLowerCase().includes('loading') ? 'working' : 
                       'ready';
    window.app.updateFooterStatus(status, statusType);
  }
}

/**
 * Enhanced scroll handling with performance optimizations
 */
handleScroll(event) {
  // Throttle scroll events for performance
  if (this.scrollThrottleTimeout) {
    clearTimeout(this.scrollThrottleTimeout);
  }
  
  this.scrollThrottleTimeout = setTimeout(() => {
    this.performScrollUpdates(event);
  }, this.scrollThrottleDelay);
}

/**
 * Perform scroll updates (simplified)
 */
performScrollUpdates(event) {
  const container = event.target;
  const scrollTop = container.scrollTop;
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
  
  // Check for infinite scroll loading
  if (!this.isLoadingMore && this.hasMore) {
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    if (distanceFromBottom <= this.scrollBuffer) {
      this.loadMorePosts();
    }
  }
}

/**
 * Enhanced load more posts with better performance
 */
async loadMorePosts() {
  if (this.isLoadingMore || !this.hasMore || !this.currentArtist) {
    return;
  }
  
  console.log(`📄 Loading more posts for ${this.currentArtist}, page ${this.currentPage + 1}`);
  
  this.isLoadingMore = true;
  this.showLoadingMore();
  
  try {
    const nextPage = this.currentPage + 1;
    const additionalTags = this.currentTagFilter
      ? this.currentTagFilter.split(/[\s,]+/).map(t => t.trim()).filter(Boolean)
      : [];
    const options = {
      limit: this.pageLimit(),
      page: nextPage,
      includeFileUrls: true,
      includeMetadata: true,
      ...this.searchFilters,
      ...(additionalTags.length > 0 ? { additionalTags } : {})
    };
    
    let result;
    if (this.searchMode === 'artist') {
      result = await window.electronAPI.e621.searchByArtist(this.currentArtist, options);
    } else {
      result = await window.electronAPI.e621.searchByCharacter(this.currentArtist, options);
    }
    
    if (result.success && result.posts.length > 0) {
      // Each page is ranked on its own; existing cards keep their places.
      result.posts = this.prepareResults(result.posts);
      // Add new posts to current posts array
      this.currentPosts.push(...result.posts);
      this.currentPage = nextPage;
      this.currentPagination = result.pagination; // Update pagination data
      this.hasMore = result.pagination.hasMore;
      
      this.appendNewPosts(result.posts);

      // Check only the newly loaded posts for download status so highlights appear immediately
      this.checkDownloadStatus(result.posts);
      
      // Update counters
      this.updatePostCounts();
      
      console.log(`✅ Loaded ${result.posts.length} more posts. Total: ${this.currentPosts.length}`);
      
      // Update load more section
      if (this.hasMore) {
        this.showLoadMoreSection();
      } else {
        this.showNoMorePosts();
      }

    } else {
      // No more posts
      this.hasMore = false;
      this.showNoMorePosts();
      console.log(`ℹ️ No more posts available for ${this.currentArtist}`);
    }
    
  } catch (error) {
    console.error('❌ Error loading more posts:', error);
    this.showToast('Failed to load more posts. Please try again.', 'error');
  } finally {
    this.isLoadingMore = false;
    this.hideLoadingMore();
  }
}

/**
 * Append new posts to display (simplified)
 */
appendNewPosts(posts) {
  const content = this.elements.posts_grid_content;
  if (!content) return;
  
  posts.forEach((post, index) => {
    const globalIndex = this.currentPosts.length - posts.length + index;
    const postElement = this.createPostElement(post, globalIndex);
    content.appendChild(postElement);
  });
  
  console.log(`📸 Appended ${posts.length} new posts to grid`);
}

/**
 * Update post counts in UI
 */
updatePostCounts() {
  const totalPosts = this.currentPosts.length;
  
  if (this.elements.total_posts_count) {
    this.elements.total_posts_count.textContent = totalPosts;
  }
  
  if (this.elements.shown_posts_count) {
    this.elements.shown_posts_count.textContent = totalPosts;
  }
  
  if (this.elements.visible_posts_count) {
    this.elements.visible_posts_count.textContent = totalPosts;
  }
}

/**
 * Show load more section
 */
showLoadMoreSection() {
  const section = this.elements.load_more_section;
  const textSpan = this.elements.load_more_text;
  
  if (section) {
    section.style.display = 'block';
    
    if (textSpan) {
      const total = this.totalPostCount || (this.currentPagination ? this.currentPagination.total : 0);
      const current = this.currentPosts.length;
      
      if (total > current) {
        const remaining = total - current;
        textSpan.textContent = `Load More (${remaining} Images more)`;
      } else {
        // Fallback
        textSpan.textContent = 'Load More';
      }
    }
  }
  
  if (this.elements.no_more_posts) {
    this.elements.no_more_posts.style.display = 'none';
  }
}

/**
 * Show loading more state
 */
showLoadingMore() {
  if (this.elements.loading_more_state) {
    this.elements.loading_more_state.style.display = 'block';
  }
  if (this.elements.load_more_section) {
    this.elements.load_more_section.style.display = 'none';
  }
}

/**
 * Hide loading more state
 */
hideLoadingMore() {
  if (this.elements.loading_more_state) {
    this.elements.loading_more_state.style.display = 'none';
  }
}

/**
 * Show no more posts message
 */
showNoMorePosts() {
  if (this.elements.no_more_posts) {
    this.elements.no_more_posts.style.display = 'block';
  }
  if (this.elements.load_more_section) {
    this.elements.load_more_section.style.display = 'none';
  }
}

/**
 * Show toast notification
 */
showToast(message, type = 'info') {
  if (window.app && window.app.showToast) {
    window.app.showToast(message, type);
  } else {
    console.log(`Toast [${type}]: ${message}`);
  }
}

/**
 * Cleanup when tool is unloaded
 */
cleanup() {
  console.log('🧹 Cleaning up Artist Search Tool...');
  
  // Clear timeouts
  if (this.suggestionTimeout) {
    clearTimeout(this.suggestionTimeout);
  }
  
  if (this.scrollThrottleTimeout) {
    clearTimeout(this.scrollThrottleTimeout);
  }
  
  // Clear elements
  this.elements = {};
  this.currentArtist = null;
  this.currentPosts = [];
  this.selectedPosts.clear();
  this.isLoading = false;
  this.isLoadingMore = false;
}
}

window.mixMethods(ArtistSearchTool, ArtistSearchTemplate, ArtistSearchSuggestions, ArtistSearchCategories,
  ArtistSearchSelection, ArtistSearchPreview, ArtistSearchDownloads);

// Export the tool class
window.ArtistSearchTool = ArtistSearchTool;
export default ArtistSearchTool;