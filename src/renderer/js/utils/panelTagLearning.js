/**
 * Panel tags, worked out from what the tagger saw in a panel ("panel facts",
 * built in main/services/tagMerge.js) and what has been learned from the
 * user's corrections in the Panel tags pane.
 *
 * Three kinds of learning:
 *  - Cutoffs per tag. Every tag starts with the same cutoffs (keep a page
 *    tag at 0.2, add a new one at 0.7), but the tagger is surer of some tags
 *    than others. Restoring a tag the tagger scored s lowers that tag's
 *    cutoff to a quarter under s; removing one raises it about 15% over s.
 *    Other panels scored about as unsure follow.
 *  - Score ranges per tag. A cutoff only moves, so the scores near it stay
 *    unsure however often they are answered. A range narrows instead: a Yes
 *    at score s settles higher scores as Yes and a No settles lower ones as
 *    No, leaving only the gap between them, so a tag takes a handful of
 *    answers however many panels it is on. Worked out from the answers
 *    themselves (PanelTagReview.scoreRanges), never saved.
 *  - Who's in a panel, for tags the tagger can't score (mostly characters)
 *    or scores near zero even where they belong. Each panel has a
 *    fingerprint: its tagger scores, which describe species, colours,
 *    clothing and so on. Panels the user has corrected are examples, with or
 *    without each such tag; a tag goes on another panel when that panel
 *    looks more like an example that has it than one that doesn't. For tags
 *    the tagger does score, examples only ever add a tag the cutoff missed.
 *    A character's profile (utils/characterProfiles.js, kept in
 *    learning.profiles) decides from species: a panel showing sheep gets
 *    the page's sheep character, and not the otter one, even over examples
 *    unless one is a near-identical panel, since a panel with two
 *    characters looks like examples of either. Examples decide what species
 *    can't: two red foxes, say.
 *
 * Plain script so it works in the renderer (window.PanelTagLearning) and in
 * the main process and jest (module.exports).
 */
(function (root) {
  const DEFAULT_KEEP = 0.2;
  const DEFAULT_ADD = 0.7;
  // Facts only list addable tags from this score up, so an add cutoff can't
  // be learned lower than it.
  const CANDIDATE_FLOOR = 0.3;
  const MIN_KEEP = 0.02;
  // How far past the corrected score a learned cutoff goes, as a share of
  // it, so similar scores on other panels follow the correction.
  const RESTORE_MARGIN = 0.25;
  const REMOVE_MARGIN = 0.15;
  const below = (score) => score - Math.max(0.01, score * RESTORE_MARGIN);
  const above = (score) => score + Math.max(0.01, score * REMOVE_MARGIN);
  // With only "doesn't have it" examples, a panel has to look nearly the
  // same as one of them before the tag is dropped.
  const SAME_PANEL = 0.9;
  // A panel about as like an example with the tag as one without it is a
  // close call: a character's profile decides it if it can, and review asks.
  const CLOSE_CALL = 0.1;
  const MAX_EXAMPLES = 40;
  // A range only decides anything with this many answers behind it.
  const MIN_RANGE_ANSWERS = 3;

  function emptyLearning() {
    return { keep: {}, add: {}, examples: {}, profiles: {} };
  }

  /** true / false when the score is outside the unsure gap, else null. */
  function rangeCall(range, score) {
    if (!range || range.yes + range.no < MIN_RANGE_ANSWERS) return null;
    const aboveYes = range.yes > 0 && score >= range.lowYes;
    const belowNo = range.no > 0 && score <= range.highNo;
    return aboveYes === belowNo ? null : aboveYes;
  }

  /**
   * Widens a tag's range with an answer. Page tags and tags the tagger would
   * add have separate ranges, the page's tags being a different starting
   * point, and named characters have none: who is in a panel isn't left to a score.
   */
  function addToRange(learning, facts, tag, present) {
    const side = tag in facts.known ? 'keep' : tag in facts.candidates ? 'add' : null;
    if (!side || facts.characters?.includes(tag)) return;
    const score = side === 'keep' ? facts.known[tag] : facts.candidates[tag];
    const ranges = learning.ranges || (learning.ranges = { keep: {}, add: {} });
    const range = ranges[side][tag] || { yes: 0, no: 0, lowYes: Infinity, highNo: -Infinity };
    // A new object each time: review tries answers out on shallow copies.
    ranges[side] = {
      ...ranges[side],
      [tag]: present
        ? { ...range, yes: range.yes + 1, lowYes: Math.min(range.lowYes, score) }
        : { ...range, no: range.no + 1, highNo: Math.max(range.highNo, score) }
    };
  }

  const profileApi = () => root.CharacterProfiles
    || (typeof require === 'function' ? require('./characterProfiles') : null);

  const verdicts = new WeakMap(); // examples list -> panel signature -> verdict

  /** Cosine similarity of two sparse fingerprints ({ index: score }). */
  function similarity(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const key in a) {
      na += a[key] * a[key];
      if (key in b) dot += a[key] * b[key];
    }
    for (const key in b) nb += b[key] * b[key];
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }

  /**
   * { present: true / false from the examples, or null when they don't
   * decide it; close: only just decided; sure: decided by a near-identical
   * panel; margin: how much more the panel looks like an example with the
   * tag than one without it }
   */
  function examplesVerdict(examples, signature) {
    if (!examples || !examples.length) return { present: null, close: false, sure: false, margin: 0 };
    // Comparing a panel with every example adds up over hundreds of panels.
    // recordPanel replaces a tag's list, so a list's verdicts never go stale.
    if (!verdicts.has(examples)) verdicts.set(examples, new WeakMap());
    const known = verdicts.get(examples);
    if (!known.has(signature)) known.set(signature, compareExamples(examples, signature));
    return known.get(signature);
  }

  function compareExamples(examples, signature) {
    const best = (present) => Math.max(-1, ...examples.filter(e => e.present === present).map(e => similarity(signature, e.signature)));
    const withTag = best(true);
    const withoutTag = best(false);
    if (withTag > -1 && withoutTag > -1) {
      const present = withTag >= withoutTag;
      return { present, close: Math.abs(withTag - withoutTag) < CLOSE_CALL, sure: Math.max(withTag, withoutTag) >= SAME_PANEL, margin: withTag - withoutTag };
    }
    if (withoutTag >= SAME_PANEL) return { present: false, close: false, sure: true, margin: -withoutTag };
    if (withTag >= SAME_PANEL) return { present: true, close: false, sure: true, margin: withTag };
    return { present: null, close: false, sure: false, margin: 0 };
  }

  /** true / false from the examples, or null when they don't decide it. */
  function predictPresence(examples, signature) {
    return examplesVerdict(examples, signature).present;
  }

  /**
   * @param {object} facts - from panelTagFacts: known, candidates, alwaysKeep, unknown, unknownDropped, signature
   * @param {object} [learning] - from emptyLearning, updated by learnFromEdit
   * @returns {{tags: string[], added: string[], dropped: string[], unverified: string[], learned: string[], profiled: string[], close: string[]}}
   *   `learned` lists tags whose outcome differs from the untrained default
   *   or was decided from examples; `profiled` the characters decided by
   *   their profile; `close` tags the examples only just decided.
   */
  function resolvePanelTags(facts, learning = emptyLearning()) {
    const tags = [...facts.alwaysKeep];
    const dropped = [...facts.unknownDropped];
    const added = [];
    const unverified = [];
    const learned = [];
    const profiled = [];
    const close = [];

    const looksLikeIt = (tag) => predictPresence(learning.examples[tag], facts.signature) === true;
    for (const [tag, score] of Object.entries(facts.known)) {
      const keep = rangeCall(learning.ranges?.keep?.[tag], score) ?? (score >= (learning.keep[tag] ?? DEFAULT_KEEP) || looksLikeIt(tag));
      (keep ? tags : dropped).push(tag);
      if (keep !== (score >= DEFAULT_KEEP)) learned.push(tag);
    }
    for (const [tag, score] of Object.entries(facts.candidates)) {
      const add = rangeCall(learning.ranges?.add?.[tag], score) ?? (score >= (learning.add[tag] ?? DEFAULT_ADD) || looksLikeIt(tag));
      if (add) {
        tags.push(tag);
        added.push(tag);
      }
      if (add !== (score >= DEFAULT_ADD)) learned.push(tag);
    }
    for (const tag of facts.unknown) {
      // On every page of the folder (see folderWideTags), so not a question
      // of who is in this panel: usually the dataset's own trigger word.
      if (learning.folderWide?.[tag]) {
        tags.push(tag);
        continue;
      }
      // A character's species clearly in the panel, or clearly not while
      // another character's is, settles it unless a near-identical panel was
      // corrected: panels with two characters look like examples of either.
      const fromProfile = profileApi() && facts.speciesScores
        ? profileApi().presenceFromProfiles(tag, facts.characters || [], learning.profiles || {}, facts.speciesScores)
        : null;
      const verdict = examplesVerdict(learning.examples[tag], facts.signature);
      let present = verdict.present;
      let source = learned;
      if (fromProfile !== null && !verdict.sure) {
        present = fromProfile;
        source = profiled;
      }
      if (source === learned && verdict.close) close.push(tag);
      if (present === null) {
        tags.push(tag);
        unverified.push(tag);
      } else {
        (present ? tags : dropped).push(tag);
        source.push(tag);
      }
    }

    return { tags: [...new Set(tags)].sort(), added, dropped, unverified, learned, profiled, close };
  }

  /**
   * Learn from the user putting `tag` on a panel (present) or taking it off.
   * Unknown tags are learned through recordPanel instead.
   */
  function learnFromEdit(learning, facts, tag, present) {
    if (tag in facts.known) {
      const score = facts.known[tag];
      const cutoff = learning.keep[tag] ?? DEFAULT_KEEP;
      if (present && score < cutoff) learning.keep[tag] = Math.max(MIN_KEEP, below(score));
      if (!present && score >= cutoff) learning.keep[tag] = above(score);
    } else if (tag in facts.candidates) {
      const score = facts.candidates[tag];
      const cutoff = learning.add[tag] ?? DEFAULT_ADD;
      if (present && score < cutoff) learning.add[tag] = Math.max(CANDIDATE_FLOOR, below(score));
      if (!present && score >= cutoff) learning.add[tag] = above(score);
    }
  }

  /**
   * A panel the user has corrected becomes an example, with or without each
   * tag being learned this way: the unknown tags on its page, `extraTags`
   * (the tag just corrected) and every tag that already has examples, or
   * just `onlyTags` when given. `key` identifies the panel, so later
   * corrections replace its earlier example.
   */
  function recordPanel(learning, facts, finalTags, key, extraTags = [], onlyTags = null) {
    const final = new Set(finalTags);
    const tracked = new Set(onlyTags || [...facts.unknown, ...extraTags, ...Object.keys(learning.examples)]);
    for (const tag of tracked) {
      const examples = (learning.examples[tag] || []).filter(e => e.key !== key);
      examples.push({ key, present: final.has(tag), signature: facts.signature });
      // Each side has its own limit: a long run of one answer must not push
      // out everything known about the other.
      learning.examples[tag] = [true, false].flatMap(present => examples.filter(e => e.present === present).slice(-MAX_EXAMPLES));
    }
  }

  const api = { CLOSE_CALL, DEFAULT_KEEP, DEFAULT_ADD, CANDIDATE_FLOOR, emptyLearning, similarity, examplesVerdict, predictPresence, rangeCall, addToRange, resolvePanelTags, learnFromEdit, recordPanel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelTagLearning = api;
})(typeof window !== 'undefined' ? window : globalThis);
