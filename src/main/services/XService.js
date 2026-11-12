/**
 * X (Twitter) search for Artist/Character Search, through the user's own
 * signed-in x.com session.
 *
 * X has no free read API, and its internal API wants request headers only its
 * own page knows how to make. So Antler doesn't call that API itself: it opens
 * the artist's profile (or a media search) in a hidden window signed in with
 * the user's account, lets x.com's page make its own requests, and reads the
 * responses through the window's debugger as they arrive. Scrolling the page
 * loads more, the same as a person would, paced by SCROLL_GAP.
 *
 * Each search is a job that indexes the whole timeline in the background and
 * streams new posts to the renderer as they arrive (onProgress). An artist's
 * index is saved (x-index/<handle>.json), so searching them again shows the
 * saved posts at once and only scrolls until it reaches tweets it has seen.
 *
 * The session lives in its own partition (persist:x), so the X sign-in is
 * kept between runs and never mixes with the app's window. This is against
 * X's terms of service; the Settings card says so before signing in.
 */
const fs = require('fs');
const path = require('path');
const { BrowserWindow, session } = require('electron');
const { postsFromResponse, userFromResponse, cleanHandle, matchesTags } = require('./xTimeline');

const PARTITION = 'persist:x';
const HOST = 'https://x.com';
// The x.com operations whose responses are read.
// The profile's Posts tab for artists (UserTweets, renamed
// UserOriginalsTimeline in 2026), and SearchTimeline for character searches.
// X renames these often, so any User...Timeline counts except the replies,
// likes, highlights and articles tabs; Media tab calls are read too.
const OPERATIONS = /\/graphql\/[^/?]+\/(UserByScreenName|UserTweets|SearchTimeline|UserMedia|User(?!\w*(?:Replies|Likes|Highlights|Articles))\w*Timeline)(?:\?|$)/;
// After each batch arrives, before scrolling for the next (ms). X sends about
// 30 tweets a batch; going much faster runs into its request limits.
const SCROLL_GAP = 600;
const FIRST_WAIT = 15000;
const NEXT_WAIT = 12000;
// How often the index is written while a job runs (ms).
const SAVE_GAP = 5000;
const INDEX_VERSION = 1;
// Sign-in popups (Google, Apple) may open; anything else is refused.
const SIGN_IN_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(x\.com|twitter\.com|google\.com|apple\.com)\//i;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function failure(message, type) {
  const error = new Error(message);
  error.userMessage = message;
  error.type = type;
  return error;
}

const ERRORS = {
  'needs-sign-in': 'Sign in to X in Settings first',
  'not-found': 'No X account by that name',
  suspended: 'That X account is suspended',
  unavailable: 'That X account is not available',
  'rate-limited': 'X is limiting requests from your account. What was found is saved; search again in about 15 minutes to continue',
  'no-response': 'X did not load. Check your connection, or sign in to X again in Settings'
};

/** Windows that show x.com stay sandboxed, with no preload, and can't wander off. */
function lockDown(win) {
  win.webContents.setWindowOpenHandler(({ url }) => (SIGN_IN_HOSTS.test(url) ? { action: 'allow' } : { action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!/^https:\/\//i.test(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

const windowPrefs = (extra = {}) => ({
  partition: PARTITION,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  ...extra
});

const artistKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '_');

/** Newest first, by the tweet id inside the post id (x<tweet>[_n]). */
function byNewest(a, b) {
  const ta = BigInt(String(a.id).match(/^x(\d+)/)?.[1] || 0);
  const tb = BigInt(String(b.id).match(/^x(\d+)/)?.[1] || 0);
  if (ta !== tb) return ta > tb ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

/** Rating, minimum likes and extra tags from the search's options. */
function postFilter(options, tags) {
  const rating = String(options.rating || '').toLowerCase();
  const minScore = options.minScore != null ? Number(options.minScore) : null;
  return (post) => {
    if ((rating === 'explicit' || rating === 'e') && post.metadata.rating !== 'Explicit') return false;
    if ((rating === 'safe' || rating === 's') && post.metadata.rating === 'Explicit') return false;
    if (minScore != null && post.metadata.favorites < minScore) return false;
    return matchesTags(post, tags);
  };
}

class XService {
  /**
   * `dataDir`: Antler's data folder. x-links.json there maps e621 artist
   * names to the X handle the user chose; x-index/ keeps each account's index.
   */
  constructor(dataDir = null) {
    this.job = null;
    this.linksPath = dataDir ? path.join(dataDir, 'x-links.json') : null;
    this.indexDir = dataDir ? path.join(dataDir, 'x-index') : null;
    this.links = {};
    try {
      if (this.linksPath && fs.existsSync(this.linksPath)) this.links = JSON.parse(fs.readFileSync(this.linksPath, 'utf8')).links || {};
    } catch (error) {
      console.warn('⚠️ Could not read X links:', error.message);
    }
  }

  getLink(artist) {
    return this.links[artistKey(artist)] || null;
  }

  setLink(artist, handle) {
    const key = artistKey(artist);
    const clean = cleanHandle(handle);
    if (clean) this.links[key] = clean;
    else delete this.links[key];
    if (this.linksPath) {
      try {
        fs.writeFileSync(this.linksPath, JSON.stringify({ links: this.links }, null, 2));
      } catch (error) {
        console.warn('⚠️ Could not save X links:', error.message);
      }
    }
    return this.getLink(artist);
  }

  get session() {
    return session.fromPartition(PARTITION);
  }

  async status() {
    const cookies = await this.session.cookies.get({ url: HOST });
    return { signedIn: cookies.some(c => c.name === 'auth_token' && c.value) };
  }

  /** Opens x.com's sign-in page; resolves { signedIn } once done or closed. */
  signIn(parent) {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        parent: parent || undefined,
        modal: !!parent,
        width: 540,
        height: 760,
        title: 'Sign in to X',
        autoHideMenuBar: true,
        backgroundColor: '#000000',
        webPreferences: windowPrefs()
      });
      lockDown(win);
      const cookies = this.session.cookies;
      let settled = false;
      const settle = async (signedIn) => {
        if (settled) return;
        settled = true;
        cookies.removeListener('changed', onCookie);
        if (!win.isDestroyed()) win.close();
        resolve({ signedIn: signedIn ?? (await this.status()).signedIn });
      };
      // auth_token is set once the sign-in (and any 2FA step) is through.
      const onCookie = (event, cookie, cause, removed) => {
        if (cookie.name === 'auth_token' && !removed && cookie.value) setTimeout(() => settle(true), 1200);
      };
      cookies.on('changed', onCookie);
      win.on('closed', () => settle());
      win.loadURL(`${HOST}/i/flow/login`).catch(() => { /* the window shows its own error */ });
    });
  }

  async signOut() {
    this.stopJob('signed out');
    await this.session.clearStorageData();
    return { signedIn: false };
  }

  /* ---------- Saved indexes ---------- */

  indexPath(handle) {
    return this.indexDir ? path.join(this.indexDir, `${String(handle).toLowerCase()}.json`) : null;
  }

  loadIndex(handle) {
    const file = this.indexPath(handle);
    try {
      if (!file || !fs.existsSync(file)) return null;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data?.version === INDEX_VERSION ? data : null;
    } catch (error) {
      console.warn(`⚠️ X: could not read the saved index for @${handle}:`, error.message);
      return null;
    }
  }

  saveIndex(job) {
    if (!job.indexed || !job.responses) return;
    const file = this.indexPath(job.author);
    if (!file) return;
    try {
      fs.mkdirSync(this.indexDir, { recursive: true });
      const data = {
        version: INDEX_VERSION,
        handle: job.user?.screenName || job.author,
        user: job.user,
        complete: job.complete,
        updatedAt: new Date().toISOString(),
        tweetIds: [...job.seenTweets],
        posts: [...job.posts].sort(byNewest)
      };
      // Written beside it first, so a crash mid-write keeps the old index.
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
      fs.renameSync(`${file}.tmp`, file);
      job.lastSave = Date.now();
    } catch (error) {
      console.warn(`⚠️ X: could not save the index for @${job.author}:`, error.message);
    }
  }

  /* ---------- Searching ---------- */

  /**
   * Artist or character search. Returns at once with what is known (a saved
   * index, or the first batch from X), and keeps indexing in the background,
   * sending { key, posts, ...progress } to onProgress as posts arrive.
   * Artist: the profile's Posts tab, keeping tweets with media; extra tags
   * are matched against hashtags and text. Character: X has no character
   * tags, so the name is a media search (not saved).
   */
  async search(mode, name, options = {}, onProgress = null) {
    if (!(await this.status()).signedIn) throw failure(ERRORS['needs-sign-in'], 'needs-sign-in');
    // Every post is sent as it is found, so there is only one page.
    if (Number(options.page) > 1) return { posts: [], pagination: { currentPage: Number(options.page), hasMore: false, totalCount: 0 } };
    const tags = (options.additionalTags || []).map(t => String(t).replace(/_/g, ' ').trim()).filter(Boolean);

    let url;
    let author = '';
    if (mode === 'artist') {
      // A plain name may be an e621 artist linked to an X account (see
      // getLink); "@name" or a link always means that exact account.
      const exact = /^\s*@|(?:x|twitter)\.com\//i.test(name);
      author = cleanHandle((!exact && this.getLink(name)) || name);
      if (!author) throw failure('Enter an X username', 'invalid-name');
      // The profile's Posts tab: X's Media tab and media search both miss
      // image posts (often all of an NSFW artist's), the timeline doesn't.
      url = `${HOST}/${author}`;
    } else {
      url = searchUrl(`${[String(name).replace(/_/g, ' '), ...tags].join(' ')} filter:media`);
    }
    const key = mode === 'artist' ? `artist:${author.toLowerCase()}` : `search:${url}`;
    console.log(`🐦 X ${mode} search: "${name}" -> ${url}${tags.length ? ` + tags ${tags.join(', ')}` : ''}`);

    const job = await this.openJob({ key, url, author, indexed: mode === 'artist' });
    // The newest search on this job gets the stream, with its own filters.
    const listener = { filter: postFilter(options, mode === 'artist' ? tags : []), onProgress, sent: new Set() };
    job.listener = listener;

    // With nothing saved, wait for X's first answer so a wrong name or a
    // lapsed sign-in shows as the search's error.
    if (!job.posts.length) {
      await this.waitUntil(job, () => job.responses > 0 || job.posts.length || job.finished || job.error, FIRST_WAIT * 2);
    }
    if (job.stopped === 'new search') throw failure('Replaced by a newer X search', 'superseded');
    if (!job.posts.length && job.error) throw failure(ERRORS[job.error] || ERRORS['no-response'], job.error);

    const posts = job.posts.filter(listener.filter);
    for (const post of posts) listener.sent.add(post.id);
    return {
      posts,
      key,
      indexing: !job.finished,
      progress: this.progressOf(job),
      pagination: { currentPage: 1, hasMore: false, totalCount: job.user?.mediaCount || job.posts.length }
    };
  }

  /** Stops the running job; what it found is kept (and saved). */
  stopIndex() {
    this.stopJob('stopped');
    return { success: true };
  }

  progressOf(job) {
    return {
      key: job.key,
      handle: job.user?.screenName || job.author,
      tweets: job.seenTweets.size,
      mediaTweets: job.mediaTweets.size,
      found: job.posts.length,
      cached: job.cached,
      total: job.user?.mediaCount || 0,
      complete: job.complete,
      finished: job.finished,
      stopped: job.stopped && job.stopped !== 'new search' ? job.stopped : null,
      error: job.error ? (ERRORS[job.error] || ERRORS['no-response']) : null
    };
  }

  emit(job, posts = []) {
    const listener = job.listener;
    if (!listener?.onProgress) return;
    const fresh = posts.filter(p => !listener.sent.has(p.id) && listener.filter(p));
    for (const post of fresh) listener.sent.add(post.id);
    try {
      listener.onProgress({ ...this.progressOf(job), posts: fresh });
    } catch (error) {
      // The window that asked is gone.
    }
  }

  async openJob({ key, url, author, indexed }) {
    if (this.job?.key === key && !this.job.finished) return this.job;
    // Two searches starting at once for the same account share one job.
    if (this.opening?.key === key) return this.opening.promise;
    this.stopJob('new search');
    this.generation = (this.generation || 0) + 1;
    const promise = this.createJob({ key, url, author, indexed }, this.generation);
    this.opening = { key, promise };
    try {
      return await promise;
    } finally {
      if (this.opening?.promise === promise) this.opening = null;
    }
  }

  async createJob({ key, url, author, indexed }, generation) {
    const saved = indexed ? this.loadIndex(author) : null;
    const job = {
      key, url, author, indexed,
      posts: saved?.posts || [],
      seen: new Set((saved?.posts || []).map(p => p.id)),
      seenTweets: new Set(saved?.tweetIds || []),
      mediaTweets: new Set((saved?.posts || []).map(p => String(p.id).match(/^x(\d+)/)?.[1]).filter(Boolean)),
      cached: saved?.posts?.length || 0,
      complete: !!saved?.complete,
      user: saved?.user || null,
      responses: 0, quiet: 0, lastSave: 0,
      ended: false, upToDate: false, finished: false, stopped: null, error: null,
      waiters: [], listener: null, win: null
    };
    if (saved) console.log(`🐦 X: saved index for @${author}: ${job.cached} posts from ${job.seenTweets.size} tweets${job.complete ? ', complete' : ''}`);

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 1600,
      // Images aren't needed: Antler reads the data, not the page.
      webPreferences: windowPrefs({ backgroundThrottling: false, autoplayPolicy: 'user-gesture-required', images: false })
    });
    job.win = win;
    lockDown(win);
    const wc = win.webContents;
    wc.setAudioMuted(true);

    const wake = () => { for (const w of job.waiters.splice(0)) w(); };
    job.wake = wake;
    win.on('closed', () => { job.ended = true; wake(); });
    wc.on('render-process-gone', (event, details) => {
      console.warn(`⚠️ X page process gone: ${details.reason}`);
      job.error = job.error || 'no-response';
      wake();
    });
    wc.on('did-fail-load', (event, code, description, failedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3) console.warn(`⚠️ X page failed to load (${code} ${description}): ${failedUrl}`);
    });
    wc.on('did-finish-load', () => console.log(`🐦 X page loaded: ${wc.getURL()}`));
    wc.on('did-navigate', (event, to) => {
      if (/\/(i\/flow\/)?login\b/.test(to)) { job.error = 'needs-sign-in'; wake(); }
    });

    const pending = new Map();
    const dbg = wc.debugger;
    // x.com's headers can move the page to a new renderer process when it
    // navigates, which detaches the debugger; attach again when that happens.
    const watch = async () => {
      if (win.isDestroyed() || job.finished) return false;
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Network.enable');
      return true;
    };
    job.watch = watch;
    dbg.on('detach', (event, reason) => {
      if (win.isDestroyed() || job.finished) return;
      console.warn(`⚠️ X: lost the page's network view (${reason}); attaching again`);
      watch().catch(error => console.warn('⚠️ X: could not attach again:', error.message));
    });
    dbg.on('message', async (event, method, params) => {
      if (method === 'Network.responseReceived') {
        const op = params.response.url.match(OPERATIONS)?.[1];
        if (!op) return;
        if (params.response.status === 429) { job.error = 'rate-limited'; wake(); return; }
        if (params.response.status === 401 || params.response.status === 403) { job.error = 'needs-sign-in'; wake(); return; }
        pending.set(params.requestId, op);
      } else if (method === 'Network.loadingFinished' && pending.has(params.requestId)) {
        const op = pending.get(params.requestId);
        pending.delete(params.requestId);
        try {
          const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          this.ingest(job, op, JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body));
        } catch (error) {
          // The window closed, or a response that isn't JSON; nothing to read.
        }
        wake();
      }
    });

    try {
      // A new window has no page for the debugger to attach to until it has
      // loaded something, so give it a blank one first.
      await wc.loadURL('about:blank');
      await watch();
    } catch (error) {
      console.error('❌ X: could not watch the page:', error.message);
      if (!win.isDestroyed()) win.destroy();
      throw failure('Could not open X in the background. Try again.', 'no-response');
    }
    if (generation !== this.generation) {
      // Another search started while this one was opening.
      win.destroy();
      throw failure('Replaced by a newer X search', 'superseded');
    }
    this.job = job;
    wc.loadURL(url).catch(() => { /* reported as no-response if nothing arrives */ });
    this.runJob(job).catch(error => console.error('❌ X indexing failed:', error));
    return job;
  }

  ingest(job, op, json) {
    if (process.env.ANTLER_X_DUMP) {
      // Debugging aid: ANTLER_X_DUMP=<folder> saves each response.
      try {
        job.dumps = (job.dumps || 0) + 1;
        fs.writeFileSync(path.join(process.env.ANTLER_X_DUMP, `x-${op}-${job.dumps}.json`), JSON.stringify(json, null, 1));
      } catch (error) {
        console.warn('⚠️ X: could not save response:', error.message);
      }
    }
    if (op === 'UserByScreenName') {
      const user = userFromResponse(json);
      // The page also looks up other accounts (e.g. the signed-in one); only
      // the searched account counts.
      if (user.unavailable) { if (!job.user) job.error = user.reason; return; }
      if (!job.author || user.screenName.toLowerCase() === job.author.toLowerCase()) {
        job.user = user;
        if (job.error === 'not-found') job.error = null;
      }
      return;
    }

    const { posts, tweetIds } = postsFromResponse(json, job.author);
    let newTweets = 0;
    for (const id of tweetIds) {
      if (job.seenTweets.has(id)) continue;
      job.seenTweets.add(id);
      newTweets++;
    }
    const added = [];
    for (const post of posts) {
      if (job.seen.has(post.id)) continue;
      job.seen.add(post.id);
      job.posts.push(post);
      job.mediaTweets.add(String(post.id).match(/^x(\d+)/)?.[1]);
      added.push(post);
    }
    job.responses++;
    job.quiet = newTweets ? 0 : job.quiet + 1;
    // Two batches in a row with no new tweets: the end of the timeline.
    if (job.quiet >= 2) job.ended = true;
    // A complete saved index needs only the tweets newer than it.
    if (job.complete && !newTweets) job.upToDate = true;
    console.log(`🐦 X ${op}: ${newTweets} new tweets, ${added.length} new posts, ${job.posts.length} in all`);

    this.emit(job, added);
    if (Date.now() - job.lastSave > SAVE_GAP) this.saveIndex(job);
  }

  waitUntil(job, done, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms);
      function finish() { clearTimeout(timer); resolve(); }
      const check = () => (done() ? finish() : job.waiters.push(check));
      check();
    });
  }

  waitForResponse(job, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      job.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  /** Scrolls until the timeline ends, the index is up to date, or it's stopped. */
  async runJob(job) {
    const exec = (js) => (job.win.isDestroyed() ? Promise.resolve() : job.win.webContents.executeJavaScript(js).catch(() => {}));
    const busy = () => !job.ended && !job.error && !job.stopped && !job.upToDate;
    let silent = 0;
    while (busy()) {
      const before = job.responses;
      if (before > 0) await exec('window.scrollTo(0, document.documentElement.scrollHeight); true');
      await this.waitForResponse(job, before > 0 ? NEXT_WAIT : FIRST_WAIT);
      if (!busy()) break;
      if (job.responses === before && !job.responses && !job.reloaded && !job.win.isDestroyed()) {
        // Nothing at all yet: the page's first requests may have gone out
        // while the debugger was re-attaching. Load it once more, watched.
        job.reloaded = true;
        console.log('🐦 X: no data seen yet; reloading the page');
        await job.watch().catch(() => {});
        job.win.webContents.reload();
        continue;
      }
      if (job.responses === before) {
        // Nothing came: either the end, or X needs a nudge (scroll up and back).
        if (++silent >= 2) {
          job.ended = true;
          if (!job.responses && !job.user) job.error = 'no-response';
          break;
        }
        await exec('window.scrollBy(0, -800); true');
      } else {
        silent = 0;
      }
      await sleep(SCROLL_GAP);
    }
    this.finishJob(job);
  }

  finishJob(job) {
    if (job.finished) return;
    // Reaching the end of the timeline makes the index complete; being
    // stopped or limited leaves it to be continued next time.
    if (job.ended && !job.error && !job.stopped && job.responses) job.complete = true;
    job.finished = true;
    this.saveIndex(job);
    const p = this.progressOf(job);
    console.log(`🐦 X: finished @${p.handle}: ${p.found} posts from ${p.tweets} tweets${p.complete ? ', complete' : ''}${p.stopped ? `, ${p.stopped}` : ''}${p.error ? `, ${p.error}` : ''}`);
    if (job.stopped !== 'new search') this.emit(job);
    job.wake?.();
    if (job.win && !job.win.isDestroyed()) job.win.destroy();
  }

  stopJob(reason) {
    const job = this.job;
    if (!job || job.finished) return;
    console.log(`🐦 X: stopping ${job.url} (${reason})`);
    job.stopped = reason;
    job.wake?.();
  }
}

function searchUrl(query) {
  return `${HOST}/search?q=${encodeURIComponent(query)}&src=typed_query&f=media`;
}

module.exports = XService;
module.exports.PARTITION = PARTITION;
module.exports.byNewest = byNewest;
module.exports.postFilter = postFilter;
