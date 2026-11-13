const { notOnE621, postForImage } = require('../src/main/services/UpgradeFinder');

// 64-bit fingerprints as 16 hex digits; flipping n low bits sets the distance.
const print = (n) => (BigInt('0xf0f0f0f0f0f0f0f0') ^ ((1n << BigInt(n)) - 1n)).toString(16).padStart(16, '0');
const other = 'ffff0000ffff0000';

describe('Pawchive work not on e621', () => {
  test('a Pawchive image close to an e621 post is on e621; one far from all is not', () => {
    const candidates = [
      { hash: 'a', fingerprint: print(3) },   // 3 bits from the e621 post
      { hash: 'b', fingerprint: other }      // nothing like it
    ];
    expect(notOnE621(candidates, [print(0)]).map(c => c.hash)).toEqual(['b']);
  });

  test('the same picture posted twice on Pawchive is listed once', () => {
    const candidates = [
      { hash: 'a', fingerprint: other },
      { hash: 'b', fingerprint: other }
    ];
    expect(notOnE621(candidates, [print(0)]).map(c => c.hash)).toEqual(['a']);
  });

  test('a missing image becomes a post that downloads from Pawchive', () => {
    const raw = {
      id: '55', service: 'patreon', user: '438036', title: 'Sketch dump',
      tags: '{fox,sketch}', published: '2026-10-01T00:00:00',
      file: { name: 'one.png', path: '/aa/bb/aabbccdd11223344.png' },
      attachments: [{ name: 'two.jpg', path: '/cc/dd/ccdd556677889900.jpg' }]
    };
    const post = postForImage({ raw, hash: 'ccdd556677889900', url: 'https://example.test/two.jpg', thumb: 'https://example.test/t/two.jpg' }, 'redrusker');
    expect(post.onlyOnPawchive).toBe(true);
    expect(post.source).toBe('pawchive');
    expect(post.id).toBe('pc_patreon_438036_55_ccdd5566');
    expect(post.fileUrls.original).toBe('https://example.test/two.jpg');
    expect(post.downloadInfo.filename).toBe('pc_patreon_438036_55_ccdd5566.jpg');
    expect(post.tags.artist).toEqual(['redrusker']);
  });
});
