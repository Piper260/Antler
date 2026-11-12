// src/main/services/E621Service.js - Enhanced with file URLs for downloads

const { formatFileSize } = require('../utils/formatters');

class E621Service {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.baseUrl = 'https://e621.net';
    this.rateLimit = 500; // 500ms between requests (E621 requirement)
    this.lastRequestTime = 0;
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    
    console.log('🌐 E621 service initialized');
  }

  /**
   * Rate limiting - E621 requires minimum 500ms between requests
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimit) {
      const waitTime = this.rateLimit - timeSinceLastRequest;
      console.log(`⏳ Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Get credentials from settings
   */
  getCredentials() {
    return this.settingsService.getE621Credentials();
  }

  /**
   * Make authenticated request to E621 API
   */
  async makeRequest(endpoint, baseUrl = this.baseUrl) {
    // Apply rate limiting
    await this.waitForRateLimit();
    
    const credentials = this.getCredentials();
    const url = `${baseUrl}${endpoint}`;
    
    console.log(`📡 Making E621 API request: ${url}`);
    
    // Prepare headers
    const headers = {
      'Accept': 'application/json',
      'User-Agent': `Antler/1.0 (by ${credentials.username || 'anonymous'} on e621)`
    };

    // Add authentication if credentials are available
    if (credentials.isConfigured) {
      const auth = Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
      console.log(`🔐 Using authenticated request for user: ${credentials.username}`);
    } else {
      console.log('⚠️ Making unauthenticated request (some posts may not be accessible)');
    }

    try {
            const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000)
      });

      console.log(`📊 API Response: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`E621 API Error: ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.statusText = response.statusText;
        error.details = errorText;
        
        // Add specific error types for better handling
        switch (response.status) {
          case 401:
            error.type = 'authentication-failed';
            error.userMessage = 'Authentication failed. Check your E621 credentials in Settings.';
            break;
          case 403:
            error.type = 'forbidden';
            error.userMessage = 'Access forbidden. Your account may not have API access enabled.';
            break;
          case 404:
            error.type = 'not-found';
            error.userMessage = 'Post not found.';
            break;
          case 429:
            error.type = 'rate-limited';
            error.userMessage = 'Rate limited. Please wait before making another request.';
            break;
          case 503:
            error.type = 'service-unavailable';
            error.userMessage = 'E621 service temporarily unavailable.';
            break;
          default:
            error.type = 'api-error';
            error.userMessage = `API error: ${response.status}`;
        }
        
        throw error;
      }

      const data = await response.json();
      return data;

    } catch (error) {
            if (error.name === 'TimeoutError') {
        const timeoutError = new Error('Request timeout');
        timeoutError.type = 'timeout';
        timeoutError.userMessage = 'Request timed out. Please check your connection.';
        throw timeoutError;
      }
      
            // fetch reports network failures as a TypeError with the cause attached.
      if (error.code === 'ENOTFOUND' || (error.name === 'TypeError' && error.cause)) {
        const networkError = new Error('Network error');
        networkError.type = 'network-error';
        networkError.userMessage = 'Network error. Please check your internet connection.';
        throw networkError;
      }
      
      // Re-throw API errors with their metadata intact
      throw error;
    }
  }

  /**
   * Fetch post data by ID with caching
   */
  async fetchPostById(postId) {
    console.log(`🔍 Fetching post: ${postId}`);

    // Validate input
    if (!postId) {
      throw new Error('Post ID is required');
    }

    const normalizedId = String(postId).trim();
    if (!/^\d+$/.test(normalizedId)) {
      const error = new Error('Post ID must be numeric');
      error.type = 'validation-error';
      error.userMessage = 'Please enter a valid numeric Post ID.';
      throw error;
    }

    // Check cache first
    const cacheKey = `post_${normalizedId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      console.log(`📦 Using cached data for post ${normalizedId}`);
      return cached.data;
    }

    try {
      // Make API request
      const response = await this.makeRequest(`/posts/${normalizedId}.json`);
      
      if (!response || !response.post) {
        const error = new Error('Invalid response format');
        error.type = 'api-error';
        error.userMessage = 'Received invalid data from E621 API.';
        throw error;
      }

      const post = response.post;

      // Validate post structure
      if (!post.id) {
        const error = new Error('Invalid post data');
        error.type = 'api-error';
        error.userMessage = 'Received incomplete post data from E621 API.';
        throw error;
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: post,
        timestamp: Date.now()
      });

      console.log(`✅ Successfully fetched post ${normalizedId}`);
      return post;

    } catch (error) {
      console.error(`❌ Error fetching post ${normalizedId}:`, error.message);
      throw error;
    }
  }

  /**
   * The e621 order: tag for a Sort dropdown value. 'id' (newest) is e621's
   * default and needs none; 'training' fetches top-scored posts, which the
   * renderer then re-ranks for training suitability.
   */
  static siteUrl(site) {
    // e926 is e621's safe-only mirror: same API, same accounts.
    return site === 'e926' ? 'https://e926.net' : 'https://e621.net';
  }

  static orderTag(sortBy) {
    const orders = { score: 'order:score', favcount: 'order:favcount', random: 'order:random', training: 'order:score' };
    return orders[sortBy] || null;
  }

  /**
   * Search posts by tags
   */
  async searchPosts(tags = [], limit = 20) {
    if (limit > 320) limit = 320; // E621 maximum
    
    const tagString = Array.isArray(tags) ? tags.join(' ') : String(tags);
    const endpoint = `/posts.json?tags=${encodeURIComponent(tagString)}&limit=${limit}`;
    
    try {
      const response = await this.makeRequest(endpoint);
      return response.posts || [];
    } catch (error) {
      console.error('❌ Error searching posts:', error.message);
      throw error;
    }
  }

  /**
   * Get popular posts
   */
  async getPopularPosts(period = 'day', limit = 20) {
    const endpoint = `/posts.json?tags=order:score_desc date:>1${period}_ago&limit=${limit}`;
    
    try {
      const response = await this.makeRequest(endpoint);
      return response.posts || [];
    } catch (error) {
      console.error('❌ Error getting popular posts:', error.message);
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`🗑️ Cleared ${size} cached items`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      items: Array.from(this.cache.keys())
    };
  }

  /**
   * Format post data for display - ENHANCED with file URLs
   */
  formatPostData(post) {
    if (!post) return null;

    return {
      id: post.id,
      tags: this.organizeTags(post.tags || {}),
      metadata: {
        id: post.id,
        score: post.score?.total || 0,
        upvotes: post.score?.up || 0,
        downvotes: post.score?.down || 0,
        favorites: post.fav_count || 0,
        rating: this.formatRating(post.rating),
        fileType: post.file?.ext || 'unknown',
        fileSize: post.file?.size || 0,
        dimensions: {
          width: post.file?.width || 0,
          height: post.file?.height || 0
        },
        uploadedAt: post.created_at,
        updatedAt: post.updated_at,
        sources: post.sources || [],
        description: post.description || '',
        commentCount: post.comment_count || 0
      },
      // ENHANCED: Include file URLs for downloading
      fileUrls: {
        original: post.file?.url || null,
        sample: post.sample?.url || null,
        preview: post.preview?.url || null,
        // Alternative sources if main URL fails
        alternatives: post.sample?.alternates || {}
      }
    };
  }

  /**
   * Organize tags by category
   */
  organizeTags(tags) {
    const organized = {
      general: tags.general || [],
      species: tags.species || [],
      character: tags.character || [],
      artist: tags.artist || [],
      copyright: tags.copyright || [],
      meta: tags.meta || [],
      lore: tags.lore || []
    };

    // Calculate totals
    organized.totals = {
      general: organized.general.length,
      species: organized.species.length,
      character: organized.character.length,
      artist: organized.artist.length,
      copyright: organized.copyright.length,
      meta: organized.meta.length,
      lore: organized.lore.length,
      total: Object.values(organized).reduce((sum, arr) => Array.isArray(arr) ? sum + arr.length : sum, 0)
    };

    return organized;
  }

  /**
   * Format rating for display
   */
  formatRating(rating) {
    const ratings = {
      's': 'Safe',
      'q': 'Questionable', 
      'e': 'Explicit'
    };
    return ratings[rating] || 'Unknown';
  }

  /**
   * Get the best available download URL for a post
   */
  getBestDownloadUrl(post) {
    if (!post) return null;

    // Try original first (best quality)
    if (post.file && post.file.url) {
      return {
        url: post.file.url,
        type: 'original',
        size: post.file.size || 0
      };
    }

    // Fall back to sample if original not available
    if (post.sample && post.sample.url) {
      return {
        url: post.sample.url,
        type: 'sample',
        size: 0 // Sample size not usually provided
      };
    }

    // Last resort: preview (very low quality)
    if (post.preview && post.preview.url) {
      return {
        url: post.preview.url,
        type: 'preview',
        size: 0
      };
    }

    return null;
  }

  /**
   * Validate if a post has downloadable content
   */
  isDownloadable(post) {
    return this.getBestDownloadUrl(post) !== null;
  }

  /**
   * Get download filename for a post
   */
  getDownloadFilename(post, urlInfo = null) {
    if (!post) return null;

    const postId = post.id;
    const fileExt = post.file?.ext || 'jpg';
    
    // If we have URL info, we can be more specific
    if (urlInfo) {
      const qualityPrefix = urlInfo.type === 'original' ? '' : `${urlInfo.type}_`;
      return `${qualityPrefix}${postId}.${fileExt}`;
    }

    return `${postId}.${fileExt}`;
  }

 /**
 * Get artist suggestions - Fixed to use proper tag search
 */
async getArtistSuggestions(query, limit = 10) {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    console.log(`🎨 Fetching artist suggestions for: ${query}`);
    
    // Method 1: Try the tags endpoint first
    try {
      const endpoint = `/tags.json?search[name_matches]=${encodeURIComponent(query + '*')}&search[category]=1&limit=${limit}`;
      console.log(`🔗 Tags API endpoint: ${this.baseUrl}${endpoint}`);
      
      const response = await this.makeRequest(endpoint);
      
      if (response && Array.isArray(response)) {
        const suggestions = response
          .filter(tag => tag.category === 1) // Category 1 = artist
          .map(tag => tag.name)
          .sort();
          
        if (suggestions.length > 0) {
          console.log(`✅ Found ${suggestions.length} artist suggestions via tags API`);
          return suggestions;
        }
      }
    } catch (error) {
      console.warn('⚠️ Tags API failed, trying fallback method:', error.message);
    }
    
    // Method 2: Fallback - use a known list of popular artists and filter
    const popularArtists = [
      'narse', 'dragonfu', 'wolfy-nail', 'zackary911', 'dimwitdog',
      'r-mk', 'tokifuji', 'whisperingfornothing', 'jay-r', 'rajii',
      'darkgem', 'miles-df', 'dagasi', 'jishinu', 'tokifuji',
      'avante92', 'orf', 'kayla-na', 'furry_artist', 'conditional_dnp',
      'chelodoy', 'meesh', 'spottyjaguar', 'kemonokun', 'zephyxus'
    ];
    
    const filteredArtists = popularArtists
      .filter(artist => artist.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit);
    
    console.log(`✅ Found ${filteredArtists.length} artist suggestions via fallback`);
    return filteredArtists;
    
  } catch (error) {
    console.error('❌ Error fetching artist suggestions:', error);
    return [];
  }
}

/**
 * The links on an e621 artist's page (their other accounts), as
 * [{ url, active }]. Empty when e621 has no artist entry by that name.
 */
async getArtistUrls(artistName) {
  const name = String(artistName || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!name) return [];
  const artists = await this.makeRequest(`/artists.json?search[name]=${encodeURIComponent(name)}&limit=5`);
  const list = Array.isArray(artists) ? artists : [];
  const artist = list.find(a => a.name === name) || list[0];
  if (!artist) return [];
  const urls = await this.makeRequest(`/artist_urls.json?search[artist_id]=${artist.id}&limit=100`);
  return (Array.isArray(urls) ? urls : []).map(u => ({ url: u.url, active: u.is_active !== false }));
}

/**
 * Validate artist exists by checking if they have posts
 */
async validateArtist(artistName) {
  try {
    console.log(`✔️ Validating artist: ${artistName}`);
    
    const endpoint = `/posts.json?tags=${encodeURIComponent(artistName)}&limit=1`;
    const response = await this.makeRequest(endpoint);
    
    const exists = response && response.posts && response.posts.length > 0;
    console.log(`${exists ? '✅' : '❌'} Artist ${artistName} ${exists ? 'exists' : 'not found'}`);
    
    return exists;
    
  } catch (error) {
    console.error(`❌ Error validating artist ${artistName}:`, error);
    return false;
  }
}

/**
 * Search posts by artist with corrected syntax
 */
async searchPostsByArtist(artistName, options = {}) {
  const {
    limit = 50,
    page = 1,
    rating = null, // 's', 'q', 'e', or null for all
    minScore = null,
    sortBy = 'id',
    site = 'e621',
    additionalTags = []
  } = options;

  try {
    console.log(`🔍 Searching posts by artist: ${artistName}`);
    
    // Build search tags - NOTE: Just use artist name directly, not "artist:name"
    const searchTags = [artistName];
    
    // Add rating filter if specified
    if (rating) {
      searchTags.push(`rating:${rating}`);
    }
    
    // Add minimum score filter if specified
    if (minScore !== null) {
      searchTags.push(`score:>=${minScore}`);
    }

    const order = E621Service.orderTag(sortBy);
    if (order) searchTags.push(order);
    
    // Add any additional tags
    if (additionalTags.length > 0) {
      searchTags.push(...additionalTags);
    }
    
    // Calculate page offset (E621 uses page-based pagination)
    const pageParam = page > 1 ? `&page=${page}` : '';
    
    const endpoint = `/posts.json?tags=${encodeURIComponent(searchTags.join(' '))}&limit=${limit}${pageParam}`;
    
    console.log(`🔗 API endpoint: ${this.baseUrl}${endpoint}`);
    
    const response = await this.makeRequest(endpoint, E621Service.siteUrl(site));
    
    if (response && response.posts) {
      console.log(`✅ Found ${response.posts.length} posts by ${artistName}`);
      
      return {
        posts: response.posts,
        totalCount: response.posts.length,
        currentPage: page,
        hasMore: response.posts.length === limit // Assume more if we got a full page
      };
    }
    
    return {
      posts: [],
      totalCount: 0,
      currentPage: page,
      hasMore: false
    };
    
  } catch (error) {
    console.error(`❌ Error searching posts by artist ${artistName}:`, error);
    throw error;
  }
}

/**
 * Search posts by character name
 */
async searchPostsByCharacter(characterName, options = {}) {
  const {
    limit = 50,
    page = 1,
    rating = null,
    minScore = null,
    sortBy = 'id',
    site = 'e621',
    additionalTags = []
  } = options;

  try {
    console.log(`🐉 Searching posts featuring character: ${characterName}`);
    
    // For character search, we use the character name directly as a tag
    // E621 character tags are just regular tags
    const searchTags = [characterName];
    
    // Add rating filter if specified
    if (rating) {
      searchTags.push(`rating:${rating}`);
    }
    
    // Add minimum score filter if specified
    if (minScore !== null) {
      searchTags.push(`score:>=${minScore}`);
    }

    const order = E621Service.orderTag(sortBy);
    if (order) searchTags.push(order);
    
    // Add any additional tags
    if (additionalTags.length > 0) {
      searchTags.push(...additionalTags);
    }
    
    // Calculate page offset
    const pageParam = page > 1 ? `&page=${page}` : '';
    
    const endpoint = `/posts.json?tags=${encodeURIComponent(searchTags.join(' '))}&limit=${limit}${pageParam}`;
    
    console.log(`🔗 Character search endpoint: ${this.baseUrl}${endpoint}`);
    
    const response = await this.makeRequest(endpoint, E621Service.siteUrl(site));
    
    if (response && response.posts) {
      console.log(`✅ Found ${response.posts.length} posts featuring ${characterName}`);
      
      return {
        posts: response.posts,
        totalCount: response.posts.length,
        currentPage: page,
        hasMore: response.posts.length === limit
      };
    }
    
    return {
      posts: [],
      totalCount: 0,
      currentPage: page,
      hasMore: false
    };
    
  } catch (error) {
    console.error(`❌ Error searching posts by character ${characterName}:`, error);
    throw error;
  }
}

/**
 * Get tag suggestions with category filtering
 */
async getTagSuggestions(query, options = {}) {
  const {
    limit = 10,
    category = null // null for all, 'character' for character tags, 'artist' for artist tags
  } = options;

  if (!query || query.length < 2) {
    return [];
  }

  try {
    console.log(`🏷️ Fetching tag suggestions for: ${query} (category: ${category || 'all'})`);
    
    // Build the endpoint based on category
    let categoryFilter = '';
    if (category === 'character') {
      categoryFilter = '&search[category]=4'; // Category 4 = character
    } else if (category === 'artist') {
      categoryFilter = '&search[category]=1'; // Category 1 = artist
    }
    
    const endpoint = `/tags.json?search[name_matches]=${encodeURIComponent(query + '*')}${categoryFilter}&limit=${limit}`;
    console.log(`🔗 Tag suggestions endpoint: ${this.baseUrl}${endpoint}`);
    
    const response = await this.makeRequest(endpoint);
    
    if (response && Array.isArray(response)) {
      const suggestions = response
        .map(tag => ({
          name: tag.name,
          category: tag.category,
          post_count: tag.post_count
        }))
        .sort((a, b) => b.post_count - a.post_count); // Sort by popularity
        
      console.log(`✅ Found ${suggestions.length} tag suggestions`);
      return suggestions;
    }
    
    return [];
    
  } catch (error) {
    console.error('❌ Error fetching tag suggestions:', error);
    
    // Fallback for character suggestions
    if (category === 'character') {
      const popularCharacters = [
        'lucario', 'fox_mccloud', 'sonic_the_hedgehog', 'nick_wilde', 'judy_hopps',
        'wolf_o\'donnell', 'falco_lombardi', 'krystal', 'toriel', 'asriel_dreemurr',
        'sans', 'undyne', 'alphys', 'renamon', 'digimon', 'pokemon',
        'knuckles_the_echidna', 'tails', 'shadow_the_hedgehog', 'rouge_the_bat'
      ];
      
      const filtered = popularCharacters
        .filter(char => char.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit)
        .map(name => ({ name, category: 4, post_count: 0 }));
        
      return filtered;
    }
    
    return [];
  }
}

/**
 * Get popular artists (approximate using post counts)
 */
async getPopularArtists(limit = 20) {
  try {
    console.log('🔥 Fetching popular artists...');
    
    // Get popular posts and extract unique artists
    const popularPosts = await this.getPopularPosts('week', 100);
    
    if (!popularPosts || popularPosts.length === 0) {
      return [];
    }
    
    // Count posts per artist
    const artistCounts = {};
    
    popularPosts.forEach(post => {
      if (post.tags && post.tags.artist) {
        post.tags.artist.forEach(artist => {
          artistCounts[artist] = (artistCounts[artist] || 0) + 1;
        });
      }
    });
    
    // Sort by post count and return top artists
    const sortedArtists = Object.entries(artistCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([artist, count]) => ({
        name: artist,
        postCount: count
      }));
    
    console.log(`✅ Found ${sortedArtists.length} popular artists`);
    return sortedArtists;
    
  } catch (error) {
    console.error('❌ Error fetching popular artists:', error);
    return [];
  }
}

/**
 * Get artist information and statistics
 */
async getArtistInfo(artistName) {
  try {
    console.log(`ℹ️ Fetching info for artist: ${artistName}`);
    
    // Search for recent posts to get statistics
    const recentPosts = await this.searchPostsByArtist(artistName, { limit: 100 });
    
    if (!recentPosts.posts || recentPosts.posts.length === 0) {
      return {
        name: artistName,
        exists: false,
        postCount: 0,
        avgScore: 0,
        totalFavorites: 0,
        ratings: { safe: 0, questionable: 0, explicit: 0 },
        recentActivity: null
      };
    }
    
    const posts = recentPosts.posts;
    
    // Calculate statistics
    const totalScore = posts.reduce((sum, post) => sum + (post.score?.total || 0), 0);
    const totalFavorites = posts.reduce((sum, post) => sum + (post.fav_count || 0), 0);
    
    const ratings = {
      safe: posts.filter(p => p.rating === 's').length,
      questionable: posts.filter(p => p.rating === 'q').length,
      explicit: posts.filter(p => p.rating === 'e').length
    };
    
    // Find most recent post
    const mostRecent = posts.reduce((latest, post) => {
      const postDate = new Date(post.created_at);
      const latestDate = new Date(latest.created_at);
      return postDate > latestDate ? post : latest;
    });
    
    return {
      name: artistName,
      exists: true,
      postCount: posts.length,
      avgScore: posts.length > 0 ? Math.round(totalScore / posts.length) : 0,
      totalFavorites,
      ratings,
      recentActivity: mostRecent.created_at,
      samplePosts: posts.slice(0, 5) // First 5 posts as samples
    };
    
  } catch (error) {
    console.error(`❌ Error fetching artist info for ${artistName}:`, error);
    throw error;
  }
}

  /**
   * Generate tags for LORA training (species + general)
   */
  generateTrainingTags(post) {
    if (!post || !post.tags) {
      return [];
    }

    const combinedTags = [];
    
    // Add character tags first (most specific)
    if (post.tags.character && Array.isArray(post.tags.character)) {
      combinedTags.push(...post.tags.character);
    }

    // Add copyright tags
    if (post.tags.copyright && Array.isArray(post.tags.copyright)) {
      combinedTags.push(...post.tags.copyright);
    }

    // Add species tags
    if (post.tags.species && Array.isArray(post.tags.species)) {
      combinedTags.push(...post.tags.species);
    }

    // Add general tags
    if (post.tags.general && Array.isArray(post.tags.general)) {
      combinedTags.push(...post.tags.general);
    }

    // Remove duplicates, filter out problematic tags, and sort
    const filteredTags = [...new Set(combinedTags)]
      .filter(tag => {
        // Filter out tags that might cause issues with training
        const problematicPatterns = [
          /^rating:/,
          /^score:/,
          /^favcount:/,
          /^id:/,
          /^user:/,
          /^deleted/,
          /^conditional_dnp/,
          /^avoid_posting/
        ];
        
        return !problematicPatterns.some(pattern => pattern.test(tag));
      })
      .sort();

    return filteredTags;
  }

  /**
   * Create training tags file content
   */
  createTrainingTagsFile(post) {
    const tags = this.generateTrainingTags(post);
    
    if (tags.length === 0) {
      return '';
    }

    // Return as comma-separated values (CSV format)
    return tags.join(', ');
  }

  /**
   * Get post statistics for debugging
   */
  getPostStats(post) {
    if (!post) return null;

    return {
      id: post.id,
      hasOriginalFile: !!(post.file && post.file.url),
      hasSampleFile: !!(post.sample && post.sample.url),
      hasPreviewFile: !!(post.preview && post.preview.url),
      isDownloadable: this.isDownloadable(post),
      tagCounts: {
        general: post.tags?.general?.length || 0,
        species: post.tags?.species?.length || 0,
        character: post.tags?.character?.length || 0,
        artist: post.tags?.artist?.length || 0,
        copyright: post.tags?.copyright?.length || 0,
        meta: post.tags?.meta?.length || 0,
        lore: post.tags?.lore?.length || 0
      },
      trainingTagsCount: this.generateTrainingTags(post).length
    };
  }

  /**
   * Search for tags with autocomplete suggestions
   */
  async searchTags(query, limit = 10) {
    console.log(`🔍 Searching tags for: "${query}"`);

    // Validate input
    if (!query || query.trim().length < 2) {
      return {
        success: false,
        message: 'Query must be at least 2 characters',
        tags: []
      };
    }

    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = `tags_${normalizedQuery}_${limit}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      console.log(`📦 Using cached tag results for "${query}"`);
      return {
        success: true,
        query: normalizedQuery,
        tags: cached.data,
        cached: true
      };
    }

    try {
      // Use E621's tag search endpoint
      // Format: /tags.json?search[name_matches]=*query*&limit=limit
      const searchPattern = `*${normalizedQuery}*`;
      const endpoint = `/tags.json?search[name_matches]=${encodeURIComponent(searchPattern)}&limit=${limit}&search[order]=count`;
      
      console.log(`📡 Making tag search request: ${endpoint}`);
      const response = await this.makeRequest(endpoint);
      
      if (!response || !Array.isArray(response)) {
        throw new Error('Invalid response format');
      }

      // Format tag results
      const tags = response.map(tag => ({
        name: tag.name,
        category: tag.category,
        post_count: tag.post_count
      }));

      // Cache the result
      this.cache.set(cacheKey, {
        data: tags,
        timestamp: Date.now()
      });

      console.log(`✅ Found ${tags.length} tags for "${query}"`);
      
      return {
        success: true,
        query: normalizedQuery,
        tags: tags,
        cached: false
      };

    } catch (error) {
      console.error(`❌ Error searching tags for "${query}":`, error.message);
      
      return {
        success: false,
        message: error.userMessage || `Failed to search tags: ${error.message}`,
        query: normalizedQuery,
        tags: [],
        error: {
          type: error.type || 'search-error',
          details: error.message
        }
      };
    }
  }

  // Aliases for IPC compatibility
  async searchByArtist(artistName, options) {
    return this.searchPostsByArtist(artistName, options);
  }

  async searchByCharacter(characterName, options) {
    return this.searchPostsByCharacter(characterName, options);
  }
}

module.exports = E621Service;