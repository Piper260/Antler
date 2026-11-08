const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateLegacyUserData } = require('../src/main/utils/legacyUserData');

describe('migrateLegacyUserData', () => {
  let appData;
  let userData;

  beforeEach(() => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-migrate-'));
    userData = path.join(appData, 'antler');
  });

  afterEach(() => {
    fs.rmSync(appData, { recursive: true, force: true });
  });

  test('moves the old piper-aio folder to the new location', () => {
    const legacy = path.join(appData, 'piper-aio');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"a":1}');

    expect(migrateLegacyUserData(appData, userData)).toBe('moved');
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).toBe('{"a":1}');
  });

  test('moves into a new folder that Electron already created', () => {
    const legacy = path.join(appData, 'piper-aio');
    fs.mkdirSync(path.join(legacy, 'Local Storage'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'Local Storage', 'old'), 'kept');
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"a":1}');
    fs.mkdirSync(path.join(userData, 'Local Storage'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'Local Storage', 'fresh'), 'x');
    fs.mkdirSync(path.join(userData, 'GPUCache'));

    expect(migrateLegacyUserData(appData, userData)).toBe('moved');
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).toBe('{"a":1}');
    expect(fs.readdirSync(path.join(userData, 'Local Storage'))).toEqual(['old']);
    expect(fs.existsSync(path.join(userData, 'GPUCache'))).toBe(true);
  });

  test('leaves a new folder that already has settings alone', () => {
    fs.mkdirSync(path.join(appData, 'piper-aio'));
    fs.mkdirSync(userData);
    fs.writeFileSync(path.join(userData, 'settings.json'), 'new');

    expect(migrateLegacyUserData(appData, userData)).toBe('skipped');
    expect(fs.existsSync(path.join(appData, 'piper-aio'))).toBe(true);
    expect(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).toBe('new');
  });

  test('does nothing on a fresh install', () => {
    expect(migrateLegacyUserData(appData, userData)).toBe('skipped');
    expect(fs.existsSync(userData)).toBe(false);
  });
});
