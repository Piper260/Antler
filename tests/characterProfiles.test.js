const { buildCharacterProfile, speciesEvidence, distinctiveSpecies, presenceFromProfiles, fit, suggestions } = require('../src/renderer/js/utils/characterProfiles');

const post = (species, general = []) => ({ tags: { species, general } });

describe('buildCharacterProfile', () => {
  test('counts how often species and traits appear', () => {
    const profile = buildCharacterProfile('nick wilde', [
      post(['fox', 'red_fox', 'canine'], ['green_eyes', 'shirt']),
      post(['fox', 'canine'], ['green_eyes']),
      post(['fox', 'red_fox', 'canine'], ['green_eyes', 'tie']),
      post(['fox', 'canine'], ['shirt'])
    ]);
    expect(profile.posts).toBe(4);
    expect(profile.species).toEqual({ fox: 1, 'red fox': 0.5, canine: 1 });
    expect(profile.traits['green eyes']).toBe(0.75);
    expect(profile.traits.tie).toBe(0.25);
  });

  test('handles a character with no usable posts', () => {
    expect(buildCharacterProfile('x', [])).toEqual({ name: 'x', posts: 0, species: {}, traits: {} });
  });
});

describe('presence from profiles', () => {
  const profiles = {
    andy: { name: 'andy', posts: 50, species: { sheep: 0.9, bovid: 0.95, mammal: 1 }, traits: {} },
    lucas: { name: 'lucas', posts: 50, species: { otter: 0.85, mustelid: 0.9, mammal: 1, canid: 0.7 }, traits: {} }
  };
  const page = ['andy', 'lucas'];

  test('species evidence uses the character\'s own species', () => {
    expect(speciesEvidence(profiles.andy, { sheep: 0.7, otter: 0.9 })).toBe(0.7);
  });

  test('only species that tell the characters apart count', () => {
    expect(distinctiveSpecies('andy', page, profiles)).toEqual(['sheep', 'bovid']);
    expect(distinctiveSpecies('lucas', page, profiles)).toEqual(['otter', 'mustelid']);
  });

  test('a species another character is often drawn as does not tell them apart', () => {
    // Shares from the real e621 profiles.
    const zootopia = {
      gideon: { posts: 320, species: { fox: 1, 'red fox': 0.91, rabbit: 0.38 } },
      nick: { posts: 320, species: { fox: 0.98, 'red fox': 0.7, rabbit: 0.56 } },
      judy: { posts: 320, species: { rabbit: 0.97, fox: 0.47, 'red fox': 0.28 } }
    };
    const names = Object.keys(zootopia);
    expect(distinctiveSpecies('gideon', names, zootopia)).toEqual([]);
    expect(distinctiveSpecies('judy', names, zootopia)).toEqual(['rabbit']);
  });

  test('a sheep panel has the sheep character, not the otter', () => {
    const sheepPanel = { sheep: 0.8, bovid: 0.9, mammal: 0.95 };
    expect(presenceFromProfiles('andy', page, profiles, sheepPanel)).toBe(true);
    expect(presenceFromProfiles('lucas', page, profiles, sheepPanel)).toBe(false);
  });

  test('a panel with both species has both characters', () => {
    const both = { sheep: 0.5, mustelid: 0.6 };
    expect(presenceFromProfiles('andy', page, profiles, both)).toBe(true);
    expect(presenceFromProfiles('lucas', page, profiles, both)).toBe(true);
  });

  test('characters sharing a species are ruled out together, not told apart', () => {
    const zoo = {
      nick: { name: 'nick', posts: 50, species: { fox: 1, 'red fox': 0.9, mammal: 1 }, traits: {} },
      gideon: { name: 'gideon', posts: 50, species: { fox: 1, 'red fox': 0.95, mammal: 1 }, traits: {} },
      judy: { name: 'judy', posts: 50, species: { rabbit: 0.95, lagomorph: 0.97, mammal: 1 }, traits: {} }
    };
    const cast = ['nick', 'gideon', 'judy'];
    const judyPanel = { rabbit: 0.9, lagomorph: 0.9, mammal: 0.99, fox: 0.01 };
    const foxPanel = { fox: 0.95, 'red fox': 0.9, mammal: 0.99 };
    expect(presenceFromProfiles('judy', cast, zoo, judyPanel)).toBe(true);
    expect(presenceFromProfiles('nick', cast, zoo, judyPanel)).toBe(false);
    expect(presenceFromProfiles('gideon', cast, zoo, judyPanel)).toBe(false);
    expect(presenceFromProfiles('nick', cast, zoo, foxPanel)).toBeNull();
    expect(presenceFromProfiles('gideon', cast, zoo, foxPanel)).toBeNull();
    expect(presenceFromProfiles('judy', cast, zoo, foxPanel)).toBe(false);
  });

  test('undecided without evidence either way', () => {
    expect(presenceFromProfiles('andy', page, profiles, { sheep: 0.15, mammal: 0.9 })).toBeNull();
    expect(presenceFromProfiles('nobody', page, profiles, { sheep: 0.9 })).toBeNull();
  });
});

describe('fit and suggestions', () => {
  const nick = { name: 'nick wilde', posts: 100, species: { fox: 0.97, 'red fox': 0.7 }, traits: { 'green eyes': 0.8, tie: 0.4 } };

  test('fit finds the best share and whose it is', () => {
    expect(fit('red fox', [nick])).toEqual({ share: 0.7, name: 'nick wilde' });
    expect(fit('wolf', [nick]).share).toBe(0);
  });

  test('suggests typical tags the panel lacks', () => {
    expect(suggestions([nick], ['fox']).map(s => s.tag)).toEqual(['green eyes', 'red fox']);
  });
});
