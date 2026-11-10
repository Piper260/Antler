/**
 * Finds larger copies of e621 posts on Pawchive.
 *
 * For an artist's e621 results: scan the linked Pawchive creator's newest
 * posts, fingerprint every image on both sides (imageMatch.dhash, on
 * thumbnails - the fingerprint doesn't depend on size), pair each e621 post
 * with its closest Pawchive image, then read the candidate's real size from
 * the start of the file. Close pairs that aren't certain are left for the
 * person to answer (same / variant / different); answers are kept so a pair
 * is never asked twice, and they tune the automatic cut-off.
 *
 * Kept in <user data>/pawchive-upgrades.json:
 *   links      e621 artist name -> Pawchive creator { service, id, name }
 *   decisions  "<e621 id>|<pawchive file hash>" -> { answer, distance, at }
 *   hashes     image URL key -> fingerprint (thumbnails never change, so these are kept)
 */
const fs = require('fs');
const path = require('path');
const { writeFileSafe } = require('../utils/safeWrite');
const match = require('./imageMatch');
const { postImages, fileHash, fileUrl, thumbUrl, PAGE_SIZE } = require('./PawchiveService');

const DEFAULT_PAGES = 10;    // newest 500 Pawchive posts
const MAX_PAGES = 40;
const CONCURRENCY = 4;
const MAX_HASHES = 50000;
const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

const artistKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
const pairKey = (postId, hash) => `${postId}|${hash}`;

/** Runs `fn` over `items`, `limit` at a time; failures become null. */
async function mapLimit(items, limit, fn, onEach) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (_) {
        results[i] = null;
      }
      onEach?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Best Pawchive image for each e621 post. Pure: works on fingerprints only.
 * @param originals  [{ postId, hash }]
 * @param candidates [{ hash: fileHash, fingerprint }]
 * @param decisions  { pairKey: { answer } } - pairs answered "different" are skipped
 * @returns Map postId -> { candidate, distance }
 */
function pairUp(originals, candidates, decisions = {}) {
  const pairs = new Map();
  for (const o of originals) {
    let best = null;
    for (const c of candidates) {
      if (decisions[pairKey(o.postId, c.hash)]?.answer === 'different') continue;
      const distance = match.hamming(o.fingerprint, c.fingerprint);
      if (distance <= match.LOOSE && (!best || distance < best.distance)) best = { candidate: c, distance };
    }
    if (best) pairs.set(o.postId, best);
  }
  return pairs;
}

class UpgradeFinder {
  constructor(pawchiveService, storePath) {
    this.pawchive = pawchiveService;
    this.storePath = storePath;
    this.store = { links: {}, decisions: {}, hashes: {} };
    try {
      const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      this.store = { links: saved.links || {}, decisions: saved.decisions || {}, hashes: saved.hashes || {} };
    } catch (_) { /* first run, or unreadable: start empty */ }
    this.saveTimer = null;
    this.running = null;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const keys = Object.keys(this.store.hashes);
      if (keys.length > MAX_HASHES) {
        for (const k of keys.slice(0, keys.length - MAX_HASHES)) delete this.store.hashes[k];
      }
      fs.promises.mkdir(path.dirname(this.storePath), { recursive: true })
        .then(() => writeFileSafe(this.storePath, JSON.stringify(this.store)))
        .catch(error => console.warn('⚠️ Could not save Pawchive upgrade data:', error.message));
    }, 500);
  }

  getLink(artist) {
    return this.store.links[artistKey(artist)] || null;
  }

  setLink(artist, creator) {
    const key = artistKey(artist);
    if (creator) this.store.links[key] = { service: String(creator.service), id: String(creator.id), name: String(creator.name || '') };
    else delete this.store.links[key];
    this.save();
    return this.getLink(artist);
  }

  recordDecision(postId, hash, answer, distance) {
    if (!['same', 'variant', 'different'].includes(answer)) throw new Error(`Unknown answer: ${answer}`);
    this.store.decisions[pairKey(postId, hash)] = { answer, distance: Number(distance) || 0, at: Date.now() };
    this.save();
    return { cutoff: this.cutoff() };
  }

  cutoff() {
    return match.sureCutoff(Object.values(this.store.decisions));
  }

  stats() {
    const answers = Object.values(this.store.decisions);
    const count = (a) => answers.filter(d => d.answer === a).length;
    return { reviewed: answers.length, same: count('same'), variant: count('variant'), different: count('different'), cutoff: this.cutoff() };
  }

  async fingerprint(key, url) {
    if (this.store.hashes[key]) return this.store.hashes[key];
    const hash = await match.fingerprintUrl(url);
    this.store.hashes[key] = hash;
    return hash;
  }

  /**
   * @param {object} args
   * @param {string} args.artist  the e621 artist name searched
   * @param {Array}  args.posts   e621 posts (formatPostData shape)
   * @param {number} [args.pages] Pawchive pages (50 posts) to scan
   * @param {function} [onProgress] ({ stage, done, total, message })
   */
  async find({ artist, posts, pages = DEFAULT_PAGES }, onProgress = () => {}) {
    const creator = this.getLink(artist);
    if (!creator) {
      const e = new Error('Choose which Pawchive creator this artist is first');
      e.type = 'needs-link';
      throw e;
    }
    pages = Math.min(MAX_PAGES, Math.max(1, Number(pages) || DEFAULT_PAGES));

    // 1. The creator's newest posts.
    const files = [];
    let scanned = 0;
    for (let page = 1; page <= pages; page++) {
      onProgress({ stage: 'posts', done: page - 1, total: pages, message: `Reading Pawchive posts (page ${page})` });
      const raw = await this.pawchive.creatorPostsPage(creator, page);
      scanned += raw.length;
      for (const post of raw) {
        for (const file of postImages(post)) {
          const hash = fileHash(file);
          if (!hash) continue;
          files.push({
            hash,
            name: file.name || '',
            url: fileUrl(file),
            thumb: thumbUrl(file),
            postTitle: post.title || '',
            postUrl: `https://pawchive.pw/${post.service}/user/${post.user}/post/${post.id}`,
            published: post.published || post.added || null
          });
        }
      }
      if (raw.length < PAGE_SIZE) break; // last page
    }

    // 2. Fingerprints, both sides.
    // e621's ~850px sample, not the 150px preview: in testing it brought true
    // matches much closer (e.g. 14 -> 1 bits) while non-matches stayed ~20.
    const printUrl = (p) => p.fileUrls?.sample || p.fileUrls?.preview;
    const originals = posts.filter(p => printUrl(p) && IMAGE_TYPES.has(String(p.metadata?.fileType || '').toLowerCase()));
    const total = files.length + originals.length;
    let done = 0;
    const tick = () => onProgress({ stage: 'fingerprints', done: ++done, total, message: `Comparing images (${done} of ${total})` });

    const candidateHashes = await mapLimit(files, CONCURRENCY, f => this.fingerprint(`pc:${f.hash}`, f.thumb), tick);
    const originalHashes = await mapLimit(originals, CONCURRENCY, p => this.fingerprint(`e6:${printUrl(p)}`, printUrl(p)), tick);
    this.save();

    const candidates = files.map((f, i) => ({ ...f, fingerprint: candidateHashes[i] })).filter(c => c.fingerprint);
    const withPrints = originals.map((p, i) => ({ post: p, postId: p.id, fingerprint: originalHashes[i] })).filter(o => o.fingerprint);
    const pairs = pairUp(withPrints, candidates, this.store.decisions);

    // 3. Real sizes for the candidates only.
    const paired = withPrints.filter(o => pairs.has(o.postId));
    let sized = 0;
    const sizes = await mapLimit(paired, 3, o => match.imageSize(pairs.get(o.postId).candidate.url), () => {
      onProgress({ stage: 'sizes', done: ++sized, total: paired.length, message: `Checking resolutions (${sized} of ${paired.length})` });
    });

    // 4. Classify.
    const cutoff = this.cutoff();
    const results = [];
    paired.forEach((o, i) => {
      const { candidate, distance } = pairs.get(o.postId);
      const size = sizes[i];
      // Archives lose files: a candidate that can't be read is no upgrade.
      if (!size) return;
      const original = {
        width: o.post.metadata?.dimensions?.width || 0,
        height: o.post.metadata?.dimensions?.height || 0,
        fileSize: o.post.metadata?.fileSize || 0,
        format: o.post.metadata?.fileType || ''
      };
      const answer = this.store.decisions[pairKey(o.postId, candidate.hash)]?.answer || null;
      const status = match.classify({ distance, original, candidate: size, answer }, cutoff);
      if (!status) return;
      results.push({
        postId: o.postId,
        status,
        answer,
        distance,
        aspectOff: match.aspectOff(original, size),
        original: { ...original, preview: o.post.fileUrls.sample || o.post.fileUrls.preview },
        candidate: {
          hash: candidate.hash,
          url: candidate.url,
          thumb: candidate.thumb,
          name: candidate.name,
          postTitle: candidate.postTitle,
          postUrl: candidate.postUrl,
          width: size?.width || 0,
          height: size?.height || 0,
          fileSize: size?.fileSize || 0,
          format: normaliseFormat(size?.format) || extOfUrl(candidate.url)
        }
      });
    });

    return {
      creator,
      scannedPosts: scanned,
      scannedImages: candidates.length,
      checkedPosts: withPrints.length,
      cutoff,
      results
    };
  }
}

function normaliseFormat(format) {
  if (!format) return '';
  return format === 'jpeg' ? 'jpg' : String(format).toLowerCase();
}

function extOfUrl(url) {
  return (String(url || '').match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || '').toLowerCase();
}

module.exports = UpgradeFinder;
Object.assign(module.exports, { pairUp, mapLimit, artistKey, pairKey, DEFAULT_PAGES });
