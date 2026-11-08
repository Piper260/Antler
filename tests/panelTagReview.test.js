const { emptyLearning } = require('../src/renderer/js/utils/panelTagLearning');
const { finalTags, hasTag, answer, scoreRanges, spreadPanels, reach, setDone, folderWideTags, uncertainTags, changedPanels, reviewQueue, panelQuestions, forgetTag, tagSummary, tagPanels } = require('../src/renderer/js/utils/panelTagReview');

const facts = (overrides = {}) => ({
  known: {},
  candidates: {},
  alwaysKeep: [],
  unknown: [],
  unknownDropped: [],
  signature: {},
  ...overrides
});

const SHEEP = { 1: 0.9, 3: 0.4 };
const SHEEP_2 = { 1: 0.8, 3: 0.5 };
const OTTER = { 2: 0.9, 3: 0.4 };

describe('uncertainTags', () => {
  test('asks about characters, clashes and scores near a cutoff, not sure ones', () => {
    const items = uncertainTags(facts({
      known: { otter: 0.15, glasses: 0.9, hat: 0.01, fur: 0.18 },
      candidates: { solo: 0.95, shirt: 0.6 },
      unknown: ['lucas lightfoot'],
      speciesScores: { otter: 0.15 }
    }), null, emptyLearning(), ['glasses']);
    // Characters first, then species (clashes included), then general tags.
    expect(items.map(item => item.tag)).toEqual(['lucas lightfoot', 'glasses', 'otter', 'fur', 'shirt']);
    expect(items[1]).toMatchObject({ reason: 'clash', kind: 'species', present: true });
    expect(items.find(item => item.tag === 'otter')).toMatchObject({ reason: 'unsure', present: false, score: 0.15 });
  });

  test('does not ask about characters a profile placed or ruled out from species', () => {
    const learning = emptyLearning();
    learning.profiles = {
      andy: { name: 'andy', posts: 40, species: { otter: 0.9 }, traits: {} },
      lucas: { name: 'lucas', posts: 40, species: { sheep: 0.9 }, traits: {} }
    };
    const items = uncertainTags(facts({ unknown: ['andy', 'lucas'], characters: ['andy', 'lucas'], speciesScores: { otter: 0.9 } }), null, learning);
    expect(items).toEqual([]);
  });

  test('skips tags the user already decided or answered', () => {
    const items = uncertainTags(facts({ known: { otter: 0.15 }, unknown: ['lucas lightfoot'] }),
      { add: [], remove: [], checked: ['lucas lightfoot', 'otter'] }, emptyLearning());
    expect(items).toEqual([]);
  });
});

describe('answer', () => {
  test('keeps the answer in the edits and marks it answered', () => {
    const learning = emptyLearning();
    const panel = { facts: facts({ known: { otter: 0.15 }, signature: OTTER }), key: 'a' };
    answer(learning, panel, 'otter', true);
    expect(panel.edits).toEqual({ add: ['otter'], remove: [], checked: ['otter'] });
    expect(finalTags(panel.facts, panel.edits, learning)).toEqual(['otter']);
  });

  test('a later answer on another panel does not undo a No', () => {
    const learning = emptyLearning();
    const first = { facts: facts({ known: { smile: 0.3 }, signature: { 1: 1 } }), key: 'a' };
    const second = { facts: facts({ known: { smile: 0.25 }, signature: { 2: 1 } }), key: 'b' };
    answer(learning, first, 'smile', false);
    answer(learning, second, 'smile', true);
    expect(learning.keep.smile).toBeLessThan(0.3);
    expect(finalTags(first.facts, first.edits, learning)).toEqual([]);
  });

  test('a later answer on another panel does not undo a Yes', () => {
    const learning = emptyLearning();
    const first = { facts: facts({ known: { smile: 0.5 }, signature: { 1: 1 } }), key: 'a' };
    const second = { facts: facts({ known: { smile: 0.6 }, signature: { 2: 1 } }), key: 'b' };
    answer(learning, first, 'smile', true);
    learning.examples = {};
    answer(learning, second, 'smile', false);
    expect(finalTags(first.facts, first.edits, learning)).toEqual(['smile']);
  });
});

describe('score ranges', () => {
  const panel = (score, key) => ({ facts: facts({ known: { fur: score }, signature: { [key]: 1 } }), key: String(key) });
  const answerAll = (learning, answers) => answers.map(([score, present], i) => {
    const item = panel(score, i);
    answer(learning, item, 'fur', present);
    return item;
  });
  const asked = (score, learning) => uncertainTags(panel(score, 99).facts, null, learning).length > 0;
  const has = (score, learning) => finalTags(panel(score, 99).facts, null, learning).includes('fur');

  test('a few answers settle everything outside the gap between Yes and No', () => {
    const learning = emptyLearning();
    answerAll(learning, [[0.3, true], [0.25, true], [0.15, false]]);
    expect(has(0.28, learning)).toBe(true);
    expect(asked(0.28, learning)).toBe(false);
    expect(has(0.12, learning)).toBe(false);
    expect(asked(0.12, learning)).toBe(false);
    expect(asked(0.2, learning)).toBe(true);
  });

  test('needs three answers before it decides anything', () => {
    const learning = emptyLearning();
    answerAll(learning, [[0.3, true], [0.15, false]]);
    expect(asked(0.28, learning)).toBe(true);
  });

  test('with only Yes so far, scores below the lowest stay open', () => {
    const learning = emptyLearning();
    answerAll(learning, [[0.3, true], [0.28, true], [0.26, true]]);
    expect(asked(0.27, learning)).toBe(false);
    expect(asked(0.2, learning)).toBe(true);
  });

  test('answers that cross leave everything between them open', () => {
    const learning = emptyLearning();
    answerAll(learning, [[0.15, true], [0.3, false], [0.5, true]]);
    expect(asked(0.25, learning)).toBe(true);
    expect(has(0.5, learning)).toBe(true);
    expect(has(0.1, learning)).toBe(false);
  });

  test('page tags and tags the tagger would add have separate ranges', () => {
    const learning = emptyLearning();
    answerAll(learning, [[0.3, true], [0.25, true], [0.15, false]]);
    expect(Object.keys(learning.ranges.keep)).toEqual(['fur']);
    expect(learning.ranges.add).toEqual({});
  });

  test('named characters are never settled by a score', () => {
    const learning = emptyLearning();
    [0.5, 0.45, 0.4].forEach((score, i) => answer(learning, { facts: facts({ known: { nick: score }, characters: ['nick'], signature: { [i]: 1 } }), key: String(i) }, 'nick', true));
    expect(learning.ranges).toBeUndefined();
  });

  test('scoreRanges rebuilds the same ranges from the answers, ignoring ones with no direction', () => {
    const learning = emptyLearning();
    const panels = answerAll(learning, [[0.3, true], [0.25, true], [0.15, false]]);
    panels.push({ facts: panel(0.9, 3).facts, edits: { add: [], remove: [], checked: ['fur'] } });
    expect(scoreRanges(panels)).toEqual(learning.ranges);
  });

  test('an answer counts the panels its range settles', () => {
    const learning = emptyLearning();
    answerAll(learning, [[0.3, true], [0.15, false]]);
    const panels = [panel(0.25, 5), panel(0.24, 6), panel(0.23, 7), panel(0.16, 8)];
    expect(reach(panels, 3, 'fur', false, learning)).toBeGreaterThanOrEqual(0);
    expect(reach(panels, 0, 'fur', true, learning)).toBe(0);
    expect(reach(panels, 2, 'fur', true, learning)).toBe(2);
  });

  test('spreadPanels takes both ends and points between', () => {
    const list = [0.9, 0.7, 0.6, 0.5, 0.4, 0.2, 0.1].map(score => ({ score }));
    expect(spreadPanels(list, 3).map(item => item.score)).toEqual([0.9, 0.5, 0.1]);
    expect(spreadPanels(list, 10)).toHaveLength(7);
  });
});

describe('setDone', () => {
  test('fixes the tags whatever is learned later, and teaches who is in the panel', () => {
    const learning = emptyLearning();
    const panel = { facts: facts({ known: { smile: 0.5 }, unknown: ['nick'], signature: SHEEP }), key: 'a' };
    const other = { facts: facts({ known: { smile: 0.6 }, signature: OTTER }), key: 'b' };
    setDone(learning, panel, true);
    expect(panel.edits.final).toEqual(['nick', 'smile']);
    expect(learning.examples.nick.map(e => e.present)).toEqual([true]);

    answer(learning, other, 'smile', false);
    expect(finalTags(panel.facts, panel.edits, learning)).toEqual(['nick', 'smile']);
    expect(hasTag(panel.facts, panel.edits, learning, 'smile')).toBe(true);
    expect(uncertainTags(panel.facts, panel.edits, learning)).toEqual([]);
  });

  test('an answer on a done panel changes its fixed tags, and reopening returns to the merge', () => {
    const learning = emptyLearning();
    const panel = { facts: facts({ known: { smile: 0.5, hat: 0.5 }, signature: SHEEP }), key: 'a' };
    setDone(learning, panel, true);
    answer(learning, panel, 'hat', false);
    expect(panel.edits.final).toEqual(['smile']);
    setDone(learning, panel, false);
    expect(panel.edits.final).toBeUndefined();
    expect(finalTags(panel.facts, panel.edits, learning)).toEqual(['smile']);
  });
});

describe('folderWideTags', () => {
  const on = (page, unknown, characters = []) => ({ page, facts: facts({ unknown, characters }) });

  test('finds uncategorised tags on every page, not characters or tags on some', () => {
    const panels = ['p1', 'p2', 'p3', 'p4', 'p5'].map(page => on(page, ['trigger', 'nick'], ['nick']));
    panels.push(on('p5', ['trigger', 'arno']));
    expect(folderWideTags(panels)).toEqual({ trigger: true });
  });

  test('needs a few pages to go on', () => {
    expect(folderWideTags([on('p1', ['trigger']), on('p2', ['trigger'])])).toEqual({});
  });

  test('a folder-wide tag stays on every panel and is not asked about', () => {
    const learning = { ...emptyLearning(), folderWide: { trigger: true } };
    const f = facts({ unknown: ['trigger', 'nick'] });
    expect(finalTags(f, null, learning)).toEqual(['nick', 'trigger']);
    expect(uncertainTags(f, null, learning).map(item => item.tag)).toEqual(['nick']);
  });
});

describe('reviewQueue', () => {
  test('puts the question that changes the most other panels first', () => {
    const panels = [
      { facts: facts({ unknown: ['lucas lightfoot'], signature: SHEEP }), key: 'a' },
      { facts: facts({ unknown: ['lucas lightfoot'], signature: SHEEP_2 }), key: 'b' },
      { facts: facts({ unknown: ['lucas lightfoot'], known: { hat: 0.19 }, signature: OTTER }), key: 'c' }
    ];
    // Lucas is answered for the otter panel already; whether he's in a sheep
    // panel also settles the other sheep panel, so that is asked first.
    const learning = emptyLearning();
    answer(learning, panels[2], 'lucas lightfoot', false);
    const queue = reviewQueue(panels, [0, 2], learning);
    expect(queue[0]).toMatchObject({ index: 0, tag: 'lucas lightfoot', reach: 1 });
    expect(queue.map(item => item.tag)).toContain('hat');
  });

  test('leaves out skipped questions', () => {
    const panels = [{ facts: facts({ unknown: ['lucas lightfoot'] }), key: 'a' }];
    expect(reviewQueue(panels, [0], emptyLearning(), () => [], new Set(['0|lucas lightfoot']))).toEqual([]);
  });

  test('ranks different tags, not one tag on many panels', () => {
    const panels = Array.from({ length: 40 }, (_, i) => ({ facts: facts({ unknown: ['nick'], signature: { [i]: 1 } }), key: `n${i}` }));
    panels.push(
      { facts: facts({ unknown: ['judy'], signature: SHEEP }), key: 'a' },
      { facts: facts({ unknown: ['judy'], signature: SHEEP_2 }), key: 'b' },
      { facts: facts({ unknown: ['judy'], signature: OTTER }), key: 'c' }
    );
    const learning = emptyLearning();
    answer(learning, panels[42], 'judy', false);
    const queue = reviewQueue(panels, panels.map((_, i) => i), learning);
    expect(queue.filter(item => item.reach > 0).map(item => item.tag)).toContain('judy');
  });

  test('forgetTag only drops panels the tag can be on', () => {
    const panels = [{ facts: facts({ unknown: ['nick'] }), key: 'a' }, { facts: facts({ unknown: ['judy'] }), key: 'b' }];
    const memo = new Map();
    panels.forEach((_, i) => panelQuestions(panels, i, emptyLearning(), () => [], memo));
    forgetTag(memo, panels, 'nick');
    expect([...memo.keys()]).toEqual(['b']);
  });
});

describe('tagSummary and tagPanels', () => {
  const panels = () => [
    { facts: facts({ unknown: ['nick', 'trigger'], known: { otter: 0.9, hat: 0.21 }, speciesScores: { otter: 0.9 }, signature: SHEEP }), key: 'a' },
    { facts: facts({ unknown: ['nick', 'trigger'], known: { otter: 0.1, hat: 0.9 }, speciesScores: { otter: 0.1 }, signature: OTTER }), key: 'b' },
    { facts: facts({ unknown: ['nick'], known: { hat: 0.5 }, signature: OTTER }), key: 'c', edits: { final: ['nick'] } }
  ];
  const summarise = (list, learning) => tagSummary(list, learning, i => uncertainTags(list[i].facts, list[i].edits, learning));

  test('counts open and unsure panels, characters first, done panels and folder-wide tags left out', () => {
    const learning = { ...emptyLearning(), folderWide: { trigger: true } };
    const summary = summarise(panels(), learning);
    expect(summary.map(item => item.tag)).toEqual(['nick', 'otter', 'hat']);
    expect(summary[0]).toMatchObject({ kind: 'character', open: 2, unsure: 2 });
    expect(summary[1]).toMatchObject({ kind: 'species', open: 2 });
    expect(summary[2]).toMatchObject({ kind: 'general', open: 2, unsure: 1 });
  });

  test('tagPanels puts panels with the tag first, best score first, and leaves out answered ones', () => {
    const learning = emptyLearning();
    const list = panels();
    list.push({ facts: facts({ known: { hat: 0.95 }, signature: SHEEP }), key: 'd', edits: { add: ['hat'], remove: [], checked: ['hat'] } });
    list.push({ facts: facts({ known: { hat: 0.1 }, signature: SHEEP }), key: 'e' });
    expect(tagPanels(list, 'hat', learning)).toEqual([
      { index: 1, present: true, score: 0.9 },
      { index: 0, present: true, score: 0.21 },
      { index: 4, present: false, score: 0.1 }
    ]);
  });

  test('tagPanels can be limited to unsure panels, and leaves out skipped ones', () => {
    const learning = emptyLearning();
    const list = panels();
    const questionsFor = i => uncertainTags(list[i].facts, list[i].edits, learning);
    expect(tagPanels(list, 'hat', learning, { unsureOnly: true, questionsFor }).map(item => item.index)).toEqual([0]);
    expect(tagPanels(list, 'hat', learning, { skipped: new Set(['0|hat']) }).map(item => item.index)).toEqual([1]);
  });
});

describe('changedPanels and hasTag', () => {
  test('lists the panels whose tags differ', () => {
    expect(changedPanels([['a'], ['a', 'b'], []], [['a'], ['a'], ['c']])).toEqual([1, 2]);
  });

  test('hasTag agrees with the full resolve', () => {
    const learning = emptyLearning();
    const f = facts({ known: { otter: 0.3, hat: 0.1 }, candidates: { solo: 0.8 }, alwaysKeep: ['disney'] });
    for (const tag of ['otter', 'hat', 'solo', 'disney']) {
      expect(hasTag(f, null, learning, tag)).toBe(finalTags(f, null, learning).includes(tag));
    }
    expect(hasTag(f, { add: [], remove: ['otter'] }, learning, 'otter')).toBe(false);
    expect(hasTag(f, null, learning, 'not on the panel')).toBe(false);
  });
});
