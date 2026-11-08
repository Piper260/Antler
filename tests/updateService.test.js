const { UpdateService, compareVersions, updateMode } = require('../src/main/services/UpdateService');

const release = (tag, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ tag_name: tag, html_url: `https://github.com/Piper260/Antler/releases/tag/${tag}` })
});

describe('compareVersions', () => {
  test('orders versions by number, not text', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('v1.0.1', '1.0.1')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('2.0', '1.9.9')).toBe(1);
  });
});

describe('updateMode', () => {
  test('installed Windows and AppImage builds update themselves', () => {
    expect(updateMode({ packaged: true, platform: 'win32', env: {} })).toBe('auto');
    expect(updateMode({ packaged: true, platform: 'linux', env: { APPIMAGE: '/x/Antler.AppImage' } })).toBe('auto');
  });

  test('macOS and non-AppImage Linux only say an update is out', () => {
    expect(updateMode({ packaged: true, platform: 'darwin', env: {} })).toBe('notify');
    expect(updateMode({ packaged: true, platform: 'linux', env: {} })).toBe('notify');
  });

  test('running from source never updates', () => {
    expect(updateMode({ packaged: false, platform: 'win32', env: {} })).toBe('source');
  });
});

describe('UpdateService in notify mode', () => {
  const make = (fetchImpl) => new UpdateService({ mode: 'notify', fetchImpl, currentVersion: '1.0.1' });

  test('reports a newer release with its page', async () => {
    const service = make(release('v1.1.0'));
    const seen = [];
    service.onStatus((s) => seen.push(s.state));
    const status = await service.check();
    expect(status.state).toBe('available');
    expect(status.version).toBe('1.1.0');
    expect(status.releaseUrl).toBe('https://github.com/Piper260/Antler/releases/tag/v1.1.0');
    expect(seen).toEqual(['checking', 'available']);
  });

  test('is up to date when the release is the same or older', async () => {
    expect((await make(release('v1.0.1')).check()).state).toBe('up-to-date');
    expect((await make(release('v0.9.0')).check()).state).toBe('up-to-date');
  });

  test('treats "no release yet" as up to date', async () => {
    expect((await make(release('', 404)).check()).state).toBe('up-to-date');
  });

  test('reports errors without throwing', async () => {
    const status = await make(async () => { throw new Error('offline'); }).check();
    expect(status.state).toBe('error');
    expect(status.error).toBe('offline');
  });

  test('cannot install: only auto mode restarts into an update', () => {
    expect(make(release('v2.0.0')).install()).toBe(false);
  });
});

describe('UpdateService from source', () => {
  test('says updates are unsupported', async () => {
    const service = new UpdateService({ mode: 'source', fetchImpl: release('v9.0.0'), currentVersion: '1.0.1' });
    expect((await service.check()).state).toBe('unsupported');
  });
});
