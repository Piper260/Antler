const { parseVocabulary, parseTagFile, formatTagFile, mergePanelTags } = require('../src/main/services/tagMerge');

const vocabulary = parseVocabulary([
  'id,name,category,post_count',
  '1,solo,0,100',
  '2,duo,0,100',
  '3,glasses,0,100',
  '4,otter,5,100',
  '5,sheep,5,100',
  '6,disney,3,100',
  '7,nick_wilde,4,100',
  '8,speech_bubble,0,100',
  '9,zaush,1,100'
].join('\n'));

const scoresFor = (map) => vocabulary.names.map(name => map[name] ?? 0);

describe('mergePanelTags', () => {
  test('keeps what the panel shows and drops what it does not', () => {
    const scores = scoresFor({ glasses: 0.9, otter: 0.6, sheep: 0.01, duo: 0.05, solo: 0.95 });
    const result = mergePanelTags(['duo', 'glasses', 'otter', 'sheep'], scores, vocabulary);
    expect(result.tags).toEqual(['glasses', 'otter', 'solo']);
    expect(result.dropped).toEqual(['duo', 'sheep']);
    expect(result.added).toEqual(['solo']);
  });

  test('keeps copyright tags and unknown tags, reporting the unknown ones', () => {
    const scores = scoresFor({ disney: 0.0 });
    const result = mergePanelTags(['disney', 'andy borrego (zaush)'], scores, vocabulary);
    expect(result.tags).toEqual(['andy borrego (zaush)', 'disney']);
    expect(result.unverified).toEqual(['andy borrego (zaush)']);
  });

  test('uses e621 categories to sort out tags the tagger does not know', () => {
    const categories = new Map([['andy_borrego_(zaush)', 4], ['ruminant', 5], ['grey_apron', 0], ['some_series', 3]]);
    const result = mergePanelTags(['andy borrego (zaush)', 'ruminant', 'grey apron', 'some series'], scoresFor({}), vocabulary, categories);
    expect(result.tags).toEqual(['andy borrego (zaush)', 'some series']);
    expect(result.unverified).toEqual(['andy borrego (zaush)']);
    expect(result.dropped).toEqual(['ruminant', 'grey apron']);
  });

  test('only adds confident general and species tags', () => {
    const scores = scoresFor({ glasses: 0.75, solo: 0.65, disney: 0.9, nick_wilde: 0.9, zaush: 0.9, sheep: 0.8 });
    const result = mergePanelTags([], scores, vocabulary);
    expect(result.added).toEqual(['glasses', 'sheep']);
  });

  test('matches spaced tag file names to underscored tagger names', () => {
    const v = parseVocabulary('id,name,category,post_count\n1,grey_apron,0,1');
    expect(mergePanelTags(['grey apron'], [0.5], v).tags).toEqual(['grey apron']);
  });

  test('never keeps or adds text tags, as lettering is cleaned out', () => {
    const scores = scoresFor({ speech_bubble: 0.95, glasses: 0.9 });
    const result = mergePanelTags(['speech bubble', 'glasses'], scores, vocabulary);
    expect(result.tags).toEqual(['glasses']);
  });
});

describe('tag files', () => {
  test('round-trip in the download format', () => {
    const tags = parseTagFile('otter, glasses,  solo ,');
    expect(tags).toEqual(['otter', 'glasses', 'solo']);
    expect(formatTagFile([...tags, 'otter'])).toBe('glasses, otter, solo');
  });
});
