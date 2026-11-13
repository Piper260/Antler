const { scorePost, rankPosts, describe: describeScore, BASE } = require('../src/renderer/js/utils/trainingScore');

const general = n => Array.from({ length: n }, (_, i) => `tag_${i}`);

const post = ({ ext = 'png', w = 1200, h = 1200, tags = {}, score = 0, favs = 0, id = 1 } = {}) => ({
  id,
  tags: { general: general(30), character: [], artist: ['someone'], meta: [], ...tags },
  metadata: { fileType: ext, dimensions: { width: w, height: h }, score, favorites: favs }
});

describe('scorePost', () => {
  test('a clean, large, well-tagged image keeps the base score', () => {
    const result = scorePost(post());
    expect(result.excluded).toBe(false);
    expect(result.score).toBe(BASE);
    expect(result.reasons).toEqual([]);
  });

  test('a Pawchive post is not marked down for the size, tags and rating Pawchive lacks', () => {
    const pawchive = { ...post({ w: 0, h: 0, tags: { general: [] } }), source: 'pawchive' };
    const result = scorePost(pawchive);
    expect(result.score).toBe(BASE + 8); // half the community points, nothing taken off
    // An e621 post with the same missing tags is marked down for them.
    expect(scorePost(post({ w: 0, h: 0, tags: { general: [] } })).score).toBeLessThan(result.score);
  });

  test('ranked together, a Pawchive post sits among e621 posts, not below them all', () => {
    const e621 = [1, 2, 3, 4].map(id => post({ id, score: id * 10, favs: id * 20, w: 900, h: 900 }));
    const pawchive = { ...post({ id: 'pc', w: 0, h: 0, tags: { general: [] } }), source: 'pawchive' };
    const order = rankPosts([...e621, pawchive]).map(p => p.id);
    expect(order.indexOf('pc')).toBeLessThan(order.length - 1);
  });

  test('videos and animations are excluded', () => {
    for (const ext of ['webm', 'mp4', 'swf', 'gif']) {
      const result = scorePost(post({ ext }));
      expect(result.excluded).toBe(true);
      expect(result.score).toBe(0);
    }
  });

  test('resolution penalties step down by shortest side', () => {
    expect(scorePost(post({ w: 2000, h: 900 })).score).toBe(BASE - 10 - 10); // under 1024 + wide
    expect(scorePost(post({ w: 700, h: 700 })).score).toBe(BASE - 25);
    expect(scorePost(post({ w: 400, h: 400 })).score).toBe(BASE - 45);
  });

  test('very tall strips are penalised', () => {
    const result = scorePost(post({ w: 1200, h: 4000 }));
    expect(result.reasons.map(r => r.label)).toContain('very tall (3.3:1)');
  });

  test('text and comic tags count against a post, capped', () => {
    expect(scorePost(post({ tags: { general: [...general(30), 'text'] } })).score).toBe(BASE - 10);
    const messy = scorePost(post({ tags: { general: [...general(30), 'comic', 'multiple_images', 'dialogue', 'speech_bubble', 'text'] } }));
    expect(messy.score).toBe(BASE - 50);
  });

  test('character mode prefers the character alone', () => {
    const solo = scorePost(post({ tags: { character: ['nick_wilde'], general: [...general(30), 'solo'] } }), 'character');
    const crowd = scorePost(post({ tags: { character: ['nick_wilde', 'judy_hopps', 'finnick'], general: [...general(30), 'group'] } }), 'character');
    expect(solo.score).toBe(BASE);
    expect(crowd.score).toBe(BASE - 25 - 16);
  });

  test('character tags are ignored in artist mode, collabs and edits are not', () => {
    expect(scorePost(post({ tags: { character: ['a', 'b', 'c'] } }), 'artist').score).toBe(BASE);
    expect(scorePost(post({ tags: { artist: ['one', 'two', 'conditional_dnp'] } }), 'artist').score).toBe(BASE - 15);
    expect(scorePost(post({ tags: { general: [...general(30), 'third-party_edit'] } }), 'artist').score).toBe(BASE - 25);
  });

  test('sparse tagging lowers the score', () => {
    expect(scorePost(post({ tags: { general: general(10) } })).score).toBe(BASE - 15);
    expect(scorePost(post({ tags: { general: general(20) } })).score).toBe(BASE - 7);
  });
});

describe('rankPosts', () => {
  test('community rating is relative to the batch', () => {
    const ranked = rankPosts([post({ id: 1, score: 5, favs: 10 }), post({ id: 2, score: 50, favs: 100 })]);
    expect(ranked.map(p => p.id)).toEqual([2, 1]);
    expect(ranked[0].training.score).toBe(100);
    expect(ranked[1].training.score).toBeGreaterThan(BASE);
    expect(ranked[1].training.score).toBeLessThan(100);
  });

  test('ranks best first with excluded posts last and keeps ties in order', () => {
    const ranked = rankPosts([
      post({ id: 1, ext: 'webm' }),
      post({ id: 2, w: 400, h: 400 }),
      post({ id: 3 }),
      post({ id: 4 })
    ]);
    expect(ranked.map(p => p.id)).toEqual([3, 4, 2, 1]);
  });

  test('describe lists the reasons', () => {
    const [ranked] = rankPosts([post({ w: 700, h: 700, tags: { general: [...general(30), 'text'] } })]);
    expect(describeScore(ranked.training)).toBe('Training score 50: -25 under 768px (700px), -10 text');
  });
});
