const { ipcMain, shell, net } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS, TEXT_EXTENSIONS, requireFile, requireLocalPath, requireName, requireFileName, requireWebUrl } = require('../utils/pathGuard');
const { writeFileSafe } = require('../utils/safeWrite');
const { datasetPath } = require('../utils/datasetLibraries');

// Supported image extensions for dataset folder scanning / raw byte reads
// (Image Resizer + Image Upscaler "choose dataset folder" feature).
const DATASET_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif']);

// Directories to never descend into while scanning: 'bak' is where
// ImageUpscalerIPC moves pre-upscale originals (see ImageUpscalerIPC.js), so
// without this a scan would surface each upscaled image's original as a
// second, duplicate-postId entry.
const IGNORED_DIR_NAMES = new Set(['bak', '.git', 'node_modules']);
const DATASET_IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff'
};

class UtilsIPC {
  constructor(settingsService = null) {
    this.settingsService = settingsService;
    this.setupHandlers();
    console.log('🔗 Utils IPC handlers registered');
  }
  
  /** The dataset libraries (see utils/datasetLibraries.js). */
  getLibraries() {
    if (this.settingsService) return this.settingsService.getLibraries();
    const fallback = path.join(process.cwd(), 'downloads');
    return { libraries: [{ id: 'datasets', name: 'Datasets', path: fallback, type: null }], defaultId: 'datasets' };
  }

  /** The library new downloads go to. */
  getStorageRoot() {
    const { libraries, defaultId } = this.getLibraries();
    return (libraries.find((lib) => lib.id === defaultId) || libraries[0]).path;
  }

  /**
   * Get the appropriate download path based on type and settings.
   * `categorySubFolder` is an optional single path segment beneath the
   * artist/character folder (e.g. a detected style folder like "flat" or
   * "shaded" - see jrjresq-style datasets). It's sanitized to a bare
   * directory name so a bad value can't escape the artist folder.
   */
  getDownloadPath(folderName, type = 'artist', categorySubFolder = '') {
    // One folder per artist or character, never a path out of a library.
    folderName = requireName(folderName, 'folder name');
    const datasetType = type === 'character' ? 'character' : 'artist'; // 'post' downloads go with artists
    // The library that already has this dataset, else the default one. Folders
    // are named "artists_<name>" / "characters_<name>"; an existing unprefixed
    // folder from the older layout is still used if there is one.
    const { libraries, defaultId } = this.getLibraries();
    const basePath = datasetPath(libraries, defaultId, folderName, datasetType);

    const safeSub = this._sanitizeCategorySubFolder(categorySubFolder);
    return safeSub ? path.join(basePath, safeSub) : basePath;
  }

  /**
   * Reduce a category subfolder value to a single safe directory name,
   * stripping any path traversal / separators (e.g. "../../etc" -> "etc").
   */
  _sanitizeCategorySubFolder(subFolder) {
    if (!subFolder || typeof subFolder !== 'string') return '';
    const base = path.basename(subFolder.trim());
    if (!base || base === '.' || base === '..') return '';
    return base;
  }

  /**
   * Recursively finds every image file under `rootPath`, at any depth.
   * Artists/characters aren't always stored flat - some datasets split into
   * style/category subfolders (e.g. twang/flat_sketch, twang/shaded) - so a
   * shallow readdir() would miss images that are genuinely on disk. Returns
   * [{filePath, name, subFolder}], subFolder being '' at rootPath itself.
   */
  async _findImagesRecursive(rootPath) {
    const images = [];
    const walk = async (dir) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) continue;
          await walk(path.join(dir, entry.name));
        } else if (entry.isFile() && DATASET_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const fullPath = path.join(dir, entry.name);
          images.push({
            filePath: fullPath,
            name: entry.name,
            subFolder: path.relative(rootPath, dir)
          });
        }
      }
    };

    await walk(rootPath);
    return images;
  }

  setupHandlers() {
    // Download image from URL
    ipcMain.handle('utils:download-image', async (event, data) => {
      try {
        const { url, artistName, fileName, downloadType = 'artist', subFolder = '' } = data;

        console.log(`🌐 Downloading image: ${url} (type: ${downloadType}${subFolder ? `, category: ${subFolder}` : ''})`);

        // Get appropriate download path based on type (and optional category subfolder)
        const downloadsPath = this.getDownloadPath(artistName, downloadType, subFolder);
        await fs.mkdir(downloadsPath, { recursive: true });
        
        console.log(`📁 Saving to: ${downloadsPath}`);
                const filePath = path.join(downloadsPath, requireFileName(fileName, MEDIA_EXTENSIONS));

        // Download image using Electron's net module
        const request = net.request(requireWebUrl(url));
        
                return new Promise((resolve, reject) => {
          const chunks = [];
          // Give up when no data has arrived for this long; a large video
          // still finishes as long as it keeps coming.
          let stallTimer;
          const stalled = () => {
            request.abort();
            reject(new Error('Download stalled: no data for 30 seconds'));
          };
          const resetStall = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(stalled, 30000);
          };
          resetStall();

          request.on('response', (response) => {
            console.log(`📥 Response status: ${response.statusCode}`);
            
                        if (response.statusCode !== 200) {
              clearTimeout(stallTimer);
              reject(new Error(`HTTP ${response.statusCode}: Failed to download image`));
              return;
            }
            
                        response.on('data', (chunk) => {
              chunks.push(chunk);
              resetStall();
            });

            response.on('end', async () => {
              clearTimeout(stallTimer);
              try {
                const buffer = Buffer.concat(chunks);
                                await writeFileSafe(filePath, buffer);
                
                console.log(`✅ Image saved: ${filePath} (${buffer.length} bytes)`);
                
                resolve({
                  success: true,
                  filePath: filePath,
                  message: `Image saved to ${artistName}${subFolder ? `/${subFolder}` : ''} folder`,
                  size: buffer.length
                });
              } catch (writeError) {
                console.error('❌ Error writing image file:', writeError);
                reject(writeError);
              }
            });
            
                        response.on('error', (error) => {
              clearTimeout(stallTimer);
              console.error('❌ Response error:', error);
              reject(error);
            });
          });
          
                    request.on('error', (error) => {
            clearTimeout(stallTimer);
            console.error('❌ Request error:', error);
            reject(error);
          });
          
          request.end();
        });
        
      } catch (error) {
        console.error('❌ Error downloading image:', error);
        return {
          success: false,
          message: `Failed to download image: ${error.message}`
        };
      }
    });

    // Save text file to downloads folder
    ipcMain.handle('utils:save-to-downloads', async (event, data) => {
      try {
        const { artistName, fileName, content, downloadType = 'artist', subFolder = '' } = data;

        // Get appropriate download path based on type (and optional category subfolder)
        const downloadsPath = this.getDownloadPath(artistName, downloadType, subFolder);
        await fs.mkdir(downloadsPath, { recursive: true });

                const filePath = path.join(downloadsPath, requireFileName(fileName, TEXT_EXTENSIONS));

                // Save text file; a caption edited since the last download is kept in bak/.
        await writeFileSafe(filePath, content, { backup: true });

        console.log(`✅ Text file saved: ${filePath}`);

        return {
          success: true,
          filePath: filePath,
          message: `File saved to ${artistName}${subFolder ? `/${subFolder}` : ''} folder`
        };
        
      } catch (error) {
        console.error('❌ Error saving text file:', error);
        return {
          success: false,
          message: `Failed to save file: ${error.message}`
        };
      }
    });

    // Show file in folder
    ipcMain.handle('utils:show-in-folder', async (event, filePath) => {
      try {
                shell.showItemInFolder(requireLocalPath(filePath));
        console.log(`📂 Showed file in folder: ${filePath}`);
        return { success: true };
      } catch (error) {
        console.error('❌ Error showing file in folder:', error);
        return {
          success: false,
          message: `Failed to show file: ${error.message}`
        };
      }
    });

    // Open downloads folder
    ipcMain.handle('utils:open-downloads-folder', async (event, artistName, downloadType = 'artist') => {
      try {
        // No name opens the root folder that holds every dataset of that type.
        const downloadsPath = artistName
          ? this.getDownloadPath(artistName, downloadType)
          : this.getStorageRoot(downloadType);

        // Check if folder exists
        try {
          await fs.access(downloadsPath);
        } catch (error) {
          // Create folder if it doesn't exist
          await fs.mkdir(downloadsPath, { recursive: true });
        }
        
        // Open folder in file explorer
        await shell.openPath(downloadsPath);
        
        console.log(`📁 Opened folder: ${downloadsPath}`);
        
        return {
          success: true,
          message: `Opened ${artistName || 'downloads'} folder`
        };
        
      } catch (error) {
        console.error('❌ Error opening folder:', error);
        return {
          success: false,
          message: `Failed to open folder: ${error.message}`
        };
      }
    });

    // Get download statistics
    ipcMain.handle('utils:get-download-stats', async (event) => {
      try {
        const downloadsPath = path.join(process.cwd(), 'downloads');
        
        // Check if downloads folder exists
        try {
          await fs.access(downloadsPath);
        } catch (error) {
          return {
            success: true,
            totalFiles: 0,
            totalFolders: 0,
            totalSize: 0
          };
        }
        
        // Count files and folders
        let totalFiles = 0;
        let totalFolders = 0;
        let totalSize = 0;
        
        const folders = await fs.readdir(downloadsPath);
        
        for (const folder of folders) {
          const folderPath = path.join(downloadsPath, folder);
          const stat = await fs.stat(folderPath);
          
          if (stat.isDirectory()) {
            totalFolders++;
            
            // Count files in folder
            const files = await fs.readdir(folderPath);
            for (const file of files) {
              const filePath = path.join(folderPath, file);
              const fileStat = await fs.stat(filePath);
              
              if (fileStat.isFile()) {
                totalFiles++;
                totalSize += fileStat.size;
              }
            }
          }
        }
        
        // console.log(`📊 Download stats: ${totalFiles} files in ${totalFolders} folders (${totalSize} bytes)`);
        
        return {
          success: true,
          totalFiles,
          totalFolders,
          totalSize
        };
        
      } catch (error) {
        console.error('❌ Error getting download stats:', error);
        return {
          success: false,
          message: `Failed to get stats: ${error.message}`,
          totalFiles: 0,
          totalFolders: 0,
          totalSize: 0
        };
      }
    });

    // Open external URL in default browser
    ipcMain.handle('utils:open-external', async (event, url) => {
      try {
        console.log(`🌐 Opening external URL: ${url}`);
                await shell.openExternal(requireWebUrl(url));
        
        return {
          success: true,
          message: 'URL opened in browser'
        };
        
      } catch (error) {
        console.error('❌ Error opening external URL:', error);
        return {
          success: false,
          message: `Failed to open URL: ${error.message}`
        };
      }
    });

    // Dataset libraries: the folders datasets live in, and the default one.
    ipcMain.handle('storage:get-libraries', async () => {
      try {
        const { libraries, defaultId } = this.getLibraries();
        const withState = await Promise.all(libraries.map(async (lib) => {
          let exists = false;
          try {
            exists = (await fs.stat(lib.path)).isDirectory();
          } catch {
            // missing: e.g. an unplugged drive
          }
          return { ...lib, exists };
        }));
        return { success: true, libraries: withState, defaultId };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    // Opens a library by id, so only folders in Settings can be opened this way.
    ipcMain.handle('storage:open-library', async (event, id) => {
      const library = this.getLibraries().libraries.find((lib) => lib.id === id);
      if (!library) return { success: false, message: 'Unknown library' };
      await fs.mkdir(library.path, { recursive: true });
      const error = await shell.openPath(library.path);
      return error ? { success: false, message: error } : { success: true };
    });

    ipcMain.handle('storage:save-libraries', async (event, libraries, defaultId) => {
      try {
        if (!Array.isArray(libraries) || libraries.length === 0) throw new Error('Keep at least one library');
        const clean = libraries.slice(0, 50).map((lib, index) => {
          const folder = requireLocalPath(lib?.path, 'library folder');
          const name = String(lib?.name || '').trim().slice(0, 60) || path.basename(folder);
          const type = lib?.type === 'artist' || lib?.type === 'character' ? lib.type : null;
          const id = String(lib?.id || `library-${index + 1}`).slice(0, 80);
          return { id, name, path: folder, type };
        });
        const chosen = clean.some((lib) => lib.id === defaultId) ? defaultId : clean[0].id;
        // The default library is where downloads go, so make sure it exists.
        await fs.mkdir(clean.find((lib) => lib.id === chosen).path, { recursive: true });
        await this.settingsService.saveSettings({ storage: { libraries: clean, defaultLibrary: chosen } });
        const saved = this.getLibraries();
        return { success: true, libraries: saved.libraries, defaultId: saved.defaultId };
      } catch (error) {
        console.error('❌ Error saving libraries:', error);
        return { success: false, message: error.message };
      }
    });

    // Resize-save: backup original to bak/ subfolder, write resized buffer in place
        ipcMain.handle('utils:resize-save-image', async (event, { filePath, buffer }) => {
      try {
        const imgPath = requireFile(filePath, IMAGE_EXTENSIONS, 'image');
        const dir = path.dirname(imgPath);
        const fileName = path.basename(imgPath);
        const bakDir = path.join(dir, 'bak');

        await fs.mkdir(bakDir, { recursive: true });

        // Move original to bak/
        const bakPath = path.join(bakDir, fileName);
        try {
          await fs.rename(imgPath, bakPath);
        } catch {
          // rename can fail across drives; fall back to copy + delete
          await fs.copyFile(imgPath, bakPath);
          await fs.unlink(imgPath);
        }

        // Write resized data
                await writeFileSafe(imgPath, Buffer.from(buffer));

        console.log(`✅ Resized and saved: ${imgPath} (backup: ${bakPath})`);
        return { success: true, bakPath };
      } catch (error) {
        console.error('❌ Error saving resized image:', error);
        return { success: false, message: error.message };
      }
    });

    // Recursively scan an arbitrary user-picked folder for image files.
    // Lightweight "dataset" scan for Image Resizer / Image Upscaler — just
    // file paths, no embedded metadata parsing (see ImageOrganizerIPC for that).
    ipcMain.handle('utils:scan-image-folder', async (event, folderPath) => {
      try {
        if (!folderPath || typeof folderPath !== 'string') {
          return { success: false, message: 'Invalid folder path' };
        }

        try {
          await fs.access(folderPath);
        } catch {
          return { success: false, message: 'Folder not accessible' };
        }

        const images = await this._findImagesRecursive(folderPath);

        console.log(`✅ Dataset scan found ${images.length} image(s) in ${folderPath}`);
        return { success: true, images };
      } catch (error) {
        console.error('❌ Error scanning image dataset folder:', error);
        return { success: false, message: `Failed to scan folder: ${error.message}` };
      }
    });

    // Read raw image bytes so the renderer can build a blob URL. Needed for
    // dataset-picked images, which (unlike drag/drop or <input type=file>)
    // have no browser-native File object/blob URL already available.
    ipcMain.handle('utils:read-image-file', async (event, filePath) => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, message: 'Invalid file path' };
        }

        const ext = path.extname(filePath).toLowerCase();
        if (!DATASET_IMAGE_EXTENSIONS.has(ext)) {
          return { success: false, message: 'Unsupported file type' };
        }

        const data = await fs.readFile(filePath);
        return { success: true, data, mime: DATASET_IMAGE_MIME_TYPES[ext] || 'application/octet-stream' };
      } catch (error) {
        console.error('❌ Error reading image file:', error);
        return { success: false, message: `Failed to read file: ${error.message}` };
      }
    });

    // Check which posts already exist in the dataset directory
    ipcMain.handle('utils:check-posts-exist', async (event, { postIds, folderName, downloadType }) => {
      try {
        const folderPath = this.getDownloadPath(folderName, downloadType);
        const existingIds = [];
        const unresolved = [];

        // Fast path: most artists are flat, so check the top level directly
        // first with no scan needed - same cost as before this fix.
        await Promise.all(
          postIds.map(async ({ id, ext }) => {
            const filePath = path.join(folderPath, `${id}.${ext}`);
            try {
              await fs.access(filePath);
              existingIds.push(id);
            } catch {
              unresolved.push(id); // not at the top level - might be in a subfolder
            }
          })
        );

        // Slow path, only if needed: some artists split their dataset into
        // subfolders (e.g. twang/flat_sketch, twang/shaded), so a post can be
        // genuinely on disk without living at the artist root. One recursive
        // scan covers every still-unresolved id in this batch, rather than
        // scanning once per id.
        if (unresolved.length > 0) {
          const images = await this._findImagesRecursive(folderPath);
          const foundIds = new Set(images.map(img => path.basename(img.name, path.extname(img.name))));
          for (const id of unresolved) {
            if (foundIds.has(String(id))) existingIds.push(id);
          }
        }

        return { success: true, existingIds };
      } catch (error) {
        console.error('❌ Error checking posts exist:', error);
        return { success: false, existingIds: [], message: error.message };
      }
    });

    // List the immediate subfolders of an artist/character's download folder.
    // Lets the Artist/Character Search tool detect style/category splits
    // (e.g. an artist folder containing flat/, shaded/, sketch/ subfolders)
    // so search results can be routed into the matching category on download.
    ipcMain.handle('utils:get-category-subfolders', async (event, { folderName, downloadType }) => {
      try {
        const folderPath = this.getDownloadPath(folderName, downloadType);

        let entries;
        try {
          entries = await fs.readdir(folderPath, { withFileTypes: true });
        } catch {
          // Folder doesn't exist yet (e.g. artist never downloaded before) - no categories
          return { success: true, subFolders: [] };
        }

        const subFolders = entries
          .filter(entry => entry.isDirectory()
            && !IGNORED_DIR_NAMES.has(entry.name.toLowerCase())
            && !entry.name.startsWith('.'))
          .map(entry => entry.name)
          .sort((a, b) => a.localeCompare(b));

        return { success: true, subFolders };
      } catch (error) {
        console.error('❌ Error listing category subfolders:', error);
        return { success: false, subFolders: [], message: error.message };
      }
    });
  }
}

module.exports = UtilsIPC;