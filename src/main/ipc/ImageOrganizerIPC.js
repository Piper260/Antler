// src/main/ipc/ImageOrganizerIPC.js
// Reads image metadata (PNG tEXt chunks, EXIF) to detect artist names,
// then copies/moves images into per-artist subfolders.
const { ipcMain, shell } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { requireFile, requireLocalPath } = require('../utils/pathGuard');

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif']);

class ImageOrganizerIPC {
  constructor() {
    this._setupHandlers();
    console.log('🔗 Image Organizer IPC handlers registered');
  }

  _setupHandlers() {
    ipcMain.handle('image-organizer:scan-folder', async (_event, folderPath) => {
      try {
        return await this._scanFolder(folderPath);
      } catch (error) {
        console.error('❌ Image Organizer scan error:', error);
        return { success: false, message: error.message || 'Scan failed' };
      }
    });

    ipcMain.handle('image-organizer:organize', async (_event, operations, outputPath, mode) => {
      try {
        return await this._organize(operations, outputPath, mode);
      } catch (error) {
        console.error('❌ Image Organizer organize error:', error);
        return { success: false, message: error.message || 'Organize failed' };
      }
    });

    ipcMain.handle('image-organizer:open-folder', async (_event, folderPath) => {
      try {
                // openPath runs programs as well as opening folders, so only folders get through.
        const folder = requireLocalPath(folderPath, 'folder');
        if (!(await fs.stat(folder)).isDirectory()) throw new Error('Not a folder');
        await shell.openPath(folder);
        return { success: true };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });
  }

  // ─── Folder Scanning ──────────────────────────────────────────────────────

  async _scanFolder(folderPath) {
    if (!folderPath || typeof folderPath !== 'string') {
      return { success: false, message: 'Invalid folder path' };
    }

    try {
      await fs.access(folderPath);
    } catch {
      return { success: false, message: 'Folder not accessible' };
    }

    const imageFiles = await this._collectImages(folderPath);

    if (imageFiles.length === 0) {
      return { success: true, images: [], message: 'No image files found in folder or subfolders' };
    }

    const results = await Promise.all(imageFiles.map(f => this._readImageMeta(f, folderPath)));
    return { success: true, images: results };
  }

  async _collectImages(rootPath) {
    const results = [];
    const walk = async (dir) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          results.push(fullPath);
        }
      }
    };
    await walk(rootPath);
    return results;
  }

  async _readImageMeta(filePath, rootPath) {
    const ext = path.extname(filePath).toLowerCase();
    const result = {
      filePath,
      name: path.basename(filePath),
      ext,
      subFolder: rootPath ? path.relative(rootPath, path.dirname(filePath)) : '',
      metadata: {},
      artists: [],
      loras: [],
      lorasInactive: [],
      tags: [],
      model: null,
      rawParams: null,
      size: 0,
      modified: null
    };

    try {
      const stat = await fs.stat(filePath);
      result.size = stat.size;
      result.modified = stat.mtime.toISOString();
    } catch { /* ignore */ }

    try {
      if (ext === '.png') {
        await this._parsePNGMeta(filePath, result);
      } else if (['.jpg', '.jpeg', '.webp', '.tiff', '.tif'].includes(ext)) {
        await this._parseWithSharp(filePath, result);
      }
    } catch (error) {
      result.parseError = error.message;
    }

    return result;
  }

  // ─── PNG Metadata Parser ──────────────────────────────────────────────────
  // Reads tEXt and iTXt chunks directly from the PNG binary without external deps.

  async _parsePNGMeta(filePath, result) {
    const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const handle = await fs.open(filePath, 'r');

    try {
      const sigBuf = Buffer.alloc(8);
      await handle.read(sigBuf, 0, 8, 0);
      if (!sigBuf.equals(PNG_SIG)) return;

      const { size: fileSize } = await handle.stat();
      let offset = 8;

      while (offset < fileSize - 12) {
        const header = Buffer.alloc(8);
        const { bytesRead } = await handle.read(header, 0, 8, offset);
        if (bytesRead < 8) break;

        const chunkLength = header.readUInt32BE(0);
        const chunkType = header.slice(4, 8).toString('ascii');

        // Sanity-check chunk length (no chunk should be > 10 MB)
        if (chunkLength < 0 || chunkLength > 10 * 1024 * 1024) break;

        if (chunkType === 'tEXt' || chunkType === 'iTXt') {
          const dataBuf = Buffer.alloc(chunkLength);
          await handle.read(dataBuf, 0, chunkLength, offset + 8);

          const nullIdx = dataBuf.indexOf(0);
          if (nullIdx > 0) {
            const keyword = dataBuf.slice(0, nullIdx).toString('latin1').toLowerCase();
            let text = '';

            if (chunkType === 'tEXt') {
              text = dataBuf.slice(nullIdx + 1).toString('latin1');
            } else {
              // iTXt: keyword\0 compression_flag(1) compression_method(1) language\0 translated_keyword\0 text
              const afterKeyword = dataBuf.slice(nullIdx + 1);
              const langNullIdx = afterKeyword.indexOf(0, 2);
              if (langNullIdx >= 0) {
                const afterLang = afterKeyword.slice(langNullIdx + 1);
                const transNullIdx = afterLang.indexOf(0);
                if (transNullIdx >= 0) {
                  text = afterLang.slice(transNullIdx + 1).toString('utf8');
                }
              }
            }

            result.metadata[keyword] = text;

            // "parameters" / "comment" — human-readable A1111/Image Saver text; prefer for rawParams display
            if (keyword === 'parameters' || keyword === 'comment') {
              result.rawParams = text;
              this._extractArtistsFromParams(text, result);
            } else if (keyword === 'prompt') {
              // ComfyUI prompt JSON — only use as rawParams if no human-readable text found yet
              if (!result.rawParams) result.rawParams = text;
              this._parseComfyUIJSON(text, result);         // structured JSON walk (on/off aware)
              this._extractArtistsFromParams(text, result); // regex patterns as fallback
            }
          }
        }

        if (chunkType === 'IEND') break;
        offset += 8 + chunkLength + 4; // header(8) + data + CRC(4)
      }
    } finally {
      await handle.close();
    }
  }

  // ─── EXIF / sharp fallback ────────────────────────────────────────────────
  // Parses ComfyUI prompt JSON to extract LoRAs (respecting the on/off flag) and checkpoint model.
  // Active LoRAs are processed first so derived artist names appear as artists[0].
  _parseComfyUIJSON(text, result) {
    let nodes;
    try { nodes = JSON.parse(text); } catch { return; }
    if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return;

    const activeLoras   = [];
    const inactiveLoras = [];

    for (const node of Object.values(nodes)) {
      if (!node || typeof node !== 'object') continue;
      const ct     = (node.class_type || '').toLowerCase();
      const inputs = node.inputs || {};

      // Standard LoraLoader node
      if (ct.includes('loraloader') || ct === 'lora loader') {
        if (typeof inputs.lora_name === 'string') activeLoras.push(inputs.lora_name);
      }

      // Power Lora Loader (rgthree) and compatible multi-slot loaders
      // Slots are keyed as lora_1, lora_2, … with {on, lora, strength} shape
      if (ct.includes('power lora loader') || ct.includes('lora loader stack') || ct.includes('lora stacker')) {
        for (const [key, val] of Object.entries(inputs)) {
          if (/^lora_\d+$/.test(key) && val && typeof val === 'object' && typeof val.lora === 'string' && val.lora) {
            (val.on ? activeLoras : inactiveLoras).push(val.lora);
          }
        }
      }

      // Checkpoint loader — grab model name (strip extension for display)
      if ((ct.includes('checkpoint') || ct === 'checkpoint loader with name (image saver)') &&
          typeof inputs.ckpt_name === 'string' && !result.model) {
        result.model = inputs.ckpt_name.replace(/\.(?:safetensors|pt|ckpt|bin|pth)$/i, '').trim();
      }
    }

    // Active LoRAs → result.loras; inactive → result.lorasInactive
    const loraSet         = new Set(result.loras);
    const loraInactiveSet = new Set(result.lorasInactive);
    for (const l of activeLoras)   loraSet.add(l);
    for (const l of inactiveLoras) {
      // Only put in inactive if not already active
      if (!loraSet.has(l)) loraInactiveSet.add(l);
    }
    result.loras         = [...loraSet];
    result.lorasInactive = [...loraInactiveSet];

    // Derive artist names from LoRA filenames (active first → artists[0] is the enabled one)
    const artistSet = new Set();
    const deriveArtist = (loraName) => {
      if (!/^(?:Artist|Style)\s*[-_]\s*/i.test(loraName)) return;
      const name = loraName
        .replace(/^(?:Artist|Style)\s*[-_]\s*/i, '')
        .replace(/\.(?:safetensors|pt|ckpt|bin|pth)$/i, '')
        .replace(/\s*[-_]\s*(?:IL|XL|SDXL|NSFW|SFW)\s*$/i, '')
        .replace(/\s*[-_]?\s*v\d+\s*$/i, '')
        .trim()
        .replace(/_/g, ' ');
      if (name.length > 1) artistSet.add(name);
    };
    for (const l of activeLoras)   deriveArtist(l);
    for (const l of inactiveLoras) deriveArtist(l);

    // Prepend JSON-derived artists (active ones first) before any previously detected ones
    result.artists = [...artistSet, ...result.artists.filter(a => !artistSet.has(a))];
  }
  async _parseWithSharp(filePath, result) {
    let sharp;
    try { sharp = require('sharp'); } catch { return; }

    try {
      const meta = await sharp(filePath).metadata();

      if (meta.exif) {
        // Scan the raw EXIF buffer for printable ASCII strings as a best-effort parse
        const exifStr = meta.exif.toString('binary');
        const matches = exifStr.match(/[\x20-\x7E]{4,128}/g) || [];
        const meaningful = matches.filter(s => /[a-zA-Z]/.test(s) && s.trim().length > 3);
        if (meaningful.length > 0) {
          result.metadata['_exif_strings'] = meaningful.slice(0, 10).join('; ');
          // Heuristic: look for artist-like strings from EXIF tag 0x013B (Artist)
          this._extractArtistsFromParams(meaningful.join(' '), result);
        }
      }
    } catch { /* ignore sharp errors */ }
  }

  // ─── Artist Extraction ────────────────────────────────────────────────────

  _extractArtistsFromParams(text, result) {
    if (!text) return;

    const artists = new Set(result.artists);
    const loras   = new Set(result.loras);
    const tags    = new Set(result.tags);

    // ── LoRA extraction ──────────────────────────────────────────────────────

    // Pattern 1: <lora:name:weight> — standard A1111 / forge syntax
    const loraAngle = /<lora:([^:>\s]+)(?::[^>]*)>/gi;
    let m;
    while ((m = loraAngle.exec(text)) !== null) {
      loras.add(m[1].trim());
    }

    // Pattern 2: [lora:name:weight] — alternate bracket syntax
    const loraBracket = /\[lora:([^:\]\s]+)(?::[^\]]*)]/gi;
    while ((m = loraBracket.exec(text)) !== null) {
      loras.add(m[1].trim());
    }

    // Pattern 3: A1111 footer "Lora hashes: \"name: abc123, name2: def456\""
    const loraHashBlock = /Lora\s+hashes\s*:\s*"([^"]+)"/gi;
    while ((m = loraHashBlock.exec(text)) !== null) {
      const pairs = m[1].split(',');
      for (const pair of pairs) {
        const name = pair.split(':')[0].trim();
        if (name) loras.add(name);
      }
    }

    // Pattern 4: ComfyUI JSON — look for "lora_name": "value" keys
    // Skip if this is a ComfyUI JSON prompt — _parseComfyUIJSON already handled it with on/off awareness
    if (!text.trimStart().startsWith('{')) {
      const loraJsonKey = /"lora_name"\s*:\s*"([^"]+)"/gi;
      while ((m = loraJsonKey.exec(text)) !== null) {
        loras.add(m[1].trim());
      }
    }

    // Pattern 5: "AddNet Model N: name" — Additional Networks extension
    const addnetRe = /AddNet\s+Model\s+\d+\s*:\s*([^\n,]+)/gi;
    while ((m = addnetRe.exec(text)) !== null) {
      loras.add(m[1].trim());
    }

    // Pattern 6: ComfyUI "Power Lora Loader (rgthree)" — lora_N: {"lora": "file.safetensors"}
    // Skip for ComfyUI JSON prompts — _parseComfyUIJSON handles on/off state properly
    if (!text.trimStart().startsWith('{')) {
      const loraNestedRe = /"lora"\s*:\s*"([^"]+\.(?:safetensors|pt|ckpt|bin|pth))"/gi;
      while ((m = loraNestedRe.exec(text)) !== null) {
        loras.add(m[1].trim());
      }
    }

    // Checkpoint model — "Model: name" from A1111 / Image Saver parameters footer
    const modelMatch = text.match(/\bModel:\s*([^\s,\n\r]+)/i);
    if (modelMatch && !result.model) {
      result.model = modelMatch[1].trim();
    }

    // ── Artist extraction ────────────────────────────────────────────────────

    // Pattern A: "artist:name" — e621/Danbooru-style SD prompts
    const artistTagRe = /\bartist[:\s_]+([a-zA-Z0-9_\-.()\s]{2,50}?)(?=[,\n\r<]|$)/gi;
    while ((m = artistTagRe.exec(text)) !== null) {
      const name = m[1].trim().replace(/,$/, '');
      if (name.length > 1) artists.add(name);
    }

    // Pattern B: "by artist_name" — general SD prompts
    const byRe = /\bby\s+([a-zA-Z0-9_\-.()\s]{2,50}?)(?=[,\n\r<(]|$)/gi;
    while ((m = byRe.exec(text)) !== null) {
      const name = m[1].trim().replace(/,$/, '');
      if (name.length > 1 && !name.toLowerCase().startsWith('by ')) artists.add(name);
    }
    // Derive artist names from "Artist - Name - IL.safetensors" style LoRA filenames
    for (const loraName of loras) {
      if (/^(?:Artist|Style)\s*[-_]\s*/i.test(loraName)) {
        const derived = loraName
          .replace(/^(?:Artist|Style)\s*[-_]\s*/i, '')
          .replace(/\.(?:safetensors|pt|ckpt|bin|pth)$/i, '')
          .replace(/\s*[-_]\s*(?:IL|XL|SDXL|NSFW|SFW)\s*$/i, '')
          .replace(/\s*[-_]?\s*v\d+\s*$/i, '')
          .trim()
          .replace(/_/g, ' ');
        if (derived.length > 1) artists.add(derived);
      }
    }
    result.artists = [...artists];
    result.loras   = [...loras];
    result.tags    = [...tags];
  }

  // ─── Group Folder Derivation ─────────────────────────────────────────────

  /**
   * Derives a parent "group" folder name from an artist/LoRA folder name by
   * stripping training-step suffixes (-000042), version tags (v2, v1.1),
   * artist prefixes (Artist -, Style -), and quality tags (- IL, - XL).
   * Examples:
   *   "Twang-000042"          → "Twang"
   *   "Patrae v2"             → "Patrae"
   *   "Artist - Flamespitter - IL" → "Flamespitter"
   *   "Hale."                 → "Hale"
   */
  _deriveGroupFolder(artistName) {
    let base = artistName;
    // Strip 5-6 digit training step: -000042, -000019
    base = base.replace(/-\d{5,6}(\s.*)?$/, (_, rest) => (rest || '')).trim();
    // Strip version suffix: v2, v3, v1.1
    base = base.replace(/[\s_-]*v\d+(\.\d+)?$/i, '').trim();
    // Strip leading artist/style prefix: "Artist - ", "Style - "
    base = base.replace(/^(?:Artist|Style)\s*[-_]\s*/i, '').trim();
    // Strip trailing quality tag: - IL, - XL, - SDXL
    base = base.replace(/\s*[-_]\s*(?:IL|XL|SDXL)$/i, '').trim();
    // Strip trailing dot(s)
    base = base.replace(/\.+$/, '').trim();
    return base || artistName;
  }

  // ─── File Organization ────────────────────────────────────────────────────

  async _organize(operations, outputPath, mode = 'copy') {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: false, message: 'No operations provided' };
    }

    if (!outputPath || typeof outputPath !== 'string') {
      return { success: false, message: 'Invalid output path' };
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const op of operations) {
      try {
                const { artistFolder, subFolder } = op;
        const filePath = requireFile(op.filePath, SUPPORTED_EXTENSIONS, 'image');

        // Sanitize artist folder name — prevent path traversal
        const safeArtist = String(artistFolder || 'unknown')
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
          .replace(/\.\./g, '_')
          .replace(/^\.+/, '')
          .trim() || 'unknown';

        // Sanitize and preserve any existing subfolder structure beneath the artist
        // e.g. source was root/batch_01/img.png with artist "alice" ->
        //       output/alice/batch_01/img.png
        const rawSubSegs = subFolder
          ? subFolder
              .split(/[\\/]/)
              .map(seg => seg.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.\./g, '_').replace(/^\.+/, '').trim())
              .filter(Boolean)
          : [];

        // Derive a group/parent folder (strips step numbers, version tags, etc.)
        const rawGroup = this._deriveGroupFolder(safeArtist);
        const safeGroup = rawGroup
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
          .replace(/\.\./g, '_')
          .replace(/^\.+/, '')
          .replace(/[. ]+$/, '') // trailing dots/spaces are invalid on Windows
          .trim() || safeArtist;

        // Strip any leading subFolder segments that are duplicates of the group or artist
        // folders — prevents triple-nesting when re-organizing already-organized folders.
        // e.g. subFolder="Flamespitter/batch01" with artist="Flamespitter" -> "batch01"
        //      subFolder="Flamespitter/Flamespitter" with group="Flamespitter" -> ""
        const normalise = s => s.toLowerCase().replace(/[_\s]/g, '');
        const groupN  = normalise(safeGroup);
        const artistN = normalise(safeArtist);
        while (
          rawSubSegs.length > 0 &&
          (normalise(rawSubSegs[0]) === groupN || normalise(rawSubSegs[0]) === artistN)
        ) {
          rawSubSegs.shift();
        }
        const safeSubFolder = rawSubSegs.join(path.sep);

        const destDir = safeSubFolder
          ? path.join(outputPath, safeGroup, safeArtist, safeSubFolder)
          : path.join(outputPath, safeGroup, safeArtist);

        await fs.mkdir(destDir, { recursive: true });

        const destFile = path.join(destDir, path.basename(filePath));

        if (mode === 'move') {
          // Try atomic rename first; fall back to copy+delete for cross-device
          try {
            await fs.rename(filePath, destFile);
          } catch {
            await fs.copyFile(filePath, destFile);
            await fs.unlink(filePath);
          }
        } else {
          await fs.copyFile(filePath, destFile);
        }

        results.push({ filePath, destFile, success: true });
        successCount++;
      } catch (error) {
        results.push({ filePath: op.filePath, success: false, message: error.message });
        failCount++;
      }
    }

    return {
      success: true,
      successCount,
      failCount,
      results,
      message: `${successCount} file(s) ${mode === 'move' ? 'moved' : 'copied'}${failCount > 0 ? `, ${failCount} failed` : ''}`
    };
  }
}

module.exports = ImageOrganizerIPC;
