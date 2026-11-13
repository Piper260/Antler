const { notOnE621, postForImage } = require('../src/main/services/UpgradeFinder');

// 64-bit fingerprints as 16 hex digits; flipping n low bits sets the distance.
const print = (n) => (BigInt('0xf0f0f0f0f0f0f0f0') ^ ((1n << BigInt(n)) - 1n)).toString(16).padStart(16, '0');
const other = 'ffff0000ffff0000';

describe('Pawchive work not on e621', () => {
  test('the closest Pawchive image to an e621 post is that post, even several bits off', () => {
    // A thumbnail's compression often moves a wide picture 5-10 bits.
    const candidates = [
      { hash: 'a', fingerprint: print(8) },
      { hash: 'c', fingerprint: other }
    ];
    expect(notOnE621(candidates, [print(0)]).map(c => c.hash)).toEqual(['c']);
  });

  test('other versions in a post are listed even though they look like the e621 post', () => {
    const candidates = [
      { hash: 'v1', fingerprint: print(3) },  // the version on e621 (closest)
      { hash: 'v2', fingerprint: print(9) },  // alternate versions, close to it too
      { hash: 'v3', fingerprint: print(12) }
    ];
    expect(notOnE621(candidates, [print(0)]).map(c => c.hash)).toEqual(['v2', 'v3']);
  });

  test('the same picture posted twice on Pawchive is listed once, or not at all when on e621', () => {
    const candidates = [
      { hash: 'a', fingerprint: other },
      { hash: 'b', fingerprint: other },       // repost of a
      { hash: 'e', fingerprint: print(1) },    // on e621
      { hash: 'f', fingerprint: print(2) }     // repost of e, one bit off
    ];
    expect(notOnE621(candidates, [print(0)]).map(c => c.hash)).toEqual(['a']);
  });

  test('a missing image becomes a post that downloads from Pawchive', () => {
    // Pawchive files are named by their sha256.
    const one = 'aa'.repeat(32);
    const two = 'cd'.repeat(32);
    const raw = {
      id: '55', service: 'patreon', user: '438036', title: 'Sketch dump',
      tags: '{fox,sketch}', published: '2026-10-01T00:00:00',
      file: { name: 'one.png', path: `/aa/bb/${one}.png` },
      attachments: [{ name: 'two.jpg', path: `/cd/cd/${two}.jpg` }]
    };
    const post = postForImage({ raw, hash: two, url: 'https://example.test/two.jpg', thumb: 'https://example.test/t/two.jpg' }, 'redrusker');
    expect(post.onlyOnPawchive).toBe(true);
    expect(post.source).toBe('pawchive');
    expect(post.id).toBe('pc_patreon_438036_55_2');
    expect(post.fileUrls.original).toContain(`${two}.jpg`);
    expect(post.downloadInfo.filename).toBe('pc_patreon_438036_55_2.jpg');
    expect(post.metadata.description).toBe('Sketch dump (2 of 2)');
    expect(post.tags.artist).toEqual(['redrusker']);
  });
});
