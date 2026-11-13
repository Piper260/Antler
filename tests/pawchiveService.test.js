const PawchiveService = require('../src/main/services/PawchiveService');
const { formatPost, parseTags, postImages, fileHash, fileUrl, thumbUrl, nameScore, PAGE_SIZE } = PawchiveService;
const { scorePost } = require('../src/renderer/js/utils/trainingScore');

const HASH_A = '9858b33fdd5e47af392799698dfe0998d14fc58df3f3f9564c3fa3e8c166d000';
const HASH_B = '22b669d9967221b213a7116249952cec4e09bdb65841dec30e3102b3df149a64';

// Shaped like a real /{service}/user/{id} list item.
const post = {
  id: '174953492',
  user: '15434950',
  service: 'patreon',
  title: 'Rosario',
  published: '2026-11-09T10:00:00',
  added: '2026-11-10T10:00:00',
  file: { name: 'Rosario.png', path: `/198/58/${HASH_A}.png`, server: 'https://n3.pawchive.pw' },
  attachments: [
    { name: 'Rosario.png', path: `/198/58/${HASH_A}.png`, server: 'https://n3.pawchive.pw' },
    { name: 'WIP.png', path: `/222/b6/${HASH_B}.png`, server: 'https://n3.pawchive.pw' },
    { name: 'source.psd', path: '/1/aa/bb.psd', server: 'https://n3.pawchive.pw' }
  ],
  tags: '{"Black Apron",fox,"speech bubble"}'
};

describe('file URLs', () => {
  test('full file uses the given server and path', () => {
    expect(fileUrl(post.file)).toBe(`https://n3.pawchive.pw/data/198/58/${HASH_A}.png`);
  });

  test('thumbnail is built from the hash, without the shard prefix', () => {
    expect(fileHash(post.file)).toBe(HASH_A);
    expect(thumbUrl(post.file)).toBe(`https://img.pawchive.pw/thumbnail/data/98/58/${HASH_A}.png`);
  });

  test('a server outside pawchive.pw falls back to the main site', () => {
    expect(fileUrl({ path: '/1/2/x.png', server: 'https://evil.example' })).toBe('https://pawchive.pw/data/1/2/x.png');
  });
});

describe('parseTags', () => {
  test('reads Postgres array literals', () => {
    expect(parseTags('{"Black Apron",fox,"speech bubble"}')).toEqual(['Black Apron', 'fox', 'speech bubble']);
    expect(parseTags('{"say \\"hi\\""}')).toEqual(['say "hi"']);
    expect(parseTags('{}')).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('formatPost', () => {
  test('keeps image files only, main file first, no repeats', () => {
    expect(postImages(post).map(fileHash)).toEqual([HASH_A, HASH_B]);
  });

  test('maps a post into the e621 post shape', () => {
    const p = formatPost(post, 'Mingrix');
    expect(p.id).toBe('pc_patreon_15434950_174953492');
    expect(p.source).toBe('pawchive');
    expect(p.tags.general).toEqual(['black_apron', 'fox', 'speech_bubble']);
    expect(p.tags.artist).toEqual(['Mingrix']);
    expect(p.metadata).toMatchObject({ fileType: 'png', pageCount: 2, sources: ['https://pawchive.pw/patreon/user/15434950/post/174953492'] });
    expect(p.fileUrls.original).toBe(`https://n3.pawchive.pw/data/198/58/${HASH_A}.png`);
    expect(Object.values(p.fileUrls.alternatives)).toEqual([`https://n3.pawchive.pw/data/222/b6/${HASH_B}.png`]);
    expect(p.downloadInfo.filename).toBe('pc_patreon_15434950_174953492.png');
  });

  test('a post with no images is dropped', () => {
    expect(formatPost({ ...post, file: {}, attachments: [{ path: '/1/2/a.zip' }] })).toBeNull();
  });

  test('works with the training score', () => {
    expect(scorePost(formatPost(post)).excluded).toBe(false);
  });
});

describe('nameScore', () => {
  test('ranks exact over prefix over contains', () => {
    expect(nameScore('Mingrix', 'mingrix')).toBe(3);
    expect(nameScore('Mingrix_Art', 'mingrix')).toBe(2);
    expect(nameScore('TheMingrix', 'mingrix')).toBe(1);
    expect(nameScore('Other', 'mingrix')).toBe(0);
    expect(nameScore('M', 'mingrix')).toBe(0);
    expect(nameScore('MING', 'mingrix')).toBe(2);
  });
});

describe('PawchiveService.search', () => {
  const creators = [
    { id: '1', name: 'Mingrix Art', service: 'fanbox', favorited: 900 },
    { id: '2', name: 'mingrix', service: 'patreon', favorited: 10 }
  ];

  test('artist search uses the best-matching creator and steps offsets by 50', async () => {
    const service = new PawchiveService();
    const calls = [];
    service.call = async (path, params) => {
      calls.push([path, params]);
      if (path === '/creators') return creators;
      return Array.from({ length: PAGE_SIZE }, (_, i) => ({ ...post, id: String(i) }));
    };
    const result = await service.search('artist', 'Mingrix', { page: 2, additionalTags: ['black_apron'] });
    // Refine words search titles and text (q): few Pawchive posts are tagged.
    expect(calls[1]).toEqual(['/patreon/user/2', { q: 'black apron', o: 50 }]);
    expect(result.posts).toHaveLength(PAGE_SIZE);
    expect(result.pagination).toEqual({ currentPage: 2, hasMore: true, totalCount: null });
    await expect(service.search('artist', 'Mingrix', { additionalTags: ['xy'] })).rejects.toThrow('3 letters');
    expect(result.creator.name).toBe('mingrix');
  });

  test('character search is a text search', async () => {
    const service = new PawchiveService();
    const calls = [];
    service.call = async (path, params) => {
      calls.push([path, params]);
      return [post];
    };
    const result = await service.search('character', 'nick_wilde');
    expect(calls[0]).toEqual(['/posts', { q: 'nick wilde', o: 0 }]);
    expect(result.pagination.hasMore).toBe(false);
  });

  test('no matching creator gives no posts', async () => {
    const service = new PawchiveService();
    service.call = async () => creators;
    const result = await service.search('artist', 'nobody_like_this');
    expect(result.posts).toEqual([]);
  });

  test('the creator list is fetched once while cached', async () => {
    const service = new PawchiveService();
    let fetches = 0;
    service.call = async () => { fetches++; return creators; };
    await Promise.all([service.findCreators('min'), service.findCreators('min')]);
    await service.artistSuggestions('mingrix');
    expect(fetches).toBe(1);
  });
});
