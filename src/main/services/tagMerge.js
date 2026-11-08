/**
 * Tags for a panel cut from a tagged page. The page's tag file describes the
 * whole page; the e621 tagger (Hydra 3.5, else JTP PILOT2 or Z3D) scores what is visible in
 * the panel, and the two are merged:
 *
 *  - copyright tags apply to the whole page and are always kept;
 *  - tags the tagger doesn't know can't be checked against the panel. Their
 *    e621 category decides: characters (mostly artist-original ones),
 *    copyrights and lore are kept, characters reported as unverified;
 *    unknown general and species tags (rare tags, parent species like
 *    "ruminant") are dropped rather than put on every panel. Without a
 *    category they are kept and reported;
 *  - other page tags are kept only if the tagger sees them in the panel;
 *  - general and species tags the tagger is confident about are added.
 *
 * In testing, adding at 0.5 brought in wrong franchises, species and
 * genders, so additions need 0.7 and never include characters, artists or
 * copyrights.
 *
 * Tag files follow the download format: sorted, comma separated, spaces in
 * place of underscores.
 */

const CATEGORY = { general: 0, artist: 1, copyright: 3, character: 4, species: 5, meta: 7, lore: 8 };
// Lettering is cleaned out of the panels, so these never go in a panel's tags.
const TEXT_TAGS = new Set(['text', 'dialogue', 'speech bubble', 'page number', 'sound effects', 'black text']);
const ADDABLE = new Set([CATEGORY.general, CATEGORY.species]);
const PAGE_WIDE = new Set([CATEGORY.artist, CATEGORY.copyright, CATEGORY.character, CATEGORY.lore]);

/** Tag list from the tagger's CSV (id,name,category,post_count). */
function parseVocabulary(csv) {
  const rows = csv.trim().split(/\r?\n/).slice(1).map(line => line.split(','));
  const names = rows.map(row => row[1]);
  return {
    names,
    categories: rows.map(row => Number(row[2])),
    index: new Map(names.map((name, i) => [name, i]))
  };
}

function parseTagFile(text) {
  return text.split(',').map(tag => tag.trim()).filter(Boolean);
}

function formatTagFile(tags) {
  return [...new Set(tags)].sort().join(', ');
}

const toTaggerName = (tag) => tag.replace(/ /g, '_');
const toFileName = (tag) => tag.replace(/_/g, ' ');

const { CANDIDATE_FLOOR, resolvePanelTags } = require('../../renderer/js/utils/panelTagLearning');
const SIGNATURE_FLOOR = 0.05;
const GUESS_FLOOR = 0.4;

/**
 * What the tagger saw in one panel, relative to the page's tags: scores of
 * the page tags it knows, confident-enough tags it could add, tags that
 * apply to the whole page, unknown tags it can't check, unknown tags dropped
 * by category, and a sparse fingerprint of all its scores. The final tags
 * come from resolvePanelTags (renderer/js/utils/panelTagLearning.js), which
 * can also apply what was learned from the user's corrections.
 *
 * @param {string[]} pageTags - from the page's tag file (spaces form)
 * @param {ArrayLike<number>} scores - tagger output, one per vocabulary entry
 * @param {{names, categories, index}} vocabulary
 * @param {Map<string, number>} [categories] - e621 categories of tags the
 *   tagger doesn't know, by tagger name (underscores)
 */
function panelTagFacts(pageTags, scores, vocabulary, categories = new Map()) {
  const known = {};
  const alwaysKeep = [];
  const unknown = [];
  const unknownDropped = [];
  const characters = [];
  for (const tag of pageTags) {
    if (TEXT_TAGS.has(tag)) continue;
    const i = vocabulary.index.get(toTaggerName(tag));
    const category = i === undefined ? categories.get(toTaggerName(tag)) : vocabulary.categories[i];
    if (category === CATEGORY.character) characters.push(tag);
    if (i === undefined) {
      if (category === undefined || category === CATEGORY.character) unknown.push(tag);
      else if (PAGE_WIDE.has(category)) alwaysKeep.push(tag);
      else unknownDropped.push(tag);
    } else if (vocabulary.categories[i] === CATEGORY.copyright) {
      alwaysKeep.push(tag);
    } else {
      known[tag] = Math.round(scores[i] * 1000) / 1000;
    }
  }

  const present = new Set(pageTags.map(toTaggerName));
  const candidates = {};
  const signature = {};
  // For character profiles: which species the panel shows, and well-known
  // characters the tagger itself recognises that the page doesn't name.
  const speciesScores = {};
  const characterGuesses = {};
  for (let i = 0; i < vocabulary.names.length; i++) {
    const score = Math.round(scores[i] * 1000) / 1000;
    if (score >= SIGNATURE_FLOOR && vocabulary.categories[i] === CATEGORY.species) speciesScores[toFileName(vocabulary.names[i])] = score;
    if (score >= GUESS_FLOOR && vocabulary.categories[i] === CATEGORY.character && !present.has(vocabulary.names[i])) {
      characterGuesses[toFileName(vocabulary.names[i])] = score;
    }
    // The fingerprint is about what's in the panel, so format and source
    // tags (tall_image, monochrome, artist names) stay out of it.
    if (score >= SIGNATURE_FLOOR && ADDABLE.has(vocabulary.categories[i])) signature[i] = score;
    if (score >= CANDIDATE_FLOOR && ADDABLE.has(vocabulary.categories[i]) && !present.has(vocabulary.names[i]) && !TEXT_TAGS.has(toFileName(vocabulary.names[i]))) {
      candidates[toFileName(vocabulary.names[i])] = score;
    }
  }
  return { known, candidates, alwaysKeep, unknown, unknownDropped, signature, characters, speciesScores, characterGuesses };
}

/** The merge with nothing learned yet. */
function mergePanelTags(pageTags, scores, vocabulary, categories = new Map()) {
  return resolvePanelTags(panelTagFacts(pageTags, scores, vocabulary, categories));
}

module.exports = { parseVocabulary, parseTagFile, formatTagFile, panelTagFacts, mergePanelTags, toTaggerName };
