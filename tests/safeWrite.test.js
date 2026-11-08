const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileSafe, writeFileSafeSync, backupPathFor } = require('../src/main/utils/safeWrite');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safewrite-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const leftovers = () => fs.readdirSync(dir).filter(name => name.endsWith('.tmp'));

describe('writeFileSafe', () => {
  test('writes a new file without a backup or temp file left over', async () => {
    const file = path.join(dir, '1.txt');
    await writeFileSafe(file, 'fox, solo', { backup: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('fox, solo');
    expect(fs.existsSync(backupPathFor(file))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  test('keeps the replaced file in bak/, one step back', async () => {
    const file = path.join(dir, '1.txt');
    await writeFileSafe(file, 'first');
    await writeFileSafe(file, 'second', { backup: true });
    await writeFileSafe(file, 'third', { backup: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('third');
    expect(fs.readFileSync(path.join(dir, 'bak', '1.txt'), 'utf8')).toBe('second');
  });

  test('leaves the old file alone when the write fails', async () => {
    const file = path.join(dir, '1.txt');
    fs.writeFileSync(file, 'keep me');
    // A folder in the way of the rename makes it fail.
    const blocked = path.join(dir, 'blocked');
    fs.mkdirSync(blocked);
    fs.writeFileSync(path.join(blocked, 'x'), '');
    await expect(writeFileSafe(blocked, 'data')).rejects.toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('keep me');
    expect(leftovers()).toEqual([]);
  });

  test('the sync version does the same', () => {
    const file = path.join(dir, 'settings.json');
    writeFileSafeSync(file, '{"a":1}');
    writeFileSafeSync(file, '{"a":2}', { backup: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":2}');
    expect(fs.readFileSync(backupPathFor(file), 'utf8')).toBe('{"a":1}');
  });
});
