/**
 * ONNX upscale worker. Runs in an Electron utility process so that model
 * loading (several seconds for transformer models) and inference never block
 * the main process, and a native crash cannot take the app down with it.
 *
 * Protocol (process.parentPort):
 *   in:  { id, type: 'upscale', modelPath, inputPath, outputPath, format, scale, modelScale, tileSize, deviceId }
 *   out: { id, type: 'progress', percent }
 *        { id, type: 'done', width, height, provider }
 *        { id, type: 'error', message }
 */
const ort = require('onnxruntime-node');
const sharp = require('sharp');

const DEFAULT_TILE = 256;
const MIN_TILE = 64;
const MAX_TILE = 1024;
// Context given to the model on every side of a tile and then discarded, so
// neighbouring tiles agree with each other where they meet.
const TILE_PAD = 16;

let cached = null; // { key, session, provider }
let queue = Promise.resolve();

async function getSession(modelPath, deviceId) {
  const key = `${modelPath}|${deviceId}`;
  if (cached && cached.key === key) return cached;

  if (cached) {
    try { await cached.session.release(); } catch { /* already released */ }
    cached = null;
  }

  const attempts = process.platform === 'win32'
    ? [['dml', [{ name: 'dml', deviceId }, 'cpu']], ['cpu', ['cpu']]]
    : [['cpu', ['cpu']]];

  let lastError;
  for (const [provider, executionProviders] of attempts) {
    try {
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders,
        // Both are required by the DirectML execution provider.
        enableMemPattern: false,
        executionMode: 'sequential',
        logSeverityLevel: 3
      });
      cached = { key, session, provider };
      return cached;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not create an ONNX Runtime session');
}

/**
 * Start offsets of fixed-size tiles covering `length`, overlapping by at
 * least 2 * TILE_PAD. The last tile is shifted back so it ends exactly on
 * the edge instead of running past it.
 */
function tileStarts(length, tile) {
  if (length <= tile) return [0];
  const step = tile - TILE_PAD * 2;
  const starts = [];
  for (let pos = 0; pos + tile < length; pos += step) starts.push(pos);
  starts.push(length - tile);
  return starts;
}

/**
 * For each tile, the [from, to) span of the source it is responsible for.
 * Boundaries sit in the middle of each overlap so every pixel comes from the
 * tile in which it has the most surrounding context.
 */
function tileSpans(starts, tile, length) {
  return starts.map((start, i) => {
    const from = i === 0 ? 0 : Math.floor((starts[i - 1] + tile + start) / 2);
    const to = i === starts.length - 1 ? length : Math.floor((start + tile + starts[i + 1]) / 2);
    return { start, from, to };
  });
}

async function upscale(job, onProgress) {
  const modelScale = job.modelScale || 4;
  const requested = Number(job.tileSize) || 0;
  const tile = requested > 0
    ? Math.max(MIN_TILE, Math.min(MAX_TILE, Math.round(requested / 16) * 16))
    : DEFAULT_TILE;

  const { session, provider } = await getSession(job.modelPath, job.deviceId || 0);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  const source = sharp(job.inputPath, { limitInputPixels: false }).rotate();
  const metadata = await source.metadata();
  const hasAlpha = Boolean(metadata.hasAlpha);

  const { data: rgb, info } = await source.clone().removeAlpha().toColourspace('srgb').raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  // Images smaller than one tile are mirrored out to tile size so every run
  // uses the same input shape; the padding is cropped off again below.
  const paddedWidth = Math.max(width, tile);
  const paddedHeight = Math.max(height, tile);
  let pixels = rgb;
  if (paddedWidth !== width || paddedHeight !== height) {
    pixels = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .extend({ right: paddedWidth - width, bottom: paddedHeight - height, extendWith: 'mirror' })
      .raw()
      .toBuffer();
  }

  const outWidth = width * modelScale;
  const outHeight = height * modelScale;
  const out = Buffer.allocUnsafe(outWidth * outHeight * 3);

  const columns = tileSpans(tileStarts(paddedWidth, tile), tile, paddedWidth);
  const rows = tileSpans(tileStarts(paddedHeight, tile), tile, paddedHeight);
  const total = columns.length * rows.length;
  const plane = tile * tile;
  const input = new Float32Array(3 * plane);
  const outTile = tile * modelScale;
  const outPlane = outTile * outTile;
  let done = 0;

  for (const row of rows) {
    for (const col of columns) {
      for (let y = 0; y < tile; y++) {
        let src = ((row.start + y) * paddedWidth + col.start) * 3;
        let dst = y * tile;
        for (let x = 0; x < tile; x++, src += 3, dst++) {
          input[dst] = pixels[src] / 255;
          input[plane + dst] = pixels[src + 1] / 255;
          input[2 * plane + dst] = pixels[src + 2] / 255;
        }
      }

      const result = await session.run({ [inputName]: new ort.Tensor('float32', input, [1, 3, tile, tile]) });
      const data = result[outputName].data;

      // Copy only this tile's own span, clipped to the real (unpadded) image.
      const y0 = row.from * modelScale;
      const y1 = Math.min(row.to * modelScale, outHeight);
      const x0 = col.from * modelScale;
      const x1 = Math.min(col.to * modelScale, outWidth);
      const offsetY = row.start * modelScale;
      const offsetX = col.start * modelScale;

      for (let y = y0; y < y1; y++) {
        let src = (y - offsetY) * outTile + (x0 - offsetX);
        let dst = (y * outWidth + x0) * 3;
        for (let x = x0; x < x1; x++, src++, dst += 3) {
          const r = data[src] * 255;
          const g = data[outPlane + src] * 255;
          const b = data[2 * outPlane + src] * 255;
          out[dst] = r < 0 ? 0 : r > 255 ? 255 : r + 0.5;
          out[dst + 1] = g < 0 ? 0 : g > 255 ? 255 : g + 0.5;
          out[dst + 2] = b < 0 ? 0 : b > 255 ? 255 : b + 0.5;
        }
      }

      done++;
      onProgress((done / total) * 95);
    }
  }

  let image = sharp(out, { raw: { width: outWidth, height: outHeight, channels: 3 }, limitInputPixels: false });

  // The models are RGB-only: transparency is resampled separately and
  // reattached so cut-out art keeps its alpha channel.
  if (hasAlpha) {
    const alpha = await sharp(job.inputPath, { limitInputPixels: false })
      .rotate()
      .extractChannel('alpha')
      .resize({ width: outWidth, height: outHeight, kernel: sharp.kernel.lanczos3 })
      .raw()
      .toBuffer();
    image = image.joinChannel(alpha, { raw: { width: outWidth, height: outHeight, channels: 1 } });
  }

  const scale = Number(job.scale) || modelScale;
  let finalWidth = outWidth;
  let finalHeight = outHeight;
  if (scale !== modelScale) {
    finalWidth = Math.round(width * scale);
    finalHeight = Math.round(height * scale);
    image = sharp(await image.png({ compressionLevel: 0 }).toBuffer(), { limitInputPixels: false })
      .resize({ width: finalWidth, height: finalHeight, kernel: sharp.kernel.lanczos3 });
  }

  if (job.format === 'jpg') image = image.flatten({ background: '#ffffff' }).jpeg({ quality: 95, mozjpeg: true });
  else if (job.format === 'webp') image = image.webp({ quality: 95 });
  else image = image.png({ compressionLevel: 6 });

  await image.toFile(job.outputPath);
  onProgress(100);

  return { width: finalWidth, height: finalHeight, provider };
}

process.parentPort.on('message', ({ data: job }) => {
  if (!job || job.type !== 'upscale') return;

  // Jobs run strictly one at a time: they share one GPU session.
  queue = queue.then(async () => {
    let lastPercent = -1;
    const onProgress = (percent) => {
      const whole = Math.floor(percent);
      if (whole === lastPercent) return;
      lastPercent = whole;
      process.parentPort.postMessage({ id: job.id, type: 'progress', percent: whole });
    };

    try {
      const result = await upscale(job, onProgress);
      process.parentPort.postMessage({ id: job.id, type: 'done', ...result });
    } catch (error) {
      process.parentPort.postMessage({ id: job.id, type: 'error', message: error?.message || String(error) });
    }
  });
});
