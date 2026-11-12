// Artist Search's page markup.
// Mixed into ArtistSearchTool (see utils/mixMethods.js).
export default class ArtistSearchTemplate {
  getTemplate() {
    return `
      <div class="tool-container artist-search-tool">
        <!-- Tool Content -->
        <div class="tool-content">
          <!-- Input Section -->
          <div class="input-section">
            <div class="form-group">
              <label class="form-label" id="search-input-label">Artist Name</label>
              <div class="input-with-button">
                <div class="search-input-wrapper">
                  <input 
                    type="text" 
                    class="form-input" 
                    id="artist-input" 
                    placeholder="Start typing artist name (e.g., narse, dragon...)"
                    autocomplete="off"
                  >
                  <div class="input-icons">
                    <div class="input-spinner" id="input-spinner" style="display: none;">
                      <i class="fas fa-spinner fa-spin"></i>
                    </div>
                    <button class="clear-input-btn" id="clear-input-btn" style="display: none;" title="Clear">
                      <i class="fas fa-times"></i>
                    </button>
                    <button class="search-icon-btn" id="search-btn" title="Search">
                      <i class="fas fa-search"></i>
                    </button>
                  </div>
                  <!-- Suggestions Dropdown -->
                  <div class="suggestions-dropdown" id="suggestions-dropdown" style="display: none;">
                    <!-- Suggestions will be populated here -->
                  </div>
                </div>
              </div>
              
              <div class="search-controls-row">
                <!-- Search Mode Toggle -->
                <div class="search-mode-container">
                  <span class="mode-label active" id="label-artist">Artist</span>
                  <label class="toggle-switch">
                    <input type="checkbox" id="mode-toggle-input">
                    <span class="slider"></span>
                  </label>
                  <span class="mode-label" id="label-character">Character</span>
                </div>
                <select class="posts-filter-control" id="source-select" title="Site to search. e926 is e621's safe-only mirror; Inkbunny without a login in Settings only shows General-rated work; Pawchive has no scores or ratings, and character search there is a text search. X needs you signed in (Settings) and loads posts by scrolling the artist's profile, so it is slower.">
                  <option value="e621">e621</option>
                  <option value="e926">e926 (safe)</option>
                  <option value="inkbunny">Inkbunny</option>
                  <option value="pawchive">Pawchive</option>
                  <option value="x">X (Twitter)</option>
                </select>
              </div>
            </div>
            
            <!-- Quick Actions
            <div class="quick-actions-section">
              <h4>Quick Actions</h4>
              <div class="quick-actions-grid">
                <button class="btn quick-action-btn" id="popular-artists-btn">
                  <i class="fas fa-star"></i>
                  <span>Popular Artists</span>
                </button>
                <button class="btn quick-action-btn" id="recent-artists-btn">
                  <i class="fas fa-clock"></i>
                  <span>Recent Artists</span>
                </button>
              </div>
            </div>-->
          </div>

          <!-- Results Section -->
          <div class="results-section" id="results-section" style="display: none;">
            <!-- Loading State -->
            <div class="loading-state" id="loading-state" style="display: none;">
              <div class="loading-spinner"></div>
              <p>Searching for posts...</p>
            </div>

            <!-- Posts Grid -->
            <div class="posts-grid" id="posts-grid" style="display: none;">
              <!-- Posts Header -->
              <div class="posts-header">
                <div class="posts-header-top">
                  <div class="posts-info">
                    <h3>Posts <span id="search-type-text">by</span> <span id="artist-name-display">-</span></h3>
                    <p class="posts-count">Showing <span id="visible-posts-count">0</span> of <span id="total-posts-count">0</span> posts</p>
                  </div>
                </div>

                <div class="posts-toolbar">
                  <select class="posts-filter-control" id="rating-filter">
                    <option value="">Rating: All</option>
                    <option value="safe">Safe</option>
                    <option value="questionable">Questionable</option>
                    <option value="explicit">Explicit</option>
                  </select>
                  <select class="posts-filter-control" id="sort-filter">
                    <option value="training">Sort: Best for training</option>
                    <option value="id">Sort: Newest</option>
                    <option value="score">Sort: Score</option>
                    <option value="favcount">Sort: Favs</option>
                    <option value="random">Sort: Random</option>
                  </select>
                  <input type="number" class="posts-filter-control posts-filter-score" id="min-score-filter" placeholder="Min score" min="0">
                  <div class="posts-filter-tag-wrap">
                    <input type="text" class="posts-filter-control" id="tag-filter-input" placeholder="Refine by tags" autocomplete="off">
                    <button class="clear-input-btn" id="clear-tag-filter-btn" style="display: none;" title="Clear tags">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                  <button class="btn btn-sm btn-primary" id="apply-filters-btn">Apply</button>
                  <div class="toolbar-divider"></div>
                  <button class="btn btn-sm btn-secondary" id="select-all-btn">All</button>
                  <button class="btn btn-sm btn-secondary" id="select-existed-btn" title="Select all posts that already exist on disk">Existed</button>
                  <button class="btn btn-sm btn-secondary" id="invert-selection-btn">Invert</button>
                  <button class="btn btn-sm btn-secondary" id="select-pattern-btn">Pattern</button>
                  <div class="toolbar-divider"></div>
                  <input type="number" class="posts-filter-control posts-filter-top" id="top-n-input" value="50" min="1" title="How many of the highest training scores to select">
                  <button class="btn btn-sm btn-secondary" id="select-top-btn" title="Select the posts with the highest training scores">Select top</button>
                  <div class="toolbar-divider" id="upgrade-divider"></div>
                  <button class="btn btn-sm btn-boost" id="find-upgrades-btn" title="Look for larger copies of these posts on Pawchive. Run it again after loading more posts."><i class="fas fa-angles-right"></i><span>Find upgrades</span></button>
                  <button class="btn btn-sm btn-secondary" id="find-on-x-btn" title="Find this artist's X account from their e621 page and search it"><i class="fab fa-x-twitter"></i> Find on X</button>
                  <div class="toolbar-divider" id="category-toolbar-divider" style="display: none;"></div>
                  <select class="posts-filter-control" id="bulk-category-select" style="display: none;" title="Category folder to apply to selected posts">
                    <option value="">Category: (root)</option>
                  </select>
                  <button class="btn btn-sm btn-secondary" id="apply-category-btn" style="display: none;" title="Assign the chosen category to all selected posts">
                    <i class="fas fa-folder"></i> Apply
                  </button>
                </div>

                <div class="posts-download-bar">
                  <span class="posts-selected-text" id="selected-count-text">No posts selected</span>
                  <label class="form-checkbox posts-tags-only" title="Only write the .txt tag files; images already on disk are not downloaded again">
                    <input type="checkbox" id="tags-only-toggle"> Tags only
                  </label>
                  <button class="btn btn-sm btn-secondary" id="open-folder-btn" title="Open this dataset's folder">
                    <i class="fas fa-folder-open"></i> Open folder
                  </button>
                  <button class="btn btn-sm btn-primary" id="download-selected-btn" disabled>
                    <i class="fas fa-download"></i> <span id="download-selected-text">Download</span>
                  </button>
                </div>

                <div class="posts-upgrade-bar" id="upgrade-bar" style="display: none;">
                  <span class="posts-upgrade-text" id="upgrade-bar-text"></span>
                  <button class="btn btn-sm btn-secondary" id="change-creator-btn" title="Link this artist to a different Pawchive creator">Change creator</button>
                  <button class="btn btn-sm btn-secondary" id="select-upgrades-btn" title="Select every post that will download from Pawchive">Select upgrades</button>
                  <button class="btn btn-sm btn-primary" id="review-upgrades-btn" title="Compare the uncertain pairs one by one">Review</button>
                </div>

                <div class="posts-upgrade-bar x-index-bar" id="x-index-bar" style="display: none;">
                  <span class="posts-upgrade-text" id="x-index-text"></span>
                  <button class="btn btn-sm btn-secondary" id="x-index-stop-btn" title="Stop indexing. What was found is kept, and searching again continues from there.">Stop</button>
                  <div class="progress-bar-container x-index-track" id="x-index-track"><div class="progress-bar" id="x-index-fill"></div></div>
                </div>
              </div>
              
              <!-- Posts Container - Simplified -->
              <div class="posts-container" id="posts-container">
                <!-- Posts will be rendered here -->
              </div>

              <!-- Load More Section -->
              <div class="load-more-section" id="load-more-section" style="display: none;">
                  <button id="load-more-btn" class="btn btn-sm load-more-btn-ghost">
                    <span id="load-more-text">Load More</span>
                  </button>
              </div>

              <!-- Loading More State -->
              <div class="loading-more-state" id="loading-more-state" style="display: none;">
                <div class="loading-spinner"></div>
                <p>Loading more posts...</p>
              </div>

              <!-- No More Posts Message -->
              <div class="no-more-posts" id="no-more-posts" style="display: none;">
                <p><i class="fas fa-check"></i> All posts loaded</p>
              </div>
            </div>

            <!-- Error State -->
            <div class="error-state" id="error-state" style="display: none;">
              <div class="error-content">
                <i class="fas fa-exclamation-triangle error-icon"></i>
                <h4>Error Loading Posts</h4>
                <p id="error-message">An error occurred while searching for posts.</p>
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
    `;
  }
}
