/**
 * Pawchive search through its API (https://pawchive.pw/api/schema, OpenAPI
 * 3.0.1). Pawchive archives posts from other sites (Patreon, Fanbox, ...),
 * often at full resolution, so it is also where Artist Search looks for
 * larger copies of e621 posts (see UpgradeFinder.js).
 *
 * Results are mapped into the shape E621Service.formatPostData gives, like
 * InkbunnyService does. Things to know about the API:
 *  - A creator is (service, id), not a name; `service` is the site the work
 *    was first posted on. Names are matched against the full creator list.
 *  - Lists are bare arrays of 50 with no total; `o` must step by 50.
 *  - Files are { name, path, server }: the file is `${server}/data${path}`.
 *    The path carries a shard prefix (/198/58/<hash>.png), so the thumbnail
 *    is built from the hash instead: img.pawchive.pw/thumbnail/data/98/58/<hash>.png.
 *  - Tags come as a Postgres array literal: '{"Black Apron","fox"}'.
 *  - No scores, favourite counts, ratings or image sizes.
 */
const HOST = 'https://pawchive.pw';
const API = `${HOST}/api/v1`;
const THUMB_HOST = 'https://img.pawchive.pw';
const REQUEST_GAP = 750; // ms between API requests
const PAGE_SIZE = 50;
const CREATOR_CACHE_MS = 30 * 60 * 1000;
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

const extOf = (p) => (String(p || '').match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || '').toLowerCase();
const isImage = (file) => !!file?.path && IMAGE_EXT.has(extOf(file.path));
const tagOf = (t) => String(t).trim().toLowerCase().replace(/\s+/g, '_');

/** The sha256 file name a path ends in, e.g. "9858...d000". */
function fileHash(file) {
  return String(file?.path || '').match(/([0-9a-f]{64})\.[a-z0-9]+$/i)?.[1]?.toLowerCase() || null;
}

/** Full-size URL; `server` is given per file, the main site as a fallback. */
function fileUrl(file) {
  if (!file?.path) return null;
  const server = /^https:\/\/[a-z0-9.-]*pawchive\.pw$/i.test(file.server || '') ? file.server : HOST;
  return `${server}/data${file.path}`;
}

function thumbUrl(file) {
  const hash = fileHash(file);
  if (!hash) return null;
  return `${THUMB_HOST}/thumbnail/data/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.${extOf(file.path)}`;
}

/** '{"Black Apron",fox}' (or an array) -> ['Black Apron', 'fox']. */
function parseTags(tags) {
  if (Array.isArray(tags)) return tags.map(String);
  const text = String(tags || '').trim();
  if (!text.startsWith('{') || !text.endsWith('}') || text.length < 3) return [];
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
  let m;
  while ((m = re.exec(text.slice(1, -1)))) {
    const value = m[1] != null ? m[1].replace(/\\(.)/g, '$1') : m[2].trim();
    if (value && value !== 'NULL') out.push(value);
  }
  return out;
}

/** The image files of a post, main file first, without repeats. */
function postImages(post) {
  const seen = new Set();
  return [post.file, ...(post.attachments || [])].filter(f => {
    if (!isImage(f)) return false;
    const key = fileHash(f) || f.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One post -> the shape E621Service.formatPostData gives, or null when it has no image. */
function formatPost(post, creatorName = null) {
  const images = postImages(post);
  const image = images[0];
  if (!image) return null;
  const fileType = extOf(image.path);
  const id = `pc_${post.service}_${post.user}_${post.id}`;

  const general = [...new Set(parseTags(post.tags).map(tagOf).filter(Boolean))];
  const tags = { general, species: [], character: [], artist: [creatorName || post.user].filter(Boolean), copyright: [], meta: [], lore: [] };
  tags.totals = { ...Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, v.length])), total: general.length + tags.artist.length };

  const original = fileUrl(image);
  return {
    id,
    source: 'pawchive',
    tags,
    metadata: {
      id,
      score: 0, upvotes: 0, downvotes: 0, favorites: 0,
      rating: 'Unknown',
      fileType,
      fileSize: 0,
      dimensions: { width: 0, height: 0 },
      uploadedAt: post.published || post.added,
      updatedAt: post.edited || post.added,
      sources: [`${HOST}/${post.service}/user/${post.user}/post/${post.id}`],
      description: post.title || '',
      commentCount: 0,
      pageCount: images.length
    },
    fileUrls: {
      original,
      sample: thumbUrl(image),
      preview: thumbUrl(image),
      alternatives: Object.fromEntries(images.slice(1).map(f => [f.name || f.path, fileUrl(f)]))
    },
    downloadInfo: {
      isDownloadable: true,
      bestUrl: { url: original, type: 'original', size: 0 },
      filename: `${id}.${fileType}`
    }
  };
}

/**
 * Every image of a post as its own post: Pawchive posts often hold several
 * (alternate versions, a sequence). The first keeps the post's own id (and
 * so the file name it always had); the rest are <id>_2, <id>_3 ...
 */
function formatPostImages(post, creatorName = null) {
  const base = formatPost(post, creatorName);
  if (!base) return [];
  const images = postImages(post);
  return images.map((image, i) => imagePost(base, image, i, images.length));
}

/** One image of a formatted post as a post of its own (see formatPostImages). */
function imagePost(base, image, index, count) {
  const id = index === 0 ? base.id : `${base.id}_${index + 1}`;
  const fileType = extOf(image.path) || base.metadata.fileType;
  const original = fileUrl(image);
  return {
    ...base,
    id,
    metadata: {
      ...base.metadata,
      id,
      fileType,
      description: count > 1 ? `${base.metadata.description || 'Untitled'} (${index + 1} of ${count})` : base.metadata.description,
      pageCount: count
    },
    fileUrls: { original, sample: thumbUrl(image), preview: thumbUrl(image), alternatives: {} },
    downloadInfo: { isDownloadable: true, bestUrl: { url: original, type: 'original', size: 0 }, filename: `${id}.${fileType}` }
  };
}

/** How closely a creator name matches a search name; 0 = not at all. */
function nameScore(creatorName, query) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[_\s\-.]+/g, '');
  const a = norm(creatorName);
  const b = norm(query);
  if (!a || !b) return 0;
  if (a === b) return 3;
  // A partial match needs the shorter name to be a real part of the longer
  // one, so "M" doesn't match "Mingrix".
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 3 || short.length < long.length / 2) return 0;
  if (long.startsWith(short)) return 2;
  if (long.includes(short)) return 1;
  return 0;
}

class PawchiveService {
  constructor() {
    this.lastRequest = 0;
    this.creators = null;
    this.creatorsAt = 0;
    this.creatorsLoading = null;
  }

  async call(path, params = {}) {
    const wait = this.lastRequest + REQUEST_GAP - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastRequest = Date.now();

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      for (const item of [].concat(v)) if (item != null && item !== '') qs.append(k, String(item));
    }
    const url = `${API}${path}${qs.size ? `?${qs}` : ''}`;
    let response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Antler/1.0' }, signal: AbortSignal.timeout(30000) });
    } catch (error) {
      const timeout = error.name === 'TimeoutError';
      throw failure(timeout ? 'Pawchive took too long to answer' : 'Network error. Please check your internet connection.', timeout ? 'timeout' : 'network-error');
    }
    if (response.status === 404) return null;
    if (response.status === 429) throw failure('Rate limited by Pawchive; wait a minute and try again', 'rate-limited', 429);
    if (!response.ok) throw failure(`Pawchive API error: ${response.status}`, 'api-error', response.status);
    const data = await response.json().catch(() => null);
    if (data == null) throw failure('Pawchive sent something that is not JSON', 'api-error', response.status);
    return data;
  }

  /** Every creator, cached; the list is large. */
  async allCreators() {
    if (this.creators && Date.now() - this.creatorsAt < CREATOR_CACHE_MS) return this.creators;
    if (!this.creatorsLoading) {
      this.creatorsLoading = this.call('/creators')
        .then(list => {
          this.creators = Array.isArray(list) ? list : [];
          this.creatorsAt = Date.now();
          return this.creators;
        })
        .finally(() => { this.creatorsLoading = null; });
    }
    return this.creatorsLoading;
  }

  /** Creators whose names match, best match then most favourited first. */
  async findCreators(name, limit = 8) {
    const all = await this.allCreators();
    return all
      .map(c => ({ c, s: nameScore(c.name, name) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || (b.c.favorited || 0) - (a.c.favorited || 0))
      .slice(0, limit)
      .map(({ c }) => ({ id: String(c.id), service: c.service, name: c.name, favorited: c.favorited || 0 }));
  }

  /** One page (50) of a creator's raw posts. */
  async creatorPostsPage(creator, page = 1, params = {}) {
    const raw = await this.call(`/${creator.service}/user/${creator.id}`, { ...params, o: (Math.max(1, page) - 1) * PAGE_SIZE });
    return Array.isArray(raw) ? raw : [];
  }

  /**
   * Artist or character search, shaped like the other services' search():
   * { posts, pagination: { currentPage, hasMore, totalCount } }.
   * Artist: the best-matching creator's posts; `additionalTags` (the Refine
   * box) search their titles and text, since few Pawchive posts are tagged
   * (Pawchive's q, which needs 3 letters or more).
   * Character: Pawchive has no character tags, so the name is a text search.
   */
  async search(mode, name, options = {}) {
    const currentPage = Math.max(1, Number(options.page) || 1);
    const additionalTags = (options.additionalTags || []).map(t => String(t).replace(/_/g, ' '));
    let raw;
    let creator = null;
    if (mode === 'artist') {
      creator = options.creator || (await this.findCreators(name, 1))[0] || null;
      if (!creator) return { posts: [], pagination: { currentPage, hasMore: false, totalCount: 0 } };
      const q = additionalTags.join(' ').trim();
      if (q && q.length < 3) {
        const error = new Error('Pawchive searches titles with 3 letters or more');
        error.userMessage = error.message;
        error.type = 'short-query';
        throw error;
      }
      raw = await this.creatorPostsPage(creator, currentPage, q.length >= 3 ? { q } : {});
    } else {
      const q = [String(name).replace(/_/g, ' '), ...additionalTags].join(' ').trim();
      if (q.length < 3) return { posts: [], pagination: { currentPage, hasMore: false, totalCount: 0 } };
      const list = await this.call('/posts', { q, o: (currentPage - 1) * PAGE_SIZE });
      raw = Array.isArray(list) ? list : [];
    }
    return {
      // Every image of a post is its own result, not just the first.
      posts: raw.flatMap(p => formatPostImages(p, creator?.name)),
      pagination: { currentPage, hasMore: raw.length === PAGE_SIZE, totalCount: null },
      creator
    };
  }

  async artistSuggestions(query, limit = 10) {
    if (!query || query.length < 2) return [];
    return (await this.findCreators(query, limit)).map(c => c.name);
  }
}

function failure(message, type, status) {
  const e = new Error(message);
  e.userMessage = message;
  e.type = type;
  if (status) e.status = status;
  return e;
}

module.exports = PawchiveService;
Object.assign(module.exports, { formatPost, formatPostImages, imagePost, parseTags, postImages, fileHash, fileUrl, thumbUrl, nameScore, PAGE_SIZE });
