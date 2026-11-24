/**
 * e621's post format.
 *
 * On 2026-11-18 (site update 26.11.18) e621 changed /posts.json and
 * /posts/<id>.json: the list comes back bare instead of as { posts: [...] },
 * a single post bare instead of { post }, file links moved under `files`,
 * score and favourites under `stats`, and tags became one flat list with no
 * categories. Asking with v1=true still gives the old format, for about six
 * months (see E621Service.makeRequest), and Antler is written against it.
 *
 * When the new format arrives anyway, toV1 turns it back into the old one,
 * so nothing else has to change. Tag categories come from e621's tags.json,
 * looked up by the caller and passed in (see E621Service.tagCategories).
 */

// e621's tag categories by number, as tags.json gives them.
const CATEGORY_NAMES = { 0: 'general', 1: 'artist', 2: 'contributor', 3: 'copyright', 4: 'character', 5: 'species', 6: 'invalid', 7: 'meta', 8: 'lore' };
const TAG_GROUPS = ['general', 'artist', 'contributor', 'copyright', 'character', 'species', 'invalid', 'meta', 'lore'];

/** Whether a post (or a list of posts) is in the new format. */
function isV2Post(post) {
  return Boolean(post && typeof post === 'object' && post.files && !post.file);
}

/** The flat tag names of new-format posts, each once. */
function flatTags(posts) {
  const names = new Set();
  for (const post of posts) if (Array.isArray(post?.tags)) for (const tag of post.tags) names.add(tag);
  return [...names];
}

/**
 * One new-format post in the old shape.
 * @param {object} post
 * @param {Map<string, number>|object} categories - tag name -> category number; unknown tags count as general
 */
function toV1(post, categories = new Map()) {
  if (!isV2Post(post)) return post;
  const categoryOf = (tag) => (categories instanceof Map ? categories.get(tag) : categories[tag]);
  const tags = Object.fromEntries(TAG_GROUPS.map(group => [group, []]));
  for (const tag of Array.isArray(post.tags) ? post.tags : []) {
    const group = CATEGORY_NAMES[categoryOf(tag)] || 'general';
    tags[group].push(tag);
  }

  const files = post.files || {};
  const meta = files.meta || {};
  const original = files.original || {};
  const preview = files.preview || {};
  const sample = files.sample || {};
  const stats = post.stats || {};
  const score = stats.score || {};
  const relationships = post.relationships || {};
  const has = post.has || {};
  const flags = post.flags || {};

  return {
    id: post.id,
    created_at: post.created_at,
    updated_at: post.updated_at,
    change_seq: post.change_seq,
    file: {
      width: original.width ?? null,
      height: original.height ?? null,
      ext: meta.ext ?? null,
      size: meta.size ?? null,
      md5: meta.md5 ?? null,
      url: original.url ?? null
    },
    preview: { width: preview.width ?? null, height: preview.height ?? null, url: preview.jpg || preview.webp || null },
    sample: {
      has: Boolean(has.sample ?? meta.has_sample),
      width: sample.width ?? null,
      height: sample.height ?? null,
      url: sample.jpg || sample.webp || null,
      alternates: {}
    },
    score: { up: score.up ?? 0, down: score.down ?? 0, total: score.total ?? 0 },
    tags,
    locked_tags: post.locked_tags || [],
    flags: {
      pending: Boolean(flags.pending),
      flagged: Boolean(flags.flagged),
      note_locked: Boolean(flags.note_locked),
      status_locked: Boolean(flags.status_locked),
      rating_locked: Boolean(flags.rating_locked),
      deleted: Boolean(flags.deleted)
    },
    rating: post.rating,
    fav_count: stats.fav_count ?? 0,
    sources: post.sources || [],
    pools: post.pools || [],
    relationships: {
      parent_id: relationships.parent_id ?? null,
      has_children: Boolean(has.children),
      has_active_children: Boolean(has.active_children),
      children: relationships.children || []
    },
    approver_id: post.approver_id ?? null,
    uploader_id: post.uploader_id ?? null,
    uploader_name: post.uploader_name ?? null,
    description: post.description || '',
    comment_count: stats.comment_count ?? 0,
    is_favorited: Boolean(stats.is_favorited),
    has_notes: Boolean(has.notes),
    duration: meta.duration ?? null
  };
}

/**
 * A posts.json or posts/<id>.json response in the old shape:
 * { posts: [...] } or { post }. Old-format responses pass through.
 */
function responseToV1(data, categories) {
  if (Array.isArray(data)) return { posts: data.map(p => toV1(p, categories)) };
  if (isV2Post(data)) return { post: toV1(data, categories) };
  if (data && Array.isArray(data.posts) && data.posts.some(isV2Post)) return { ...data, posts: data.posts.map(p => toV1(p, categories)) };
  if (data && isV2Post(data.post)) return { ...data, post: toV1(data.post, categories) };
  return data;
}

/** The new-format posts in a response, to look their tags' categories up. */
function v2PostsIn(data) {
  if (Array.isArray(data)) return data.filter(isV2Post);
  if (isV2Post(data)) return [data];
  if (Array.isArray(data?.posts)) return data.posts.filter(isV2Post);
  if (isV2Post(data?.post)) return [data.post];
  return [];
}

module.exports = { CATEGORY_NAMES, isV2Post, flatTags, toV1, responseToV1, v2PostsIn };
