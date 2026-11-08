/**
 * Hydra's view of one image's tags, for the Tag Editor: its score for each
 * tag the image has, and the tags it is confident about that the image
 * lacks. Tags it doesn't know (artists, rare tags, most original
 * characters) get no score; that says nothing about whether they're right.
 * Tags the user has hidden are never suggested, and the suggestion limit
 * applies after they're left out.
 *
 * Tag files use spaces, the tagger's vocabulary underscores
 * (services/tagMerge.js).
 */
const { toTaggerName } = require('./tagMerge');

// A tag the image has is shown as doubtful below this score.
const DOUBTFUL_BELOW = 0.2;
// Missing tags are suggested from this score.
const SUGGEST_FROM = 0.5;
const MAX_SUGGESTIONS = 40;

const CATEGORY_NAMES = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'species', 7: 'meta', 8: 'lore' };
const toFileName = (tag) => tag.replace(/_/g, ' ');
const round = (score) => Math.round(score * 1000) / 1000;

/**
 * @param {string[]} tags - the image's tags, as in its tag file
 * @param {ArrayLike<number>} probs - Hydra's probabilities, one per vocabulary entry
 * @param {{names: string[], categories: number[], index: Map<string, number>}} vocabulary
 * @param {string[]} [hidden] - tags never to suggest (the user's list, any case, spaces or underscores)
 * @param {{all?: boolean}} [options] - all: every tag from SUGGEST_FROM up, not just the top MAX_SUGGESTIONS
 * @returns {{scores: Object<string, number|null>, categories: Object<string, string>, suggestions: {tag: string, score: number, category: string}[], doubtfulBelow: number}}
 *   categories: the e621 category of each of the image's tags Hydra knows
 */
function reviewImageTags(tags, probs, vocabulary, hidden = [], { all = false } = {}) {
  const never = new Set(hidden.map(tag => toTaggerName(String(tag).trim().toLowerCase())));
  const scores = {};
  const categories = {};
  const present = new Set();
  for (const tag of tags) {
    const i = vocabulary.index.get(toTaggerName(tag.trim().toLowerCase()));
    scores[tag] = i === undefined ? null : round(probs[i]);
    if (i === undefined) continue;
    present.add(i);
    categories[tag] = CATEGORY_NAMES[vocabulary.categories[i]] || 'general';
  }

  const suggestions = [];
  for (let i = 0; i < vocabulary.names.length; i++) {
    if (probs[i] < SUGGEST_FROM || present.has(i) || never.has(vocabulary.names[i])) continue;
    suggestions.push({
      tag: toFileName(vocabulary.names[i]),
      score: round(probs[i]),
      category: CATEGORY_NAMES[vocabulary.categories[i]] || 'general'
    });
  }
  suggestions.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
  return { scores, categories, suggestions: all ? suggestions : suggestions.slice(0, MAX_SUGGESTIONS), doubtfulBelow: DOUBTFUL_BELOW };
}

module.exports = { reviewImageTags, DOUBTFUL_BELOW, SUGGEST_FROM, MAX_SUGGESTIONS };
