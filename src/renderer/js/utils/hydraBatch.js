/**
 * The Tag Editor's "Tag with Hydra" batch: from what Hydra suggested for
 * each scanned file (every tag it scored 0.5 or more that the file lacked
 * at the time), which tags to add where, for a chosen threshold and set of
 * categories. Worked out again on every change of threshold or category,
 * so the scan runs once.
 *
 * Tags are compared case-insensitively, with spaces and underscores alike,
 * against the file's tags as they are now: a tag added since the scan is
 * not added twice.
 *
 * The other way round, planRemovals finds tags a file has that Hydra scored
 * below a threshold, i.e. tags it is fairly sure aren't in the image. Tags
 * Hydra doesn't know (artists, most original characters) and protected
 * tags are never removed.
 */
(function (root) {
  const normalize = (tag) => String(tag).trim().toLowerCase().replace(/_/g, ' ');

  /**
   * @param {Array<{file: {tags: string[]}, suggestions: {tag, score, category}[]}>} scanned
   * @param {{threshold: number, categories: Set<string>, hidden?: Set<string>, excluded?: Set<string>}} options
   *   hidden: the user's never-suggest list; excluded: tags unticked in the preview (both normalized)
   * @returns {{perTag: {tag, category, files: number}[], perFile: Map<object, string[]>, total: number}}
   *   perTag counts tags that are unticked too, so they can be ticked again; perFile and total leave them out.
   */
  function planAdditions(scanned, { threshold, categories, hidden = new Set(), excluded = new Set() }) {
    const counts = new Map();
    const perFile = new Map();
    let total = 0;
    for (const { file, suggestions } of scanned) {
      const has = new Set(file.tags.map(normalize));
      const adds = [];
      for (const { tag, score, category } of suggestions) {
        const key = normalize(tag);
        if (score < threshold || !categories.has(category) || hidden.has(key) || has.has(key)) continue;
        const entry = counts.get(key) || { tag, category, files: 0 };
        entry.files++;
        counts.set(key, entry);
        if (excluded.has(key)) continue;
        has.add(key);
        adds.push(tag);
      }
      if (adds.length) {
        perFile.set(file, adds);
        total += adds.length;
      }
    }
    const perTag = [...counts.values()].sort((a, b) => b.files - a.files || a.tag.localeCompare(b.tag));
    return { perTag, perFile, total };
  }

  /**
   * @param {Array<{file: {tags: string[]}, scores: Object<string, number|null>, categories: Object<string, string>}>} scanned
   * @param {{threshold: number, categories: Set<string>, protectedTags?: Set<string>, excluded?: Set<string>, agreeFrom?: number}} options
   *   protectedTags: lower-case tags never to remove; excluded: tags unticked in the preview (normalized)
   * @returns {{perTag: {tag, category, files: number, agree: number, remove: number}[], perFile: Map<object, string[]>, total: number}}
   *   perTag lists every tag Hydra knows in the scanned files, with how many
   *   have it, how many of those Hydra agrees with (agreeFrom and up) and how
   *   many it would remove; unticked tags are counted but not removed.
   */
  function planRemovals(scanned, { threshold, categories, protectedTags = new Set(), excluded = new Set(), agreeFrom = 0.5 }) {
    const stats = new Map();
    const perFile = new Map();
    let total = 0;
    for (const { file, scores = {}, categories: tagCategories = {} } of scanned) {
      const current = new Set(file.tags.map(normalize));
      const removes = [];
      for (const [tag, score] of Object.entries(scores)) {
        const key = normalize(tag);
        // Scores belong to the tags the file had when scanned; one removed since doesn't count.
        if (score === null || !current.has(key)) continue;
        const category = tagCategories[tag] || 'general';
        const entry = stats.get(key) || { tag, category, files: 0, agree: 0, remove: 0 };
        entry.files++;
        if (score >= agreeFrom) entry.agree++;
        stats.set(key, entry);
        if (score >= threshold || !categories.has(category) || protectedTags.has(tag.trim().toLowerCase())) continue;
        entry.remove++;
        if (excluded.has(key)) continue;
        removes.push(file.tags.find(existing => normalize(existing) === key));
      }
      if (removes.length) {
        perFile.set(file, removes);
        total += removes.length;
      }
    }
    const perTag = [...stats.values()].sort((a, b) => b.remove - a.remove || b.files - a.files || a.tag.localeCompare(b.tag));
    return { perTag, perFile, total };
  }

  /** The tags without `removed`, with where each was, so it can be put back in place. */
  function removeTags(tags, removed) {
    const remove = new Set(removed.map(normalize));
    const kept = [];
    const taken = [];
    tags.forEach((tag, index) => {
      if (remove.has(normalize(tag))) taken.push({ tag, index });
      else kept.push(tag);
    });
    return { tags: kept, taken };
  }

  /** Puts removed tags back where they were, unless the file has them again. */
  function restoreRemoved(tags, taken) {
    const out = [...tags];
    const has = new Set(out.map(normalize));
    for (const { tag, index } of taken) {
      if (has.has(normalize(tag))) continue;
      out.splice(Math.min(index, out.length), 0, tag);
      has.add(normalize(tag));
    }
    return out;
  }

  /**
   * How well Hydra agrees with each tag across the scanned files, for the
   * All Tags list. Only files that still have the tag count, and only tags
   * Hydra knows get an entry.
   * @returns {Map<string, {scored: number, mean: number, agree: number, doubted: number}>} by normalized tag
   */
  function tagAgreement(scanned, { agreeFrom = 0.5, doubtBelow = 0.2 } = {}) {
    const sums = new Map();
    for (const { file, scores = {} } of scanned) {
      const current = new Set(file.tags.map(normalize));
      for (const [tag, score] of Object.entries(scores)) {
        const key = normalize(tag);
        if (score === null || !current.has(key)) continue;
        const entry = sums.get(key) || { scored: 0, total: 0, agree: 0, doubted: 0 };
        entry.scored++;
        entry.total += score;
        if (score >= agreeFrom) entry.agree++;
        if (score < doubtBelow) entry.doubted++;
        sums.set(key, entry);
      }
    }
    const out = new Map();
    for (const [key, { scored, total, agree, doubted }] of sums) {
      out.set(key, { scored, mean: Math.round((total / scored) * 1000) / 1000, agree, doubted });
    }
    return out;
  }

  /** Takes the tags a batch added back off a file, if they're still there; the file's other edits stay. */
  function withoutAdded(tags, added) {
    const remove = new Set(added.map(normalize));
    return tags.filter(tag => !remove.has(normalize(tag)));
  }

  const api = { normalize, planAdditions, withoutAdded, planRemovals, removeTags, restoreRemoved, tagAgreement };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HydraBatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
