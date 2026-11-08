const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ModelDownloadService, packStatus, fileUrl, MANIFEST } = require('../src/main/services/ModelDownloadService');

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function makeManifest(files) {
  return {
    repo: 'someone/models',
    revision: 'main',
    packs: [{ id: 'p', name: 'Pack', description: '', recommended: true, files }]
  };
}

/** A fetch that serves `content` and honours Range unless told not to. */
function fakeFetch(content, { honourRange = true, calls = [] } = {}) {
  return async (url, { headers = {} } = {}) => {
    calls.push({ url, headers });
    const match = /bytes=(\d+)-/.exec(headers.Range || '');
    const start = match && honourRange ? Number(match[1]) : 0;
    const body = content.subarray(start);
    return {
      ok: true,
      status: start > 0 ? 206 : 200,
      body: (async function* () {
        for (let i = 0; i < body.length; i += 7) yield body.subarray(i, i + 7);
      })()
    };
  };
}

describe('ModelDownloadService', () => {
  let dir;
  const none = () => null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-models-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('downloads, verifies and renames into place', async () => {
    const content = Buffer.from('model bytes for a test file');
    const manifest = makeManifest([{ path: 'tagger/a.onnx', size: content.length, sha256: sha(content) }]);
    const calls = [];
    const service = new ModelDownloadService({ targetDir: dir, manifest, fetchImpl: fakeFetch(content, { calls }), find: none });

    const events = [];
    const result = await service.download(['p'], event => events.push(event));

    expect(result.downloaded).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'tagger', 'a.onnx'))).toEqual(content);
    expect(fs.existsSync(path.join(dir, 'tagger', 'a.onnx.part'))).toBe(false);
    expect(calls[0].url).toBe('https://huggingface.co/someone/models/resolve/main/tagger/a.onnx');
    expect(events.at(-1).state).toBe('done');
  });

  test('downloads a file with a source from its own repo', async () => {
    const content = Buffer.from('upstream');
    const manifest = makeManifest([{ path: 'up.onnx', size: content.length, sha256: sha(content), source: { repo: 'author/model', revision: 'abc123', path: 'dir/best.onnx' } }]);
    const calls = [];
    const service = new ModelDownloadService({ targetDir: dir, manifest, fetchImpl: fakeFetch(content, { calls }), find: none });

    await service.download(['p']);

    expect(calls[0].url).toBe('https://huggingface.co/author/model/resolve/abc123/dir/best.onnx');
    expect(fs.readFileSync(path.join(dir, 'up.onnx'))).toEqual(content);
  });

  test('resumes a partial download with a Range request', async () => {
    const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
    const manifest = makeManifest([{ path: 'b.onnx', size: content.length, sha256: sha(content) }]);
    fs.writeFileSync(path.join(dir, 'b.onnx.part'), content.subarray(0, 10));
    const calls = [];
    const service = new ModelDownloadService({ targetDir: dir, manifest, fetchImpl: fakeFetch(content, { calls }), find: none });

    await service.download(['p']);

    expect(calls[0].headers.Range).toBe('bytes=10-');
    expect(fs.readFileSync(path.join(dir, 'b.onnx'))).toEqual(content);
  });

  test('starts over when the server ignores the range', async () => {
    const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
    const manifest = makeManifest([{ path: 'c.onnx', size: content.length, sha256: sha(content) }]);
    fs.writeFileSync(path.join(dir, 'c.onnx.part'), content.subarray(0, 10));
    const service = new ModelDownloadService({ targetDir: dir, manifest, fetchImpl: fakeFetch(content, { honourRange: false }), find: none });

    await service.download(['p']);

    expect(fs.readFileSync(path.join(dir, 'c.onnx'))).toEqual(content);
  });

  test('removes a file whose checksum does not match', async () => {
    const content = Buffer.from('corrupted');
    const manifest = makeManifest([{ path: 'd.onnx', size: content.length, sha256: 'f'.repeat(64) }]);
    const service = new ModelDownloadService({ targetDir: dir, manifest, fetchImpl: fakeFetch(content), find: none });

    await expect(service.download(['p'])).rejects.toThrow(/checksum/);
    expect(fs.existsSync(path.join(dir, 'd.onnx'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'd.onnx.part'))).toBe(false);
  });

  test('rejects unknown packs', async () => {
    const service = new ModelDownloadService({ targetDir: dir, manifest: makeManifest([]), fetchImpl: fakeFetch(Buffer.alloc(0)), find: none });
    await expect(service.download(['nope'])).rejects.toThrow(/No model packs/);
  });
});

describe('packStatus', () => {
  test('a pack is installed only when every file is present at its size', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antler-status-'));
    try {
      fs.writeFileSync(path.join(dir, 'a'), 'abc');
      fs.writeFileSync(path.join(dir, 'b'), 'ab');
      const find = (file) => (fs.existsSync(path.join(dir, file)) ? path.join(dir, file) : null);
      const manifest = makeManifest([{ path: 'a', size: 3 }, { path: 'b', size: 3 }, { path: 'c', size: 5 }]);
      const [pack] = packStatus(manifest, find);
      expect(pack.installed).toBe(false);
      expect(pack.size).toBe(11);
      expect(pack.missingBytes).toBe(8);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bundled manifest', () => {
  test('every file has a size and checksum and a safe path', () => {
    for (const pack of MANIFEST.packs) {
      for (const entry of pack.files) {
        expect(entry.size).toBeGreaterThan(0);
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.path).not.toMatch(/\.\.|^\/|\\/);
        expect(fileUrl(MANIFEST, entry)).toMatch(/^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[\w.-]+\//);
        // Upstream files are pinned to a commit so a later change upstream can't break the checksum.
        if (entry.source) expect(entry.source.revision).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
