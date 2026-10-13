import { describe, expect, test } from 'vite-plus/test';
import { externalLinks } from './external.ts';

const SHA = 'f3d5e7779ba3a1217495df2828e3ff2576d8d38a39d12223a3121bd02d1debf2';
const MD5 = '65ef6729cdb3ab608251628a425290f9';
const titled = { title: 'Song' };

describe('externalLinks', () => {
  test('links a SHA-256 to Mocha-Repository, MinIR and BMS Search, in the formats BMS Search uses', () => {
    expect(externalLinks(titled, [{ kind: 'sha256', hash: SHA.toUpperCase() }])).toEqual([
      {
        name: 'Mocha-Repository',
        url: `https://mocha-repository.info/song.php?sha256=${SHA}`,
        kind: 'chart',
        hash: SHA,
      },
      { name: 'MinIR', url: `https://www.gaftalk.com/minir/#/viewer/song/${SHA}/0`, kind: 'chart', hash: SHA },
      { name: 'BMS Search', url: `https://bmssearch.net/patterns/${SHA}`, kind: 'chart', hash: SHA },
    ]);
  });

  test('links an MD5 to LR2IR', () => {
    expect(externalLinks(titled, [{ kind: 'md5', hash: MD5 }])).toEqual([
      {
        name: 'LR2IR',
        url: `http://www.dream-pro.info/~lavalse/LR2IR/search.cgi?mode=ranking&bmsmd5=${MD5}`,
        kind: 'chart',
        hash: MD5,
      },
    ]);
  });

  test('gives one set per file, and skips malformed hashes', () => {
    const other = 'b'.repeat(64);
    const links = externalLinks(titled, [
      { kind: 'sha256', hash: SHA },
      { kind: 'sha256', hash: other },
      { kind: 'sha256', hash: 'not-a-hash' },
      { kind: 'md5', hash: `${MD5}&x=1` },
    ]);
    expect(links.map((link) => [link.name, link.hash])).toEqual([
      ['Mocha-Repository', SHA],
      ['MinIR', SHA],
      ['BMS Search', SHA],
      ['Mocha-Repository', other],
      ['MinIR', other],
      ['BMS Search', other],
    ]);
  });

  test('falls back to a BMS Search title search only when no hash is known', () => {
    expect(externalLinks({ title: 'FREEDOM DiVE [ANOTHER] & more' }, [])).toEqual([
      {
        name: 'BMS Search',
        url: 'https://bmssearch.net/search?q=FREEDOM%20DiVE%20%5BANOTHER%5D%20%26%20more',
        kind: 'search',
      },
    ]);
    expect(externalLinks({ title: '   ' }, [])).toEqual([]);
    expect(externalLinks(titled, [{ kind: 'sha256', hash: SHA }]).some((link) => link.kind === 'search')).toBe(false);
  });
});
