const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { CaptionService, cleanCaption, composeOutput } = require('../src/main/services/CaptionService');

describe('cleanCaption', () => {
  test('strips thinking, labels, quotes, markdown and line breaks', () => {
    expect(cleanCaption('<think>hmm</think>Caption: "A fox **sits** on a log.\nIt is dusk."'))
      .toBe('A fox sits on a log. It is dusk.');
    expect(cleanCaption("Here's the caption: A wolf runs.")).toBe('A wolf runs.');
  });
});

describe('composeOutput', () => {
  const tags = ['fox', 'twangstyle', 'solo'];
  test('sidecar and replace are the sentence, with the trigger first', () => {
    expect(composeOutput('sidecar', 'A fox.', tags, 'twangstyle')).toBe('twangstyle, A fox.');
    expect(composeOutput('replace', 'A fox.', tags)).toBe('A fox.');
  });
  test('hybrid adds the tags after the sentence, not repeating the trigger', () => {
    expect(composeOutput('hybrid', 'A fox.', tags, 'twangstyle')).toBe('twangstyle, A fox., fox, solo');
  });
});

describe('CaptionService', () => {
  let dir;
  let image;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-caption-'));
    image = path.join(dir, '123.png');
    await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#ff0000' } }).png().toFile(image);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const fakeOllama = (calls, reply = { message: { content: 'A red square.' } }) => async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => reply };
  };
  const settings = { getAllSettings: () => ({ ollama: { host: 'http://ollama.test:11434/' } }) };

  test('sends a shrunk image with the tags and no thinking', async () => {
    const calls = [];
    const service = new CaptionService(settings, { fetchImpl: fakeOllama(calls) });
    const caption = await service.caption({ imagePath: image, tags: ['red_square', 'simple background'], model: 'vision:7b', length: 'short' });

    expect(caption).toBe('A red square.');
    const { url, body } = calls[0];
    expect(url).toBe('http://ollama.test:11434/api/chat');
    expect(body).toMatchObject({ model: 'vision:7b', stream: false, think: false });
    const user = body.messages[1];
    expect(user.content).toContain('one sentence');
    expect(user.content).toContain('red square, simple background');
    const meta = await sharp(Buffer.from(user.images[0], 'base64')).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(1024);
  });

  test('retries without the thinking option when a model rejects it', async () => {
    const calls = [];
    let first = true;
    const service = new CaptionService(settings, {
      fetchImpl: async (url, init) => {
        calls.push(JSON.parse(init.body));
        if (first) {
          first = false;
          return { ok: false, status: 400, json: async () => ({ error: '"vision:7b" does not support thinking' }) };
        }
        return { ok: true, status: 200, json: async () => ({ message: { content: 'A red square.' } }) };
      }
    });
    expect(await service.caption({ imagePath: image, tags: [], model: 'vision:7b' })).toBe('A red square.');
    expect(calls[0].think).toBe(false);
    expect('think' in calls[1]).toBe(false);
  });

  test('sidecar leaves the tags alone; hybrid backs up the .txt once', async () => {
    const service = new CaptionService(settings, { fetchImpl: fakeOllama([]) });
    fs.writeFileSync(path.join(dir, '123.txt'), 'red_square, solo');

    await service.write({ imagePath: image, mode: 'sidecar', caption: 'A red square.', tags: ['red_square'] });
    expect(fs.readFileSync(path.join(dir, '123.caption'), 'utf8')).toBe('A red square.\n');
    expect(fs.readFileSync(path.join(dir, '123.txt'), 'utf8')).toBe('red_square, solo');

    await service.write({ imagePath: image, mode: 'hybrid', caption: 'A red square.', tags: ['red_square', 'solo'] });
    await service.write({ imagePath: image, mode: 'replace', caption: 'Second pass.', tags: [] });
    expect(fs.readFileSync(path.join(dir, '123.txt'), 'utf8')).toBe('Second pass.\n');
    // The backup is the original, not the first rewrite.
    expect(fs.readFileSync(path.join(dir, 'bak', 'captions', '123.txt'), 'utf8')).toBe('red_square, solo');
  });

  test('says plainly when Ollama is not running', async () => {
    const service = new CaptionService(settings, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    await expect(service.listVisionModels()).rejects.toThrow(/Can't reach Ollama/);
  });
});
