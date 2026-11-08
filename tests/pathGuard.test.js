const path = require('path');
const { IMAGE_EXTENSIONS, TEXT_EXTENSIONS, requireFile, requireLocalPath, requireName, requireFileName, requireWebUrl } = require('../src/main/utils/pathGuard');

const abs = (...parts) => path.resolve(path.sep, ...parts);

describe('requireFile', () => {
  test('accepts an absolute path with an allowed extension', () => {
    expect(requireFile(abs('data', 'a.txt'), TEXT_EXTENSIONS)).toBe(abs('data', 'a.txt'));
    expect(requireFile(abs('data', 'x.PNG'), IMAGE_EXTENSIONS)).toBe(abs('data', 'x.PNG'));
  });

  test('refuses other file types, relative paths and odd input', () => {
    expect(() => requireFile(abs('Windows', 'system.ini'), TEXT_EXTENSIONS)).toThrow();
    expect(() => requireFile(abs('data', 'evil.exe'), IMAGE_EXTENSIONS)).toThrow();
    expect(() => requireFile('relative/a.txt', TEXT_EXTENSIONS)).toThrow();
    expect(() => requireFile(abs('a.txt\0.png'), IMAGE_EXTENSIONS)).toThrow();
    expect(() => requireFile(null, TEXT_EXTENSIONS)).toThrow();
  });
});

describe('requireLocalPath', () => {
  test('refuses network shares', () => {
    expect(() => requireLocalPath('\\\\attacker\\share\\a.png')).toThrow();
    expect(() => requireLocalPath('//attacker/share/a.png')).toThrow();
  });
});

describe('names', () => {
  test('a name is one path segment', () => {
    expect(requireName('zaush')).toBe('zaush');
    for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a\0b']) expect(() => requireName(bad)).toThrow();
  });

  test('a file name also needs an allowed extension', () => {
    expect(requireFileName('123.png', IMAGE_EXTENSIONS)).toBe('123.png');
    expect(() => requireFileName('123.bat', TEXT_EXTENSIONS)).toThrow();
    expect(() => requireFileName('..\\..\\Startup\\x.txt', TEXT_EXTENSIONS)).toThrow();
  });
});

describe('requireWebUrl', () => {
  test('allows web links only', () => {
    expect(requireWebUrl('https://e621.net/posts/1')).toBe('https://e621.net/posts/1');
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'ms-settings:', 'javascript:alert(1)', 'not a url']) {
      expect(() => requireWebUrl(bad)).toThrow();
    }
  });
});
