/**
 * Image fingerprints and sizes for matching the same picture across sites.
 *
 * A fingerprint is a 64-bit difference hash (dHash): the image is shrunk to
 * 9x8 grey pixels and each bit says whether a pixel is brighter than its
 * right-hand neighbour. Because the image is shrunk first, a 150px e621
 * preview and a 4000px original give (nearly) the same bits, so the number
 * of differing bits says how alike two pictures are whatever their sizes:
 * 0-4 is the same picture, around 5-12 is the same picture edited (text,
 * colours, a crop), above that they are different pictures.
 *
 * Sizes come from the first bytes of a file: image formats keep width and
 * height in their header, so a ranged request for 64 KB is enough instead of
 * downloading the whole file.
 */
const sharp = require('sharp');

const HEAD_BYTES = 64 * 1024;
const HEAD_BYTES_RETRY = 1024 * 1024; // JPEGs with big EXIF/ICC blocks put the size further in
const MAX_THUMB_BYTES = 8 * 1024 * 1024;

// Distances (differing bits out of 64).
const LOOSE = 14;          // further apart than this is not considered at all
const DEFAULT_SURE = 4;    // at or under this, with a matching shape, needs no review
const MAX_SURE = 8;        // review answers never push the automatic cut-off past this
const AGREE = 3;           // "same" answers needed before the cut-off moves out to them
const ASPECT_TOLERANCE = 0.03;
const BIGGER = 1.05;       // pixel ratio that counts as an upgrade

/** e621's image host refuses requests without an e621 Referer. */
function headersFor(url) {
  const headers = { 'User-Agent': 'Antler/1.0' };
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)e621\.net$|(^|\.)e926\.net$/.test(host)) headers.Referer = 'https://e621.net/';
    else if (/(^|\.)pawchive\.pw$/.test(host)) headers.Referer = 'https://pawchive.pw/';
    else if (/\.ib\.metapix\.net$/.test(host)) headers.Referer = 'https://inkbunny.net/';
  } catch (_) { /* invalid URL: fetch will say so */ }
  return headers;
}

/** Reads at most `limit` bytes of a response body, then stops the download. */
async function readBody(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).subarray(0, limit);
}

async function fetchBytes(url, limit, { range = false } = {}) {
  const headers = headersFor(url);
  if (range) headers.Range = `bytes=0-${limit - 1}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    const e = new Error(`HTTP ${response.status} for ${url}`);
    e.status = response.status;
    throw e;
  }
  // Content-Range: bytes 0-65535/1234567 gives the whole file's size.
  const totalFromRange = Number(response.headers.get('content-range')?.split('/')[1]) || 0;
  const totalFromLength = response.status === 200 ? Number(response.headers.get('content-length')) || 0 : 0;
  const buffer = await readBody(response, limit);
  return { buffer, fileSize: totalFromRange || totalFromLength };
}

/** 64-bit dHash of an image buffer, as 16 hex characters. */
async function dhash(buffer) {
  const pixels = await sharp(buffer, { failOn: 'none', animated: false })
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(9, 8, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/** Differing bits between two hashes from dhash(). */
function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/** Fingerprint of the image at a URL (a thumbnail or preview). */
async function fingerprintUrl(url) {
  const { buffer } = await fetchBytes(url, MAX_THUMB_BYTES);
  return dhash(buffer);
}

/** { width, height, format, fileSize } from the start of the file at `url`. */
async function imageSize(url) {
  for (const limit of [HEAD_BYTES, HEAD_BYTES_RETRY]) {
    const { buffer, fileSize } = await fetchBytes(url, limit, { range: true });
    try {
      const meta = await sharp(buffer, { failOn: 'none' }).metadata();
      if (meta.width && meta.height) {
        return { width: meta.width, height: meta.height, format: meta.format, fileSize };
      }
    } catch (_) { /* header not complete yet: try a longer read */ }
  }
  throw new Error(`Could not read the image size of ${url}`);
}

/** How far apart two aspect ratios are, as a share of the larger (0 = same shape). */
function aspectOff(a, b) {
  if (!a?.width || !a?.height || !b?.width || !b?.height) return null;
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.abs(ra - rb) / Math.max(ra, rb);
}

/**
 * The automatic cut-off, tuned by review answers. It only rises to a
 * distance where at least AGREE answers of "same" sit at or beyond it (one
 * answer is not enough: in testing a single pair 10 bits apart was the same
 * picture and another 10 bits apart was not), never past MAX_SURE, and
 * always below the closest pair ever answered "different".
 */
function sureCutoff(decisions = []) {
  const different = decisions.filter(d => d.answer === 'different').map(d => d.distance);
  const lowestDifferent = different.length ? Math.min(...different) : Infinity;
  const same = decisions
    .filter(d => d.answer === 'same' && d.distance < lowestDifferent)
    .map(d => d.distance)
    .sort((a, b) => b - a);
  const supported = same.length >= AGREE ? same[AGREE - 1] : 0;
  return Math.max(0, Math.min(Math.max(DEFAULT_SURE, supported), MAX_SURE, lowestDifferent - 1));
}

/**
 * What a candidate pair is:
 *  'upgrade'  same picture, larger on Pawchive
 *  'same'     same picture, not larger
 *  'variant'  answered as an edit of the same picture
 *  'ask'      close, but needs a look
 *  null       not a match
 */
function classify({ distance, original, candidate, answer = null }, cutoff = DEFAULT_SURE) {
  if (answer === 'different' || distance > LOOSE) return null;
  const off = aspectOff(original, candidate);
  const ratio = original?.width && candidate?.width
    ? (candidate.width * candidate.height) / (original.width * original.height)
    : null;
  const bigger = ratio != null && ratio >= BIGGER;
  if (answer === 'variant') return 'variant';
  if (answer === 'same') return bigger ? 'upgrade' : 'same';
  if (distance <= cutoff && (off == null || off <= ASPECT_TOLERANCE)) return bigger ? 'upgrade' : 'same';
  // Only ask when the answer changes something: a pair that isn't larger
  // would download the same thing either way. (Same-size pages of a comic
  // can also sit close together, and asking about those is just noise.)
  return bigger ? 'ask' : null;
}

module.exports = {
  dhash, hamming, fingerprintUrl, imageSize, aspectOff, sureCutoff, classify, headersFor,
  LOOSE, DEFAULT_SURE, MAX_SURE, AGREE, ASPECT_TOLERANCE, BIGGER
};
