const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const OnnxUpscaleService = require('../services/OnnxUpscaleService');
const { modelFolders } = require('../utils/modelPaths');

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp']);
// Display names and one-line guidance for models we know about. Anything
// else dropped into the models folder still works and gets a generated name.
const MODEL_INFO = {
  'ultrasharp-v2-4x': { name: 'UltraSharp V2 4x', note: 'Best quality for illustration, slower' },
  'ultrasharp-v2-lite-4x': { name: 'UltraSharp V2 Lite 4x', note: 'Near V2 quality, much faster' },
  'remacri-4x': { name: 'Remacri 4x', note: 'General, soft detail' },
  'ultrasharp-4x': { name: 'UltraSharp 4x', note: 'Sharp edges' },
  'ultramix-balanced-4x': { name: 'UltraMix Balanced 4x', note: 'Balanced' },
  'high-fidelity-4x': { name: 'High Fidelity 4x', note: 'Detailed' },
  'digital-art-4x': { name: 'Digital Art 4x', note: 'Flat illustration, fast' },
  'upscayl-standard-4x': { name: 'Upscayl Standard 4x', note: 'General' },
  'upscayl-lite-4x': { name: 'Upscayl Lite 4x', note: 'Fastest' }
};
// First available entry wins as the default model.
const DEFAULT_MODEL_ORDER = ['ultrasharp-v2-4x', 'ultrasharp-v2-lite-4x', 'remacri-4x'];
const FORMAT_IDS = new Set(['png', 'jpg', 'webp']);
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const PROGRESS_PATTERN = /(\d+(?:\.\d+)?)\s*%/g;

function getPlatformResourceName() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

// Resolves the project root regardless of the process's current working
// directory (which can be unreliable, e.g. Windows may launch a GUI app with
// cwd set to System32). This file lives at <root>/src/main/ipc/, so walking
// up three levels reaches <root> in dev/unpacked runs.
function getAppRoot() {
  return path.join(__dirname, '..', '..', '..');
}

class ImageUpscalerIPC {
  constructor() {
    this.onnx = new OnnxUpscaleService();
    this._setupHandlers();
    console.log('🔗 Image Upscaler IPC handlers registered');
  }

  _setupHandlers() {
    ipcMain.handle('image-upscaler:status', async () => {
      try {
        return { success: true, ...await this._getBackendStatus() };
      } catch (error) {
        console.error('❌ Upscaler status error:', error);
        return { success: false, message: error.message, upscaylAvailable: false, sharpAvailable: this._hasSharp() };
      }
    });

    ipcMain.handle('image-upscaler:upscale', async (event, filePath, options = {}) => {
      const onProgress = (percent) => {
        try {
          if (!event.sender.isDestroyed()) event.sender.send('image-upscaler:progress', { filePath, percent });
        } catch { /* renderer may have navigated away */ }
      };

      try {
        return await this._upscale(filePath, options, onProgress);
      } catch (error) {
        console.error('❌ Upscale error:', error);
        return { success: false, message: error.message || 'Upscale failed' };
      }
    });

    ipcMain.handle('image-upscaler:upscale-all-models', async (event, filePath, options = {}) => {
      const onProgress = (payload) => {
        try {
          if (!event.sender.isDestroyed()) event.sender.send('image-upscaler:model-progress', { filePath, ...payload });
        } catch { /* renderer may have navigated away */ }
      };

      try {
        return await this._upscaleAllModels(filePath, options, onProgress);
      } catch (error) {
        console.error('❌ Compare-all-models error:', error);
        return { success: false, message: error.message || 'Failed to run all models' };
      }
    });
  }

  async _getBackendStatus() {
    const binaryPath = await this._findUpscaylBinary();
    const modelsPaths = await this._findModelsPaths();
    const modelsPath = modelsPaths[0] || null;
    const models = await this._scanAllModels(modelsPaths);
    const sharpAvailable = this._hasSharp();
    const onnxRuntime = this.onnx.isAvailable();
    // A model is only offered if the engine that runs it is actually present.
    const usable = models.filter(model => (model.engine === 'onnx' ? onnxRuntime : Boolean(binaryPath)));
    const upscaylAvailable = usable.some(model => model.engine === 'ncnn');
    const onnxAvailable = usable.some(model => model.engine === 'onnx');
    const missing = [];

    if (!binaryPath) missing.push('upscayl-bin.exe');
    if (!modelsPath) missing.push('models folder');
    if (modelsPath && models.length === 0) missing.push('model files');

    const engines = [onnxAvailable ? 'ONNX' : null, upscaylAvailable ? 'NCNN' : null].filter(Boolean);
    const defaultModel = DEFAULT_MODEL_ORDER.find(id => usable.some(model => model.id === id)) || usable[0]?.id || null;

    return {
      upscaylAvailable,
      onnxAvailable,
      aiAvailable: usable.length > 0,
      sharpAvailable,
      binaryPath,
      modelsPath,
      models: usable,
      missing,
      defaultModel,
      message: engines.length > 0
        ? `${usable.length} models ready (${engines.join(' + ')})`
        : `Sharp fallback active: missing ${missing.join(', ')}`
    };
  }

  async _upscale(filePath, options, onProgress = null) {
    this._validateFilePath(filePath);
    await fs.access(filePath);

    const backend = await this._getBackendStatus();
    const requestedModel = typeof options.model === 'string' ? options.model.trim() : '';
    const modelEntry = backend.models.find(entry => entry.id === requestedModel)
      || backend.models.find(entry => entry.id === backend.defaultModel)
      || null;
    const model = modelEntry ? modelEntry.id : requestedModel;
    const scale = [2, 3, 4].includes(Number(options.scale)) ? Number(options.scale) : 4;
    const format = FORMAT_IDS.has(options.format) ? options.format : 'png';
    const tileSize = Math.max(0, Math.min(1024, Number(options.tileSize) || 0));
    const gpuId = typeof options.gpuId === 'string' ? options.gpuId.trim() : '';
    const compression = typeof options.compression === 'string' ? options.compression : '0';

    const outputFormat = this._getReplacementFormat(filePath, format);
    const outputPath = this._getReplacementOutputPath(filePath, outputFormat);
    const tempOutputPath = await this._getTemporaryOutputPath(filePath, outputFormat);

    try {
      if (modelEntry) {
        await this._runModel(modelEntry, backend, {
          inputPath: filePath,
          outputPath: tempOutputPath,
          scale,
          format: outputFormat,
          tileSize,
          gpuId,
          compression,
          onProgress
        });
        const dimensions = await this._readDimensions(tempOutputPath);
        const bakPath = await this._replaceOriginalWithUpscaled(filePath, tempOutputPath, outputPath);
        return { success: true, outputPath, bakPath, engine: modelEntry.engine, model, scale, format: outputFormat, replaced: true, ...dimensions };
      }

      await this._runSharpFallback(filePath, tempOutputPath, scale, outputFormat);
      const dimensions = await this._readDimensions(tempOutputPath);
      const bakPath = await this._replaceOriginalWithUpscaled(filePath, tempOutputPath, outputPath);
      return { success: true, outputPath, bakPath, engine: 'sharp', model: 'sharp-lanczos3', requestedModel: model, scale, format: outputFormat, message: backend.message, replaced: true, ...dimensions };
    } finally {
      await this._removeIfExists(tempOutputPath);
    }
  }

  /**
   * Runs one model with whichever engine it belongs to: ONNX Runtime for
   * .onnx models, the Upscayl NCNN binary for .param/.bin pairs.
   */
  async _runModel(modelEntry, backend, { inputPath, outputPath, scale, format, tileSize, gpuId, compression, onProgress }) {
    if (modelEntry.engine === 'onnx') {
      await this.onnx.upscale({
        modelPath: modelEntry.modelPath,
        inputPath,
        outputPath,
        format,
        scale,
        modelScale: Number(this._getModelScale(modelEntry.id)),
        tileSize,
        deviceId: /^[0-9]+$/.test(gpuId) ? Number(gpuId) : 0
      }, onProgress);
      return;
    }

    await this._runUpscayl({
      binaryPath: backend.binaryPath,
      modelsPath: modelEntry.modelsPath || backend.modelsPath,
      inputPath,
      outputPath,
      model: modelEntry.id,
      scale,
      format,
      tileSize,
      gpuId,
      compression,
      onProgress
    });
  }

  async _readDimensions(filePath) {
    try {
      const metadata = await require('sharp')(filePath, { limitInputPixels: false }).metadata();
      return metadata.width && metadata.height ? { width: metadata.width, height: metadata.height } : {};
    } catch {
      return {};
    }
  }

  /**
   * Runs every locally available model against a single image so the
   * results can be compared side by side. Unlike `_upscale`, this never
   * touches the original file - each model's output is written to its own
   * `<name>_<model>.<ext>` file next to the source image, and re-running the
   * comparison simply overwrites those scratch files.
   */
  async _upscaleAllModels(filePath, options, onProgress = null) {
    this._validateFilePath(filePath);
    await fs.access(filePath);

    const backend = await this._getBackendStatus();
    if (backend.models.length === 0) {
      throw new Error('No local upscale models available to compare');
    }

    const format = FORMAT_IDS.has(options.format) ? options.format : 'png';
    const tileSize = Math.max(0, Math.min(1024, Number(options.tileSize) || 0));
    const gpuId = typeof options.gpuId === 'string' ? options.gpuId.trim() : '';
    const compression = typeof options.compression === 'string' ? options.compression : '0';
    const outputFormat = this._getReplacementFormat(filePath, format);

    const models = backend.models;
    const total = models.length;
    const results = [];
    const errors = [];

    for (let index = 0; index < total; index++) {
      const model = models[index];
      const scale = Number(this._getModelScale(model.id));
      const outputPath = this._getComparisonOutputPath(filePath, model.id, outputFormat);

      try {
        await this._runModel(model, backend, {
          inputPath: filePath,
          outputPath,
          scale,
          format: outputFormat,
          tileSize,
          gpuId,
          compression,
          onProgress: (percent) => {
            if (onProgress) onProgress({ index, total, modelId: model.id, modelName: model.name, percent });
          }
        });
        results.push({ modelId: model.id, modelName: model.name, outputPath, scale });
      } catch (error) {
        console.error(`❌ Model "${model.id}" failed during comparison run:`, error);
        errors.push({ modelId: model.id, modelName: model.name, message: error.message || 'Upscale failed' });
      }
    }

    return { success: true, sourcePath: filePath, results, errors };
  }

  _getComparisonOutputPath(inputPath, modelId, format) {
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const safeModelId = modelId.replace(/[^a-z0-9._-]/gi, '-');
    return path.join(dir, `${base}_${safeModelId}.${format}`);
  }

  _validateFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path');
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error('Unsupported file type');
    }
  }

  async _runUpscayl({ binaryPath, modelsPath, inputPath, outputPath, model, scale, format, tileSize, gpuId, compression, onProgress }) {
    // Passing -z explicitly (rather than relying on the binary's own default
    // of 4) keeps tiling/blending correct if a non-4x model is ever added.
    const modelScale = this._getModelScale(model);
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-m', modelsPath,
      '-n', model,
      '-f', format,
      '-c', compression,
      '-z', modelScale
    ];

    if (modelScale !== String(scale)) args.push('-s', String(scale));
    if (tileSize > 0) args.push('-t', String(tileSize));
    if (gpuId) args.push('-g', gpuId);

    await new Promise((resolve, reject) => {
      const child = spawn(binaryPath, args, { windowsHide: true });
      let stderrTail = '';
      let lastPercentSent = -1;

      const handleOutput = (chunk) => {
        const text = chunk.toString('utf8');
        stderrTail += text;
        if (stderrTail.length > 8000) stderrTail = stderrTail.slice(-8000);

        if (!onProgress) return;
        // A single data event can contain several buffered progress lines
        // (e.g. "12.50%\n14.58%\n..."), so use the last/highest one seen.
        const matches = [...text.matchAll(PROGRESS_PATTERN)];
        if (matches.length === 0) return;
        const percent = Math.max(0, Math.min(100, parseFloat(matches[matches.length - 1][1])));
        // Only forward whole-percentage changes to avoid flooding IPC.
        if (Math.floor(percent) !== lastPercentSent) {
          lastPercentSent = Math.floor(percent);
          onProgress(percent);
        }
      };

      child.stdout.on('data', handleOutput);
      child.stderr.on('data', handleOutput);

      child.on('error', (error) => {
        reject(new Error(`Upscayl failed to start: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Upscayl failed (exit ${code}): ${stderrTail.trim() || 'unknown error'}`));
          return;
        }
        if (onProgress) onProgress(100);
        resolve();
      });
    });
  }

  async _runSharpFallback(inputPath, outputPath, scale, format) {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      throw new Error('Neither Upscayl NCNN nor sharp is available');
    }

    const metadata = await sharp(inputPath).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions');
    }

    let pipeline = sharp(inputPath)
      .resize({
        width: metadata.width * scale,
        height: metadata.height * scale,
        kernel: sharp.kernel.lanczos3
      });

    if (format === 'jpg') {
      pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ quality: 95 });
    } else {
      pipeline = pipeline.png({ compressionLevel: 6 });
    }

    await pipeline.toFile(outputPath);
  }

  _getReplacementFormat(inputPath, requestedFormat) {
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'jpg';
    if (ext === '.png') return 'png';
    if (ext === '.webp') return 'webp';
    return requestedFormat;
  }

  _getReplacementOutputPath(inputPath, format) {
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const ext = path.extname(inputPath).toLowerCase();
    const currentFormat = ext === '.jpeg' ? 'jpg' : ext.replace('.', '');

    if (currentFormat === format) return inputPath;

    return path.join(dir, `${base}.${format}`);
  }

  async _getTemporaryOutputPath(inputPath, format) {
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath)).replace(/[^a-z0-9._-]/gi, '-');
    let candidate = path.join(dir, `.piper-upscale-${base}-${Date.now()}.${format}`);
    let counter = 2;

    while (await this._exists(candidate)) {
      candidate = path.join(dir, `.piper-upscale-${base}-${Date.now()}-${counter}.${format}`);
      counter++;
    }

    return candidate;
  }

  async _replaceOriginalWithUpscaled(inputPath, tempOutputPath, outputPath) {
    if (outputPath !== inputPath && await this._exists(outputPath)) {
      throw new Error(`Output file already exists: ${outputPath}`);
    }

    const dir = path.dirname(inputPath);
    const bakDir = path.join(dir, 'bak');
    await fs.mkdir(bakDir, { recursive: true });

    const bakPath = await this._getAvailableBackupPath(bakDir, path.basename(inputPath));
    let backedUp = false;

    try {
      await this._moveFile(inputPath, bakPath);
      backedUp = true;
      await this._moveFile(tempOutputPath, outputPath);
      console.log(`✅ Upscaled and replaced: ${outputPath} (backup: ${bakPath})`);
      return bakPath;
    } catch (error) {
      if (backedUp && !await this._exists(inputPath)) {
        try { await this._moveFile(bakPath, inputPath); } catch { /* best effort rollback */ }
      }
      throw error;
    }
  }

  async _getAvailableBackupPath(bakDir, fileName) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let candidate = path.join(bakDir, fileName);
    let counter = 2;

    while (await this._exists(candidate)) {
      candidate = path.join(bakDir, `${base}_${counter}${ext}`);
      counter++;
    }

    return candidate;
  }

  async _moveFile(sourcePath, destinationPath) {
    try {
      await fs.rename(sourcePath, destinationPath);
    } catch {
      await fs.copyFile(sourcePath, destinationPath);
      await fs.unlink(sourcePath);
    }
  }

  async _removeIfExists(filePath) {
    try {
      await fs.unlink(filePath);
    } catch { /* file already moved or never created */ }
  }

  async _exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  _hasSharp() {
    try {
      require.resolve('sharp');
      return true;
    } catch {
      return false;
    }
  }

  _getModelScale(model) {
    const modelName = String(model || '').toLowerCase();
    if (modelName.includes('x2') || modelName.includes('2x')) return '2';
    if (modelName.includes('x3') || modelName.includes('3x')) return '3';
    return '4';
  }

  async _findUpscaylBinary() {
    const executable = process.platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
    const platformResources = getPlatformResourceName();
    const appRoot = getAppRoot();
    const candidates = [
      process.env.ANTLER_UPSCAYL_BIN,
      path.join(appRoot, 'resources', platformResources, 'bin', executable),
      path.join(appRoot, 'resources', 'bin', executable),
      path.join(process.cwd(), 'resources', platformResources, 'bin', executable),
      path.join(process.cwd(), 'resources', 'bin', executable),
      path.join(process.cwd(), 'resources', 'upscayl', 'bin', executable),
      path.join(process.cwd(), 'resources', 'upscayl', executable),
      path.join(process.cwd(), 'bin', 'upscayl', executable),
      path.join(process.cwd(), 'upscayl', executable),
      process.resourcesPath ? path.join(process.resourcesPath, platformResources, 'bin', executable) : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'bin', executable) : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'resources', platformResources, 'bin', executable) : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'upscayl', 'bin', executable) : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'upscayl', executable) : null
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fsSync.existsSync(candidate)) return candidate;
    }

    return null;
  }

  /**
   * Every folder that exists and may hold upscaler models, in priority order.
   * The bundled ncnn models live in the app's resources; ONNX models
   * downloaded from Settings > Models land in <user data>/models.
   */
  async _findModelsPaths() {
    const appRoot = getAppRoot();
    const candidates = [
      process.env.ANTLER_UPSCAYL_MODELS,
      path.join(appRoot, 'resources', 'models'),
      path.join(process.cwd(), 'resources', 'models'),
      path.join(process.cwd(), 'resources', 'upscayl', 'models'),
      path.join(process.cwd(), 'models'),
      path.join(process.cwd(), 'upscayl', 'models'),
      process.resourcesPath ? path.join(process.resourcesPath, 'models') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'models') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'upscayl', 'models') : null,
      ...modelFolders()
    ].filter(Boolean);

    const seen = new Set();
    return candidates.filter(candidate => {
      const key = path.resolve(candidate).toLowerCase();
      if (seen.has(key) || !fsSync.existsSync(candidate)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Models from every folder; when two folders have the same id, the first wins. */
  async _scanAllModels(modelsPaths) {
    const byId = new Map();
    for (const modelsPath of modelsPaths) {
      for (const model of await this._scanModels(modelsPath)) {
        if (!byId.has(model.id)) byId.set(model.id, model);
      }
    }
    return [...byId.values()].sort((a, b) => (a.engine === b.engine
      ? a.name.localeCompare(b.name)
      : a.engine === 'onnx' ? -1 : 1));
  }

  async _scanModels(modelsPath) {
    let entries;
    try {
      entries = await fs.readdir(modelsPath);
    } catch {
      return [];
    }

    const files = new Set(entries.map(entry => entry.toLowerCase()));
    const models = [];

    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (ext !== '.param' && ext !== '.onnx') continue;
      const id = path.basename(entry, path.extname(entry));
      if (!MODEL_ID_PATTERN.test(id)) continue;

      const info = MODEL_INFO[id] || {};
      const base = { id, name: info.name || this._formatModelName(id), note: info.note || '', modelsPath };

      if (ext === '.onnx') {
        models.push({ ...base, engine: 'onnx', modelPath: path.join(modelsPath, entry) });
        continue;
      }

      const hasBin = files.has(`${id.toLowerCase()}.bin`);
      if (!hasBin) continue;

      models.push({
        ...base,
        engine: 'ncnn',
        paramPath: path.join(modelsPath, `${id}.param`),
        binPath: path.join(modelsPath, `${id}.bin`)
      });
    }

    // ONNX (transformer) models first, then alphabetical within each engine.
    return models.sort((a, b) => (a.engine === b.engine
      ? a.name.localeCompare(b.name)
      : a.engine === 'onnx' ? -1 : 1));
  }

  _formatModelName(modelId) {
    return modelId
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }
}

module.exports = ImageUpscalerIPC;
