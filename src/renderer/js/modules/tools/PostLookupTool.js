// src/renderer/js/modules/tools/PostLookupTool.js - Enhanced with Download Feature
import { formatFileSize, formatDate, shortenUrl } from '../../utils/formatters.js';
import { validatePostId } from '../../utils/validators.js';
import { sanitizeForFilesystem, underscoresToSpaces } from '../../utils/stringUtils.js';

console.log('🔧 PostLookupTool module loading...');

class PostLookupTool extends BaseTool {
  constructor() {
    super({
      name: 'Post ID Lookup',
      id: 'post-lookup',
      icon: 'fas fa-search',
      description: 'Lookup E621 posts by ID and view detailed information',
      version: '1.0.0',
      category: 'E621 Tools'
    });

    this.currentPostId = null;
    this.currentPostData = null;
    this.isLoading = false;
    this.cache = new Map();
    
    // DOM elements (will be set when tool is loaded)
    this.elements = {};
    
    console.log('[DEBUG] Post Lookup Tool initialized');
  }

  // Cleanup method called when navigating away from the tool
  destroy() {
    this.cleanup();
    super.destroy();
    console.log('[DEBUG] Post Lookup Tool cleaned up');
  }

  /**
   * Get the HTML template for this tool
   */
  getTemplate() {
    return `
      <div class="tool-container post-lookup-tool">
        <!-- Tool Content -->
        <div class="tool-content">
          <!-- Input Section -->
          <div class="input-section">
            <div class="form-group">
              <label class="form-label">Post ID</label>
              <div class="input-with-button">
                <div class="search-input-wrapper">
                  <input 
                    type="text" 
                    class="form-input" 
                    id="post-id-input" 
                    placeholder="Enter E621 Post ID (e.g., 1234567)"
                    autocomplete="off"
                  >
                  <div class="input-icons">
                    <div class="input-spinner" id="input-spinner" style="display: none;">
                      <i class="fas fa-spinner fa-spin"></i>
                    </div>
                    <button class="clear-input-btn" id="clear-input-btn" style="display: none;" title="Clear">
                      <i class="fas fa-times"></i>
                    </button>
                    <button class="search-icon-btn" id="lookup-btn" title="Lookup">
                      <i class="fas fa-search"></i>
                    </button>
                  </div>
                </div>
              </div>
              <small class="form-help">
                Enter a numeric Post ID from e621.net. You can find this in the URL of any post.
              </small>
            </div>

            <!-- Quick Actions -->
            <!-- Removed to save space -->

          </div>

          <!-- Results Section -->
          <div class="results-section" id="results-section" style="display: none;">
            <!-- Loading State -->
            <div class="loading-state" id="loading-state" style="display: none;">
              <div class="loading-spinner"></div>
              <p>Fetching post data...</p>
            </div>

          <!-- Post Data Display -->
            <div class="post-data" id="post-data" style="display: none;">
              <div class="post-content-layout">
                <!-- Left Column: Visuals & Actions -->
                <div class="post-left-col">
                  <!-- Post Thumbnail Section -->
                  <div class="post-thumbnail-section">
                    <div class="thumbnail-container">
                      <div class="thumbnail-wrapper" id="thumbnail-wrapper">
                        <img id="post-thumbnail" src="" alt="Post thumbnail" style="display: none;">
                        <div class="thumbnail-placeholder" id="thumbnail-placeholder">
                          <i class="fas fa-image"></i>
                          <span>Loading preview...</span>
                        </div>
                        <div class="thumbnail-error" id="thumbnail-error" style="display: none;">
                          <i class="fas fa-exclamation-triangle"></i>
                          <span>Preview not available</span>
                        </div>
                      </div>
                      <div class="thumbnail-info">
                        <div class="thumbnail-actions">
                          <button class="btn btn-sm btn-secondary" id="view-full-size-btn" style="display: none;">
                            <i class="fas fa-expand"></i>
                            Full Size
                          </button>
                          <button class="btn btn-sm btn-secondary" id="copy-image-url-btn" style="display: none;">
                            <i class="fas fa-link"></i>
                            Copy URL
                          </button>
                        </div>
                        <div class="thumbnail-details">
                          <small class="text-muted" id="thumbnail-size-info">-</small>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Primary Actions -->
                  <div class="post-primary-actions">
                    <button class="btn btn-success btn-block" id="download-btn">
                      <i class="fas fa-download"></i>
                      Download
                    </button>
                    <button class="btn btn-secondary btn-block" id="open-folder-btn">
                      <i class="fas fa-folder-open"></i>
                      Open Folder
                    </button>
                    <div class="action-row">
                      <button class="btn btn-secondary" id="view-original-btn">
                        <i class="fas fa-external-link-alt"></i>
                        E621
                      </button>
                      <button class="btn btn-secondary" id="copy-data-btn">
                        <i class="fas fa-copy"></i>
                        Copy Data
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Right Column: Information -->
                <div class="post-right-col">
                  <!-- Post Header -->
                  <div class="post-header-info">
                    <div class="post-title-row">
                      <h3>Post #<span id="post-id-display">-</span></h3>
                      <div class="post-badges">
                        <span class="rating-badge" id="post-rating">-</span>
                        <span class="score-badge" id="post-score">-</span>
                        <span class="fav-badge" id="post-favorites">-</span>
                      </div>
                    </div>
                  </div>

                  <!-- Post Details Grid -->
                  <div class="post-details-grid">
                    <!-- File Information -->
                    <div class="info-card">
                      <h4><i class="fas fa-file"></i> File Info</h4>
                      <div class="info-content">
                        <div class="info-row">
                          <span class="info-label">Type:</span>
                          <span class="info-value" id="file-type">-</span>
                        </div>
                        <div class="info-row">
                          <span class="info-label">Size:</span>
                          <span class="info-value" id="file-size">-</span>
                        </div>
                        <div class="info-row">
                          <span class="info-label">Dim:</span>
                          <span class="info-value" id="file-dimensions">-</span>
                        </div>
                      </div>
                    </div>

                    <!-- Post Statistics -->
                    <div class="info-card">
                      <h4><i class="fas fa-chart-bar"></i> Stats</h4>
                      <div class="info-content">
                        <div class="info-row">
                          <span class="info-label">Score:</span>
                          <span class="info-value" id="detailed-score">-</span>
                        </div>
                        <div class="info-row">
                          <span class="info-label">Favs:</span>
                          <span class="info-value" id="detailed-favorites">-</span>
                        </div>
                        <div class="info-row">
                          <span class="info-label">Comments:</span>
                          <span class="info-value" id="comment-count">-</span>
                        </div>
                      </div>
                    </div>

                    <!-- Upload Information -->
                    <div class="info-card">
                      <h4><i class="fas fa-calendar"></i> Dates</h4>
                      <div class="info-content">
                        <div class="info-row">
                          <span class="info-label">Uploaded:</span>
                          <span class="info-value" id="upload-date">-</span>
                        </div>
                        <div class="info-row">
                          <span class="info-label">Updated:</span>
                          <span class="info-value" id="update-date">-</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Tags Section -->
                  <div class="tags-section">
                    <h4><i class="fas fa-tags"></i> Tags</h4>
                    <div class="tags-container">
                      <!-- General Tags -->
                      <div class="tag-category">
                        <h5>General (<span id="general-count">0</span>)</h5>
                        <div class="tag-list" id="general-tags"></div>
                      </div>

                      <!-- Species Tags -->
                      <div class="tag-category">
                        <h5>Species (<span id="species-count">0</span>)</h5>
                        <div class="tag-list" id="species-tags"></div>
                      </div>

                      <!-- Character Tags -->
                      <div class="tag-category">
                        <h5>Characters (<span id="character-count">0</span>)</h5>
                        <div class="tag-list" id="character-tags"></div>
                      </div>

                      <!-- Artist Tags -->
                      <div class="tag-category">
                        <h5>Artists (<span id="artist-count">0</span>)</h5>
                        <div class="tag-list" id="artist-tags"></div>
                      </div>

                      <!-- Copyright Tags -->
                      <div class="tag-category">
                        <h5>Copyright (<span id="copyright-count">0</span>)</h5>
                        <div class="tag-list" id="copyright-tags"></div>
                      </div>

                      <!-- Meta Tags -->
                      <div class="tag-category">
                        <h5>Meta (<span id="meta-count">0</span>)</h5>
                        <div class="tag-list" id="meta-tags"></div>
                      </div>
                    </div>
                  </div>

                  <!-- Description Section -->
                  <div class="description-section" id="description-section" style="display: none;">
                    <h4><i class="fas fa-align-left"></i> Description</h4>
                    <div class="description-content" id="description-content"></div>
                  </div>

                  <!-- Sources Section -->
                  <div class="sources-section" id="sources-section" style="display: none;">
                    <h4><i class="fas fa-link"></i> Sources</h4>
                    <div class="sources-list" id="sources-list"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Error State -->
            <div class="error-state" id="error-state" style="display: none;">
              <div class="error-content">
                <i class="fas fa-exclamation-triangle error-icon"></i>
                <h4>Error Loading Post</h4>
                <p id="error-message">An error occurred while fetching the post data.</p>
                <div class="error-actions">
                  <button class="btn btn-primary" id="retry-btn">
                    <i class="fas fa-redo"></i>
                    Retry
                  </button>
                  <button class="btn btn-secondary" id="clear-error-btn">
                    <i class="fas fa-times"></i>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Download Progress Modal -->
      <div id="download-progress-modal" class="modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3><i class="fas fa-download"></i> Download Progress</h3>
          </div>
          <div class="modal-body">
            <div class="download-progress-container">
              <div class="download-step" id="download-step-image">
                <i class="fas fa-image"></i>
                <span class="step-text">Downloading image...</span>
                <div class="step-status" id="image-status">
                  <i class="fas fa-spinner fa-spin"></i>
                </div>
              </div>
              <div class="download-step" id="download-step-tags">
                <i class="fas fa-tags"></i>
                <span class="step-text">Creating tags file...</span>
                <div class="step-status" id="tags-status">
                  <i class="fas fa-clock"></i>
                </div>
              </div>
              <div class="download-step" id="download-step-complete">
                <i class="fas fa-check-circle"></i>
                <span class="step-text">Download complete!</span>
                <div class="step-status" id="complete-status">
                  <i class="fas fa-clock"></i>
                </div>
              </div>
            </div>
            <div class="download-info" id="download-info" style="display: none;">
              <p><strong>Files downloaded:</strong></p>
              <ul id="downloaded-files-list"></ul>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="download-close-btn" disabled>
              Close
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Initialize the tool when it's loaded into the DOM
   */
  async initialize(container) {
    console.log('[DEBUG] Initializing Post Lookup Tool...');

    try {
      // Load the template
      container.innerHTML = this.getTemplate();
      this.setRoot(container);
      
      // Cache DOM elements
      this.cacheElements();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Load initial state
      await this.loadInitialState();
      
      // Update UI state
      this.updateFooterInfo();
      
      // Register header actions
      this.setHeaderActions([
        {
          id: 'clear-form-btn',
          label: 'Clear',
          icon: 'fas fa-broom',
          variant: 'secondary',
          onClick: () => this.clearForm()
        },
        {
          id: 'clear-cache-btn',
          label: 'Clear Cache',
          icon: 'fas fa-trash',
          variant: 'secondary',
          onClick: () => this.clearCache()
        }
      ]);
      
      console.log('[INFO] Post Lookup Tool initialized successfully');
      
    } catch (error) {
      console.error('[ERROR] Failed to initialize Post Lookup Tool:', error);
      this.showError('Failed to initialize tool', error);
    }
  }

  /**
   * Cache DOM elements for efficient access
   */
  cacheElements() {
    const elementIds = [
      'post-id-input', 'lookup-btn', 'input-spinner', 'clear-input-btn',
      'results-section', 'loading-state', 'post-data', 
      'error-state', 'post-id-display', 'post-rating', 'post-score', 
      'post-favorites', 'view-original-btn', 'copy-data-btn', 'download-btn',
      'post-thumbnail', 'thumbnail-wrapper', 'thumbnail-placeholder', 'thumbnail-error',
      'view-full-size-btn', 'copy-image-url-btn', 'thumbnail-size-info',
      'file-type', 'file-size', 'file-dimensions', 'detailed-score', 
      'detailed-favorites', 'comment-count', 'upload-date', 'update-date', 
      'general-tags', 'species-tags', 'character-tags', 'artist-tags',
      'copyright-tags', 'meta-tags', 'general-count', 'species-count',
      'character-count', 'artist-count', 'copyright-count', 'meta-count',
      'description-section', 'description-content', 'sources-section',
      'sources-list', 'error-message', 'retry-btn', 'clear-error-btn',
      'status-text', 'cache-info', 'api-status', 'open-folder-btn'
    ];

    this.elements = {
      ...this.elements,
      ...super.cacheElements(elementIds)
    };
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    console.log('[DEBUG] Setting up Post Lookup Tool event listeners...');

    // Input field - Enter key support and clear button visibility
    this.on(this.elements.post_id_input, 'input', (e) => {
      const value = e.target.value;
      if (this.elements.clear_input_btn) {
        this.elements.clear_input_btn.style.display = value.length > 0 ? 'block' : 'none';
      }
    });

    this.on(this.elements.post_id_input, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.lookupPost();
      }
    });

    // Clear input button
    this.on(this.elements.clear_input_btn, 'click', () => {
      this.clearForm();
    });

    // Open folder button
    this.on(this.elements.open_folder_btn, 'click', () => this.openDownloadsFolder());

    // Main lookup button
    this.on(this.elements.lookup_btn, 'click', () => this.lookupPost());

    // Post action buttons
    this.on(this.elements.view_original_btn, 'click', () => this.viewOriginalPost());
    this.on(this.elements.copy_data_btn, 'click', () => this.copyPostData());

    // Download button
    this.on(this.elements.download_btn, 'click', () => {
      console.log('[DEBUG] Download button clicked');
      console.log('[DEBUG] Current post data:', this.currentPostData);
      this.downloadPostData();
    });

    // Thumbnail action buttons
    this.on(this.elements.view_full_size_btn, 'click', () => this.viewFullSizeImage());
    this.on(this.elements.copy_image_url_btn, 'click', () => this.copyImageUrl());

    // Thumbnail state handling
    this.on(this.elements.post_thumbnail, 'error', () => this.handleThumbnailError());
    this.on(this.elements.post_thumbnail, 'load', () => this.handleThumbnailLoad());

    // Error handling buttons
    this.on(this.elements.retry_btn, 'click', () => this.retryLastLookup());
    this.on(this.elements.clear_error_btn, 'click', () => this.clearError());
  }

  /**
   * Load initial state of the tool
   */
  async loadInitialState() {
    try {
      // Check API status
      const apiStatus = await this.checkApiStatus();
      this.updateApiStatus(apiStatus);
      
      // Load any cached data
      this.updateFooterInfo();
      
      console.log('[DEBUG] Post ID tool initial state loaded', apiStatus);
      
    } catch (error) {
      console.error('[ERROR] Error loading initial state:', error);
      this.updateApiStatus({ isConfigured: false, error: true });
    }
  }

  /**
   * Main post lookup function
   */
  async lookupPost() {
    const postId = this.elements.post_id_input?.value?.trim();
    
    if (!postId) {
      this.showError('Please enter a Post ID');
      return;
    }

    if (!validatePostId(postId)) {
      this.showError('Please enter a valid numeric Post ID');
      return;
    }

    await this.fetchAndDisplayPost(postId);
  }

  /**
   * Fetch and display post data
   */
  async fetchAndDisplayPost(postId) {
    console.log(`[INFO] Looking up post: ${postId}`);
    
    this.currentPostId = postId;
    this.showLoading();
    this.updateStatus('Fetching post data...');

    try {
      // Check cache first
      if (this.cache.has(postId)) {
        console.log(`[DEBUG] Using cached data for post ${postId}`);
        const cachedData = this.cache.get(postId);
        this.displayPostData(cachedData);
        this.updateStatus('Post loaded from cache');
        return;
      }

      // Fetch from API
      const result = await window.electronAPI.e621.fetchPost(postId);
      
      if (result.success) {
        console.log(`[INFO] Post ${postId} fetched successfully`);
        
        // Cache the result
        this.cache.set(postId, result.post);
        this.currentPostData = result.post;
        
        // Display the data
        this.displayPostData(result.post);
        this.updateStatus(`Post ${postId} loaded successfully`);
        this.updateFooterInfo();
        
      } else {
        console.error(`[ERROR] Failed to fetch post ${postId}:`, result.message);
        this.showError(result.message, { type: result.type, details: result.details });
      }
      
    } catch (error) {
      console.error(`[ERROR] Error fetching post ${postId}:`, error);
      this.showError('Failed to fetch post data', error);
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Display post data in the UI
   */
  displayPostData(postData) {
    if (!postData) {
      this.showError('No post data to display');
      return;
    }

    console.log('[DEBUG] Displaying post data:', postData);

    // Show results section
    this.showResults();

    // Display basic post info
    this.displayBasicInfo(postData);
    
    // Load and display thumbnail
    this.loadThumbnail(postData);
    
    // Display detailed info
    this.displayDetailedInfo(postData);
    
    // Display tags
    this.displayTags(postData.tags);
    
    // Display description if present
    this.displayDescription(postData.metadata.description);
    
    // Display sources if present
    this.displaySources(postData.metadata.sources);

    // Update download button availability
    this.updateDownloadButton();

    // Add animation
    this.elements.post_data?.classList.add('fade-in-up');
  }

  /**
   * Update download button availability based on post data
   */
  updateDownloadButton() {
    if (!this.elements.download_btn) return;

    const isDownloadable = this.isPostDownloadable();
    
    if (isDownloadable) {
      this.elements.download_btn.disabled = false;
      this.elements.download_btn.title = 'Download image and tags file';
      this.elements.download_btn.style.opacity = '1';
    } else {
      this.elements.download_btn.disabled = true;
      this.elements.download_btn.title = 'No downloadable content available';
      this.elements.download_btn.style.opacity = '0.5';
    }
  }

  /**
   * Check if current post has downloadable content
   */
  isPostDownloadable() {
    if (!this.currentPostData || !this.currentPostData.fileUrls) {
      return false;
    }

    const fileUrls = this.currentPostData.fileUrls;
    return !!(fileUrls.original || fileUrls.sample || fileUrls.preview);
  }

  /**
   * Get download quality info for user feedback
   */
  getDownloadQualityInfo() {
    if (!this.currentPostData || !this.currentPostData.fileUrls) {
      return 'No download available';
    }

    const fileUrls = this.currentPostData.fileUrls;
    
    if (fileUrls.original) {
      return 'Original quality';
    } else if (fileUrls.sample) {
      return 'Sample quality (original not available)';
    } else if (fileUrls.preview) {
      return 'Preview quality (low resolution)';
    }
    
    return 'No download available';
  }

  /**
   * Display basic post information
   */
  displayBasicInfo(postData) {
    const { id, metadata } = postData;

    // Post ID
    if (this.elements.post_id_display) {
      this.elements.post_id_display.textContent = id;
    }

    // Rating badge
    if (this.elements.post_rating) {
      this.elements.post_rating.textContent = metadata.rating;
      this.elements.post_rating.className = `rating-badge ${metadata.rating.toLowerCase()}`;
    }

    // Score badge
    if (this.elements.post_score) {
      this.elements.post_score.textContent = `Score: ${metadata.score}`;
    }

    // Favorites badge
    if (this.elements.post_favorites) {
      this.elements.post_favorites.textContent = `${metadata.favorites} favorites`;
    }
  }

  /**
   * Display detailed post information
   */
  displayDetailedInfo(postData) {
    const { metadata } = postData;

    // File information
    if (this.elements.file_type) {
      this.elements.file_type.textContent = metadata.fileType.toUpperCase();
    }
    
    if (this.elements.file_size) {
      this.elements.file_size.textContent = formatFileSize(metadata.fileSize);
    }
    
    if (this.elements.file_dimensions) {
      this.elements.file_dimensions.textContent = 
        `${metadata.dimensions.width} × ${metadata.dimensions.height}`;
    }

    // Statistics
    if (this.elements.detailed_score) {
      this.elements.detailed_score.textContent = 
        `${metadata.score} (↑${metadata.upvotes} ↓${metadata.downvotes})`;
    }
    
    if (this.elements.detailed_favorites) {
      this.elements.detailed_favorites.textContent = metadata.favorites.toLocaleString();
    }
    
    if (this.elements.comment_count) {
      this.elements.comment_count.textContent = metadata.commentCount.toLocaleString();
    }

    // Dates
    if (this.elements.upload_date) {
      this.elements.upload_date.textContent = formatDate(metadata.uploadedAt);
    }
    
    if (this.elements.update_date) {
      this.elements.update_date.textContent = formatDate(metadata.updatedAt);
    }
  }

  /**
   * Display tags organized by category
   */
  displayTags(tags) {
    if (!tags) return;

    const categories = [
      { key: 'general', element: 'general_tags', count: 'general_count' },
      { key: 'species', element: 'species_tags', count: 'species_count' },
      { key: 'character', element: 'character_tags', count: 'character_count' },
      { key: 'artist', element: 'artist_tags', count: 'artist_count' },
      { key: 'copyright', element: 'copyright_tags', count: 'copyright_count' },
      { key: 'meta', element: 'meta_tags', count: 'meta_count' }
    ];

    categories.forEach(({ key, element, count }) => {
      const tagList = tags[key] || [];
      const tagContainer = this.elements[element];
      const countElement = this.elements[count];

      if (countElement) {
        countElement.textContent = tagList.length;
      }

      if (tagContainer) {
        tagContainer.innerHTML = '';
        
        if (tagList.length === 0) {
          tagContainer.innerHTML = '<span class="no-tags">None</span>';
        } else {
          tagList.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = `tag-item ${key}`;
            tagElement.textContent = tag;
            tagElement.title = `Copy "${tag}"`;
            tagElement.addEventListener('click', () => {
              this.searchByTag(tag);
            });
            tagContainer.appendChild(tagElement);
          });
        }
      }
    });
  }

  /**
   * Display post description
   */
  displayDescription(description) {
    if (description && description.trim()) {
      if (this.elements.description_content) {
        // Basic text formatting - convert newlines to <br>
        const formattedDescription = description
          .replace(/\n/g, '<br>')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        this.elements.description_content.innerHTML = formattedDescription;
      }
      
      if (this.elements.description_section) {
        this.elements.description_section.style.display = 'block';
      }
    } else {
      if (this.elements.description_section) {
        this.elements.description_section.style.display = 'none';
      }
    }
  }

  /**
   * Display post sources
   */
  displaySources(sources) {
    if (sources && sources.length > 0) {
      if (this.elements.sources_list) {
        this.elements.sources_list.innerHTML = '';
        
        sources.forEach(source => {
          const sourceElement = document.createElement('a');
          sourceElement.className = 'source-item';
          sourceElement.href = source;
          sourceElement.target = '_blank';
          sourceElement.innerHTML = `
            <i class="fas fa-external-link-alt"></i>
            ${shortenUrl(source)}
          `;
          this.elements.sources_list.appendChild(sourceElement);
        });
      }
      
      if (this.elements.sources_section) {
        this.elements.sources_section.style.display = 'block';
      }
    } else {
      if (this.elements.sources_section) {
        this.elements.sources_section.style.display = 'none';
      }
    }
  }

  /**
   * Download post data (image and tags)
   */
  async downloadPostData() {
    console.log('[INFO] downloadPostData called');
    console.log('[DEBUG] Current post data:', this.currentPostData);
    
    if (!this.currentPostData) {
      console.warn('[WARN] No current post data');
      this.showToast('No post data to download', 'warning');
      return;
    }

    const isDownloadable = this.isPostDownloadable();
    console.log('[DEBUG] Is post downloadable?', isDownloadable);
    
    if (!isDownloadable) {
      console.warn('[WARN] Post is not downloadable');
      this.showToast('No downloadable content available for this post', 'error');
      return;
    }

    console.log('[INFO] Starting download process...');
    
    const postId = this.currentPostData.id;
    const artistName = this.getArtistName();
    
    console.log(`[INFO] Post ID: ${postId}, Artist: ${artistName}`);
    
    try {
      const fileType = this.currentPostData.metadata.fileType;
      console.log(`[DEBUG] File type: ${fileType}`);
      
      // Download image
      this.showToast('Downloading image...', 'info');
      console.log('[INFO] Downloading image...');
      await this.downloadImageToFolder(postId, fileType, artistName);
      
      // Download tags
      this.showToast('Downloading tags...', 'info');
      console.log('[INFO] Downloading tags...');
      await this.downloadTagsToFolder(postId, artistName);
      
      // Complete
      console.log('[INFO] Download complete!');
      this.showToast(`Downloaded to: downloads/${artistName}/`, 'success');
      
    } catch (error) {
      console.error('[ERROR] Download failed:', error);
      console.error('[ERROR] Error stack:', error.stack);
      this.showToast(`Download failed: ${error.message}`, 'error');
    }
  }

/**
 * Get the artist name for folder creation
 */
getArtistName() {
  if (!this.currentPostData || !this.currentPostData.tags || !this.currentPostData.tags.artist) {
    return 'unknown_artist';
  }
  
  const artists = this.currentPostData.tags.artist;
  if (artists.length === 0) {
    return 'unknown_artist';
  }
  
  // Use first artist, clean the name for folder usage
  let artistName = artists[0];
  
  // Convert underscores to spaces, then sanitize for filesystem
  artistName = sanitizeForFilesystem(underscoresToSpaces(artistName));
    
  return artistName || 'unknown_artist';
}

/**
 * Download image to artist folder
 */
async downloadImageToFolder(postId, fileType, artistName) {
  console.log(`[INFO] Downloading image for post ${postId} to ${artistName}/...`);
  
  try {
    const imageUrl = this.getImageUrl();
    console.log('[DEBUG] Image URL:', imageUrl);
    
    if (!imageUrl) {
      throw new Error('Image URL not found in post data');
    }
    
    console.log(`[DEBUG] Fetching image from: ${imageUrl}`);
    console.log(`[DEBUG] Target: downloads/${artistName}/${postId}.${fileType}`);
    
    // Check if electronAPI is available
    if (!window.electronAPI || !window.electronAPI.utils || !window.electronAPI.utils.downloadImage) {
      console.error('[ERROR] electronAPI.utils.downloadImage not available');
      throw new Error('Download API not available');
    }
    
    // Use Electron's net module to download the image
    // Post Lookup always downloads to artist folders
    const result = await window.electronAPI.utils.downloadImage({
      url: imageUrl,
      artistName,
      fileName: `${postId}.${fileType}`,
      downloadType: 'artist'
    });
    
    console.log('[DEBUG] Download result:', result);
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    console.log(`[INFO] Image saved: ${result.filePath}`);
    
  } catch (error) {
    console.error('[ERROR] Image download failed:', error);
    throw error;
  }
}

/**
 * Download tags file to artist folder
 */
async downloadTagsToFolder(postId, artistName) {
  console.log(`[INFO] Creating tags file for post ${postId} in ${artistName}/...`);
  
  try {
    const combinedTags = this.getCombinedTags();
    
    if (combinedTags.length === 0) {
      console.warn('[WARN] No tags found to download');
      return;
    }
    
    // Process tags: replace underscores with spaces
    const processedTags = combinedTags.map(tag => tag.replace(/_/g, ' '));
    
    // Create CSV content
    const csvContent = processedTags.join(', ');
    const fileName = `${postId}.txt`;
    
    // Save using Electron's file system
    // Post Lookup always saves to artist folders
    const result = await window.electronAPI.utils.saveToDownloads({
      artistName,
      fileName,
      content: csvContent,
      downloadType: 'artist'
    });
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    console.log(`[INFO] Tags file saved: ${result.filePath}`);
    
  } catch (error) {
    console.error('[ERROR] Tags file creation failed:', error);
    throw error;
  }
}

  /**
   * Open downloads folder for current artist
   */
  async openDownloadsFolder() {
    if (!this.currentPostData) {
      this.showToast('No post data available', 'warning');
      return;
    }
    
    const artistName = this.getArtistName();
    
    try {
      const result = await window.electronAPI.utils.openDownloadsFolder(artistName);
      
      if (result.success) {
        this.showToast(`Opened folder: ${artistName}`, 'info');
      } else {
        this.showToast(result.message, 'error');
      }
      
    } catch (error) {
      console.error('[ERROR] Failed to open folder:', error);
      this.showToast('Failed to open folder', 'error');
    }
  }  /**
   * Get the image URL from current post data
   */
  getImageUrl() {
    if (!this.currentPostData || !this.currentPostData.fileUrls) {
      return null;
    }

    const fileUrls = this.currentPostData.fileUrls;
    
    // Try original first (best quality)
    if (fileUrls.original) {
      console.log('[DEBUG] Using original file URL');
      return fileUrls.original;
    }
    
    // Fall back to sample
    if (fileUrls.sample) {
      console.log('[DEBUG] Using sample file URL (original not available)');
      return fileUrls.sample;
    }
    
    // Last resort: preview (very low quality)
    if (fileUrls.preview) {
      console.log('[DEBUG] Using preview file URL (low quality)');
      return fileUrls.preview;
    }
    
    console.warn('[WARN] No downloadable file URL found');
    return null;
  }

  /**
   * Generate E621 file path (approximation)
   * Note: This is a simplified version. The actual E621 file paths are more complex.
   */
  generateE621Path(postId) {
    // This method is no longer needed since we get URLs from the API
    // Keeping it for backwards compatibility
    const paddedId = postId.toString().padStart(8, '0');
    return `${paddedId.slice(0, 2)}/${paddedId.slice(2, 4)}/${paddedId}`;
  }

  /**
   * Get combined species and general tags for LORA training
   */
  getCombinedTags() {
  if (!this.currentPostData || !this.currentPostData.tags) {
    return [];
  }

  const tags = this.currentPostData.tags;
  const combinedTags = [];

  // Add character tags first (most specific)
  if (tags.character && Array.isArray(tags.character)) {
    combinedTags.push(...tags.character);
  }

  // Add copyright tags
  if (tags.copyright && Array.isArray(tags.copyright)) {
    combinedTags.push(...tags.copyright);
  }

  // Add species tags
  if (tags.species && Array.isArray(tags.species)) {
    combinedTags.push(...tags.species);
  }

  // Add general tags
  if (tags.general && Array.isArray(tags.general)) {
    combinedTags.push(...tags.general);
  }

  // Remove duplicates and filter problematic tags
  const filteredTags = [...new Set(combinedTags)]
    .filter(tag => {
      const problematicPatterns = [
        /^rating:/, /^score:/, /^favcount:/, /^id:/, /^user:/,
        /^deleted/, /^conditional_dnp/, /^avoid_posting/
      ];
      return !problematicPatterns.some(pattern => pattern.test(tag));
    })
    .sort();

  return filteredTags;
}

  /**
   * Get the appropriate filename for the downloaded image
   */
  getImageFilename() {
    if (!this.currentPostData) {
      return 'unknown.jpg';
    }

    const postId = this.currentPostData.id;
    const fileType = this.currentPostData.metadata.fileType;
    
    // Check if we're using original, sample, or preview
    const fileUrls = this.currentPostData.fileUrls;
    let qualityPrefix = '';
    
    if (fileUrls.sample && !fileUrls.original) {
      qualityPrefix = 'sample_';
    } else if (fileUrls.preview && !fileUrls.original && !fileUrls.sample) {
      qualityPrefix = 'preview_';
    }
    
    return `${qualityPrefix}${postId}.${fileType}`;
  }

  /**
   * Complete the download process
   */
  completeDownload() {
    console.log('[INFO] Download process completed');
    
    // Update status
    this.updateDownloadStep('complete', 'complete');
    
    // Show download info
    this.showDownloadInfo();
    
    // Enable close button
    if (this.elements.download_close_btn) {
      this.elements.download_close_btn.disabled = false;
    }
    
    // Show success toast
    this.showToast('Download completed successfully!', 'success');
  }

  /**
   * Show loading state
   */
  showLoading() {
    this.isLoading = true;
    
    if (this.elements.results_section) {
      this.elements.results_section.style.display = 'block';
    }
    
    if (this.elements.loading_state) {
      this.elements.loading_state.style.display = 'flex';
    }
    
    if (this.elements.post_data) {
      this.elements.post_data.style.display = 'none';
    }
    
    if (this.elements.error_state) {
      this.elements.error_state.style.display = 'none';
    }

    // Show spinner in input
    if (this.elements.input_spinner) {
      this.elements.input_spinner.style.display = 'block';
    }

    // Disable lookup button
    if (this.elements.lookup_btn) {
      this.elements.lookup_btn.disabled = true;
      this.elements.lookup_btn.style.opacity = '0.5';
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

    // Hide spinner in input
    if (this.elements.input_spinner) {
      this.elements.input_spinner.style.display = 'none';
    }

    // Re-enable lookup button
    if (this.elements.lookup_btn) {
      this.elements.lookup_btn.disabled = false;
      this.elements.lookup_btn.style.opacity = '1';
    }
  }

  /**
   * Show results section
   */
  showResults() {
    if (this.elements.results_section) {
      this.elements.results_section.style.display = 'block';
    }
    
    if (this.elements.post_data) {
      this.elements.post_data.style.display = 'block';
    }
    
    if (this.elements.error_state) {
      this.elements.error_state.style.display = 'none';
    }
  }

  /**
   * Show error state
   */
  showError(message, details = null) {
    console.error('[ERROR] Post Lookup Tool Error:', message, details);

    if (this.elements.results_section) {
      this.elements.results_section.style.display = 'block';
    }
    
    if (this.elements.error_state) {
      this.elements.error_state.style.display = 'flex';
    }
    
    if (this.elements.post_data) {
      this.elements.post_data.style.display = 'none';
    }
    
    if (this.elements.loading_state) {
      this.elements.loading_state.style.display = 'none';
    }

    if (this.elements.error_message) {
      this.elements.error_message.textContent = message;
    }

    this.updateStatus(`Error: ${message}`);

    // Show toast notification
    this.showToast(message, 'error');
  }

  /**
   * Clear error state
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
   * Clear the form
   */
  clearForm() {
    if (this.elements.post_id_input) {
      this.elements.post_id_input.value = '';
      this.elements.post_id_input.focus();
    }
    
    if (this.elements.clear_input_btn) {
      this.elements.clear_input_btn.style.display = 'none';
    }
    
    if (this.elements.results_section) {
      this.elements.results_section.style.display = 'none';
    }

    this.currentPostId = null;
    this.currentPostData = null;
    this.updateStatus('Ready');
  }

  /**
   * Clear cache
   */
  clearCache() {
    const cacheSize = this.cache.size;
    this.cache.clear();
    
    this.updateFooterInfo();
    this.updateStatus(`Cache cleared (${cacheSize} items removed)`);
    
    this.showToast(`Cache cleared: ${cacheSize} items removed`, 'success');

    // Also clear API cache
    if (window.electronAPI.e621.clearCache) {
      window.electronAPI.e621.clearCache().then(result => {
        if (result.success) {
          console.log('[INFO] API cache cleared');
        }
      });
    }
  }

  /**
   * View original post on E621
   */
  viewOriginalPost() {
    if (this.currentPostId) {
      const url = `https://e621.net/posts/${this.currentPostId}`;
      window.open(url, '_blank');
    }
  }

  /**
   * Copy post data to clipboard
   */
  async copyPostData() {
    if (!this.currentPostData) {
      this.showToast('No post data to copy', 'warning');
      return;
    }

    try {
      const dataText = JSON.stringify(this.currentPostData, null, 2);
      await navigator.clipboard.writeText(dataText);
      
      this.showToast('Post data copied to clipboard!', 'success');
      this.updateStatus(`Post data copied (${this.currentPostId})`);
      this.updateFooterInfo();
      console.log('[DEBUG] Post data copied:', dataText);
    } catch (error) {
      console.error('[ERROR] Failed to copy post data:', error);
      this.showToast('Failed to copy post data', 'error');
    }
  }

  /**
   * Retry last lookup
   */
  async retryLastLookup() {
    if (this.currentPostId) {
      await this.fetchAndDisplayPost(this.currentPostId);
    }
  }

  /** Copies a clicked tag, ready to paste into a caption or search. */
  async searchByTag(tag) {
    try {
      await navigator.clipboard.writeText(tag);
      this.showToast(`Copied "${tag}"`, 'success');
    } catch (error) {
      console.error('Could not copy tag:', error);
      this.showToast('Could not copy the tag', 'error');
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
      console.error('[ERROR] Error checking API status:', error);
      return { isConfigured: false, error: true };
    }
  }

  /**
   * Update status text (now uses global footer)
   */
  updateStatus(status) {
    super.updateStatus(status);
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
   * Update footer information
   */
  updateFooterInfo() {
    if (this.elements.cache_info) {
      this.elements.cache_info.textContent = `Cache: ${this.cache.size} items`;
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    super.showToast(message, type);
  }

  /**
   * Load and display thumbnail
   */
  loadThumbnail(postData) {
    if (!postData || !postData.fileUrls) {
      this.showThumbnailError();
      return;
    }

    const { fileUrls } = postData;
    
    // Determine best thumbnail URL (preview > sample > original for thumbnail)
    let thumbnailUrl = fileUrls.preview || fileUrls.sample || fileUrls.original;
    let fullSizeUrl = fileUrls.original || fileUrls.sample;
    
    if (!thumbnailUrl) {
      this.showThumbnailError();
      return;
    }

    console.log(`[DEBUG] Loading thumbnail for post ${postData.id}:`, thumbnailUrl);

    // Reset thumbnail state
    this.resetThumbnailState();

    // Set up the thumbnail image
    if (this.elements.post_thumbnail) {
      this.elements.post_thumbnail.src = thumbnailUrl;
      this.elements.post_thumbnail.alt = `Post ${postData.id} thumbnail`;
      
      // Store URLs for button actions
      this.elements.post_thumbnail.dataset.fullSizeUrl = fullSizeUrl;
      this.elements.post_thumbnail.dataset.thumbnailUrl = thumbnailUrl;
    }

    // Update thumbnail size info
    this.updateThumbnailSizeInfo(postData.metadata);
  }

  /**
   * Reset thumbnail state to loading
   */
  resetThumbnailState() {
    // Hide error and thumbnail
    if (this.elements.thumbnail_error) {
      this.elements.thumbnail_error.style.display = 'none';
    }
    if (this.elements.post_thumbnail) {
      this.elements.post_thumbnail.style.display = 'none';
    }
    
    // Show placeholder
    if (this.elements.thumbnail_placeholder) {
      this.elements.thumbnail_placeholder.style.display = 'flex';
    }

    // Hide action buttons
    if (this.elements.view_full_size_btn) {
      this.elements.view_full_size_btn.style.display = 'none';
    }
    if (this.elements.copy_image_url_btn) {
      this.elements.copy_image_url_btn.style.display = 'none';
    }
  }

  /**
   * Handle successful thumbnail load
   */
  handleThumbnailLoad() {
    console.log('[DEBUG] Thumbnail loaded successfully');
    
    // Hide placeholder and error
    if (this.elements.thumbnail_placeholder) {
      this.elements.thumbnail_placeholder.style.display = 'none';
    }
    if (this.elements.thumbnail_error) {
      this.elements.thumbnail_error.style.display = 'none';
    }
    
    // Show thumbnail
    if (this.elements.post_thumbnail) {
      this.elements.post_thumbnail.style.display = 'block';
    }

    // Show action buttons
    if (this.elements.view_full_size_btn) {
      this.elements.view_full_size_btn.style.display = 'inline-block';
    }
    if (this.elements.copy_image_url_btn) {
      this.elements.copy_image_url_btn.style.display = 'inline-block';
    }
  }

  /**
   * Handle thumbnail load error
   */
  handleThumbnailError() {
    console.warn('[WARN] Thumbnail failed to load');
    
    // Hide placeholder and thumbnail
    if (this.elements.thumbnail_placeholder) {
      this.elements.thumbnail_placeholder.style.display = 'none';
    }
    if (this.elements.post_thumbnail) {
      this.elements.post_thumbnail.style.display = 'none';
    }
    
    // Show error state
    this.showThumbnailError();
  }

  /**
   * Show thumbnail error state
   */
  showThumbnailError() {
    if (this.elements.thumbnail_error) {
      this.elements.thumbnail_error.style.display = 'flex';
    }
    
    // Hide action buttons
    if (this.elements.view_full_size_btn) {
      this.elements.view_full_size_btn.style.display = 'none';
    }
    if (this.elements.copy_image_url_btn) {
      this.elements.copy_image_url_btn.style.display = 'none';
    }
  }

  /**
   * Update thumbnail size info
   */
  updateThumbnailSizeInfo(metadata) {
    if (!this.elements.thumbnail_size_info || !metadata) return;

    const { dimensions, fileType, fileSize } = metadata;
    
    let sizeInfo = '';
    
    if (dimensions && dimensions.width && dimensions.height) {
      sizeInfo += `${dimensions.width}×${dimensions.height}`;
    }
    
    if (fileType) {
      sizeInfo += sizeInfo ? ` • ${fileType.toUpperCase()}` : fileType.toUpperCase();
    }
    
    if (fileSize && fileSize > 0) {
      const sizeFormatted = formatFileSize(fileSize);
      sizeInfo += sizeInfo ? ` • ${sizeFormatted}` : sizeFormatted;
    }
    
    this.elements.thumbnail_size_info.textContent = sizeInfo || 'No size info';
  }

  /**
   * View full size image in new tab
   */
  viewFullSizeImage() {
    const fullSizeUrl = this.elements.post_thumbnail?.dataset.fullSizeUrl;
    
    if (fullSizeUrl) {
      window.open(fullSizeUrl, '_blank');
      this.showToast('Opening full size image', 'info');
    } else {
      this.showToast('Full size image not available', 'warning');
    }
  }

  /**
   * Copy image URL to clipboard
   */
  async copyImageUrl() {
    const fullSizeUrl = this.elements.post_thumbnail?.dataset.fullSizeUrl;
    
    if (!fullSizeUrl) {
      this.showToast('Image URL not available', 'warning');
      return;
    }

    try {
      await navigator.clipboard.writeText(fullSizeUrl);
      this.showToast('Image URL copied to clipboard', 'success');
    } catch (error) {
      console.error('[ERROR] Failed to copy URL:', error);
      this.showToast('Failed to copy URL', 'error');
    }
  }

  /**
   * Cleanup when tool is unloaded
   */
  cleanup() {
    console.log('[DEBUG] Cleaning up Post Lookup Tool...');
    
    // Clear any intervals/timeouts
    // Remove event listeners if needed
    // Clear cache if desired
    
    this.elements = {};
    this.currentPostId = null;
    this.currentPostData = null;
    this.isLoading = false;
  }

  /**
   * Get tool statistics for debugging
   */
  getStats() {
    return {
      name: this.name,
      version: this.version,
      isLoading: this.isLoading,
      currentPostId: this.currentPostId,
      cacheSize: this.cache.size,
      hasCurrentData: !!this.currentPostData
    };
  }
}

// Export the tool class
window.PostLookupTool = PostLookupTool;
export default PostLookupTool;