/**
 * Training suitability score for e621 posts (0-100), used by Artist/Character
 * Search to rank results for LoRA datasets.
 *
 * Works on posts as formatted by E621Service.formatPostData: tags grouped by
 * category, metadata.fileType / dimensions / score / favorites.
 *
 * A post starts at 85 and loses points for things that hurt training
 * (low resolution, odd shapes, text, comics, extra characters, edits). Up to
 * 15 points come back from community rating, scaled against the best post in
 * the same batch so niche artists aren't penalised for having small numbers.
 * Videos and animations are excluded (score 0).
 */
(function (root) {
  const BASE = 85;
  const COMMUNITY_MAX = 15;
  const TAG_PENALTY_CAP = 50;

  const STILL_IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp']);

  // General/meta tags that make an image a worse training example.
  const TAG_PENALTIES = {
    ai_generated: 40,
    comic: 25,
    multiple_images: 20,
    low_res: 20,
    screencap: 15,
    dialogue: 15,
    speech_bubble: 15,
    sketch: 15,
    jpeg_artifacts: 15,
    text: 10,
    watermark: 10,
    monochrome: 10,
    greyscale: 10,
    line_art: 10,
    unfinished: 10,
    censored: 10,
    meme: 10,
    colored_sketch: 8,
    signature: 3
  };

  // Character mode: the subject should be alone in the frame.
  const CROWD_PENALTIES = { duo: 15, trio: 20, group: 25 };

  // Artist mode: the image should be that artist's own, unaltered work.
  const EDIT_PENALTIES = { 'third-party_edit': 25, traced: 20, edit: 10 };

  // Artist-category tags that aren't real artists.
  const NOT_ARTISTS = new Set(['unknown_artist', 'anonymous_artist', 'conditional_dnp', 'avoid_posting', 'sound_warning', 'epilepsy_warning']);

  const label = tag => tag.replace(/_/g, ' ');

  function resolutionPenalty(width, height) {
    const short = Math.min(width, height);
    if (!short) return null;
    if (short >= 1024) return null;
    if (short >= 768) return { delta: -10, label: `under 1024px (${short}px)` };
    if (short >= 512) return { delta: -25, label: `under 768px (${short}px)` };
    return { delta: -45, label: `under 512px (${short}px)` };
  }

  function aspectPenalty(width, height) {
    if (!width || !height) return null;
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (ratio > 3) return { delta: -25, label: `very ${width > height ? 'wide' : 'tall'} (${ratio.toFixed(1)}:1)` };
    if (ratio > 2) return { delta: -10, label: `${width > height ? 'wide' : 'tall'} (${ratio.toFixed(1)}:1)` };
    return null;
  }

  /**
   * Batch-wide maxima used to scale community rating.
   */
  function batchStats(posts) {
    let maxScore = 0;
    let maxFavs = 0;
    for (const post of posts) {
      maxScore = Math.max(maxScore, post.metadata?.score || 0);
      maxFavs = Math.max(maxFavs, post.metadata?.favorites || 0);
    }
    return { maxScore, maxFavs };
  }

  /**
   * Score one post. mode is 'artist' or 'character'.
   * Returns { score, excluded, reasons: [{ delta, label }] }.
   */
  function scorePost(post, mode = 'artist', stats = batchStats([post])) {
    const meta = post.metadata || {};
    const tags = post.tags || {};
    const ext = String(meta.fileType || '').toLowerCase();

    if (!STILL_IMAGE.has(ext)) {
      return { score: 0, excluded: true, reasons: [{ delta: 0, label: `not a still image (${ext || 'unknown'})` }] };
    }

    const reasons = [];
    const add = r => { if (r) reasons.push(r); };
    const width = meta.dimensions?.width || 0;
    const height = meta.dimensions?.height || 0;
    // Pawchive gives no size, score, favourites or (mostly) tags. Missing
    // isn't bad: such posts aren't marked down for it, so they rank fairly
    // beside e621 posts instead of sinking to the bottom.
    const unrated = post.source === 'pawchive';

    if (width && height) {
      add(resolutionPenalty(width, height));
      add(aspectPenalty(width, height));
    } else if (unrated) {
      add({ delta: 0, label: 'size unknown' });
    } else {
      add(resolutionPenalty(width, height));
      add(aspectPenalty(width, height));
    }

    const present = new Set([...(tags.general || []), ...(tags.meta || [])]);
    const tagReasons = [];
    for (const [tag, weight] of Object.entries(TAG_PENALTIES)) {
      if (present.has(tag)) tagReasons.push({ delta: -weight, label: label(tag) });
    }

    if (mode === 'character') {
      for (const [tag, weight] of Object.entries(CROWD_PENALTIES)) {
        if (present.has(tag)) tagReasons.push({ delta: -weight, label: label(tag) });
      }
      const extraCharacters = Math.max(0, (tags.character || []).length - 1);
      if (extraCharacters) tagReasons.push({ delta: -Math.min(24, extraCharacters * 8), label: `${extraCharacters} other character${extraCharacters > 1 ? 's' : ''}` });
    } else {
      for (const [tag, weight] of Object.entries(EDIT_PENALTIES)) {
        if (present.has(tag)) tagReasons.push({ delta: -weight, label: label(tag) });
      }
      const artists = (tags.artist || []).filter(a => !NOT_ARTISTS.has(a));
      if (artists.length > 1) tagReasons.push({ delta: -15, label: `collab (${artists.length} artists)` });
    }

    // Many flaws shouldn't sink a post below what a tiny image gets on its own.
    const tagTotal = tagReasons.reduce((sum, r) => sum + r.delta, 0);
    if (tagTotal < -TAG_PENALTY_CAP) {
      reasons.push(...tagReasons, { delta: -TAG_PENALTY_CAP - tagTotal, label: 'tag penalties capped' });
    } else {
      reasons.push(...tagReasons);
    }

    const generalCount = (tags.general || []).length;
    if (unrated) {
      // Tag with Hydra after downloading; the count here says nothing yet.
    } else if (generalCount < 15) add({ delta: -15, label: `few tags (${generalCount})` });
    else if (generalCount < 25) add({ delta: -7, label: `light tagging (${generalCount})` });

    const share = (value, max) => (max > 0 ? Math.log1p(Math.max(0, value)) / Math.log1p(max) : 0);
    const community = unrated
      ? Math.round(COMMUNITY_MAX / 2)
      : Math.round(COMMUNITY_MAX * (share(meta.score || 0, stats.maxScore) + share(meta.favorites || 0, stats.maxFavs)) / 2);
    if (community) reasons.push({ delta: community, label: unrated ? 'no rating on Pawchive (counted as average)' : 'community rating' });

    const total = BASE + reasons.reduce((sum, r) => sum + r.delta, 0);
    return { score: Math.max(0, Math.min(100, Math.round(total))), excluded: false, reasons };
  }

  /**
   * Score a batch in place (sets post.training) and return the posts ranked
   * best first; excluded posts go last. The sort is stable, so ties keep
   * e621's order.
   */
  function rankPosts(posts, mode = 'artist') {
    const stats = batchStats(posts);
    for (const post of posts) post.training = scorePost(post, mode, stats);
    return [...posts].sort((a, b) => (a.training.excluded - b.training.excluded) || (b.training.score - a.training.score));
  }

  /**
   * One-line explanation for a card's tooltip.
   */
  function describe(training) {
    if (!training) return '';
    const parts = training.reasons.map(r => (r.delta ? `${r.delta > 0 ? '+' : ''}${r.delta} ${r.label}` : r.label));
    return `Training score ${training.score}${parts.length ? `: ${parts.join(', ')}` : ''}`;
  }

  const api = { BASE, COMMUNITY_MAX, TAG_PENALTY_CAP, scorePost, rankPosts, batchStats, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
