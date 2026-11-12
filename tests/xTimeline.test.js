const { postsFromResponse, userFromResponse, cleanHandle, findTweets, handlesFromUrls, matchesTags } = require('../src/main/services/xTimeline');
const { scorePost } = require('../src/renderer/js/utils/trainingScore');

// XService needs Electron only when it opens windows; its helpers don't.
jest.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({}) } }), { virtual: true });
const XService = require('../src/main/services/XService');

const user = (screenName) => ({ result: { __typename: 'User', rest_id: '99', core: { screen_name: screenName, name: 'Some Artist' }, legacy: {} } });

const photo = (key, ext = 'jpg', width = 2048, height = 1536) => ({
  type: 'photo',
  media_url_https: `https://pbs.twimg.com/media/${key}.${ext}`,
  original_info: { width, height }
});

const tweet = (id, media, extra = {}) => ({
  __typename: 'Tweet',
  rest_id: id,
  core: { user_results: user(extra.author || 'SomeArtist') },
  legacy: {
    created_at: 'Tue Nov 10 17:21:03 +0000 2026',
    full_text: 'New piece! #RedFox #commission https://t.co/abc123',
    favorite_count: 812,
    reply_count: 4,
    possibly_sensitive: !!extra.sensitive,
    entities: { hashtags: [{ text: 'RedFox' }, { text: 'commission' }, { text: 'redfox' }] },
    extended_entities: { media },
    ...(extra.retweet ? { retweeted_status_result: { result: {} } } : {})
  }
});

// UserMedia: the first page puts the grid in an entry, later pages add to the module.
const firstPage = (tweets) => ({
  data: { user: { result: { timeline: { timeline: { instructions: [
    { type: 'TimelineClearCache' },
    { type: 'TimelineAddEntries', entries: [
      { entryId: 'profile-grid-0', content: { items: tweets.map(t => ({ item: { itemContent: { tweet_results: { result: t } } } })) } },
      { entryId: 'cursor-bottom-1', content: { value: 'DAABCgAB' } }
    ] }
  ] } } } } }
});

const laterPage = (tweets) => ({
  data: { user: { result: { timeline: { timeline: { instructions: [
    { type: 'TimelineAddToModule', moduleItems: tweets.map(t => ({ item: { itemContent: { tweet_results: { result: t } } } })) }
  ] } } } } }
});

describe('xTimeline', () => {
  test('a single-image tweet becomes one post with original, large and small urls', () => {
    const { posts, tweets } = postsFromResponse(firstPage([tweet('1855000000000000001', [photo('GabcXYZ')])]), 'someartist');
    expect(tweets).toBe(1);
    expect(posts).toHaveLength(1);
    const [post] = posts;
    expect(post.id).toBe('x1855000000000000001');
    expect(post.source).toBe('x');
    expect(post.fileUrls.original).toBe('https://pbs.twimg.com/media/GabcXYZ?format=jpg&name=orig');
    expect(post.fileUrls.sample).toBe('https://pbs.twimg.com/media/GabcXYZ?format=jpg&name=large');
    expect(post.fileUrls.preview).toBe('https://pbs.twimg.com/media/GabcXYZ?format=jpg&name=small');
    expect(post.downloadInfo.filename).toBe('x1855000000000000001.jpg');
    expect(post.metadata.dimensions).toEqual({ width: 2048, height: 1536 });
    expect(post.metadata.favorites).toBe(812);
    expect(post.metadata.uploadedAt).toBe('2026-11-10T17:21:03.000Z');
    expect(post.metadata.sources).toEqual(['https://x.com/SomeArtist/status/1855000000000000001']);
    expect(post.metadata.description).toBe('New piece! #RedFox #commission');
    expect(post.tags.general).toEqual(['redfox', 'commission']);
    expect(post.tags.artist).toEqual(['SomeArtist']);
  });

  test('each image of a multi-image tweet is its own post, keeping png', () => {
    const { posts } = postsFromResponse(laterPage([tweet('7', [photo('A', 'png'), photo('B')])]));
    expect(posts.map(p => p.id)).toEqual(['x7_1', 'x7_2']);
    expect(posts[0].metadata.fileType).toBe('png');
    expect(posts[0].fileUrls.original).toBe('https://pbs.twimg.com/media/A?format=png&name=orig');
    expect(posts[0].metadata.pageCount).toBe(2);
  });

  test('videos use the highest-bitrate mp4 and the thumbnail as preview', () => {
    const video = {
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/t.jpg',
      original_info: { width: 1280, height: 720 },
      video_info: { variants: [
        { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a.m3u8' },
        { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/low.mp4' },
        { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' }
      ] }
    };
    const [post] = postsFromResponse(firstPage([tweet('8', [video])])).posts;
    expect(post.metadata.fileType).toBe('mp4');
    expect(post.fileUrls.original).toBe('https://video.twimg.com/high.mp4');
    expect(post.fileUrls.preview).toBe('https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/t.jpg');
  });

  test('retweets, quoted tweets and other authors are left out', () => {
    const quoted = tweet('2', [photo('Q')], { author: 'Someone' });
    const own = tweet('3', [photo('O')]);
    own.quoted_status_result = { result: quoted };
    const response = firstPage([own, tweet('4', [photo('R')], { retweet: true }), tweet('5', [photo('S')], { author: 'Someone' })]);
    expect(postsFromResponse(response, 'SomeArtist').posts.map(p => p.id)).toEqual(['x3']);
  });

  test('tweets behind a visibility wrapper are unwrapped', () => {
    const response = firstPage([{ __typename: 'TweetWithVisibilityResults', tweet: tweet('6', [photo('V')]) }]);
    expect(findTweets(response.data)).toHaveLength(1);
    expect(postsFromResponse(response).posts[0].id).toBe('x6');
  });

  test('sensitive tweets are rated Explicit, others Unknown', () => {
    const response = firstPage([tweet('10', [photo('A')], { sensitive: true }), tweet('11', [photo('B')])]);
    expect(postsFromResponse(response).posts.map(p => p.metadata.rating)).toEqual(['Explicit', 'Unknown']);
  });

  test('X posts can be scored for training', () => {
    const [post] = postsFromResponse(firstPage([tweet('12', [photo('A')])])).posts;
    const result = scorePost(post, 'artist');
    expect(result.excluded).toBe(false);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  test('userFromResponse reads the account and reports missing or suspended ones', () => {
    expect(userFromResponse({ data: { user: { result: {
      __typename: 'User', rest_id: '99', core: { screen_name: 'SomeArtist', name: 'Some Artist' }, legacy: { media_count: 431 }, privacy: { protected: false }
    } } } })).toEqual({ id: '99', screenName: 'SomeArtist', name: 'Some Artist', mediaCount: 431, protected: false });
    expect(userFromResponse({ data: {} })).toEqual({ unavailable: true, reason: 'not-found' });
    expect(userFromResponse({ data: { user: { result: { __typename: 'UserUnavailable', reason: 'Suspended' } } } }))
      .toEqual({ unavailable: true, reason: 'suspended' });
  });

  test('handlesFromUrls picks the X accounts out of an e621 artist page', () => {
    // cherrybuns' links on e621, November 2026
    const urls = [
      { url: 'https://bsky.app/profile/cherrybuns.bsky.social', active: true },
      { url: 'https://www.patreon.com/cw/cherrybuns', active: true },
      { url: 'https://x.com/lewd_cherrybuns', active: true },
      { url: 'https://www.tiktok.com/@_cherrybuns__', active: true },
      { url: 'https://x.com/_cherrybuns__', active: true },
      { url: 'https://twitter.com/_CherryBuns__/status/123', active: false },
      { url: 'https://twitter.com/intent/user?screen_name=x', active: true },
      'https://mobile.twitter.com/oldname'
    ];
    expect(handlesFromUrls(urls)).toEqual([
      { handle: 'lewd_cherrybuns', active: true },
      { handle: '_cherrybuns__', active: true },
      { handle: 'oldname', active: true }
    ]);
  });

  test('text-only tweets count as timeline progress but give no posts', () => {
    const textOnly = tweet('20', []);
    const { posts, tweetIds } = postsFromResponse(firstPage([textOnly, tweet('21', [photo('A')])]), 'SomeArtist');
    expect(tweetIds).toEqual(['20', '21']);
    expect(posts.map(p => p.id)).toEqual(['x21']);
  });

  test('matchesTags matches hashtags and words in the text', () => {
    const [post] = postsFromResponse(firstPage([tweet('30', [photo('A')])])).posts;
    expect(matchesTags(post, [])).toBe(true);
    expect(matchesTags(post, ['red_fox'])).toBe(true); // #RedFox
    expect(matchesTags(post, ['#commission'])).toBe(true);
    expect(matchesTags(post, ['new_piece'])).toBe(true); // "New piece!"
    expect(matchesTags(post, ['red_fox', 'wolf'])).toBe(false);
  });

  test('saved posts sort newest first, images of a tweet in order', () => {
    const ids = ['x100_2', 'x99', 'x1855000000000000001', 'x100_1'].map(id => ({ id }));
    expect(ids.sort(XService.byNewest).map(p => p.id)).toEqual(['x1855000000000000001', 'x100_1', 'x100_2', 'x99']);
  });

  test('postFilter applies rating, minimum likes and tags', () => {
    const [sensitive, plain] = postsFromResponse(firstPage([tweet('40', [photo('A')], { sensitive: true }), tweet('41', [photo('B')])])).posts;
    expect(XService.postFilter({ rating: 'explicit' }, [])(sensitive)).toBe(true);
    expect(XService.postFilter({ rating: 'explicit' }, [])(plain)).toBe(false);
    expect(XService.postFilter({ rating: 's' }, [])(sensitive)).toBe(false);
    expect(XService.postFilter({ minScore: 900 }, [])(plain)).toBe(false);
    expect(XService.postFilter({}, ['red_fox'])(plain)).toBe(true);
  });

  test('a saved index round-trips through its file', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-x-'));
    const service = new XService(dir);
    const posts = postsFromResponse(firstPage([tweet('50', [photo('A')]), tweet('51', [photo('B')])])).posts;
    service.saveIndex({ indexed: true, responses: 1, author: 'SomeArtist', user: null, complete: true, seenTweets: new Set(['50', '51', '52']), posts });
    const saved = service.loadIndex('someartist');
    expect(saved.complete).toBe(true);
    expect(saved.tweetIds).toEqual(['50', '51', '52']);
    expect(saved.posts.map(p => p.id)).toEqual(['x51', 'x50']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('cleanHandle accepts @names and profile links', () => {
    expect(cleanHandle('@SomeArtist')).toBe('SomeArtist');
    expect(cleanHandle('https://x.com/SomeArtist/media')).toBe('SomeArtist');
    expect(cleanHandle('twitter.com/Some_Artist')).toBe('Some_Artist');
    expect(cleanHandle('  plainname ')).toBe('plainname');
  });
});
