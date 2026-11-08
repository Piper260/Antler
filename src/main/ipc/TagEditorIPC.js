// src/main/ipc/TagEditorIPC.js - IPC handlers for Tag Editor Tool
const { ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { calculateSimilarity, normalizePath, sanitizeFilePath } = require('../utils/stringUtils');
const { imageSizeFromFile } = require('image-size/fromFile');
const { IMAGE_EXTENSIONS: GUARD_IMAGE_EXTENSIONS, TEXT_EXTENSIONS, requireFile } = require('../utils/pathGuard');
const { writeFileSafe } = require('../utils/safeWrite');
const { parseDatasetFolderName } = require('../utils/datasetFolders');
const { datasetType } = require('../utils/datasetLibraries');
const { findTagger } = require('../utils/taggers');
const ComicVisionService = require('../services/ComicVisionService');
const { ThumbnailCache } = require('../services/thumbnailCache');

// How many files are read at once while loading a dataset.
const LOAD_CONCURRENCY = 16;

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Directories to never descend into during a dataset scan: 'bak' is where
// ImageUpscalerIPC moves pre-upscale originals (see src/main/ipc/ImageUpscalerIPC.js),
// so without this a scan would surface each upscaled image's original as a
// second, duplicate-postId entry.
const IGNORED_DIR_NAMES = new Set(['bak', '.git', 'node_modules']);

class TagEditorIPC {
  constructor(settingsService = null) {
    this.settingsService = settingsService;
    this.defaultDownloadsPath = path.join(process.cwd(), 'downloads');
    this.setupHandlers();
    console.log('🏷️ Tag Editor IPC handlers initialized');
  }

  setupHandlers() {
    // Get list of downloaded artists
    ipcMain.handle('tag-editor:get-downloaded-artists', async () => {
      try {
        return await this.getDownloadedArtists();
      } catch (error) {
        console.error('Failed to get downloaded artists:', error);
        return {
          success: false,
          message: 'Failed to scan downloads folder',
          error: error.message
        };
      }
    });

    // Get tag data for a specific artist
    ipcMain.handle('tag-editor:get-artist-tag-data', async (event, artistTarget) => {
      try {
        return await this.getArtistTagData(artistTarget);
      } catch (error) {
        console.error('Failed to get tag data for artist:', error);
        return {
          success: false,
          message: 'Failed to load artist data',
          error: error.message
        };
      }
    });

    // Save tag data for a file
    ipcMain.handle('tag-editor:save-tag-data', async (event, artistTarget, postId, tags, tagPath) => {
      try {
        return await this.saveTagData(artistTarget, postId, tags, tagPath);
      } catch (error) {
        console.error('Failed to save tag data:', error);
        return {
          success: false,
          message: 'Failed to save tag data',
          error: error.message
        };
      }
    });

    // Batch save tag data
    ipcMain.handle('tag-editor:batch-save-tag-data', async (event, artistTarget, tagDataArray) => {
      try {
        return await this.batchSaveTagData(artistTarget, tagDataArray);
      } catch (error) {
        console.error('Failed to batch save tag data:', error);
        return {
          success: false,
          message: 'Failed to save tag data',
          error: error.message
        };
      }
    });

    // Export tag data
    ipcMain.handle('tag-editor:export-tag-data', async (event, artistTarget, format) => {
      try {
        return await this.exportTagData(artistTarget, format);
      } catch (error) {
        console.error('Failed to export tag data:', error);
        return {
          success: false,
          message: 'Failed to export tag data',
          error: error.message
        };
      }
    });

    // Custom folder handlers
    ipcMain.handle('tag-editor:browse-custom-folder', async () => {
      try {
        return await this.browseCustomFolder();
      } catch (error) {
        console.error('Failed to browse custom folder:', error);
        return {
          success: false,
          message: 'Failed to browse folder',
          error: error.message
        };
      }
    });

    ipcMain.handle('tag-editor:scan-custom-folder', async (event, folderPath) => {
      try {
        return await this.scanCustomFolder(folderPath);
      } catch (error) {
        console.error(`Failed to scan custom folder ${folderPath}:`, error);
        return {
          success: false,
          message: 'Failed to scan folder',
          error: error.message
        };
      }
    });

    ipcMain.handle('tag-editor:load-custom-folder', async (event, customFolderData) => {
      try {
        return await this.loadCustomFolder(customFolderData);
      } catch (error) {
        console.error('Failed to load custom folder:', error);
        return {
          success: false,
          message: 'Failed to load custom folder',
          error: error.message
        };
      }
    });

    // Save tag data with custom file path
    ipcMain.handle('tag-editor:save-custom-tag-data', async (event, tagFilePath, tags) => {
      try {
        return await this.saveCustomTagData(tagFilePath, tags);
      } catch (error) {
        console.error(`Failed to save custom tag data to ${tagFilePath}:`, error);
        return {
          success: false,
          message: 'Failed to save tag data',
          error: error.message
        };
      }
    });

    // Delete file and associated tag file
    ipcMain.handle('tag-editor:delete-file', async (event, imagePath, tagPath) => {
      try {
        return await this.deleteFile(imagePath, tagPath);
      } catch (error) {
        console.error(`Failed to delete file ${imagePath}:`, error);
        return {
          success: false,
          message: 'Failed to delete file',
          error: error.message
        };
      }
    });

    // Analyze tag frequency
    ipcMain.handle('tag-editor:analyze-tags', async (event, artistTarget) => {
      try {
        return await this.analyzeTagFrequency(artistTarget);
      } catch (error) {
        console.error('Failed to analyze tags:', error);
        return {
          success: false,
          message: 'Failed to analyze tags',
          error: error.message
        };
      }
    });

    // A small cached JPEG for the grid, as a file:// URL; the renderer falls
    // back to the full image if this fails.
    ipcMain.handle('tag-editor:thumbnail', async (event, imagePath) => {
      try {
        const thumb = await this.thumbnailCache().get(this.imageFilePath(imagePath));
        return { success: true, url: pathToFileURL(thumb).href };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Hydra tag check: whether the model is installed, its scores for one
    // image's tags, and the heatmap for one tag. The model runs in the
    // comic worker, shared with Comic Panels.
    ipcMain.handle('tag-editor:hydra-available', () => ({ success: true, available: Boolean(findTagger({ kinds: ['hydra'] })) }));

    ipcMain.handle('tag-editor:hydra-tags', async (event, imagePath, tags, hidden, options) => {
      try {
        const tagger = findTagger({ kinds: ['hydra'] });
        if (!tagger) return { success: false, error: 'The Hydra tagger is not installed' };
        const inputPath = this.imageFilePath(imagePath);
        const strings = (value) => (Array.isArray(value) ? value.filter(tag => typeof tag === 'string') : []);
        return { success: true, ...await ComicVisionService.shared().run('hydra-tags', { inputPath, tags: strings(tags), hidden: strings(hidden), all: Boolean(options?.all), tagger }) };
      } catch (error) {
        console.error('Hydra tag check failed:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('tag-editor:hydra-heatmap', async (event, imagePath, tag) => {
      try {
        const tagger = findTagger({ kinds: ['hydra'] });
        if (!tagger) return { success: false, error: 'The Hydra tagger is not installed' };
        if (typeof tag !== 'string' || !tag.trim()) throw new Error('No tag given');
        const inputPath = this.imageFilePath(imagePath);
        return { success: true, ...await ComicVisionService.shared().run('hydra-heatmap', { inputPath, tag: tag.trim(), tagger }) };
      } catch (error) {
        console.error('Hydra heatmap failed:', error);
        return { success: false, error: error.message };
      }
    });
  }

  /** The grid's thumbnail cache, in the user data folder. */
  thumbnailCache() {
    if (!this.thumbnails) {
      const { app } = require('electron');
      this.thumbnails = new ThumbnailCache(path.join(app.getPath('userData'), 'thumbnails'));
    }
    return this.thumbnails;
  }

  /** A dataset image's path on disk, from the file:// URL the renderer shows it by. */
  imageFilePath(imagePath) {
    if (typeof imagePath !== 'string') throw new Error('Invalid image path');
    const filePath = imagePath.startsWith('file:') ? fileURLToPath(imagePath) : imagePath;
    return requireFile(filePath, GUARD_IMAGE_EXTENSIONS, 'image');
  }

  /**
   * Get list of downloaded artists with file counts
   */
  async getDownloadedArtists() {
    const artists = [];
    const scannedFolders = new Set();

    try {
      // Every library the user keeps datasets in (Settings > Storage).
      for (const library of this.getLibraries()) {
        await this.collectEntriesFromLibrary({ list: artists, library, scannedFolders });
      }

      // Loose folders in the old built-in downloads folder.
      const legacyRoot = path.join(process.cwd(), 'downloads');
      await this.collectLegacyEntries({
        list: artists,
        baseDownloads: legacyRoot,
        scannedFolders,
        storageConfig: { baseDownloads: legacyRoot }
      });

      artists.sort((a, b) => b.lastModified - a.lastModified);
      console.log(`📂 Loaded ${artists.length} artist/character folders`);

      return {
        success: true,
        artists
      };
    } catch (error) {
      throw new Error(`Failed to scan storage paths: ${error.message}`);
    }
  }

  /**
   * Get tag data for a specific artist/character
   */
  async getArtistTagData(artistTarget) {
    const resolvedTarget = await this.resolveArtistTarget(artistTarget);
    const artistPath = resolvedTarget.folderPath;

    try {
      await fs.access(artistPath);
    } catch (error) {
      throw new Error(`Artist/character folder not found: ${artistPath}`);
    }

    try {
      // Recursive so artists whose dataset is split into subfolders (e.g.
      // flat_sketch/, shaded/) load correctly instead of appearing empty.
      const imagePaths = await this._findImagesRecursive(artistPath);

      const loadFile = async (filePath) => {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const postId = path.basename(filePath, ext);
        const tagFilePath = path.join(dir, `${postId}.txt`);

        let tags = [];
        let tagFileExists = false;

        try {
          const tagContent = await fs.readFile(tagFilePath, 'utf-8');
          tags = tagContent
            .trim()
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
          tagFileExists = true;
        } catch (error) {
          // Missing tag file is acceptable
        }

        const stats = await fs.stat(filePath);

        // Dimensions come from the file header only; the image itself is
        // never loaded into memory just to measure it.
        let width = 0;
        let height = 0;
        try {
          const dimensions = await imageSizeFromFile(filePath);
          width = dimensions.width || 0;
          height = dimensions.height || 0;
        } catch (error) {
          console.warn(`Could not read dimensions for ${postId}:`, error.message);
        }

        return {
          postId,
          // pathToFileURL escapes characters such as # and % that would
          // otherwise cut the URL short for some folder names.
          imagePath: pathToFileURL(filePath).href,
          tagPath: tagFilePath,
          fileType: ext.substring(1),
          // Relative subfolder the image was found in ('' at the artist root),
          // e.g. "flat_sketch" - lets the UI show which category a file came from.
          subFolder: path.relative(artistPath, dir).replace(/\\/g, '/'),
          tags,
          tagFileExists,
          lastModified: stats.mtime,
          fileSize: stats.size,
          width,
          height,
          selected: false
        };
      };

      const files = new Array(imagePaths.length);
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < imagePaths.length) {
          const index = nextIndex++;
          files[index] = await loadFile(imagePaths[index]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, imagePaths.length) }, worker));

      files.sort((a, b) => {
        const aId = parseInt(a.postId, 10) || 0;
        const bId = parseInt(b.postId, 10) || 0;
        return aId - bId;
      });
      
      console.log(`Loaded ${files.length} files for artist: ${resolvedTarget.displayName}`);
      
      return {
        success: true,
        data: {
          artistId: resolvedTarget.id,
          artistName: resolvedTarget.displayName,
          artistType: resolvedTarget.type,
          folderName: resolvedTarget.folderName || resolvedTarget.id,
          artistPath,
          storageLabel: resolvedTarget.storageLabel || 'Downloads',
          isCustomStorage: !!resolvedTarget.isCustomStorage,
          files,
          totalFiles: files.length,
          filesWithTags: files.filter(f => f.tags.length > 0).length
        }
      };
      
    } catch (error) {
      throw new Error(`Failed to load artist data: ${error.message}`);
    }
  }

  /**
   * Save tag data for a single file
   */
  async saveTagData(artistTarget, postId, tags, tagPath = null) {
    const resolvedTarget = await this.resolveArtistTarget(artistTarget);
    const artistPath = resolvedTarget.folderPath;

    try {
      // Ensure artist folder exists
      await fs.access(artistPath);

      // The loader hands every file its exact .txt path, and the editor
      // sends it back. That is the only unambiguous identity when the same
      // post id exists in two subfolders. It is only trusted if it is a .txt
      // file inside this dataset; otherwise fall back to searching by id.
      const tagFilePath = this._isTagPathInside(artistPath, tagPath)
        ? path.normalize(tagPath)
        : await this._resolveTagFilePath(artistPath, postId);

      // Clean and format tags (duplicates compared case-insensitively)
      const seen = new Set();
      const cleanTags = [];
      for (const raw of Array.isArray(tags) ? tags : []) {
        const tag = String(raw).trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        cleanTags.push(tag);
      }

      const tagContent = cleanTags.join(', ');

            // Never half-written; the previous caption is kept in bak/.
      await writeFileSafe(tagFilePath, tagContent, { backup: true });
      
      console.log(`Saved ${cleanTags.length} tags for ${resolvedTarget.displayName}/${postId}`);
      
      return {
        success: true,
        message: `Saved ${cleanTags.length} tags`,
        tagCount: cleanTags.length,
        filePath: tagFilePath
      };
      
    } catch (error) {
      throw new Error(`Failed to save tag data: ${error.message}`);
    }
  }

  /**
   * Batch save tag data for multiple files
   */
  async batchSaveTagData(artistTarget, tagDataArray) {
    const resolvedTarget = await this.resolveArtistTarget(artistTarget);
    const artistPath = resolvedTarget.folderPath;
    
    try {
      await fs.access(artistPath);
    } catch (error) {
      throw new Error(`Artist folder not found: ${artistPath}`);
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (const { postId, tags, tagPath } of tagDataArray) {
      try {
        const result = await this.saveTagData(resolvedTarget, postId, tags, tagPath);
        results.push({ postId, success: true, ...result });
        successCount++;
      } catch (error) {
        results.push({ 
          postId, 
          success: false, 
          error: error.message 
        });
        errorCount++;
      }
    }
    
  console.log(`Batch save completed for ${resolvedTarget.displayName}: ${successCount} success, ${errorCount} errors`);
    
    return {
      success: errorCount === 0,
      message: `Saved ${successCount} files, ${errorCount} errors`,
      results: results,
      successCount: successCount,
      errorCount: errorCount
    };
  }

  /**
   * Export tag data in various formats
   */
  async exportTagData(artistTarget, format = 'csv') {
    const artistData = await this.getArtistTagData(artistTarget);
    
    if (!artistData.success) {
      throw new Error('Failed to load artist data for export');
    }
    const resolvedTarget = await this.resolveArtistTarget(artistTarget);
    const { files } = artistData.data;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = path.join(resolvedTarget.folderPath, `tags_export_${timestamp}.${format}`);
    
    let content = '';
    
    try {
      switch (format.toLowerCase()) {
        case 'csv':
          content = this.generateCSVExport(files);
          break;
        case 'json':
          content = this.generateJSONExport(files);
          break;
        case 'txt':
          content = this.generateTXTExport(files);
          break;
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
      
            await writeFileSafe(exportPath, content);
      
  console.log(`Exported tag data for ${resolvedTarget.displayName} to ${exportPath}`);
      
      return {
        success: true,
        message: `Exported to ${path.basename(exportPath)}`,
        filePath: exportPath,
        format: format,
        fileCount: files.length
      };
      
    } catch (error) {
      throw new Error(`Failed to export tag data: ${error.message}`);
    }
  }

  /**
   * Delete an image file and its associated tag file
   */
  async deleteFile(imagePath, tagPath) {
    try {
      // Convert file:// URL to path if needed
      const fsImagePath = imagePath.startsWith('file://') ? 
        (process.platform === 'win32' ? imagePath.replace('file:///', '').replace('file://', '') : imagePath.replace('file://', '')) 
        : imagePath;
        
      // Decode URI components in case of spaces/special chars
            // Only an image and its caption: never any other file the renderer names.
      const decodedImagePath = requireFile(decodeURIComponent(fsImagePath), GUARD_IMAGE_EXTENSIONS, 'image');
      if (tagPath) tagPath = requireFile(tagPath, TEXT_EXTENSIONS, 'tag file');
      
      // Check if image exists and delete it
      try {
        await fs.access(decodedImagePath);
        await fs.unlink(decodedImagePath);
        console.log(`Deleted image: ${decodedImagePath}`);
      } catch (error) {
        console.warn(`Image file not found or could not be deleted: ${decodedImagePath}`, error.message);
      }
      
      // Check if tag file exists and delete it
      if (tagPath) {
        try {
          await fs.access(tagPath);
          await fs.unlink(tagPath);
          console.log(`Deleted tag file: ${tagPath}`);
        } catch (error) {
          console.warn(`Tag file not found or could not be deleted: ${tagPath}`, error.message);
        }
      }
      
      return {
        success: true,
        message: 'File deleted successfully'
      };
      
    } catch (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Analyze tag frequency for an artist
   */
  async analyzeTagFrequency(artistTarget) {
    const artistData = await this.getArtistTagData(artistTarget);
    
    if (!artistData.success) {
      throw new Error('Failed to load artist data for analysis');
    }
    
    const { files } = artistData.data;
    const tagFrequency = new Map();
    const tagCooccurrence = new Map();
    
    // Count tag frequency
    files.forEach(file => {
      file.tags.forEach(tag => {
        tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
      });
      
      // Count tag co-occurrence
      for (let i = 0; i < file.tags.length; i++) {
        for (let j = i + 1; j < file.tags.length; j++) {
          const pair = [file.tags[i], file.tags[j]].sort().join('|');
          tagCooccurrence.set(pair, (tagCooccurrence.get(pair) || 0) + 1);
        }
      }
    });
    
    // Sort by frequency
    const sortedTags = Array.from(tagFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({
        tag,
        count,
        percentage: Math.round((count / files.length) * 100)
      }));
    
    // Find common and rare tags
    const commonTags = sortedTags.filter(t => t.percentage >= 50);
    const rareTags = sortedTags.filter(t => t.count === 1);
    
    // Find potential duplicates (similar tags)
    const duplicateTags = this.findSimilarTags(sortedTags.map(t => t.tag));
    
    return {
      success: true,
      analysis: {
        totalTags: tagFrequency.size,
        totalFiles: files.length,
        avgTagsPerFile: Math.round((sortedTags.reduce((sum, t) => sum + t.count, 0) / files.length) * 10) / 10,
        tagFrequency: sortedTags,
        commonTags: commonTags,
        rareTags: rareTags,
        duplicateTags: duplicateTags,
        topCooccurrence: Array.from(tagCooccurrence.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([pair, count]) => ({
            tags: pair.split('|'),
            count
          }))
      }
    };
  }

  /**
   * Helper methods
   */

  /**
   * Recursively finds every image file under `rootPath`, at any depth. Some
   * artists split their dataset into style/category subfolders (e.g.
   * twang/flat_sketch, twang/shaded) instead of keeping images flat - a plain
   * readdir() reports those as having zero files, so they silently vanish
   * from the Artist/Character list. Depth is unbounded but dataset folders
   * are shallow in practice; maxEntries is a sanity cap against runaway trees.
   * Returns absolute file paths.
   */
  async _findImagesRecursive(rootPath, { maxEntries = 50000 } = {}) {
    const results = [];
    const queue = [rootPath];

    while (queue.length && results.length < maxEntries) {
      const dir = queue.shift();
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable dir (permissions, race with external delete) - skip it
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) continue;
          queue.push(path.join(dir, entry.name));
        } else if (IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
          results.push(path.join(dir, entry.name));
        }
      }
    }

    return results;
  }

  async getArtistFiles(artistPath) {
    try {
      return await this._findImagesRecursive(artistPath);
    } catch (error) {
      return [];
    }
  }

  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the .txt tag path for a postId. Checks artistPath directly first
   * (the fast path for the common flat layout, no scan needed); if the image
   * isn't there, searches subfolders for it and uses its directory instead -
   * otherwise saving tags for a subfoldered image would write a stray file at
   * the artist root that getArtistTagData() would never look at again. Falls
   * back to artistPath/postId.txt (pre-subfolder-support behavior) if no
   * matching image exists anywhere, so saving still works ahead of the image.
   */
  async _resolveTagFilePath(artistPath, postId) {
    for (const ext of IMAGE_EXTENSIONS) {
      if (await this._fileExists(path.join(artistPath, `${postId}${ext}`))) {
        return path.join(artistPath, `${postId}.txt`);
      }
    }

    const imagePaths = await this._findImagesRecursive(artistPath);
    const match = imagePaths.find(p => path.basename(p, path.extname(p)) === postId);
    if (match) {
      return path.join(path.dirname(match), `${postId}.txt`);
    }

    return path.join(artistPath, `${postId}.txt`);
  }

  _isTagPathInside(artistPath, tagPath) {
    if (!tagPath || typeof tagPath !== 'string') return false;
    if (path.extname(tagPath).toLowerCase() !== '.txt') return false;
    const relative = path.relative(path.resolve(artistPath), path.resolve(tagPath));
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  async getLastModifiedTime(folderPath) {
    try {
      const stats = await fs.stat(folderPath);
      return stats.mtime.getTime();
    } catch (error) {
      return 0;
    }
  }

  /** The dataset libraries from Settings > Storage. */
  getLibraries() {
    if (this.settingsService) return this.settingsService.getLibraries().libraries;
    return [{ id: 'datasets', name: 'Datasets', path: this.defaultDownloadsPath, type: null }];
  }

  /** Adds every dataset folder in one library to `list`. */
  async collectEntriesFromLibrary({ list, library, scannedFolders }) {
    const resolvedBase = path.resolve(library.path);
    if (!(await this.directoryExists(resolvedBase))) {
      console.log(`⚠️ Library "${library.name}" is missing: ${resolvedBase}`);
      return;
    }

    const entries = await fs.readdir(resolvedBase, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'bak') continue;
      // "artists_x" / "characters_x" say their own type; unprefixed folders
      // take the library's old type (see utils/datasetLibraries.js).
      const parsed = parseDatasetFolderName(entry.name);
      const type = datasetType(library, entry.name);

      const folderPath = path.join(resolvedBase, entry.name);
      const normalizedFolderPath = path.normalize(folderPath);
      if (scannedFolders.has(normalizedFolderPath)) continue;

      const files = await this.getArtistFiles(folderPath);
      if (!files.length) continue;

      scannedFolders.add(normalizedFolderPath);
      list.push({
        id: `${type}:${normalizedFolderPath}`,
        name: parsed.name,
        displayName: parsed.name,
        folderName: entry.name,
        type,
        fileCount: files.length,
        path: folderPath,
        storageLabel: library.name,
        libraryId: library.id,
        basePath: resolvedBase,
        lastModified: await this.getLastModifiedTime(folderPath)
      });
    }
  }

  async collectLegacyEntries({ list, baseDownloads, scannedFolders, storageConfig }) {
    if (!baseDownloads) return;
    if (!(await this.directoryExists(baseDownloads))) {
      return;
    }

    const entries = await fs.readdir(baseDownloads, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'artists' || entry.name === 'characters') continue;

      const folderPath = path.join(baseDownloads, entry.name);
      const normalizedFolderPath = path.normalize(folderPath);
      if (scannedFolders.has(normalizedFolderPath)) continue;

      const files = await this.getArtistFiles(folderPath);
      if (!files.length) continue;

      scannedFolders.add(normalizedFolderPath);
      list.push({
        id: `legacy:${normalizedFolderPath}`,
        name: entry.name,
        displayName: entry.name,
        folderName: this.buildFolderIdentifier(normalizedFolderPath, storageConfig) || entry.name,
        type: 'legacy',
        fileCount: files.length,
        path: folderPath,
        storageLabel: 'Legacy Downloads',
        isCustomStorage: false,
        basePath: baseDownloads,
        lastModified: await this.getLastModifiedTime(folderPath)
      });
    }
  }

  buildFolderIdentifier(folderPath, storageConfig) {
    if (!storageConfig?.baseDownloads) {
      return folderPath;
    }

    const relative = path.relative(storageConfig.baseDownloads, folderPath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.replace(/\\/g, '/');
    }

    return folderPath;
  }

  async directoryExists(targetPath) {
    try {
      const stats = await fs.stat(targetPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  async resolveArtistTarget(target) {
    if (!target) {
      throw new Error('Artist target is required');
    }

    if (target.__isResolved && target.folderPath) {
      return target;
    }

    if (typeof target === 'object') {
      const folderPath = target.path || target.folderPath;
      if (!folderPath) {
        throw new Error('Artist target missing folder path');
      }

      const normalizedPath = path.normalize(folderPath);
      const resolved = {
        id: target.id || target.folderName || normalizedPath,
        folderName: target.folderName || target.id || normalizedPath,
        folderPath: normalizedPath,
        displayName: target.displayName || target.name || parseDatasetFolderName(path.basename(normalizedPath)).name,
        type: target.type || parseDatasetFolderName(path.basename(normalizedPath)).type || 'artist',
        storageLabel: target.storageLabel || 'Storage',
        isCustomStorage: !!target.isCustomStorage
      };
      resolved.__isResolved = true;
      return resolved;
    }

    if (typeof target === 'string') {
      const sanitized = sanitizeFilePath(target);
      const normalized = normalizePath(sanitized);
      const absolute = path.isAbsolute(normalized)
        ? path.normalize(normalized)
        : path.join(this.defaultDownloadsPath, normalized);
      const parsedFolder = parseDatasetFolderName(path.basename(absolute));
      const resolved = {
        id: normalized,
        folderName: normalized,
        folderPath: absolute,
        displayName: parsedFolder.name,
        type: parsedFolder.type || (normalized.includes('characters') ? 'character' : 'artist'),
        storageLabel: 'Downloads',
        isCustomStorage: false
      };
      resolved.__isResolved = true;
      return resolved;
    }

    throw new Error('Invalid artist target reference');
  }

  generateCSVExport(files) {
    const header = 'Post ID,File Name,Tag Count,Tags\n';
    const rows = files.map(file => {
      const fileName = `${file.postId}.${file.fileType}`;
      const tags = file.tags.join('; ');
      return `${file.postId},"${fileName}",${file.tags.length},"${tags}"`;
    });
    
    return header + rows.join('\n');
  }

  generateJSONExport(files) {
    const exportData = {
      exportDate: new Date().toISOString(),
      fileCount: files.length,
      files: files.map(file => ({
        postId: file.postId,
        fileName: `${file.postId}.${file.fileType}`,
        tagCount: file.tags.length,
        tags: file.tags,
        lastModified: file.lastModified
      }))
    };
    
    return JSON.stringify(exportData, null, 2);
  }

  generateTXTExport(files) {
    const header = `Tag Export - ${new Date().toISOString()}\n`;
    const summary = `Total Files: ${files.length}\n`;
    const separator = '=' .repeat(50) + '\n\n';
    
    const fileEntries = files.map(file => {
      return `Post ID: ${file.postId}\nTags (${file.tags.length}): ${file.tags.join(', ')}\n`;
    });
    
    return header + summary + separator + fileEntries.join('\n');
  }

  findSimilarTags(tags) {
    const similarities = [];
    
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const tag1 = tags[i].toLowerCase();
        const tag2 = tags[j].toLowerCase();
        
        // Check for similar tags (Levenshtein distance or substring)
        if (calculateSimilarity(tag1, tag2) > 0.8) {
          similarities.push({
            tag1: tags[i],
            tag2: tags[j],
            similarity: calculateSimilarity(tag1, tag2)
          });
        }
      }
    }
    
    return similarities;
  }

  // Custom folder methods
  async browseCustomFolder() {
    const { dialog } = require('electron');
    const { BrowserWindow } = require('electron');
    
    try {
      const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Custom Folder',
        properties: ['openDirectory'],
        message: 'Choose a folder containing images and tag files'
      });
      
      if (result.canceled) {
        return {
          success: true,
          cancelled: true
        };
      }
      
      const folderPath = result.filePaths[0];
      console.log(`📁 User selected custom folder: ${folderPath}`);
      
      return {
        success: true,
        folderPath
      };
      
    } catch (error) {
      console.error('Error browsing for custom folder:', error);
      return {
        success: false,
        message: 'Failed to open folder browser',
        error: error.message
      };
    }
  }

  async scanCustomFolder(folderPath) {
    try {
      console.log(`🔍 Scanning custom folder: ${folderPath}`);
      
      // Check if folder exists
      const stats = await fs.stat(folderPath);
      if (!stats.isDirectory()) {
        throw new Error('Path is not a directory');
      }
      
      // Read folder contents
      const files = await fs.readdir(folderPath);
      
      // Filter image files
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return imageExtensions.includes(ext);
      }).map(file => ({
        name: file,
        path: path.join(folderPath, file),
        baseName: path.parse(file).name
      }));
      
      // Filter tag files
      const tagFiles = files.filter(file => {
        return path.extname(file).toLowerCase() === '.txt';
      }).map(file => ({
        name: file,
        path: path.join(folderPath, file),
        baseName: path.parse(file).name
      }));
      
      console.log(`✅ Found ${imageFiles.length} images and ${tagFiles.length} tag files`);
      
      return {
        success: true,
        data: {
          imageFiles,
          tagFiles
        }
      };
      
    } catch (error) {
      console.error('Error scanning custom folder:', error);
      return {
        success: false,
        message: 'Failed to scan folder',
        error: error.message
      };
    }
  }

  async loadCustomFolder(customFolderData) {
    try {
      const { folderPath, imageFiles, tagFiles } = customFolderData;
      console.log(`📦 Loading custom folder: ${folderPath}`);
      
      const files = [];
      
      // Process each image file
      for (const imageFile of imageFiles) {
        // Find corresponding tag file
        const tagFile = tagFiles.find(tf => tf.baseName === imageFile.baseName);
        
        let tags = [];
        if (tagFile) {
          try {
            // Read tag file content
            const tagContent = await fs.readFile(tagFile.path, 'utf8');
            tags = tagContent.trim()
              .split(',')
              .map(tag => tag.trim())
              .filter(tag => tag.length > 0);
          } catch (error) {
            console.warn(`⚠️ Could not read tag file ${tagFile.path}:`, error.message);
          }
        }
        
        // Create file entry
        files.push({
          postId: imageFile.baseName, // Use filename as postId for custom files
          imagePath: `file://${imageFile.path.replace(/\\/g, '/')}`,
          tagPath: tagFile ? tagFile.path : path.join(folderPath, `${imageFile.baseName}.txt`),
          tags: tags,
          isCustom: true,
          folderPath: folderPath
        });
      }
      
      console.log(`✅ Processed ${files.length} files from custom folder`);
      
      return {
        success: true,
        data: {
          files,
          folderPath
        }
      };
      
    } catch (error) {
      console.error('Error loading custom folder:', error);
      return {
        success: false,
        message: 'Failed to load custom folder',
        error: error.message
      };
    }
  }

  /**
   * Save tag data to a custom file path
   */
    async saveCustomTagData(tagFilePath, tags) {
    try {
      tagFilePath = requireFile(tagFilePath, TEXT_EXTENSIONS, 'tag file');
      // Clean and format tags
      const cleanTags = tags
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
        .filter((tag, index, arr) => arr.indexOf(tag) === index); // Remove duplicates
      
      const tagContent = cleanTags.join(', ');
      
            // Write tag file; the previous caption is kept in bak/.
      await writeFileSafe(tagFilePath, tagContent, { backup: true });
      
      console.log(`💾 Saved ${cleanTags.length} tags to custom file: ${tagFilePath}`);
      
      return {
        success: true,
        message: `Saved ${cleanTags.length} tags`,
        tagCount: cleanTags.length,
        filePath: tagFilePath
      };
      
    } catch (error) {
      console.error('Error saving custom tag data:', error);
      return {
        success: false,
        message: 'Failed to save tag data',
        error: error.message
      };
    }
  }

  /**
   * Get directory configuration from settings
   */
}

module.exports = TagEditorIPC;
