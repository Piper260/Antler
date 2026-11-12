// A blank key field must never wipe a saved key; only clearSecret removes one.
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-settings-'));
jest.mock('electron', () => ({
  app: { getPath: () => mockDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`x${s}`),
    decryptString: (b) => b.toString().slice(1)
  }
}), { virtual: true });

const SettingsService = require('../src/main/services/SettingsService');
const MASK = '••••••••';

const fresh = async () => {
  fs.rmSync(path.join(mockDir, 'settings.json'), { force: true });
  const service = new SettingsService();
  await service.saveSettings({ e621: { username: 'me', apiKey: 'e621key' }, inkbunny: { username: 'ib', password: 'ibpass' }, huggingface: { apiToken: 'hf_token' } });
  return service;
};
const reload = () => new SettingsService().settings;

afterAll(() => fs.rmSync(mockDir, { recursive: true, force: true }));

describe('saved keys', () => {
  test('saving a form with blank key fields keeps the saved keys', async () => {
    const service = await fresh();
    await service.saveSettings(service.unmaskSecrets({
      e621: { username: 'me', apiKey: '' },
      inkbunny: { username: 'ib', password: '   ' },
      huggingface: { apiToken: '', enableAI: true }
    }));
    const saved = reload();
    expect(saved.e621.apiKey).toBe('e621key');
    expect(saved.inkbunny.password).toBe('ibpass');
    expect(saved.huggingface.apiToken).toBe('hf_token');
    expect(saved.huggingface.enableAI).toBe(true);
  });

  test('the mask keeps the saved key and a new value replaces it', async () => {
    const service = await fresh();
    await service.saveSettings(service.unmaskSecrets({ e621: { apiKey: MASK }, huggingface: { apiToken: 'hf_new' } }));
    const saved = reload();
    expect(saved.e621.apiKey).toBe('e621key');
    expect(saved.huggingface.apiToken).toBe('hf_new');
  });

  test('keys are encrypted on disk', async () => {
    await fresh();
    const onDisk = JSON.parse(fs.readFileSync(path.join(mockDir, 'settings.json'), 'utf8'));
    expect(onDisk.e621.apiKey.startsWith('enc:')).toBe(true);
    expect(JSON.stringify(onDisk)).not.toContain('e621key');
  });

  test('clearSecret removes one key and leaves the others', async () => {
    const service = await fresh();
    expect((await service.clearSecret('inkbunny.password')).success).toBe(true);
    const saved = reload();
    expect(saved.inkbunny.password).toBe('');
    expect(saved.e621.apiKey).toBe('e621key');
    expect((await service.clearSecret('app.theme')).success).toBe(false);
  });

  test('unmaskSecret only touches secret settings', async () => {
    const service = await fresh();
    expect(service.unmaskSecret('e621.apiKey', '')).toBe('e621key');
    expect(service.unmaskSecret('e621.username', '')).toBe('');
    expect(service.unmaskSecret('e621.apiKey', 'other')).toBe('other');
  });

  test('setting the e621 credentials with a blank key keeps the saved key', async () => {
    const service = await fresh();
    await service.setE621Credentials('newname', '');
    const saved = reload();
    expect(saved.e621.username).toBe('newname');
    expect(saved.e621.apiKey).toBe('e621key');
  });
});
