/**
 * Reads the JSON that x.com's own web page fetches (its GraphQL
 * UserByScreenName, UserMedia and SearchTimeline responses) and turns tweets
 * into posts in E621Service.formatPostData's shape, like InkbunnyService.
 *
 * X changes the nesting of these responses often (timeline vs timeline_v2,
 * entries vs module items, core.screen_name vs legacy.screen_name), so tweets
 * are found by walking the whole response for `tweet_results.result` rather
 * than by a fixed path. No Electron here, so it can be tested on its own.
 *
 * Each image of a tweet is its own post: x<tweet id>, or x<tweet id>_<n>
 * when the tweet has more than one.
 */
const HOST = 'https://x.com';

const toTag = (text) => String(text).trim().toLowerCase().replace(/\s+/g, '_');

/** Every tweet object in a response, in the order X lists them. */
function findTweets(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const item of node) findTweets(item, found);
    return found;
  }
  const result = node.tweet_results?.result;
  if (result) {
    const tweet = result.__typename === 'TweetWithVisibilityResults' ? result.tweet : result;
    if (tweet?.legacy) found.push(tweet);
  }
  for (const [key, value] of Object.entries(node)) {
    // A quoted tweet or a retweet's original is someone else's post.
    if (key === 'tweet_results' || key === 'quoted_status_result' || key === 'retweeted_status_result') continue;
    findTweets(value, found);
  }
  return found;
}

function authorOf(tweet) {
  const user = tweet.core?.user_results?.result;
  return user?.core?.screen_name || user?.legacy?.screen_name || '';
}

/** "Wed Oct 10 20:19:24 +0000 2018" as ISO, or '' when it doesn't parse. */
function isoDate(text) {
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** The best file for one media item: the original image, or the top mp4. */
function mediaFiles(media) {
  if (media.type === 'video' || media.type === 'animated_gif') {
    const mp4 = (media.video_info?.variants || [])
      .filter(v => v.content_type === 'video/mp4' && v.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    const thumb = media.media_url_https || null;
    return mp4 ? { fileType: 'mp4', original: mp4.url, sample: thumb, preview: thumb } : null;
  }
  const match = String(media.media_url_https || '').match(/^(.*)\.([a-z0-9]+)$/i);
  if (!match) return null;
  const [, base, ext] = match;
  const fileType = ext.toLowerCase();
  return {
    fileType,
    original: `${base}?format=${fileType}&name=orig`,
    sample: `${base}?format=${fileType}&name=large`,
    preview: `${base}?format=${fileType}&name=small`
  };
}

/** One tweet as posts, one per image or video. Retweets give none. */
function tweetPosts(tweet) {
  const legacy = tweet.legacy;
  if (!legacy || legacy.retweeted_status_result) return [];
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  if (!media.length) return [];

  const tweetId = String(tweet.rest_id || legacy.id_str || '');
  const author = authorOf(tweet);
  const hashtags = [...new Set((legacy.entities?.hashtags || []).map(h => toTag(h.text)).filter(Boolean))];
  const text = (tweet.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || '')
    .replace(/\s*https:\/\/t\.co\/\w+\s*$/, '')
    .trim();
  const favorites = Number(legacy.favorite_count) || 0;
  const tags = { general: hashtags, species: [], character: [], artist: author ? [author] : [], copyright: [], meta: [], lore: [] };
  tags.totals = { ...Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, v.length])), total: hashtags.length + tags.artist.length };
  const link = `${HOST}/${author || 'i'}/status/${tweetId}`;

  const posts = [];
  media.forEach((item, index) => {
    const files = mediaFiles(item);
    if (!files) return;
    const id = media.length > 1 ? `x${tweetId}_${index + 1}` : `x${tweetId}`;
    posts.push({
      id,
      source: 'x',
      tags,
      metadata: {
        id,
        // X has no votes; likes stand in for score.
        score: favorites,
        upvotes: 0,
        downvotes: 0,
        favorites,
        // X only says whether the author marked it sensitive.
        rating: legacy.possibly_sensitive ? 'Explicit' : 'Unknown',
        fileType: files.fileType,
        fileSize: 0,
        dimensions: { width: Number(item.original_info?.width) || 0, height: Number(item.original_info?.height) || 0 },
        uploadedAt: isoDate(legacy.created_at),
        updatedAt: isoDate(legacy.created_at),
        sources: [link],
        description: text,
        commentCount: Number(legacy.reply_count) || 0,
        pageCount: media.length
      },
      fileUrls: { original: files.original, sample: files.sample, preview: files.preview, alternatives: {} },
      downloadInfo: {
        isDownloadable: true,
        bestUrl: { url: files.original, type: 'original', size: 0 },
        filename: `${id}.${files.fileType}`
      }
    });
  });
  return posts;
}

/**
 * Posts from a UserMedia or SearchTimeline response. With `author`, only
 * that account's own tweets are kept (case-insensitive).
 * Returns { posts, tweets } where tweets is how many tweets were listed.
 */
function postsFromResponse(json, author = '') {
  const wanted = String(author).toLowerCase();
  const tweets = findTweets(json?.data);
  const posts = [];
  for (const tweet of tweets) {
    if (wanted && authorOf(tweet).toLowerCase() !== wanted) continue;
    posts.push(...tweetPosts(tweet));
  }
  // Every tweet listed, with or without media: a timeline page of text-only
  // tweets is still progress, not the end.
  const tweetIds = tweets.map(t => String(t.rest_id || t.legacy?.id_str || '')).filter(Boolean);
  return { posts, tweets: tweets.length, tweetIds };
}

/** The account in a UserByScreenName response, or { unavailable, reason }. */
function userFromResponse(json) {
  const result = json?.data?.user?.result;
  if (!result) return { unavailable: true, reason: 'not-found' };
  if (result.__typename === 'UserUnavailable') return { unavailable: true, reason: result.reason === 'Suspended' ? 'suspended' : 'unavailable' };
  return {
    id: result.rest_id,
    screenName: result.core?.screen_name || result.legacy?.screen_name || '',
    name: result.core?.name || result.legacy?.name || '',
    mediaCount: Number(result.legacy?.media_count) || 0,
    protected: !!(result.privacy?.protected ?? result.legacy?.protected)
  };
}

/**
 * Whether a post matches every extra tag: as a hashtag, or as words in the
 * text ("red_fox" matches #redfox, #red_fox or "red fox").
 */
function matchesTags(post, tags) {
  if (!tags?.length) return true;
  const hashtags = new Set((post.tags?.general || []).map(t => t.replace(/_/g, '')));
  const text = String(post.metadata?.description || '').toLowerCase();
  return tags.every((tag) => {
    const word = String(tag).toLowerCase().replace(/^#/, '');
    return hashtags.has(word.replace(/[_\s]/g, '')) || text.includes(word.replace(/_/g, ' '));
  });
}

/** "@Name", "x.com/Name" or "https://twitter.com/Name/media" -> "Name". */
function cleanHandle(input) {
  const text = String(input || '').trim();
  const fromUrl = text.match(/(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
  return (fromUrl ? fromUrl[1] : text.replace(/^@/, '')).replace(/[^A-Za-z0-9_]/g, '');
}

// x.com paths that are pages, not accounts.
const NOT_HANDLES = new Set(['i', 'intent', 'home', 'search', 'hashtag', 'share', 'settings', 'explore', 'messages', 'notifications']);

/**
 * X handles from a list of profile links (e.g. an e621 artist's URLs),
 * deduplicated case-insensitively, in the order given.
 * Each item is a url string or { url, active }.
 */
function handlesFromUrls(urls) {
  const found = new Map();
  for (const item of urls || []) {
    const url = typeof item === 'string' ? item : item?.url;
    const match = String(url || '').match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(?=[/?#]|$)/i);
    if (!match || NOT_HANDLES.has(match[1].toLowerCase())) continue;
    const key = match[1].toLowerCase();
    const active = typeof item === 'object' ? item.active !== false : true;
    const known = found.get(key);
    if (!known) found.set(key, { handle: match[1], active });
    else if (active) known.active = true;
  }
  return [...found.values()];
}

module.exports = { handlesFromUrls, matchesTags, findTweets, tweetPosts, postsFromResponse, userFromResponse, cleanHandle, mediaFiles };
