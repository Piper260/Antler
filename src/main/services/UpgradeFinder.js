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
 * It also finds the creator's work that isn't on e621 at all: Pawchive
 * images that match none of the artist's e621 posts (every one, fetched for
 * the run, not just the ones the search loaded), so they can be downloaded.
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
const { postImages, fileHash, fileUrl, thumbUrl, formatPost, imagePost, PAGE_SIZE } = require('./PawchiveService');

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

// Pawchive copies of one picture (reposted in two tiers) are this close or closer.
const SAME_PICTURE = 2;

/**
 * Pawchive images that aren't on e621, each picture once. Pure: fingerprints only.
 *
 * Each e621 post claims the one Pawchive image closest to it (within
 * match.LOOSE): that image is the e621 picture, whatever its thumbnail's
 * compression did to the fingerprint (often 5-10 bits on wide images). The
 * other images of a multi-image post (alternate versions, small edits) look
 * like the same e621 post but aren't its closest, so they stay unclaimed and
 * are listed. Unclaimed near-exact copies of a claimed or listed image
 * (SAME_PICTURE) are the same picture posted again, and are left out.
 * @param candidates [{ hash, fingerprint }]
 * @param prints     e621 fingerprints
 */
function notOnE621(candidates, prints) {
  const claimed = new Set();
  for (const p of prints) {
    let best = null;
    for (const c of candidates) {
      const d = match.hamming(c.fingerprint, p);
      if (d <= match.LOOSE && (!best || d < best.d)) best = { c, d };
    }
    if (best) claimed.add(best.c);
  }
  const kept = [...claimed];
  const missing = [];
  for (const c of candidates) {
    if (claimed.has(c)) continue;
    if (kept.some(k => match.hamming(c.fingerprint, k.fingerprint) <= SAME_PICTURE)) continue;
    missing.push(c);
    kept.push(c);
  }
  return missing;
}

/**
 * A Pawchive image as a post the search grid can show and download, named
 * as the Pawchive search names it (<post id>, then <post id>_2 ...), so a
 * file downloaded either way is recognised by the other.
 */
function postForImage(candidate, creatorName) {
  const base = formatPost(candidate.raw, creatorName);
  if (!base) return null;
  const images = postImages(candidate.raw);
  const index = Math.max(0, images.findIndex(f => fileHash(f) === candidate.hash));
  return { ...imagePost(base, images[index], index, images.length), onlyOnPawchive: true };
}

class UpgradeFinder {
  /**
   * @param {object} [options]
   * @param {(artist: string, site: string, onPage: Function) => Promise<{posts, complete}>} [options.allPosts]
   *   every e621 post by an artist, to find work that isn't on e621
   */
  constructor(pawchiveService, storePath, { allPosts = null } = {}) {
    this.pawchive = pawchiveService;
    this.allPosts = allPosts;
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
  async find({ artist, posts, pages = DEFAULT_PAGES, site = 'e621' }, onProgress = () => {}) {
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
            raw: post,
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

    // 2b. Every e621 post by the artist, for work that isn't on e621 at all.
    let catalog = null;
    if (this.allPosts) {
      try {
        onProgress({ stage: 'catalog', done: 0, total: 1, message: 'Listing the artist\'s e621 posts' });
        const listed = await this.allPosts(artist, site, (n) => onProgress({ stage: 'catalog', done: 0, total: 1, message: `Listing the artist's e621 posts (${n})` }));
        const loaded = new Set(withPrints.map(o => String(o.postId)));
        const extra = listed.posts.filter(p => !loaded.has(String(p.id)) && printUrl(p) && IMAGE_TYPES.has(String(p.metadata?.fileType || '').toLowerCase()));
        let printed = 0;
        const extraHashes = await mapLimit(extra, CONCURRENCY, p => this.fingerprint(`e6:${printUrl(p)}`, printUrl(p)), () => {
          onProgress({ stage: 'catalog', done: ++printed, total: extra.length, message: `Comparing with all ${listed.posts.length} e621 posts (${printed} of ${extra.length})` });
        });
        this.save();
        catalog = {
          posts: listed.posts.length,
          complete: listed.complete,
          prints: [...withPrints.map(o => o.fingerprint), ...extraHashes.filter(Boolean)]
        };
      } catch (error) {
        console.warn('⚠️ Could not list the artist\'s e621 posts; only loaded posts are compared:', error.message);
      }
    }
    const prints = catalog ? catalog.prints : withPrints.map(o => o.fingerprint);
    const missing = notOnE621(candidates, prints)
      .map(c => postForImage(c, creator.name))
      .filter(Boolean);

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
      results,
      // Pawchive images not on e621: against every e621 post when they could be
      // listed (allPostsCompared), else only against the loaded ones.
      missing,
      allPostsCompared: catalog ? catalog.posts : 0,
      allPostsComplete: Boolean(catalog?.complete)
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
Object.assign(module.exports, { pairUp, notOnE621, postForImage });
Object.assign(module.exports, { pairUp, mapLimit, artistKey, pairKey, DEFAULT_PAGES });
