import { describe, expect, test } from 'vite-plus/test';
import { externalLinks } from './external.ts';

const SHA = 'a'.repeat(64);
const untitled = { title: null };

describe('externalLinks', () => {
  test('links each SHA-256 alias to Mocha-Repository', () => {
    expect(externalLinks(untitled, [{ kind: 'sha256', hash: SHA.toUpperCase() }])).toEqual([
      {
        name: 'Mocha-Repository',
        url: `https://mocha-repository.info/song.php?sha256=${SHA}`,
        kind: 'ranking',
        hash: SHA,
      },
    ]);
    const other = 'b'.repeat(64);
    const links = externalLinks(untitled, [
      { kind: 'sha256', hash: SHA },
      { kind: 'sha256', hash: other },
    ]);
    expect(links.map((link) => link.hash)).toEqual([SHA, other]);
  });

  test('skips MD5 aliases (no LR2IR link yet) and malformed hashes', () => {
    expect(externalLinks(untitled, [{ kind: 'md5', hash: 'c'.repeat(32) }])).toEqual([]);
    expect(externalLinks(untitled, [{ kind: 'sha256', hash: 'not-a-hash' }])).toEqual([]);
    expect(externalLinks(untitled, [{ kind: 'sha256', hash: `${SHA}&x=1` }])).toEqual([]);
  });

  test('searches BMS Search for the title, encoded, and skips it without a title', () => {
    expect(externalLinks({ title: 'FREEDOM DiVE [ANOTHER] & more' }, [])).toEqual([
      {
        name: 'BMS Search',
        url: 'https://bmssearch.net/search?q=FREEDOM%20DiVE%20%5BANOTHER%5D%20%26%20more',
        kind: 'search',
      },
    ]);
    expect(externalLinks({ title: '   ' }, [])).toEqual([]);
  });
});
