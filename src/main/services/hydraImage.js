/**
 * Image preparation for the Hydra 3.5 e621 tagger
 * (resources/models/tagger/hydra-tagger.onnx), matching Hydra's own
 * hydra/image.py open_srgb and hydra/model.py get_image_size_for_seq:
 *
 *  - EXIF rotation, sRGB, transparency flattened onto white;
 *  - resized so the image is a whole number of 16px patches, at most 1024
 *    of them, keeping the aspect ratio as near as the patches allow; small
 *    images are only trimmed down to whole patches, never enlarged;
 *  - the resize is done in linear light, through Hydra's own 8-bit sRGB to
 *    16-bit linear tables, with the mks2013 kernel.
 *
 * The result is pixel-identical to Hydra's for most images. When a large
 * original is shrunk a long way, libvips splits the shrink differently
 * (Hydra sets gap=3, which sharp doesn't expose), which moves a tag's score
 * by up to about 0.03, the same size as Hydra's own bf16/fp32 difference.
 *
 * The model takes the pixels as uint8 [H, W, 3].
 */
const sharp = require('sharp');

const PATCH = 16;
const MAX_PATCHES = 1024;

/** [height, width] in pixels, multiples of 16, for an image of the given size. */
function hydraSize(height, width, patch = PATCH, maxSeq = MAX_PATCHES) {
  const maxRatio = 1.0;
  const eps = 1e-5;
  const maxPy = Math.max(Math.floor((height * maxRatio) / patch), 1);
  const maxPx = Math.max(Math.floor((width * maxRatio) / patch), 1);
  if (maxPy * maxPx <= maxSeq) return [maxPy * patch, maxPx * patch];

  const patchify = (ratio) => [
    Math.min(Math.ceil((height * ratio) / patch), maxPy),
    Math.min(Math.ceil((width * ratio) / patch), maxPx)
  ];
  let [py, px] = patchify(eps);
  if (py * px > maxSeq) throw new Error(`Image of size ${width}x${height} is too large.`);

  // Binary search for the largest scale that still fits, as Hydra does.
  let ratio = eps;
  let high = maxRatio;
  while (high - ratio >= eps) {
    const mid = (ratio + high) / 2;
    const [my, mx] = patchify(mid);
    if (my * mx > maxSeq) {
      high = mid;
      continue;
    }
    ratio = mid;
    py = my;
    px = mx;
    if (my * mx === maxSeq) break;
  }
  return [py * patch, px * patch];
}

// Python's round(), which rounds halves to even; Hydra's tables use it.
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const TO_LINEAR = new Uint16Array(256);
for (let c = 0; c < 256; c++) {
  TO_LINEAR[c] = roundHalfEven(c <= 10 ? (c * 257) / 12.92 : Math.pow((c + 14.025) / 269.025, 2.4) * 65535);
}
const TO_SRGB = new Uint8Array(65536);
for (let c = 0; c < 65536; c++) {
  TO_SRGB[c] = roundHalfEven(c <= 205 ? c * (12.92 / 257) : Math.pow(c / 65535, 1 / 2.4) * 269.025 - 14.025);
}

/**
 * @param {string|Buffer} input - an image file or encoded image
 * @returns {Promise<{data: Buffer, height: number, width: number}>} RGB pixels, H x W x 3
 */
async function prepareHydraImage(input) {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .rotate()
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const [height, width] = hydraSize(info.height, info.width);
  if (height === info.height && width === info.width) return { data, height, width };

  const linear = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) linear[i] = TO_LINEAR[data[i]];

  // Without toColourspace('rgb16') sharp brings 16-bit data back to the
  // 8-bit range before writing it out.
  const resized = await sharp(linear, { raw: { width: info.width, height: info.height, channels: 3 } })
    .resize(width, height, { fit: 'fill', kernel: 'mks2013' })
    .toColourspace('rgb16')
    .raw({ depth: 'ushort' })
    .toBuffer();

  const wide = new Uint16Array(resized.buffer, resized.byteOffset, resized.length / 2);
  const out = Buffer.alloc(wide.length);
  for (let i = 0; i < wide.length; i++) out[i] = TO_SRGB[wide[i]];
  return { data: out, height, width };
}

module.exports = { PATCH, hydraSize, prepareHydraImage, TO_LINEAR, TO_SRGB };
