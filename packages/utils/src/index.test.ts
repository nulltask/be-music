import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  clamp,
  clampSignedUnit,
  basename,
  compareFractions,
  dirname,
  extname,
  asLoadedFileEntryBytes,
  findFirstIndexAtOrAfter,
  findFirstIndexNumberAtOrAfter,
  findCaseInsensitiveMapPath,
  findLastIndexAtOrBefore,
  findLastIndexBefore,
  gcd,
  isAudioAssetPath,
  isMaliciousAssetPath,
  lcm,
  loadFileEntryBytes,
  lookupCaseInsensitiveMapEntry,
  normalizePath,
  normalizeAsciiBase36Code,
  normalizeAsciiBase62Code,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizeSortedUniqueNonNegativeIntegers,
  normalizePositiveInt,
  readFilesIntoEntryMap,
  resolveCliPath,
  runWithConcurrency,
} from './index.ts';
describe('utils', () => {
  test('resolveCliPath: resolves to an absolute path from the specified cwd', () => {
    expect(resolveCliPath('chart/test.bms', '/tmp')).toBe(resolve('/tmp', 'chart/test.bms'));
    expect(resolveCliPath('./chart/test.bms', '/tmp')).toBe(resolve('/tmp', './chart/test.bms'));
    expect(resolveCliPath('./', '/tmp')).toBe(resolve('/tmp', './'));
  });

  test('resolveCliPath: returns POSIX absolute paths verbatim regardless of cwd', () => {
    // The previous implementation routed absolute inputs through the lazy `node:path` `require` slow
    // path, which silently fell back to `cwd` on pure-ESM Node runtimes (`tsx`, `node --import tsx/esm`)
    // because `eval('require')` throws in strict ESM. Result: every CLI invocation with an absolute
    // argument turned into "scan cwd as a directory." Verify the fast-path branch never reaches that
    // code path now by exercising it from a cwd that doesn't share a prefix with the input.
    expect(resolveCliPath('/Users/foo/song/chart.bms', '/tmp')).toBe('/Users/foo/song/chart.bms');
    expect(resolveCliPath('/abs', '/tmp')).toBe('/abs');
  });

  test('resolveCliPath: returns Windows drive-absolute paths verbatim', () => {
    // Same regression class as the POSIX case — `C:\foo` / `C:/foo` would silently collapse to `cwd`
    // when the slow path's `require` lookup failed.
    expect(resolveCliPath('C:\\Users\\foo\\chart.bms', '/tmp')).toBe('C:\\Users\\foo\\chart.bms');
    expect(resolveCliPath('C:/Users/foo/chart.bms', '/tmp')).toBe('C:/Users/foo/chart.bms');
    expect(resolveCliPath('d:\\song.bms', '/tmp')).toBe('d:\\song.bms');
  });

  test('clamp/clampSignedUnit: clamps values to configured ranges', () => {
    expect(clamp(4, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(clampSignedUnit(1.5)).toBe(1);
    expect(clampSignedUnit(-2)).toBe(-1);
  });

  test('normalizeNonNegativeInt/normalizePositiveInt: normalizes integer values', () => {
    expect(normalizeNonNegativeInt(4.9)).toBe(4);
    expect(normalizeNonNegativeInt(-1.2)).toBe(0);
    expect(normalizeNonNegativeInt(Number.NaN, 7)).toBe(7);
    expect(normalizeNonNegativeInt(Number.POSITIVE_INFINITY, 9)).toBe(9);
    expect(normalizeNonNegativeInt(Number.NEGATIVE_INFINITY, 4)).toBe(4);
    expect(normalizePositiveInt(9.8)).toBe(9);
    expect(normalizePositiveInt(0.1)).toBe(1);
    expect(normalizePositiveInt(-5, 3)).toBe(3);
    expect(normalizePositiveInt(Number.NaN, 5)).toBe(5);
    expect(normalizePositiveInt(Number.POSITIVE_INFINITY, 6)).toBe(6);
  });

  test('normalizeFractionNumerator: normalizes fractional numerators into range', () => {
    expect(normalizeFractionNumerator(3.9, 8)).toBe(3);
    expect(normalizeFractionNumerator(-2, 8)).toBe(0);
    expect(normalizeFractionNumerator(99, 8)).toBe(7);
    expect(normalizeFractionNumerator(2.8, 3.9)).toBe(2);
    expect(normalizeFractionNumerator(10, Number.NaN)).toBe(0);
    expect(normalizeFractionNumerator(10, -3)).toBe(0);
    expect(normalizeFractionNumerator(Number.NaN, 8, 2)).toBe(2);
    expect(normalizeFractionNumerator(Number.POSITIVE_INFINITY, 8, 3)).toBe(3);
    expect(normalizeFractionNumerator(4, 0)).toBe(0);
  });

  test('gcd/lcm: computes greatest common divisor and least common multiple', () => {
    expect(gcd(24, 18)).toBe(6);
    expect(gcd(-24, 18)).toBe(6);
    expect(gcd(0, 5)).toBe(5);
    expect(lcm(6, 8)).toBe(24);
    expect(lcm(-6, 8)).toBe(24);
    expect(lcm(0, 8)).toBe(0);
  });

  test('compareFractions: handles equal denominators, safe integer math, and BigInt fallback', () => {
    expect(compareFractions(1, 4, 2, 4)).toBe(-1);
    expect(compareFractions(1, 3, 2, 6)).toBe(0);
    expect(compareFractions(3, 5, 1, 2)).toBe(1);
    expect(
      compareFractions(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER - 1,
      ),
    ).toBe(-1);
    expect(
      compareFractions(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER - 1,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(1);
  });

  test('normalizeSortedUniqueNonNegativeIntegers: normalizes, sorts, and deduplicates small inputs', () => {
    expect(
      normalizeSortedUniqueNonNegativeIntegers([
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -5,
        3.8,
        1.2,
        3.2,
        0x8000_0000 + 0.9,
        0,
      ]),
    ).toEqual([0, 1, 3, 0x8000_0000]);
  });

  test('normalizeSortedUniqueNonNegativeIntegers: uses the large-input sort path', () => {
    expect(
      normalizeSortedUniqueNonNegativeIntegers([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1.8, 0]),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  test('findLastIndexAtOrBefore/findLastIndexBefore: returns binary-search index bounds', () => {
    const values = [{ beat: 1 }, { beat: 3 }, { beat: 3 }, { beat: 7 }];
    expect(findLastIndexAtOrBefore(values, 0, (item) => item.beat)).toBe(-1);
    expect(findLastIndexAtOrBefore(values, 3, (item) => item.beat)).toBe(2);
    expect(findLastIndexAtOrBefore(values, 8, (item) => item.beat)).toBe(3);
    expect(findLastIndexBefore(values, 1, (item) => item.beat)).toBe(-1);
    expect(findLastIndexBefore(values, 3, (item) => item.beat)).toBe(0);
    expect(findLastIndexBefore(values, 8, (item) => item.beat)).toBe(3);
  });

  test('findFirstIndexAtOrAfter/findFirstIndexNumberAtOrAfter: returns lower-bound indexes', () => {
    const values = [{ beat: 1 }, { beat: 3 }, { beat: 3 }, { beat: 7 }];
    expect(findFirstIndexAtOrAfter(values, 0, (item) => item.beat)).toBe(0);
    expect(findFirstIndexAtOrAfter(values, 3, (item) => item.beat)).toBe(1);
    expect(findFirstIndexAtOrAfter(values, 4, (item) => item.beat)).toBe(3);
    expect(findFirstIndexAtOrAfter(values, 8, (item) => item.beat)).toBe(4);
    expect(findFirstIndexNumberAtOrAfter([1, 3, 3, 7], 3)).toBe(1);
    expect(findFirstIndexNumberAtOrAfter([1, 3, 3, 7], 8)).toBe(4);
  });

  test('runWithConcurrency: bounds in-flight tasks and preserves item indexes', async () => {
    let active = 0;
    let maxActive = 0;
    const visited: Array<[number, number]> = [];
    await runWithConcurrency([10, 20, 30, 40, 50], 2, async (item, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      visited.push([item, index]);
      await Promise.resolve();
      active -= 1;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(visited.sort((a, b) => a[1] - b[1])).toEqual([
      [10, 0],
      [20, 1],
      [30, 2],
      [40, 3],
      [50, 4],
    ]);
  });

  test('runWithConcurrency: throws AbortError for aborted signals', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runWithConcurrency([1], 1, async () => undefined, { signal: controller.signal })).rejects.toThrow(
      /aborted/i,
    );
  });

  test('case-insensitive file entry helpers: resolve exact, folded, and rejected paths', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const files = new Map<string, Uint8Array>([['Song/Kick.WAV', bytes]]);

    expect(findCaseInsensitiveMapPath(files, 'Song/Kick.WAV')).toBe('Song/Kick.WAV');
    expect(findCaseInsensitiveMapPath(files, 'song/kick.wav')).toBe('Song/Kick.WAV');
    expect(lookupCaseInsensitiveMapEntry(files, 'SONG/KICK.WAV')).toBe(bytes);
    expect(findCaseInsensitiveMapPath(files, '/etc/passwd', { rejectCandidate: isMaliciousAssetPath })).toBeUndefined();
  });

  test('file entry byte helpers: read eager and lazy entries', async () => {
    const eager = new Uint8Array([1, 2]);
    const lazy = {
      arrayBuffer: async () => new Uint8Array([3, 4]).buffer,
    };

    expect(await loadFileEntryBytes(eager)).toBe(eager);
    expect(await loadFileEntryBytes(lazy)).toEqual(new Uint8Array([3, 4]));
    expect(asLoadedFileEntryBytes(eager)).toBe(eager);
    expect(asLoadedFileEntryBytes(lazy)).toBeUndefined();
  });

  test('readFilesIntoEntryMap: normalizes paths, defers audio, reports progress, and skips unreadable files', async () => {
    const reads: string[] = [];
    const errors: string[] = [];
    const files = [
      {
        name: 'kick.wav',
        webkitRelativePath: String.raw`Song\\kick.wav`,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      },
      {
        name: 'chart.bms',
        webkitRelativePath: 'Song/chart.bms',
        arrayBuffer: async () => new Uint8Array([2]).buffer,
      },
      {
        name: 'broken.txt',
        arrayBuffer: async () => {
          throw new Error('nope');
        },
      },
    ];

    const out = await readFilesIntoEntryMap(files, {
      concurrency: 1,
      onRead: (path) => reads.push(path),
      onReadError: (path) => errors.push(path),
    });

    expect(out.get('Song/kick.wav')).toBe(files[0]);
    expect(out.get('Song/chart.bms')).toEqual(new Uint8Array([2]));
    expect(out.has('broken.txt')).toBe(false);
    expect(reads).toEqual(['Song/kick.wav', 'Song/chart.bms', 'broken.txt']);
    expect(errors).toEqual(['broken.txt']);
  });

  test('normalizeAsciiBase36Code: normalizes ASCII 0-9/A-Z/a-z to uppercase base36 codes', () => {
    expect(normalizeAsciiBase36Code(0x30)).toBe(0x30);
    expect(normalizeAsciiBase36Code(0x39)).toBe(0x39);
    expect(normalizeAsciiBase36Code(0x41)).toBe(0x41);
    expect(normalizeAsciiBase36Code(0x5a)).toBe(0x5a);
    expect(normalizeAsciiBase36Code(0x61)).toBe(0x41);
    expect(normalizeAsciiBase36Code(0x7a)).toBe(0x5a);
    expect(normalizeAsciiBase36Code(0x2d)).toBe(-1);
  });

  test('normalizeAsciiBase62Code: preserves case for the beatoraja base-62 extension', () => {
    // 0-9 unchanged.
    expect(normalizeAsciiBase62Code(0x30)).toBe(0x30);
    expect(normalizeAsciiBase62Code(0x39)).toBe(0x39);
    // A-Z unchanged.
    expect(normalizeAsciiBase62Code(0x41)).toBe(0x41);
    expect(normalizeAsciiBase62Code(0x5a)).toBe(0x5a);
    // a-z preserved (NOT folded to uppercase, unlike base-36).
    expect(normalizeAsciiBase62Code(0x61)).toBe(0x61);
    expect(normalizeAsciiBase62Code(0x7a)).toBe(0x7a);
    // Out-of-range codes rejected the same way.
    expect(normalizeAsciiBase62Code(0x2d)).toBe(-1);
    expect(normalizeAsciiBase62Code(0x40)).toBe(-1);
    expect(normalizeAsciiBase62Code(0x60)).toBe(-1);
    expect(normalizeAsciiBase62Code(0x7b)).toBe(-1);
  });

  test('normalizePath/dirname/basename: normalizes browser and archive-style paths', () => {
    expect(normalizePath(String.raw`Songs\\set/../chart/./main.bms`)).toBe('Songs/chart/main.bms');
    expect(normalizePath('/root//song/../theme/')).toBe('root/theme');
    expect(dirname(String.raw`root\\song/main.bms`)).toBe('root/song');
    expect(dirname('main.bms')).toBe('');
    expect(basename(String.raw`root\\song/main.bms`)).toBe('main.bms');
  });

  test('extname: returns Node-style trailing extensions without depending on node:path', () => {
    expect(extname(String.raw`Songs\\chart/main.bms`)).toBe('.bms');
    expect(extname('archive.tar.gz')).toBe('.gz');
    expect(extname('README')).toBe('');
    expect(extname('.env')).toBe('');
    expect(extname('dir.with.dots/file')).toBe('');
  });

  test('isMaliciousAssetPath: rejects spec-named threat shapes', () => {
    // bmson 1.0.0 spec MUST entries.
    expect(isMaliciousAssetPath('/etc/passwd')).toBe(true);
    expect(isMaliciousAssetPath('\\etc\\passwd')).toBe(true);
    expect(isMaliciousAssetPath('C:\\password.txt')).toBe(true);
    expect(isMaliciousAssetPath('D:/secrets.bin')).toBe(true);
    expect(isMaliciousAssetPath('//server/share/file.wav')).toBe(true);
    expect(isMaliciousAssetPath('\\\\server\\share\\file.wav')).toBe(true);
    expect(isMaliciousAssetPath('../../../var/www/html/config.php')).toBe(true);
    expect(isMaliciousAssetPath('safe/../escape.wav')).toBe(true);
    expect(isMaliciousAssetPath('safe.wav\0/etc/passwd')).toBe(true);
  });

  test('isMaliciousAssetPath: accepts ordinary chart-relative paths', () => {
    expect(isMaliciousAssetPath('kick.wav')).toBe(false);
    expect(isMaliciousAssetPath('subdir/kick.wav')).toBe(false);
    expect(isMaliciousAssetPath('subdir\\kick.wav')).toBe(false);
    expect(isMaliciousAssetPath('Lab..rinth.wav')).toBe(false);
    expect(isMaliciousAssetPath('./local.wav')).toBe(false);
    expect(isMaliciousAssetPath('')).toBe(false);
  });

  test('isAudioAssetPath: recognizes deferred audio extensions', () => {
    expect(isAudioAssetPath('sound/KICK.WAV')).toBe(true);
    expect(isAudioAssetPath('sound/kick.ogg')).toBe(true);
    expect(isAudioAssetPath('sound/kick.wav/readme')).toBe(false);
    expect(isAudioAssetPath('image.png')).toBe(false);
  });
});
