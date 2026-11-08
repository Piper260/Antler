// src/main/ipc/E621IPC.js - Enhanced E621 IPC handlers with file URL support
const { ipcMain } = require('electron');

class E621IPC {
  constructor(e621Service) {
    this.e621Service = e621Service;
    this.setupHandlers();
    console.log('🔗 E621 IPC handlers registered');
  }

  setupHandlers() {
    // Fetch post by ID
    ipcMain.handle('e621:fetch-post', async (event, postId) => {
      const startTime = Date.now();
      
      try {
        console.log(`🔍 IPC: Fetch post request for ID: ${postId}`);

        const post = await this.e621Service.fetchPostById(postId);
        const formattedPost = this.e621Service.formatPostData(post);
        
        // Add download statistics
        const downloadInfo = {
          isDownloadable: this.e621Service.isDownloadable(post),
          bestUrl: this.e621Service.getBestDownloadUrl(post),
          filename: this.e621Service.getDownloadFilename(post),
          trainingTagsCount: this.e621Service.generateTrainingTags(post).length
        };
        
        const duration = Date.now() - startTime;
        console.log(`✅ Post ${postId} fetched successfully in ${duration}ms`);
        
        return {
          success: true,
          message: `Post ${postId} fetched successfully`,
          postId: String(postId),
          post: formattedPost,
          downloadInfo,
          timestamp: new Date().toISOString(),
          duration
        };

      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ Fetch post error for ID ${postId} (${duration}ms):`, error);

        return {
          success: false,
          message: error.userMessage || error.message,
          type: error.type || 'unknown-error',
          postId: String(postId),
          details: {
            originalError: error.message,
            status: error.status,
            timestamp: new Date().toISOString(),
            duration
          }
        };
      }
    });

    // Search posts
    ipcMain.handle('e621:search-posts', async (event, tags, limit = 20) => {
      try {
        console.log(`🔍 IPC: Search posts request - tags: ${tags}, limit: ${limit}`);

        const posts = await this.e621Service.searchPosts(tags, limit);
        const formattedPosts = posts.map(post => {
          const formatted = this.e621Service.formatPostData(post);
          // Add download info for each post
          formatted.downloadInfo = {
            isDownloadable: this.e621Service.isDownloadable(post),
            bestUrl: this.e621Service.getBestDownloadUrl(post),
            filename: this.e621Service.getDownloadFilename(post)
          };
          return formatted;
        });
        
        console.log(`✅ Search completed: ${posts.length} posts found`);
        
        return {
          success: true,
          message: `Found ${posts.length} posts`,
          posts: formattedPosts,
          query: { tags, limit },
          timestamp: new Date().toISOString()
        };

      } catch (error) {
        console.error('❌ Search posts error:', error);

        return {
          success: false,
          message: error.userMessage || error.message,
          type: error.type || 'unknown-error',
          query: { tags, limit },
          details: {
            originalError: error.message,
            status: error.status,
            timestamp: new Date().toISOString()
          }
        };
      }
    });

    // Get popular posts
    ipcMain.handle('e621:popular-posts', async (event, period = 'day', limit = 20) => {
      try {
        console.log(`🔥 IPC: Popular posts request - period: ${period}, limit: ${limit}`);

        const posts = await this.e621Service.getPopularPosts(period, limit);
        const formattedPosts = posts.map(post => {
          const formatted = this.e621Service.formatPostData(post);
          // Add download info for each post
          formatted.downloadInfo = {
            isDownloadable: this.e621Service.isDownloadable(post),
            bestUrl: this.e621Service.getBestDownloadUrl(post),
            filename: this.e621Service.getDownloadFilename(post)
          };
          return formatted;
        });
        
        console.log(`✅ Popular posts fetched: ${posts.length} posts`);
        
        return {
          success: true,
          message: `Found ${posts.length} popular posts`,
          posts: formattedPosts,
          period,
          limit,
          timestamp: new Date().toISOString()
        };

      } catch (error) {
        console.error('❌ Popular posts error:', error);

        return {
          success: false,
          message: error.userMessage || error.message,
          type: error.type || 'unknown-error',
          period,
          limit,
          details: {
            originalError: error.message,
            status: error.status,
            timestamp: new Date().toISOString()
          }
        };
      }
    });

    // Clear cache
    ipcMain.handle('e621:clear-cache', async () => {
      try {
        this.e621Service.clearCache();
        console.log('🗑️ E621 cache cleared via IPC');
        
        return {
          success: true,
          message: 'Cache cleared successfully',
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        console.error('❌ Error clearing E621 cache:', error);
        
        return {
          success: false,
          message: `Failed to clear cache: ${error.message}`,
          timestamp: new Date().toISOString()
        };
      }
    });

    // Get cache stats
    ipcMain.handle('e621:cache-stats', async () => {
      try {
        const stats = this.e621Service.getCacheStats();
        
        return {
          success: true,
          stats,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        console.error('❌ Error getting E621 cache stats:', error);
        
        return {
          success: false,
          message: `Failed to get cache stats: ${error.message}`,
          timestamp: new Date().toISOString()
        };
      }
    });

    // Check credentials status
    ipcMain.handle('e621:credentials-status', async () => {
      try {
        const credentials = this.e621Service.getCredentials();
        
        return {
          success: true,
          isConfigured: credentials.isConfigured,
          username: credentials.username,
          hasCredentials: !!(credentials.username && credentials.apiKey),
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        console.error('❌ Error checking E621 credentials status:', error);
        
        return {
          success: false,
          message: `Failed to check credentials: ${error.message}`,
          timestamp: new Date().toISOString()
        };
      }
    });

    // Artist suggestions handler
ipcMain.handle('e621:artist-suggestions', async (event, query, limit = 10) => {
  try {
    console.log(`🎨 IPC: Artist suggestions request - query: ${query}`);
    
    const suggestions = await this.e621Service.getArtistSuggestions(query, limit);
    
    return {
      success: true,
      suggestions,
      query,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Artist suggestions error:', error);
    
    return {
      success: false,
      message: error.userMessage || error.message,
      type: error.type || 'unknown-error',
      query,
      timestamp: new Date().toISOString()
    };
  }
});

// Search posts by artist handler
ipcMain.handle('e621:search-by-artist', async (event, artistName, options = {}) => {
  const startTime = Date.now();
  
  try {
    console.log(`🎨 IPC: Search by artist request - artist: ${artistName}`);
    
    const result = await this.e621Service.searchPostsByArtist(artistName, options);
    
    // Format posts with download info
    const formattedPosts = result.posts.map(post => {
      const formatted = this.e621Service.formatPostData(post);
      formatted.downloadInfo = {
        isDownloadable: this.e621Service.isDownloadable(post),
        bestUrl: this.e621Service.getBestDownloadUrl(post),
        filename: this.e621Service.getDownloadFilename(post)
      };
      return formatted;
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ Artist search completed: ${result.posts.length} posts found in ${duration}ms`);
    
    return {
      success: true,
      message: `Found ${result.posts.length} posts by ${artistName}`,
      artist: artistName,
      posts: formattedPosts,
      pagination: {
        currentPage: result.currentPage,
        hasMore: result.hasMore,
        totalCount: result.totalCount
      },
      options,
      timestamp: new Date().toISOString(),
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Artist search error for ${artistName} (${duration}ms):`, error);
    
    return {
      success: false,
      message: error.userMessage || error.message,
      type: error.type || 'unknown-error',
      artist: artistName,
      details: {
        originalError: error.message,
        status: error.status,
        timestamp: new Date().toISOString(),
        duration
      }
    };
  }
});

// Popular artists handler
ipcMain.handle('e621:popular-artists', async (event, limit = 20) => {
  try {
    console.log(`🔥 IPC: Popular artists request - limit: ${limit}`);
    
    const artists = await this.e621Service.getPopularArtists(limit);
    
    return {
      success: true,
      artists,
      limit,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Popular artists error:', error);
    
    return {
      success: false,
      message: error.userMessage || error.message,
      type: error.type || 'unknown-error',
      limit,
      timestamp: new Date().toISOString()
    };
  }
});

// Search posts by character handler
ipcMain.handle('e621:search-by-character', async (event, characterName, options = {}) => {
  const startTime = Date.now();
  
  try {
    console.log(`🐉 IPC: Search by character request - character: ${characterName}`);
    
    const result = await this.e621Service.searchPostsByCharacter(characterName, options);
    
    // Format posts with download info
    const formattedPosts = result.posts.map(post => {
      const formatted = this.e621Service.formatPostData(post);
      formatted.downloadInfo = {
        isDownloadable: this.e621Service.isDownloadable(post),
        bestUrl: this.e621Service.getBestDownloadUrl(post),
        filename: this.e621Service.getDownloadFilename(post)
      };
      return formatted;
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ Character search completed: ${result.posts.length} posts found in ${duration}ms`);
    
    return {
      success: true,
      message: `Found ${result.posts.length} posts featuring ${characterName}`,
      character: characterName,
      posts: formattedPosts,
      pagination: {
        currentPage: result.currentPage,
        hasMore: result.hasMore,
        totalCount: result.totalCount
      },
      options,
      timestamp: new Date().toISOString(),
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Character search error for ${characterName} (${duration}ms):`, error);
    
    return {
      success: false,
      message: error.userMessage || error.message,
      type: error.type || 'unknown-error',
      character: characterName,
      details: {
        originalError: error.message,
        status: error.status,
        timestamp: new Date().toISOString(),
        duration
      }
    };
  }
});

// Tag suggestions handler
ipcMain.handle('e621:tag-suggestions', async (event, query, options = {}) => {
  try {
    console.log(`🏷️ IPC: Tag suggestions request - query: ${query}, options:`, options);
    
    const suggestions = await this.e621Service.getTagSuggestions(query, options);
    
    return {
      success: true,
      suggestions,
      query,
      options,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Tag suggestions error:', error);
    
    return {
      success: false,
      message: error.userMessage || error.message,
      type: error.type || 'unknown-error',
      query,
      options,
      timestamp: new Date().toISOString()
    };
  }
});

    // NEW: Get post download info
    ipcMain.handle('e621:get-download-info', async (event, postId) => {
      try {
        console.log(`📥 IPC: Get download info for post ${postId}`);
        
        const post = await this.e621Service.fetchPostById(postId);
        const downloadUrl = this.e621Service.getBestDownloadUrl(post);
        const filename = this.e621Service.getDownloadFilename(post, downloadUrl);
        const trainingTags = this.e621Service.generateTrainingTags(post);
        const stats = this.e621Service.getPostStats(post);
        
        return {
          success: true,
          downloadInfo: {
            isDownloadable: this.e621Service.isDownloadable(post),
            bestUrl: downloadUrl,
            filename: filename,
            trainingTags: trainingTags,
            trainingTagsCount: trainingTags.length,
            stats: stats
          },
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ Error getting download info for post ${postId}:`, error);
        
        return {
          success: false,
          message: error.userMessage || error.message,
          type: error.type || 'unknown-error',
          postId: String(postId),
          timestamp: new Date().toISOString()
        };
      }
    });

    // NEW: Generate training tags file content
    ipcMain.handle('e621:generate-training-tags', async (event, postId) => {
      try {
        console.log(`🏷️ IPC: Generate training tags for post ${postId}`);
        
        const post = await this.e621Service.fetchPostById(postId);
        const tagsContent = this.e621Service.createTrainingTagsFile(post);
        const tags = this.e621Service.generateTrainingTags(post);
        
        return {
          success: true,
          content: tagsContent,
          tags: tags,
          tagCount: tags.length,
          filename: `${postId}.txt`,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ Error generating training tags for post ${postId}:`, error);
        
        return {
          success: false,
          message: error.userMessage || error.message,
          type: error.type || 'unknown-error',
          postId: String(postId),
          timestamp: new Date().toISOString()
        };
      }
    });

    // Search tags for autocomplete
    ipcMain.handle('e621:search-tags', async (event, query, limit = 10) => {
      const startTime = Date.now();
      
      try {
        console.log(`🔍 IPC: Tag search request for query: "${query}"`);

        const result = await this.e621Service.searchTags(query, limit);
        
        const duration = Date.now() - startTime;
        console.log(`✅ Tag search completed in ${duration}ms: ${result.tags?.length || 0} results`);
        
        return {
          ...result,
          timestamp: new Date().toISOString(),
          duration
        };

      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ Tag search error for query "${query}" (${duration}ms):`, error);

        return {
          success: false,
          message: error.userMessage || error.message,
          type: error.type || 'search-error',
          query: String(query),
          tags: [],
          timestamp: new Date().toISOString(),
          duration
        };
      }
    });
  }
}

module.exports = E621IPC;