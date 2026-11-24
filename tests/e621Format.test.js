const e621Format = require('../src/main/services/e621Format');
const E621Service = require('../src/main/services/E621Service');

// A post as e621 sends it since 2026-11-18 (site update 26.11.18).
const v2Post = {
  id: 123,
  created_at: '2026-11-01T00:00:00.000-05:00',
  rating: 'e',
  tags: ['pngx', 'canine', 'solo', 'mystery_tag'],
  files: {
    meta: { ext: 'png', size: 1000, md5: 'abc', has_sample: true },
    original: { width: 2000, height: 1500, url: 'https://static1.e621.net/data/ab/cd/abc.png' },
    preview: { width: 150, height: 112, jpg: 'https://static1.e621.net/data/preview/abc.jpg' },
    sample: { width: 850, height: 637, webp: 'https://static1.e621.net/data/sample/abc.webp' }
  },
  stats: { score: { up: 150, down: -10, total: 140 }, fav_count: 218, comment_count: 4 },
  has: { children: true, notes: false },
  flags: { deleted: false },
  relationships: { parent_id: 7, children: [8] },
  sources: ['https://example.com/a'],
  pools: [5]
};
const categories = new Map([['pngx', 1], ['canine', 5], ['solo', 0]]);

describe('e621Format', () => {
  test('recognises the new format', () => {
    expect(e621Format.isV2Post(v2Post)).toBe(true);
    expect(e621Format.isV2Post({ id: 1, file: {} })).toBe(false);
  });

  test('converts a post to the old shape, with tag categories', () => {
    const post = e621Format.toV1(v2Post, categories);
    expect(post.file).toMatchObject({ width: 2000, height: 1500, ext: 'png', md5: 'abc', url: v2Post.files.original.url });
    expect(post.preview.url).toBe(v2Post.files.preview.jpg);
    expect(post.sample).toMatchObject({ has: true, url: v2Post.files.sample.webp });
    expect(post.score).toEqual({ up: 150, down: -10, total: 140 });
    expect(post.fav_count).toBe(218);
    expect(post.tags.artist).toEqual(['pngx']);
    expect(post.tags.species).toEqual(['canine']);
    expect(post.tags.general).toEqual(['solo', 'mystery_tag']);
    expect(post.relationships).toMatchObject({ parent_id: 7, has_children: true, children: [8] });
  });

  test('wraps responses the way the old API did', () => {
    expect(e621Format.responseToV1([v2Post], categories).posts).toHaveLength(1);
    expect(e621Format.responseToV1(v2Post, categories).post.id).toBe(123);
    const old = { posts: [{ id: 1, file: { url: 'x' } }] };
    expect(e621Format.responseToV1(old, categories)).toBe(old);
  });

  test('lists the tags to look up, each once', () => {
    expect(e621Format.flatTags([v2Post, v2Post])).toEqual(['pngx', 'canine', 'solo', 'mystery_tag']);
  });
});

describe('E621Service.makeRequest', () => {
  const settings = { getE621Credentials: () => ({ isConfigured: false }), userDataPath: require('os').tmpdir() };
  let urls;
  const respond = (bodies) => {
    urls = [];
    global.fetch = jest.fn(async (url) => {
      urls.push(url);
      const body = typeof bodies === 'function' ? bodies(url) : bodies;
      return { ok: true, status: 200, statusText: 'OK', json: async () => body };
    });
  };
  const service = () => {
    const s = new E621Service(settings);
    s.rateLimit = 0;
    s.saveTagCategories = () => {};
    return s;
  };
  afterEach(() => { delete global.fetch; });

  test('asks posts endpoints for the old format', async () => {
    respond({ posts: [] });
    const s = service();
    await s.makeRequest('/posts.json?tags=pngx&limit=1');
    await s.makeRequest('/posts/123.json');
    await s.makeRequest('/tags.json?search[name]=pngx');
    expect(urls[0]).toMatch(/\/posts\.json\?tags=pngx&limit=1&v1=true$/);
    expect(urls[1]).toMatch(/\/posts\/123\.json\?v1=true$/);
    expect(urls[2]).not.toMatch(/v1=/);
  });

  test('converts the new format when it arrives anyway', async () => {
    respond(url => (url.includes('/tags.json')
      ? [{ name: 'pngx', category: 1 }, { name: 'canine', category: 5 }]
      : [v2Post]));
    const data = await service().makeRequest('/posts.json?tags=pngx&v1=false');
    expect(data.posts[0].tags.artist).toEqual(['pngx']);
    expect(data.posts[0].tags.species).toEqual(['canine']);
    expect(data.posts[0].file.url).toBe(v2Post.files.original.url);
  });
});
