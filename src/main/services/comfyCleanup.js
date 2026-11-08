/**
 * Image Cleanup's repairs, run on a ComfyUI server: Flux Fill repaints a crop
 * around the mask (InpaintCropImproved / InpaintStitchImproved), the same
 * graph as the "Flux Fill Crop-Stitch" workflow. The image goes up with the
 * mask in its alpha channel, which is how LoadImage gives a mask.
 *
 * The result is never trusted outside the mask: every pixel there is copied
 * back from the original here, and saving checks it.
 *
 * Files live in a bak/cleanup folder beside the image, which dataset scans
 * skip: <name>.mask.png, the tries (<stem>.try1.png ...) and, once a try is
 * kept, the untouched original (<name>).
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { writeFileSafe } = require('../utils/safeWrite');
const { roughEdge, matchTone } = require('./bubbleMask');

const DEFAULT_MODELS = {
  unet: 'flux1-fill-dev-Q8_0.gguf',
  clip1: 'clip_l.safetensors',
  clip2: 't5xxl_fp16.safetensors',
  vae: 'ae.safetensors'
};
const DEFAULT_PROMPT = 'A seamless continuation of the surrounding artwork, matching its exact colors, lighting, texture, brushwork and linework, same art style and level of detail, clean area with nothing added.';
const REQUIRED_NODES = ['InpaintCropImproved', 'InpaintStitchImproved', 'DifferentialDiffusion', 'InpaintModelConditioning', 'FluxGuidance', 'DualCLIPLoader', 'VAELoader'];
// Tags that describe lettering, dropped from the caption when it's cleaned away.
const TEXT_TAGS = ['dialogue', 'speech bubble', 'thought bubble', 'text', 'english text'];
const WAIT_LIMIT = 15 * 60 * 1000;
const POLL_DELAY = 1000;
// Sampler previews are passed on at most this often (ms).
const PREVIEW_DELAY = 400;
// How rough the mask's edge is (px): see roughEdge.
const DEFAULT_EDGE = 16;

const cleanupDir = (filePath) => path.join(path.dirname(filePath), 'bak', 'cleanup');
const stemOf = (filePath) => path.parse(filePath).name;
const maskPath = (filePath) => path.join(cleanupDir(filePath), `${path.basename(filePath)}.mask.png`);
const originalPath = (filePath) => path.join(cleanupDir(filePath), path.basename(filePath));
const tryPath = (filePath, n) => path.join(cleanupDir(filePath), `${stemOf(filePath)}.try${n}.png`);
// The mask a try was made with, rough edge included.
const tryMaskPath = (filePath, n) => path.join(cleanupDir(filePath), `${stemOf(filePath)}.try${n}.mask.png`);

const unetNode = (name) => (/\.gguf$/i.test(name)
  ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: name } }
  : { class_type: 'UNETLoader', inputs: { unet_name: name, weight_dtype: 'default' } });

/** The workflow in ComfyUI's API format (node ids follow the original workflow). */
function buildGraph({ image, prompt = DEFAULT_PROMPT, seed, models = DEFAULT_MODELS, steps = 20, guidance = 30 }) {
  const m = { ...DEFAULT_MODELS, ...models };
  return {
    1: { class_type: 'LoadImage', inputs: { image } },
    17: unetNode(m.unet),
    18: { class_type: 'DualCLIPLoader', inputs: { clip_name1: m.clip1, clip_name2: m.clip2, type: 'flux', device: 'default' } },
    19: { class_type: 'VAELoader', inputs: { vae_name: m.vae } },
    3: { class_type: 'CLIPTextEncode', inputs: { clip: ['18', 0], text: prompt || DEFAULT_PROMPT } },
    20: { class_type: 'FluxGuidance', inputs: { conditioning: ['3', 0], guidance } },
    // CFG 1 ignores the negative, so it's zeroed as in the workflow.
    21: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['3', 0] } },
    5: {
      class_type: 'InpaintCropImproved',
      inputs: {
        image: ['1', 0],
        mask: ['1', 1],
        downscale_algorithm: 'bilinear',
        upscale_algorithm: 'bicubic',
        preresize: false,
        preresize_mode: 'ensure minimum resolution',
        preresize_min_width: 1024,
        preresize_min_height: 1024,
        preresize_max_width: 16384,
        preresize_max_height: 16384,
        mask_fill_holes: false,
        mask_expand_pixels: 0,
        mask_invert: false,
        mask_blend_pixels: 8,
        mask_hipass_filter: 0.1,
        extend_for_outpainting: false,
        extend_up_factor: 1,
        extend_down_factor: 1,
        extend_left_factor: 1,
        extend_right_factor: 1,
        context_from_mask_extend_factor: 4,
        output_resize_to_target_size: true,
        output_target_width: 1024,
        output_target_height: 1024,
        output_padding: '32',
        device_mode: 'cpu (compatible)'
      }
    },
    6: { class_type: 'InpaintModelConditioning', inputs: { positive: ['20', 0], negative: ['21', 0], vae: ['19', 0], pixels: ['5', 1], mask: ['5', 2], noise_mask: true } },
    7: { class_type: 'DifferentialDiffusion', inputs: { model: ['17', 0], strength: 1 } },
    8: { class_type: 'KSampler', inputs: { model: ['7', 0], seed, steps, cfg: 1, sampler_name: 'euler', scheduler: 'normal', positive: ['6', 0], negative: ['6', 1], latent_image: ['6', 2], denoise: 1 } },
    9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['19', 0] } },
    10: { class_type: 'InpaintStitchImproved', inputs: { stitcher: ['5', 0], inpainted_image: ['9', 0] } },
    11: { class_type: 'PreviewImage', inputs: { images: ['10', 0] } }
  };
}

/** A caption without the lettering tags, in its original order. */
function removeTextTags(text) {
  const tags = text.split(',').map(tag => tag.trim()).filter(Boolean);
  const kept = tags.filter(tag => !TEXT_TAGS.includes(tag.toLowerCase().replace(/_/g, ' ')));
  return { text: kept.join(', '), removed: tags.filter(tag => !kept.includes(tag)) };
}

function serverUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error('Invalid ComfyUI address');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid ComfyUI address');
  return parsed.origin;
}

async function request(base, route, { method = 'GET', body, json = true, signal, timeout = 30000 } = {}) {
  const signals = [AbortSignal.timeout(timeout), signal].filter(Boolean);
  let res;
  try {
    res = await fetch(`${base}${route}`, { method, body, signal: AbortSignal.any(signals) });
  } catch (error) {
    if (signal?.aborted) throw new Error('Stopped');
    throw new Error(`ComfyUI didn't answer at ${base} (${error.cause?.code || error.name})`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error?.message || '';
      const nodeErrors = Object.values(data?.node_errors || {}).flatMap(node => node.errors || []).map(error => error.details || error.message);
      if (nodeErrors.length) detail += `: ${nodeErrors.join('; ')}`;
    } catch {
      // not JSON
    }
    throw new Error(`ComfyUI ${route.split('?')[0]} failed (${res.status})${detail ? ` - ${detail}` : ''}`);
  }
  return json ? res.json() : Buffer.from(await res.arrayBuffer());
}

/** A websocket message: JSON, or a binary sampler preview. */
function parseMessage(data) {
  if (typeof data === 'string') return JSON.parse(data);
  const bytes = Buffer.from(data);
  const event = bytes.readUInt32BE(0);
  if (event === 1) {
    return { type: 'preview', data: { mime: bytes.readUInt32BE(4) === 2 ? 'image/png' : 'image/jpeg', image: bytes.subarray(8) } };
  }
  if (event === 4) { // a preview with its prompt id, from newer servers
    const length = bytes.readUInt32BE(4);
    const meta = JSON.parse(bytes.subarray(8, 8 + length).toString());
    return { type: 'preview', data: { mime: meta.image_type || 'image/jpeg', image: bytes.subarray(8 + length), prompt_id: meta.prompt_id } };
  }
  return { type: 'unknown' };
}

/**
 * Listens on ComfyUI's websocket for one client's messages; resolves once
 * connected, or after a short wait. Finishing is still read from /history,
 * so a socket that won't connect only costs the progress.
 */
async function listen(base, onMessage) {
  const clientId = crypto.randomUUID();
  let socket;
  try {
    socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
  } catch {
    return { clientId, close() {} };
  }
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (event) => {
    try {
      onMessage(parseMessage(event.data));
    } catch {
      // not a message we read
    }
  });
  socket.addEventListener('error', () => {});
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    const done = () => { clearTimeout(timer); resolve(); };
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('close', done, { once: true });
  });
  return { clientId, close: () => socket.close() };
}

/** Whether the server is up and has the nodes and models the graph needs. */
async function checkServer(url, models = DEFAULT_MODELS) {
  const base = serverUrl(url);
  const m = { ...DEFAULT_MODELS, ...models };
  await request(base, '/system_stats', { timeout: 6000 });
  const problems = [];
  const unet = unetNode(m.unet).class_type;
  const options = async (node, input) => {
    const info = (await request(base, `/object_info/${node}`, { timeout: 10000 }))[node];
    if (!info) return null;
    const spec = info.input?.required?.[input];
    return Array.isArray(spec?.[0]) ? spec[0] : [];
  };
  for (const node of [...REQUIRED_NODES, unet]) {
    if (!(await request(base, `/object_info/${node}`, { timeout: 10000 }))[node]) problems.push(`missing node ${node}`);
  }
  const checks = [[unet, 'unet_name', m.unet], ['DualCLIPLoader', 'clip_name1', m.clip1], ['DualCLIPLoader', 'clip_name2', m.clip2], ['VAELoader', 'vae_name', m.vae]];
  for (const [node, input, name] of checks) {
    const list = await options(node, input);
    if (list && !list.includes(name)) problems.push(`missing model ${name}`);
  }
  return { ok: problems.length === 0, problems };
}

/** The image's pixels as shown (EXIF rotation applied), RGBA. */
async function readPixels(filePath) {
  const { data, info } = await sharp(filePath, { limitInputPixels: false }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function readMask(file, width, height) {
  const { data, info } = await sharp(await fs.readFile(file)).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error('The saved mask is for a different image size');
  return data;
}

/**
 * Up to `attempts` repairs with different seeds, each kept as a try in
 * bak/cleanup with everything outside the mask copied from the original.
 */
async function repair({ url, filePath, attempts = 3, prompt, models, edge = DEFAULT_EDGE, signal, onProgress }) {
  const base = serverUrl(url);
  const pixels = await readPixels(filePath);
  const { width, height } = pixels;
  const mask = await readMask(maskPath(filePath), width, height);
  if (!mask.some(v => v > 127)) throw new Error('Nothing is marked on this image');

  // The upload: original colours, transparent as far as the try's mask goes
  // (LoadImage's mask is 1 - alpha, so the fade carries through).
  const uploadName = `piper-cleanup-${crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 12)}.png`;
  const uploadImage = async (soft) => {
    const upload = Buffer.from(pixels.data);
    for (let i = 0; i < soft.length; i++) upload[i * 4 + 3] = 255 - soft[i];
    const form = new FormData();
    form.append('image', new Blob([await sharp(upload, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 3 }).toBuffer()], { type: 'image/png' }), uploadName);
    form.append('overwrite', 'true');
    const uploaded = await request(base, '/upload/image', { method: 'POST', body: form, signal, timeout: 120000 });
    return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
  };

  await fs.mkdir(cleanupDir(filePath), { recursive: true });
  const tries = [];
  // What the current try is up to, from ComfyUI's websocket: step counts
  // from the sampler (node 8) and its previews, when the server makes them.
  let current = null;
  let lastPreview = 0;
  const socket = await listen(base, ({ type, data }) => {
    if (!current || !data || (data.prompt_id && data.prompt_id !== current.promptId)) return;
    const { n } = current;
    if (type === 'progress' && (data.node == null || String(data.node) === '8')) {
      current.sampling = true;
      onProgress?.({ attempt: n, attempts, stage: 'sampling', step: data.value, steps: data.max });
    } else if (type === 'executing' && data.node && !current.running) {
      current.running = true;
      onProgress?.({ attempt: n, attempts, stage: 'running' });
    } else if (type === 'preview' && current.sampling && Date.now() - lastPreview > PREVIEW_DELAY) {
      lastPreview = Date.now();
      onProgress?.({ attempt: n, attempts, stage: 'preview', preview: data.image, previewType: data.mime });
    }
  });
  try {
    for (let n = 1; n <= attempts; n++) {
      if (signal?.aborted) throw new Error('Stopped');
      onProgress?.({ attempt: n, attempts, stage: 'queued' });
      // Each try gets its own rough edge, kept beside it for the check on keeping.
      const soft = roughEdge(mask, width, height, { edge, seed: crypto.randomInt(1, 2 ** 31) });
      const image = await uploadImage(soft);
      const graph = buildGraph({ image, prompt, models, seed: crypto.randomInt(0, 2 ** 47) });
      const { prompt_id: promptId } = await request(base, '/prompt', {
        method: 'POST',
        // taesd falls back to a rough colour preview when the server lacks its decoder.
        body: JSON.stringify({ prompt: graph, client_id: socket.clientId, extra_data: { preview_method: 'taesd' } }),
        signal
      });
      current = { n, promptId };

      let output = null;
      const started = Date.now();
      try {
        while (!output) {
          if (Date.now() - started > WAIT_LIMIT) throw new Error('ComfyUI took too long');
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, POLL_DELAY);
            signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Stopped')); }, { once: true });
          });
          const history = (await request(base, `/history/${promptId}`, { signal }))[promptId];
          if (!history) continue;
          if (history.status?.status_str === 'error') {
            const failure = (history.status.messages || []).find(([kind]) => kind === 'execution_error')?.[1];
            throw new Error(`ComfyUI failed${failure ? `: ${failure.node_type} - ${failure.exception_message}` : ''}`);
          }
          if (history.status?.completed) output = history.outputs?.[11]?.images?.[0] || history.outputs?.['11']?.images?.[0];
          if (history.status?.completed && !output) throw new Error('ComfyUI returned no image');
        }
      } catch (error) {
        if (signal?.aborted) {
          await request(base, '/queue', { method: 'POST', body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
          await request(base, '/interrupt', { method: 'POST' }).catch(() => {});
        }
        throw error;
      }

      const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: output.type || 'temp' });
      const stitched = await sharp(await request(base, `/view?${query}`, { json: false, timeout: 120000 }))
        .resize(width, height, { fit: 'fill' }) // stitched back at full size; a no-op normally
        .removeAlpha().raw().toBuffer();
      const result = matchTone(pixels.data, stitched, mask, soft, width, height);

      // Blended in through the try's mask: fully inside it, fading over its edge.
      const merged = Buffer.from(pixels.data);
      for (let i = 0; i < soft.length; i++) {
        const a = soft[i];
        if (!a) continue;
        for (let c = 0; c < 3; c++) {
          merged[i * 4 + c] = Math.round(pixels.data[i * 4 + c] + ((result[i * 3 + c] - pixels.data[i * 4 + c]) * a) / 255);
        }
      }
      const out = tryPath(filePath, n);
      await writeFileSafe(tryMaskPath(filePath, n), await sharp(soft, { raw: { width, height, channels: 1 } }).png().toBuffer());
      await writeFileSafe(out, await sharp(merged, { raw: { width, height, channels: 4 } }).png().toBuffer());
      tries.push(out);
      onProgress?.({ attempt: n, attempts, stage: 'done', tryFile: out });
    }
  } finally {
    socket.close();
  }
  return tries;
}

/** The tries and mask already in bak/cleanup for an image, and whether it was cleaned before. */
async function imageState(filePath) {
  const exists = (file) => fs.access(file).then(() => true, () => false);
  const tries = [];
  for (let n = 1; n <= 9; n++) if (await exists(tryPath(filePath, n))) tries.push(tryPath(filePath, n));
  return { hasMask: await exists(maskPath(filePath)), tries, cleaned: await exists(originalPath(filePath)) };
}

async function discardTries(filePath) {
  for (let n = 1; n <= 9; n++) {
    await fs.rm(tryPath(filePath, n), { force: true });
    await fs.rm(tryMaskPath(filePath, n), { force: true });
  }
}

/**
 * Replaces the image with a try. The first original is kept in bak/cleanup;
 * PNG and WebP are saved losslessly and checked to match the original
 * outside the mask, JPG at quality 95 (which changes it slightly everywhere).
 */
async function keepTry({ filePath, tryFile, removeTags = false }) {
  if (path.dirname(tryFile) !== cleanupDir(filePath) || !path.basename(tryFile).startsWith(`${stemOf(filePath)}.try`)) throw new Error('Not a try for this image');
  const before = await readPixels(filePath);
  // The try's own mask reaches past what was marked (its rough edge); older
  // tries have none and were made with the marked mask alone.
  const tryMask = tryFile.replace(/\.png$/i, '.mask.png');
  const mask = await readMask(tryMask, before.width, before.height).catch(() => readMask(maskPath(filePath), before.width, before.height));
  const chosen = sharp(tryFile).ensureAlpha();

  const ext = path.extname(filePath).toLowerCase();
  let encoded;
  if (ext === '.png') encoded = await chosen.png().toBuffer();
  else if (ext === '.webp') encoded = await chosen.webp({ lossless: true }).toBuffer();
  else if (ext === '.jpg' || ext === '.jpeg') encoded = await chosen.flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  else throw new Error(`Can't save ${ext} images; convert to PNG first`);

  try {
    await fs.access(originalPath(filePath));
  } catch {
    await fs.copyFile(filePath, originalPath(filePath));
  }
  await writeFileSafe(filePath, encoded);

  const after = await readPixels(filePath);
  let changedOutside = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    const p = i * 4;
    if (before.data[p] !== after.data[p] || before.data[p + 1] !== after.data[p + 1] || before.data[p + 2] !== after.data[p + 2]) changedOutside++;
  }

  let removed = [];
  if (removeTags) {
    const caption = path.join(path.dirname(filePath), `${stemOf(filePath)}.txt`);
    try {
      const result = removeTextTags(await fs.readFile(caption, 'utf8'));
      if (result.removed.length) await writeFileSafe(caption, result.text, { backup: true });
      removed = result.removed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  await discardTries(filePath);
  return { changedOutside, exact: changedOutside === 0, removedTags: removed };
}

module.exports = {
  DEFAULT_MODELS, DEFAULT_PROMPT, DEFAULT_EDGE, TEXT_TAGS,
  buildGraph, removeTextTags, checkServer, repair, imageState, discardTries, keepTry,
  cleanupDir, maskPath, originalPath, tryPath, tryMaskPath
};
