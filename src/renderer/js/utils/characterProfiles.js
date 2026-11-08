/**
 * Character profiles: what a character is usually tagged with on e621,
 * counted from a few hundred of their posts (tags only, no images). Nick
 * Wilde comes out as fox, red fox, canine and so on with how often each
 * appears; an artist's own character the same way.
 *
 * Profiles are used three ways in the Panel tags pane:
 *  - species evidence: a panel the tagger sees as sheep likely shows the
 *    page's sheep character, before any correction;
 *  - tags that fit or clash with the characters in a panel;
 *  - typical tags missing from a panel, as suggestions.
 *
 * Plain script so it works in the renderer (window.CharacterProfiles) and in
 * jest (module.exports).
 */
(function (root) {
  const SPECIES_MIN = 0.05;
  const TRAIT_MIN = 0.2;
  const MAX_TRAITS = 40;
  // A species counts as the character's when at least this share of their
  // posts carry it; "typical" suggestions need TYPICAL.
  const OWN_SPECIES = 0.3;
  const TYPICAL = 0.6;
  // Species in at least this share of a character's posts are theirs for
  // telling characters apart. Lower shares are often a frequent partner's
  // species, since profiles count every tag on the character's posts.
  const DISTINCTIVE = 0.8;
  // ...and only tell them apart when no other page character carries the
  // species within this much of it: Nick Wilde is a red fox in 70% of his
  // posts, so red fox (91%) doesn't single out Gideon Grey, while Nick's 56%
  // rabbit, from posts with Judy Hopps, leaves rabbit (97%) as Judy's.
  const DISTINCT_GAP = 0.3;
  // Tagger species score that counts as seeing the character's species.
  const SEEN = 0.3;
  const NOT_SEEN = 0.1;

  const spaced = (tag) => tag.replace(/_/g, ' ');

  /**
   * @param {string} name - character tag, spaces form
   * @param {object[]} posts - e621 posts with tags grouped by category
   */
  function buildCharacterProfile(name, posts) {
    const count = (category) => {
      const counts = new Map();
      for (const post of posts) {
        for (const tag of new Set(post.tags?.[category] || [])) counts.set(spaced(tag), (counts.get(spaced(tag)) || 0) + 1);
      }
      return [...counts].map(([tag, n]) => [tag, Math.round((n / posts.length) * 100) / 100]);
    };
    if (!posts.length) return { name, posts: 0, species: {}, traits: {} };
    const species = Object.fromEntries(count('species').filter(([, share]) => share >= SPECIES_MIN));
    const traits = Object.fromEntries(count('general')
      .filter(([, share]) => share >= TRAIT_MIN)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TRAITS));
    return { name, posts: posts.length, species, traits };
  }

  /** How strongly a panel's species scores suggest this character (0..1). */
  function speciesEvidence(profile, speciesScores, species = Object.keys(profile?.species || {}).filter(tag => profile.species[tag] >= OWN_SPECIES)) {
    let best = 0;
    for (const tag of species) best = Math.max(best, speciesScores[tag] || 0);
    return best;
  }

  /**
   * A character's species that tell them apart from the page's other
   * characters: common in their posts and not as common in the others'.
   * "mammal" on every character's profile says nothing about who's in a
   * panel.
   */
  function distinctiveSpecies(name, pageCharacters, profiles) {
    const species = profiles[name]?.species || {};
    const others = pageCharacters.filter(other => other !== name).map(other => profiles[other]?.species || {});
    return Object.keys(species).filter(tag => species[tag] >= DISTINCTIVE
      && others.every(other => (other[tag] || 0) <= species[tag] - DISTINCT_GAP));
  }

  /**
   * Whether a page character is in a panel from species alone: true when the
   * panel shows a species that tells them apart from the page's other
   * characters; false when it shows none of their main species at all while
   * another page character's are there; otherwise null (undecided). Two
   * characters of the same species can't be told apart this way, only ruled
   * out together.
   */
  function presenceFromProfiles(name, pageCharacters, profiles, speciesScores) {
    const profile = profiles?.[name];
    if (!profile || !profile.posts) return null;
    const distinctive = distinctiveSpecies(name, pageCharacters, profiles);
    if (distinctive.length && speciesEvidence(profile, speciesScores, distinctive) >= SEEN) return true;

    // Main species, minus ones every page character has ("mammal").
    const mainOf = (character) => Object.keys(profiles[character]?.species || {}).filter(tag => profiles[character].species[tag] >= DISTINCTIVE);
    const profiled = pageCharacters.filter(character => profiles[character]?.posts);
    const main = (character) => mainOf(character).filter(tag => !profiled.every(other => mainOf(other).includes(tag)));
    // Judge absence by what tells this character apart when anything does
    // (Finnick's "fennec fox" among foxes), else by their main species.
    const own = distinctive.length ? distinctive : main(name);
    const otherSeen = profiled.some(other => other !== name
      && speciesEvidence(profiles[other], speciesScores, main(other)) >= SEEN);
    if (own.length && speciesEvidence(profile, speciesScores, own) < NOT_SEEN && otherSeen) return false;
    return null;
  }

  /** The best share of `tag` across the given profiles, with whose it is. */
  function fit(tag, profileList) {
    let best = { share: 0, name: null };
    for (const profile of profileList) {
      const share = Math.max(profile.species?.[tag] || 0, profile.traits?.[tag] || 0);
      if (share > best.share) best = { share, name: profile.name };
    }
    return best;
  }

  /** Typical tags of these characters that the panel doesn't have yet. */
  function suggestions(profileList, tags) {
    const have = new Set(tags);
    const out = new Map();
    for (const profile of profileList) {
      for (const [tag, share] of [...Object.entries(profile.species || {}), ...Object.entries(profile.traits || {})]) {
        if (share >= TYPICAL && !have.has(tag) && share > (out.get(tag)?.share || 0)) out.set(tag, { tag, share, name: profile.name });
      }
    }
    return [...out.values()].sort((a, b) => b.share - a.share);
  }

  const api = { OWN_SPECIES, TYPICAL, buildCharacterProfile, speciesEvidence, distinctiveSpecies, presenceFromProfiles, fit, suggestions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterProfiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
