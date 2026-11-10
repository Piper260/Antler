const InkbunnyService = require('../src/main/services/InkbunnyService');
const { formatSubmission, searchParams, PAGE_SIZE } = InkbunnyService;
const { scorePost } = require('../src/renderer/js/utils/trainingScore');

const submission = {
  submission_id: '3983825',
  username: 'SomeArtist',
  rating_id: '1',
  favorites_count: '42',
  comments_count: '3',
  pagecount: '2',
  create_datetime: '2026-11-10 17:21:03+00',
  keywords: [{ keyword_name: 'Red Fox' }, { keyword_name: 'speech bubble' }, { keyword_name: 'red fox' }],
  files: [{
    file_name: '6227030_SomeArtist_chatting.PNG',
    file_url_full: 'https://example.test/full.png',
    file_url_screen: 'https://example.test/screen.png',
    thumbnail_url_huge_noncustom: 'https://example.test/thumb.jpg',
    full_size_x: '1500',
    full_size_y: '1200'
  }]
};

describe('formatSubmission', () => {
  test('maps a submission into the e621 post shape', () => {
    const post = formatSubmission(submission);
    expect(post.id).toBe('ib3983825');
    expect(post.source).toBe('inkbunny');
    expect(post.tags.general).toEqual(['red_fox', 'speech_bubble']);
    expect(post.tags.artist).toEqual(['SomeArtist']);
    expect(post.metadata).toMatchObject({
      favorites: 42, score: 42, rating: 'Questionable', fileType: 'png',
      dimensions: { width: 1500, height: 1200 }, pageCount: 2,
      sources: ['https://inkbunny.net/s/3983825']
    });
    expect(post.fileUrls).toMatchObject({ original: 'https://example.test/full.png', preview: 'https://example.test/thumb.jpg' });
    expect(post.downloadInfo.filename).toBe('ib3983825.png');
  });

  test('works with the training score', () => {
    const result = scorePost(formatSubmission(submission));
    expect(result.excluded).toBe(false);
    expect(result.reasons.map(r => r.label)).toContain('speech bubble');
  });

  test('copes with a submission missing files and keywords', () => {
    const post = formatSubmission({ submission_id: '1', file_name: 'x.gif' });
    expect(post.metadata.fileType).toBe('gif');
    expect(post.downloadInfo.isDownloadable).toBe(false);
    expect(post.tags.general).toEqual([]);
  });
});

describe('searchParams', () => {
  test('artist search uses the username', () => {
    expect(searchParams('artist', 'SomeArtist', { page: 2 })).toEqual({ submissions_per_page: PAGE_SIZE, page: 2, username: 'SomeArtist' });
  });

  test('character search matches the name among keywords', () => {
    expect(searchParams('character', 'nick_wilde', { additionalTags: ['solo'] })).toMatchObject({
      text: 'nick wilde solo', keywords: 'yes', title: 'no', description: 'no'
    });
  });

  test('sort maps to orderby or random', () => {
    expect(searchParams('artist', 'a', { sortBy: 'training' }).orderby).toBe('favs');
    expect(searchParams('artist', 'a', { sortBy: 'favcount' }).orderby).toBe('favs');
    expect(searchParams('artist', 'a', { sortBy: 'random' }).random).toBe('yes');
    expect(searchParams('artist', 'a', { sortBy: 'id' }).orderby).toBeUndefined();
  });
});

describe('InkbunnyService.search', () => {
  const settings = (inkbunny = {}) => ({ getSetting: () => inkbunny });

  test('logs in as a guest, keeps search order, filters by rating', async () => {
    const service = new InkbunnyService(settings());
    const calls = [];
    service.call = async (script, params) => {
      calls.push([script, params]);
      if (script === 'api_login.php') return { sid: 'S1' };
      if (script === 'api_search.php') return { submissions: [{ submission_id: '2' }, { submission_id: '1' }], pages_count: '3', results_count_all: '250' };
      return { submissions: [{ ...submission, submission_id: '1', rating_id: '0' }, { ...submission, submission_id: '2', rating_id: '0' }] };
    };
    const result = await service.search('artist', 'SomeArtist', { page: 1, rating: 'safe' });
    expect(calls[0]).toEqual(['api_login.php', { username: 'guest' }]);
    expect(calls[1][1].sid).toBe('S1');
    expect(result.posts.map(p => p.id)).toEqual(['ib2', 'ib1']);
    expect(result.pagination).toEqual({ currentPage: 1, hasMore: true, totalCount: 250 });
    expect(result.guest).toBe(true);

    const none = await service.search('artist', 'SomeArtist', { page: 3, rating: 'explicit' });
    expect(none.posts).toEqual([]);
    expect(none.pagination.hasMore).toBe(false);
  });

  test('logs in again once when the session expires', async () => {
    const service = new InkbunnyService(settings({ username: 'me', password: 'pw' }));
    let logins = 0;
    let searches = 0;
    service.call = async (script, params, opts) => {
      if (script === 'api_login.php') {
        expect(opts).toEqual({ method: 'POST' });
        return { sid: `S${++logins}` };
      }
      if (script === 'api_search.php' && ++searches === 1) {
        const error = new Error('Invalid Session ID');
        error.code = 2;
        throw error;
      }
      expect(params.sid).toBe('S2');
      return { submissions: [], pages_count: '0' };
    };
    const result = await service.search('artist', 'x');
    expect(logins).toBe(2);
    expect(result.posts).toEqual([]);
    expect(result.guest).toBe(false);
  });
});
