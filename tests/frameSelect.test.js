const { SIGNATURE_WIDTH, SIGNATURE_HEIGHT, sampleTimes, toGrey, contrast, sharpness, difference, pickFrames } = require('../src/renderer/js/utils/frameSelect');

const SIZE = SIGNATURE_WIDTH * SIGNATURE_HEIGHT;

// A picture with bright pixels from `start`, on a dark ground.
const picture = (start, length = SIZE / 2) => {
  const signature = new Uint8Array(SIZE).fill(40);
  for (let i = start; i < start + length && i < SIZE; i++) signature[i] = 220;
  return signature;
};
const sample = (time, signature, extra = {}) => ({ time, signature, sharpness: 1, contrast: contrast(signature), ...extra });

describe('sampleTimes', () => {
  test('steps through the duration', () => {
    expect(sampleTimes(1, 0.25, 100)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  test('widens the step rather than pass the limit', () => {
    const times = sampleTimes(1000, 0.1, 500);
    expect(times).toHaveLength(500);
    expect(times[1]).toBe(2);
  });

  test('copes with a length that is not known', () => {
    expect(sampleTimes(Infinity, 0.25, 0)).toEqual([0]);
    expect(sampleTimes(0, 0.25, 100)).toEqual([0]);
  });
});

describe('measurements', () => {
  test('toGrey weighs the colour channels', () => {
    expect([...toGrey(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([255, 0]);
  });

  test('a flat picture has no contrast', () => {
    expect(contrast(new Uint8Array(100).fill(90))).toBe(0);
    expect(contrast(picture(0))).toBeGreaterThan(50);
  });

  test('a hard edge is sharper than a soft one', () => {
    expect(sharpness(new Uint8Array([0, 200, 0, 200]), 2)).toBeGreaterThan(sharpness(new Uint8Array([90, 110, 90, 110]), 2));
  });

  test('difference is the share of pixels that moved', () => {
    expect(difference(picture(0), picture(0))).toBe(0);
    expect(difference(picture(0, SIZE), new Uint8Array(SIZE).fill(40))).toBe(1);
  });

  test('difference ignores noise too small to be a real change', () => {
    const noisy = picture(0).map(value => value + 5);
    expect(difference(picture(0), noisy)).toBe(0);
  });
});

describe('pickFrames', () => {
  test('keeps one frame from a stretch that does not change', () => {
    const samples = [0, 1, 2, 3].map(time => sample(time, picture(0)));
    expect(pickFrames(samples, 0.08)).toHaveLength(1);
  });

  test('keeps each real change', () => {
    const samples = [sample(0, picture(0)), sample(1, picture(600)), sample(2, picture(1200))];
    expect(pickFrames(samples, 0.08).map(s => s.time)).toEqual([0, 1, 2]);
  });

  test('takes the sharpest frame of a stretch', () => {
    const samples = [sample(0, picture(0), { sharpness: 2 }), sample(1, picture(0), { sharpness: 9 }), sample(2, picture(0), { sharpness: 4 })];
    expect(pickFrames(samples, 0.08).map(s => s.time)).toEqual([1]);
  });

  test('drops the repeats of a looping clip', () => {
    const loop = [picture(0), picture(600), picture(1200)];
    const samples = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(time => sample(time, loop[time % 3]));
    expect(pickFrames(samples, 0.08).map(s => s.time)).toEqual([0, 1, 2]);
  });

  test('leaves out flat frames such as a fade to black', () => {
    const black = new Uint8Array(SIZE);
    const samples = [sample(0, black), sample(1, picture(0)), sample(2, black)];
    expect(pickFrames(samples, 0.08).map(s => s.time)).toEqual([1]);
  });

  test('a higher minimum keeps fewer frames', () => {
    const samples = [0, 50, 100, 400, 800, 1200].map((start, time) => sample(time, picture(start)));
    expect(pickFrames(samples, 0.5).length).toBeLessThan(pickFrames(samples, 0.02).length);
  });

  test('handles nothing read yet', () => {
    expect(pickFrames([], 0.08)).toEqual([]);
  });
});
