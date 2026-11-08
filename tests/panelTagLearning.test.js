const { emptyLearning, similarity, predictPresence, resolvePanelTags, learnFromEdit, recordPanel } = require('../src/renderer/js/utils/panelTagLearning');

const facts = (overrides = {}) => ({
  known: {},
  candidates: {},
  alwaysKeep: [],
  unknown: [],
  unknownDropped: [],
  signature: {},
  ...overrides
});

// Fingerprints: "sheep" panels score high on index 1, "otter" panels on 2.
const SHEEP = { 1: 0.9, 3: 0.4 };
const SHEEP_2 = { 1: 0.8, 3: 0.5 };
const OTTER = { 2: 0.9, 3: 0.4 };
const OTTER_2 = { 2: 0.85, 3: 0.3 };

describe('resolvePanelTags', () => {
  test('uses the default cutoffs when nothing is learned', () => {
    const result = resolvePanelTags(facts({
      known: { otter: 0.15, glasses: 0.9 },
      candidates: { solo: 0.95, shirt: 0.5 },
      alwaysKeep: ['disney'],
      unknown: ['andy borrego (zaush)'],
      unknownDropped: ['ruminant']
    }));
    expect(result.tags).toEqual(['andy borrego (zaush)', 'disney', 'glasses', 'solo']);
    expect(result.dropped).toEqual(['ruminant', 'otter']);
    expect(result.unverified).toEqual(['andy borrego (zaush)']);
    expect(result.learned).toEqual([]);
  });
});

describe('learning cutoffs', () => {
  test('restoring a tag keeps it on other panels scored about as low', () => {
    const learning = emptyLearning();
    learnFromEdit(learning, facts({ known: { otter: 0.15 } }), 'otter', true);
    const similar = resolvePanelTags(facts({ known: { otter: 0.13 } }), learning);
    const absent = resolvePanelTags(facts({ known: { otter: 0.01 } }), learning);
    expect(similar.tags).toContain('otter');
    expect(similar.learned).toEqual(['otter']);
    expect(absent.tags).not.toContain('otter');
  });

  test('removing a tag drops it from other panels scored about as high', () => {
    const learning = emptyLearning();
    learnFromEdit(learning, facts({ known: { duo: 0.3 } }), 'duo', false);
    expect(resolvePanelTags(facts({ known: { duo: 0.28 } }), learning).tags).not.toContain('duo');
    expect(resolvePanelTags(facts({ known: { duo: 0.6 } }), learning).tags).toContain('duo');
  });

  test('tagger additions learn their own cutoff', () => {
    const learning = emptyLearning();
    learnFromEdit(learning, facts({ candidates: { shirt: 0.5 } }), 'shirt', true);
    expect(resolvePanelTags(facts({ candidates: { shirt: 0.45 } }), learning).added).toEqual(['shirt']);
    expect(resolvePanelTags(facts({ candidates: { shirt: 0.32 } }), learning).added).toEqual([]);
    learnFromEdit(learning, facts({ candidates: { meme: 0.8 } }), 'meme', false);
    expect(resolvePanelTags(facts({ candidates: { meme: 0.79 } }), learning).added).toEqual([]);
  });
});

describe('learning who is in a panel', () => {
  test('fingerprint similarity', () => {
    expect(similarity(SHEEP, SHEEP_2)).toBeGreaterThan(similarity(SHEEP, OTTER));
    expect(similarity({}, SHEEP)).toBe(0);
  });

  test('a character follows the panels it was kept on', () => {
    const learning = emptyLearning();
    const andy = ['andy borrego (zaush)'];
    recordPanel(learning, facts({ unknown: andy, signature: SHEEP }), andy, 'page#1');
    recordPanel(learning, facts({ unknown: andy, signature: OTTER }), [], 'page#2');

    const sheepPanel = resolvePanelTags(facts({ unknown: andy, signature: SHEEP_2 }), learning);
    const otterPanel = resolvePanelTags(facts({ unknown: andy, signature: OTTER_2 }), learning);
    expect(sheepPanel.tags).toEqual(andy);
    expect(sheepPanel.unverified).toEqual([]);
    expect(otterPanel.tags).toEqual([]);
    expect(otterPanel.dropped).toEqual(andy);
  });

  test('a later correction of the same panel replaces its example', () => {
    const learning = emptyLearning();
    const tag = ['lucas'];
    recordPanel(learning, facts({ unknown: tag, signature: OTTER }), [], 'page#2');
    recordPanel(learning, facts({ unknown: tag, signature: OTTER }), tag, 'page#2');
    expect(learning.examples.lucas).toHaveLength(1);
    expect(learning.examples.lucas[0].present).toBe(true);
  });

  test('a tag the tagger scores near zero follows the panels it was put back on', () => {
    const learning = emptyLearning();
    recordPanel(learning, facts({ known: { otter: 0 }, signature: OTTER }), ['otter'], 'page#2', ['otter']);
    recordPanel(learning, facts({ known: { otter: 0 }, signature: SHEEP }), [], 'page#1');
    expect(learning.examples.otter.map(e => e.present)).toEqual([true, false]);
    const otterPanel = resolvePanelTags(facts({ known: { otter: 0 }, signature: OTTER_2 }), learning);
    const sheepPanel = resolvePanelTags(facts({ known: { otter: 0 }, signature: SHEEP_2 }), learning);
    expect(otterPanel.tags).toEqual(['otter']);
    expect(otterPanel.learned).toEqual(['otter']);
    expect(sheepPanel.tags).toEqual([]);
  });

  test('a long run of one answer keeps the examples of the other', () => {
    const learning = emptyLearning();
    for (let i = 0; i < 100; i++) {
      recordPanel(learning, facts({ signature: { [i]: 1 } }), i < 60 ? ['nick'] : [], `page#${i}`, [], ['nick']);
    }
    const kept = learning.examples.nick;
    expect(kept.filter(e => e.present)).toHaveLength(40);
    expect(kept.filter(e => !e.present)).toHaveLength(40);
  });

  test('before any correction, character profiles decide from species', () => {
    const learning = emptyLearning();
    learning.profiles = {
      andy: { name: 'andy', posts: 40, species: { sheep: 0.9 }, traits: {} },
      lucas: { name: 'lucas', posts: 40, species: { otter: 0.8 }, traits: {} }
    };
    const pageFacts = (speciesScores) => facts({ unknown: ['andy', 'lucas'], characters: ['andy', 'lucas'], speciesScores });
    const sheepPanel = resolvePanelTags(pageFacts({ sheep: 0.8 }), learning);
    expect(sheepPanel.tags).toEqual(['andy']);
    expect(sheepPanel.profiled).toEqual(['andy', 'lucas']);
    // Corrections still win over the profile.
    recordPanel(learning, facts({ unknown: ['andy'], signature: SHEEP }), [], 'page#1');
    recordPanel(learning, facts({ unknown: ['andy'], signature: OTTER }), ['andy'], 'page#2');
    const corrected = resolvePanelTags({ ...pageFacts({ sheep: 0.8 }), signature: SHEEP_2 }, learning);
    expect(corrected.tags).not.toContain('andy');
  });

  test('a character whose species is clearly in a two-character panel stays, though it looks like a panel without them', () => {
    const learning = emptyLearning();
    learning.profiles = {
      andy: { name: 'andy', posts: 40, species: { otter: 0.9 }, traits: {} },
      lucas: { name: 'lucas', posts: 40, species: { sheep: 0.9 }, traits: {} }
    };
    recordPanel(learning, facts({ unknown: ['andy'], signature: SHEEP }), [], 'page#1');
    recordPanel(learning, facts({ unknown: ['andy'], signature: OTTER }), ['andy'], 'page#2');
    // Mostly sheep, but an otter is clearly there too.
    const both = resolvePanelTags(facts({ unknown: ['andy', 'lucas'], characters: ['andy', 'lucas'], speciesScores: { sheep: 0.6, otter: 0.9 }, signature: { 1: 0.7, 2: 0.5, 3: 0.4 } }), learning);
    expect(both.tags).toEqual(['andy', 'lucas']);
    expect(both.profiled).toContain('andy');
  });

  test('lists characters the examples only just decided', () => {
    const learning = emptyLearning();
    recordPanel(learning, facts({ unknown: ['nick'], signature: { 1: 1 } }), ['nick'], 'page#1');
    recordPanel(learning, facts({ unknown: ['nick'], signature: { 2: 1 } }), [], 'page#2');
    const between = resolvePanelTags(facts({ unknown: ['nick'], signature: { 1: 1, 2: 0.95 } }), learning);
    expect(between.close).toEqual(['nick']);
    const clear = resolvePanelTags(facts({ unknown: ['nick'], signature: { 1: 1, 2: 0.2 } }), learning);
    expect(clear.close).toEqual([]);
  });

  test('one-sided examples only decide for near-identical panels', () => {
    const examples = [{ key: 'a', present: false, signature: OTTER }];
    expect(predictPresence(examples, OTTER)).toBe(false);
    expect(predictPresence(examples, SHEEP)).toBeNull();
    expect(predictPresence([], SHEEP)).toBeNull();
  });
});
