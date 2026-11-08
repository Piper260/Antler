/**
 * Review of panel tags: finds the tags the tagger and the learning are least
 * sure of, and asks about them one at a time, the ones whose answer changes
 * the most other panels first. Also answers (learns from) a correction and
 * reports which panels it changed.
 *
 * A panel here is { facts, edits, key }: facts from panelTagFacts, edits the
 * user's own { add, remove, checked, final } (checked: tags already answered;
 * final: the panel is done and these are its tags, whatever is learned
 * later), key identifying the panel for recordPanel.
 *
 * Plain script so it works in the renderer (window.PanelTagReview) and in
 * jest (module.exports).
 */
(function (root) {
  const learningApi = () => root.PanelTagLearning
    || (typeof require === 'function' ? require('./panelTagLearning') : null);

  // How far from its cutoff a tagger score still counts as unsure: a factor
  // of two for page tags, 0.2 either side for tags the tagger would add.
  const KEEP_BAND = Math.log(2);
  const ADD_BAND = 0.2;
  // Only the most unsure questions are checked for how far an answer reaches.
  const RANKED = 24;
  // Who is in a panel and what species they are matter most for training,
  // so those are asked before general tags like "fur" or "clothed".
  const TIER = { character: 0, species: 1, general: 2 };
  // A tag on every page counts as folder-wide only with this many pages to go on.
  const MIN_PAGES = 5;

  function finalTags(facts, edits, learning) {
    if (edits?.final) return edits.final;
    const remove = new Set(edits?.remove || []);
    const tags = learningApi().resolvePanelTags(facts, learning).tags.filter(tag => !remove.has(tag));
    return [...new Set([...tags, ...(edits?.add || [])])].sort();
  }

  /** Whether one tag ends up on a panel, without resolving all its tags. */
  function hasTag(facts, edits, learning, tag) {
    if (edits?.final) return edits.final.includes(tag);
    if (edits?.remove?.includes(tag)) return false;
    if (edits?.add?.includes(tag)) return true;
    if (!mayHave(facts, tag) && !facts.alwaysKeep.includes(tag)) return false;
    const only = {
      ...facts,
      known: tag in facts.known ? { [tag]: facts.known[tag] } : {},
      candidates: tag in facts.candidates ? { [tag]: facts.candidates[tag] } : {},
      alwaysKeep: facts.alwaysKeep.filter(name => name === tag),
      unknown: facts.unknown.filter(name => name === tag),
      unknownDropped: []
    };
    return learningApi().resolvePanelTags(only, learning).tags.includes(tag);
  }

  /** Whether the tag's presence on a panel is an open question at all. */
  function mayHave(facts, tag) {
    return tag in facts.known || tag in facts.candidates || facts.unknown.includes(tag);
  }

  /** Enough of a copy that answering on it leaves the original alone. */
  function cloneLearning(learning) {
    return { ...learning, keep: { ...learning.keep }, add: { ...learning.add }, examples: { ...learning.examples }, ranges: learning.ranges && { ...learning.ranges } };
  }

  /**
   * The user says `tag` is (present) or isn't on the panel. Learns from it,
   * and keeps the answer in the panel's edits even where learning gives the
   * same result today, so that later answers on other panels can't undo it.
   */
  function answer(learning, panel, tag, present) {
    const api = learningApi();
    api.learnFromEdit(learning, panel.facts, tag, present);
    api.addToRange(learning, panel.facts, tag, present);
    const edits = panel.edits || (panel.edits = { add: [], remove: [] });
    edits.add = (edits.add || []).filter(name => name !== tag);
    edits.remove = (edits.remove || []).filter(name => name !== tag);
    (present ? edits.add : edits.remove).push(tag);
    if (edits.final) {
      edits.final = edits.final.filter(name => name !== tag);
      if (present) edits.final = [...edits.final, tag].sort();
    }
    edits.checked = [...new Set([...(edits.checked || []), tag])];
    // Only what the user has answered for this panel is an example: one
    // answer says nothing about the panel's other characters.
    api.recordPanel(learning, panel.facts, finalTags(panel.facts, edits, learning), panel.key, [], edits.checked);
  }

  /** Every tag's score range, from the answers kept on the panels. */
  function scoreRanges(panels) {
    const learning = {};
    for (const { facts, edits } of panels) {
      for (const tag of edits?.checked || []) {
        const yes = edits.add?.includes(tag);
        if (yes || edits.remove?.includes(tag)) learningApi().addToRange(learning, facts, tag, Boolean(yes));
      }
    }
    return learning.ranges || { keep: {}, add: {} };
  }

  /**
   * Marks a panel done, fixing its tags as they are now, or reopens it. Done
   * vouches for who is in the panel, so its characters become examples.
   */
  function setDone(learning, panel, done) {
    const edits = panel.edits || (panel.edits = { add: [], remove: [] });
    if (!done) {
      delete edits.final;
      return;
    }
    edits.final = finalTags(panel.facts, edits, learning);
    const characters = panel.facts.unknown.filter(tag => !learning.folderWide?.[tag]);
    learningApi().recordPanel(learning, panel.facts, edits.final, panel.key, [], [...new Set([...characters, ...(edits.checked || [])])]);
  }

  /**
   * Tags the tagger can't check that are on every page seen so far, and so
   * don't vary from panel to panel. Named characters are left out: a panel
   * can still leave them out even in a set about them.
   * @param {{page: *, facts: object}[]} panels
   * @returns {Object<string, true>}
   */
  function folderWideTags(panels) {
    const pages = new Map();
    for (const { page, facts } of panels) {
      if (!pages.has(page)) pages.set(page, new Set());
      const tags = pages.get(page);
      facts.unknown.filter(tag => !facts.characters?.includes(tag)).forEach(tag => tags.add(tag));
    }
    const wide = {};
    if (pages.size < MIN_PAGES) return wide;
    const [first, ...rest] = pages.values();
    for (const tag of first) if (rest.every(tags => tags.has(tag))) wide[tag] = true;
    return wide;
  }

  /**
   * Tags on a panel worth asking about, most unsure first. `clashes` are
   * species the panel's characters aren't usually tagged with.
   * @returns {{tag: string, present: boolean, reason: string, kind: string, score?: number, closeness: number}[]}
   *   kind is character, species or general; closeness 0 is a coin toss, 1
   *   the edge of unsure. Sorted by kind, then closeness.
   */
  function uncertainTags(facts, edits, learning, clashes = []) {
    if (edits?.final) return [];
    const api = learningApi();
    const decided = new Set([...(edits?.add || []), ...(edits?.remove || []), ...(edits?.checked || [])]);
    const final = new Set(finalTags(facts, edits, learning));
    const result = api.resolvePanelTags(facts, learning);
    const found = new Map();
    const species = new Set(Object.keys(facts.speciesScores || {}));
    const ask = (tag, reason, closeness, score) => {
      if (decided.has(tag) || found.has(tag)) return;
      const kind = reason === 'unverified' || reason === 'close' ? 'character'
        : reason === 'clash' || species.has(tag) ? 'species' : 'general';
      found.set(tag, { tag, present: final.has(tag), reason, kind, closeness, ...(score === undefined ? {} : { score }) });
    };

    clashes.filter(tag => final.has(tag)).forEach(tag => ask(tag, 'clash', 0));
    result.unverified.forEach(tag => ask(tag, 'unverified', 0));
    // Characters a profile placed aren't asked: it only decides when their
    // species is clearly in the panel or clearly not.
    result.close.forEach(tag => ask(tag, 'close', 0.1));
    for (const [tag, score] of [...Object.entries(facts.known), ...Object.entries(facts.candidates)]) {
      const closeness = scoreCloseness(facts, tag, learning);
      if (closeness !== null) ask(tag, 'unsure', closeness, score);
    }
    return [...found.values()].sort(byKind);
  }

  /** How near a tag's score is to deciding it (0 a coin toss), or null when it isn't unsure. */
  function scoreCloseness(facts, tag, learning) {
    const api = learningApi();
    let distance = null;
    if (tag in facts.known) {
      const score = facts.known[tag];
      if (api.rangeCall(learning.ranges?.keep?.[tag], score) !== null) return null;
      distance = Math.abs(Math.log(Math.max(score, 1e-4) / (learning.keep[tag] ?? api.DEFAULT_KEEP))) / KEEP_BAND;
    } else if (tag in facts.candidates) {
      const score = facts.candidates[tag];
      if (api.rangeCall(learning.ranges?.add?.[tag], score) !== null) return null;
      distance = Math.abs(score - (learning.add[tag] ?? api.DEFAULT_ADD)) / ADD_BAND;
    }
    return distance !== null && distance < 1 ? distance : null;
  }

  function byKind(a, b) {
    return TIER[a.kind] - TIER[b.kind] || a.closeness - b.closeness;
  }

  /** Indexes of panels whose tags differ between two lists of tag lists. */
  function changedPanels(before, after) {
    const same = (a, b) => a.length === b.length && a.every((tag, i) => tag === b[i]);
    return before.map((tags, i) => (same(tags, after[i]) ? -1 : i)).filter(i => i >= 0);
  }

  /**
   * How many other panels `tag` is settled on if the answer for panels[index]
   * is `present`: those whose tags change, and those a score range stops
   * being unsure about though the tag stays as it was.
   */
  function reach(panels, index, tag, present, learning) {
    const trial = cloneLearning(learning);
    const panel = panels[index];
    answer(trial, { ...panel, edits: JSON.parse(JSON.stringify(panel.edits || {})) }, tag, present);
    let count = 0;
    panels.forEach((other, i) => {
      if (i === index) return;
      const closes = !other.edits?.checked?.includes(tag) && scoreCloseness(other.facts, tag, learning) !== null && scoreCloseness(other.facts, tag, trial) === null;
      if (closes || hasTag(other.facts, other.edits, learning, tag) !== hasTag(other.facts, other.edits, trial, tag)) count++;
    });
    return count;
  }

  /**
   * Questions for the panels at `indexes`: characters, then species, then
   * general tags, and within each the ones whose answer changes the most
   * other panels first. `clashesFor(index)` gives a panel's clashes. Only
   * the most unsure are ranked by reach; the rest follow with reach 0.
   * @returns {{index: number, tag: string, present: boolean, reason: string, kind: string, score?: number, closeness: number, reach: number}[]}
   */
  function reviewQueue(panels, indexes, learning, clashesFor = () => [], skipped = new Set(), memo = new Map()) {
    const questions = indexes.flatMap(index => panelQuestions(panels, index, learning, clashesFor, memo)
      .filter(item => !skipped.has(`${index}|${item.tag}`))
      .map(item => ({ index, ...item })));
    questions.sort(byKind);
    // One question per tag is ranked: one tag on many panels would otherwise
    // fill the list and leave nothing to compare it with.
    const tags = new Set();
    const ranked = [];
    const rest = [];
    for (const item of questions) {
      if (tags.has(item.tag) || ranked.length >= RANKED) rest.push({ ...item, reach: 0 });
      else {
        tags.add(item.tag);
        ranked.push({ ...item, reach: Math.max(reach(panels, item.index, item.tag, true, learning), reach(panels, item.index, item.tag, false, learning)) });
      }
    }
    ranked.sort((a, b) => TIER[a.kind] - TIER[b.kind] || b.reach - a.reach || a.closeness - b.closeness);
    return [...ranked, ...rest];
  }

  /**
   * A panel's questions, kept in `memo` by panel key. An answer only changes
   * things for its own tag, so forgetTag then drops just the panels it
   * touches and the rest aren't worked out again.
   */
  function panelQuestions(panels, index, learning, clashesFor, memo) {
    const { facts, edits, key } = panels[index];
    if (!memo.has(key)) memo.set(key, uncertainTags(facts, edits, learning, clashesFor(index)));
    return memo.get(key);
  }

  function forgetTag(memo, panels, tag) {
    panels.forEach(panel => {
      if (mayHave(panel.facts, tag)) memo.delete(panel.key);
    });
  }

  /**
   * Every tag still open on some panel, for choosing one to check across the
   * folder. `questionsFor(index)` gives a panel's questions.
   * @returns {{tag: string, kind: string, open: number, unsure: number}[]}
   *   open: panels not answered yet; unsure: those the review would ask about.
   *   Sorted by kind, then most unsure.
   */
  function tagSummary(panels, learning, questionsFor) {
    const tags = new Map();
    panels.forEach(({ facts, edits }, index) => {
      if (edits?.final) return;
      const answered = new Set([...(edits?.add || []), ...(edits?.remove || []), ...(edits?.checked || [])]);
      const speciesScores = facts.speciesScores || {};
      const note = (tag, kind) => {
        if (answered.has(tag) || learning.folderWide?.[tag]) return;
        if (!tags.has(tag)) tags.set(tag, { tag, kind, open: 0, unsure: 0 });
        tags.get(tag).open++;
      };
      facts.unknown.forEach(tag => note(tag, 'character'));
      [...Object.keys(facts.known), ...Object.keys(facts.candidates)].forEach(tag => {
        note(tag, facts.characters?.includes(tag) ? 'character' : tag in speciesScores ? 'species' : 'general');
      });
      questionsFor(index).forEach(item => {
        if (tags.has(item.tag)) tags.get(item.tag).unsure++;
      });
    });
    return [...tags.values()].sort((a, b) => TIER[a.kind] - TIER[b.kind] || b.unsure - a.unsure || b.open - a.open || a.tag.localeCompare(b.tag));
  }

  /**
   * Panels still to check for `tag`, those most likely to have it first, so
   * the mistakes gather where the tag stops applying.
   * @returns {{index: number, present: boolean, score: number}[]}
   */
  function tagPanels(panels, tag, learning, { unsureOnly = false, questionsFor = () => [], skipped = new Set() } = {}) {
    const api = learningApi();
    const found = [];
    panels.forEach(({ facts, edits }, index) => {
      if (edits?.final || !mayHave(facts, tag) || skipped.has(`${index}|${tag}`)) return;
      if ([edits?.add, edits?.remove, edits?.checked].some(list => list?.includes(tag))) return;
      if (unsureOnly && !questionsFor(index).some(item => item.tag === tag)) return;
      const score = facts.known[tag] ?? facts.candidates[tag] ?? api.examplesVerdict(learning.examples[tag], facts.signature).margin;
      found.push({ index, present: hasTag(facts, edits, learning, tag), score });
    });
    return found.sort((a, b) => b.present - a.present || b.score - a.score);
  }

  /**
   * `count` panels spread evenly from the highest score to the lowest: the
   * answers that narrow a tag's range fastest. Keeps the list's own order
   * of scores, highest first.
   */
  function spreadPanels(list, count) {
    if (list.length <= count) return [...list];
    const sorted = [...list].sort((a, b) => b.score - a.score);
    if (count === 1) return [sorted[0]];
    return Array.from({ length: count }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (count - 1))]);
  }

  const api = { finalTags, hasTag, mayHave, cloneLearning, answer, scoreRanges, spreadPanels, setDone, folderWideTags, uncertainTags, changedPanels, reach, reviewQueue, panelQuestions, forgetTag, tagSummary, tagPanels };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelTagReview = api;
})(typeof window !== 'undefined' ? window : globalThis);
