const { parseVocabulary } = require('../src/main/services/tagMerge');
const { reviewImageTags, DOUBTFUL_BELOW, SUGGEST_FROM } = require('../src/main/services/hydraReview');

const vocabulary = parseVocabulary([
  'id,name,category,post_count',
  '0,solo,0,0',
  '1,blue_eyes,0,0',
  '2,otter,5,0',
  '3,nick_wilde,4,0',
  '4,comic,7,0',
  '5,sheep,5,0'
].join('\n'));
const probs = (map) => vocabulary.names.map(name => map[name] ?? 0);

describe('reviewImageTags', () => {
  test('scores the tags the image has, in tag-file form', () => {
    const result = reviewImageTags(['solo', 'blue eyes', 'andy borrego'], probs({ solo: 0.9, blue_eyes: 0.1234 }), vocabulary);
    expect(result.scores).toEqual({ solo: 0.9, 'blue eyes': 0.123, 'andy borrego': null });
    expect(result.doubtfulBelow).toBe(DOUBTFUL_BELOW);
  });

  test('suggests confident tags the image lacks, most confident first', () => {
    const result = reviewImageTags(['solo'], probs({ solo: 0.99, otter: 0.8, nick_wilde: 0.95, comic: SUGGEST_FROM, sheep: SUGGEST_FROM - 0.01 }), vocabulary);
    expect(result.suggestions).toEqual([
      { tag: 'nick wilde', score: 0.95, category: 'character' },
      { tag: 'otter', score: 0.8, category: 'species' },
      { tag: 'comic', score: 0.5, category: 'meta' }
    ]);
  });

  test('never suggests hidden tags, and fills the list without them', () => {
    const result = reviewImageTags([], probs({ solo: 0.99, otter: 0.8, comic: 0.9 }), vocabulary, ['Solo', 'comic']);
    expect(result.suggestions.map(item => item.tag)).toEqual(['otter']);
  });

  test('hiding a tag does not hide its score on an image that has it', () => {
    const result = reviewImageTags(['blue eyes'], probs({ blue_eyes: 0.9 }), vocabulary, ['blue eyes']);
    expect(result.scores).toEqual({ 'blue eyes': 0.9 });
  });

  test('matches tags whatever their case', () => {
    const result = reviewImageTags(['Otter'], probs({ otter: 0.7 }), vocabulary);
    expect(result.scores).toEqual({ Otter: 0.7 });
    expect(result.suggestions).toEqual([]);
  });
});
