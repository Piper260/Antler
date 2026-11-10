/**
 * Inkbunny search through its official API (https://wiki.inkbunny.net/wiki/API).
 *
 * Results are mapped into the same shape E621Service.formatPostData gives,
 * so Artist/Character Search, the training score and downloads treat them
 * like e621 posts. Inkbunny keywords aren't split by category, so they all
 * land in `general` (normalised to e621 style: lower case, underscores).
 *
 * Without an account the API runs as a guest, which only sees General-rated
 * work. Logging in shows what that account's own rating settings allow; the
 * account needs "Enable API access" turned on in its Inkbunny settings.
 */
const API = 'https://inkbunny.net';
// Inkbunny asks API users to go easy; keep requests at least this far apart (ms).
const REQUEST_GAP = 500;
// api_search returns at most 100 a page; api_submissions takes up to 100 ids.
const PAGE_SIZE = 100;
const RATINGS = { 0: 'Safe', 1: 'Questionable', 2: 'Explicit' };
const RATING_FILTER = { safe: '0', s: '0', questionable: '1', q: '1', explicit: '2', e: '2' };

const keywordTag = (name) => String(name).trim().toLowerCase().replace(/\s+/g, '_');
const extOf = (fileName) => (String(fileName).match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();

/** One api_submissions.php submission as a post in E621Service.formatPostData's shape. */
function formatSubmission(sub) {
  const file = (sub.files && sub.files[0]) || {};
  const general = [...new Set((sub.keywords || []).map(k => keywordTag(k.keyword_name)).filter(Boolean))];
  const tags = { general, species: [], character: [], artist: sub.username ? [sub.username] : [], copyright: [], meta: [], lore: [] };
  tags.totals = { ...Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, v.length])), total: general.length + tags.artist.length };
  const favorites = Number(sub.favorites_count) || 0;
  const id = `ib${sub.submission_id}`;
  const fileType = extOf(file.file_name || sub.file_name);
  const original = file.file_url_full || sub.file_url_full || null;
  return {
    id,
    source: 'inkbunny',
    tags,
    metadata: {
      id,
      // Inkbunny has no votes; favourites stand in for score.
      score: favorites,
      upvotes: 0,
      downvotes: 0,
      favorites,
      rating: RATINGS[sub.rating_id] || 'Unknown',
      fileType,
      fileSize: 0,
      dimensions: { width: Number(file.full_size_x) || 0, height: Number(file.full_size_y) || 0 },
      uploadedAt: sub.create_datetime,
      updatedAt: sub.last_file_update_datetime,
      sources: [`${API}/s/${sub.submission_id}`],
      description: '',
      commentCount: Number(sub.comments_count) || 0,
      pageCount: Number(sub.pagecount) || 1
    },
    fileUrls: {
      original,
      sample: file.file_url_screen || sub.file_url_screen || null,
      preview: file.thumbnail_url_huge_noncustom || sub.thumbnail_url_huge_noncustom || file.file_url_preview || null,
      alternatives: {}
    },
    downloadInfo: {
      isDownloadable: !!original,
      bestUrl: original ? { url: original, type: 'original', size: 0 } : null,
      filename: `${id}.${fileType}`
    }
  };
}

/** api_search.php parameters for an artist or character search. */
function searchParams(mode, name, { page = 1, sortBy = 'id', additionalTags = [] } = {}) {
  const params = { submissions_per_page: PAGE_SIZE, page };
  const words = [...additionalTags];
  if (mode === 'artist') {
    params.username = name;
  } else {
    // No character category on Inkbunny: match the name among keywords.
    words.unshift(String(name).replace(/_/g, ' '));
  }
  if (words.length) Object.assign(params, { text: words.map(w => String(w).replace(/_/g, ' ')).join(' '), keywords: 'yes', title: 'no', description: 'no' });
  if (sortBy === 'random') params.random = 'yes';
  else if (sortBy === 'score' || sortBy === 'favcount' || sortBy === 'training') params.orderby = 'favs';
  return params;
}

class InkbunnyService {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.sid = null;
    this.sidUser = null;
    this.lastRequest = 0;
  }

  credentials() {
    const s = this.settingsService.getSetting?.('inkbunny') || this.settingsService.settings?.inkbunny || {};
    return { username: s.username || '', password: s.password || '' };
  }

  async call(script, params = {}, { method = 'GET' } = {}) {
    const wait = this.lastRequest + REQUEST_GAP - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastRequest = Date.now();

    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const url = method === 'GET' ? `${API}/${script}?${body}` : `${API}/${script}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { Accept: 'application/json', 'User-Agent': 'Antler/1.0', ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      const failure = new Error(error.name === 'TimeoutError' ? 'Inkbunny took too long to answer' : 'Network error. Please check your internet connection.');
      failure.userMessage = failure.message;
      failure.type = error.name === 'TimeoutError' ? 'timeout' : 'network-error';
      throw failure;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const failure = new Error(`Inkbunny API error: ${response.status}`);
      failure.userMessage = failure.message;
      failure.type = 'api-error';
      failure.status = response.status;
      throw failure;
    }
    if (data.error_code != null) {
      const failure = new Error(data.error_message || `Inkbunny error ${data.error_code}`);
      failure.code = Number(data.error_code);
      failure.userMessage = failure.message;
      failure.type = 'api-error';
      throw failure;
    }
    return data;
  }

  /** Log in with the saved account, or as a guest when there is none. */
  async login(force = false) {
    const { username, password } = this.credentials();
    const who = username && password ? username : 'guest';
    if (this.sid && !force && this.sidUser === who) return this.sid;
    const data = who === 'guest'
      ? await this.call('api_login.php', { username: 'guest' })
      : await this.call('api_login.php', { username, password }, { method: 'POST' });
    this.sid = data.sid;
    this.sidUser = who;
    return this.sid;
  }

  /** A call that needs a session; logs in again once if the session lapsed. */
  async withSession(script, params) {
    const sid = await this.login();
    try {
      return await this.call(script, { ...params, sid });
    } catch (error) {
      if (error.code !== 2) throw error; // 2: invalid session id
      return this.call(script, { ...params, sid: await this.login(true) });
    }
  }

  /** Tests a username and password without saving them. */
  async testLogin(username, password) {
    try {
      const data = await this.call('api_login.php', { username, password }, { method: 'POST' });
      return { success: true, message: `Logged in as ${username}`, ratingsmask: data.ratingsmask };
    } catch (error) {
      const hint = /api/i.test(error.message) ? '' : ' Check the password, and that "Enable API access" is on in your Inkbunny account settings.';
      return { success: false, message: `${error.message}.${hint}` };
    }
  }

  /**
   * Artist or character search. Returns the shape E621IPC's search handlers
   * give: { posts, pagination: { currentPage, hasMore, totalCount } }.
   */
  async search(mode, name, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const found = await this.withSession('api_search.php', searchParams(mode, name, { ...options, page }));
    const ids = (found.submissions || []).map(s => s.submission_id);
    let posts = [];
    if (ids.length) {
      const details = await this.withSession('api_submissions.php', { submission_ids: ids.join(','), show_description: 'no', show_pools: 'no' });
      const byId = new Map((details.submissions || []).map(s => [String(s.submission_id), s]));
      // Keep the search's order; api_submissions doesn't promise it.
      posts = ids.map(id => byId.get(String(id))).filter(Boolean).map(formatSubmission);
    }
    const rating = RATING_FILTER[String(options.rating || '').toLowerCase()];
    if (rating) posts = posts.filter(p => p.metadata.rating === RATINGS[rating]);
    if (options.minScore != null) posts = posts.filter(p => p.metadata.favorites >= options.minScore);
    return {
      posts,
      pagination: {
        currentPage: page,
        hasMore: page < (Number(found.pages_count) || 0),
        totalCount: Number(found.results_count_all) || posts.length
      },
      guest: this.sidUser === 'guest'
    };
  }

  /** Usernames starting with the query. */
  async artistSuggestions(query, limit = 10) {
    if (!query || query.length < 2) return [];
    const data = await this.call('api_username_autosuggest.php', { username: query });
    return (data.results || []).map(r => r.value).filter(Boolean).slice(0, limit);
  }
}

module.exports = InkbunnyService;
module.exports.formatSubmission = formatSubmission;
module.exports.searchParams = searchParams;
module.exports.PAGE_SIZE = PAGE_SIZE;
