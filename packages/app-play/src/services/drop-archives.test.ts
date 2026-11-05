import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vite-plus/test';
import {
  isChartArchive,
  isDroppedArchive,
  isZipArchiveName,
  locateZipCentralDirectory,
  readZipEntryNames,
  sortDroppedArchives,
} from './drop-archives.ts';

function zip(entries: Record<string, string>, comment?: string): Uint8Array {
  const files = Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)]));
  return comment === undefined ? zipSync(files) : zipSync(files, { comment });
}

function file(bytes: Uint8Array, name: string, relativePath?: string): File {
  const out = new File([new Uint8Array(bytes)], name);
  if (relativePath !== undefined) Object.defineProperty(out, 'webkitRelativePath', { value: relativePath });
  return out;
}

describe('dropped ZIP archives', () => {
  test('names a ZIP archive by its extension', () => {
    expect(isZipArchiveName('Pack.ZIP')).toBe(true);
    expect(isZipArchiveName('song.bms')).toBe(false);
  });

  test('opens only a ZIP dropped as itself, not one inside a dropped folder', () => {
    expect(isDroppedArchive({ name: 'pack.zip', webkitRelativePath: '' })).toBe(true);
    expect(isDroppedArchive({ name: 'pack.zip', webkitRelativePath: 'pack.zip' })).toBe(true);
    expect(isDroppedArchive({ name: 'pack.zip' })).toBe(true);
    expect(isDroppedArchive({ name: 'pack.zip', webkitRelativePath: 'songs/pack.zip' })).toBe(false);
    expect(isDroppedArchive({ name: 'song.bms', webkitRelativePath: '' })).toBe(false);
  });

  test('reads the entry paths from the central directory, past an archive comment', async () => {
    const bytes = zip({ 'song/a.bms': '#TITLE A', 'song/a.wav': 'RIFF', 'readme.txt': 'hi' }, 'x'.repeat(300));
    expect(locateZipCentralDirectory(bytes)?.entryCount).toBe(3);
    expect(await readZipEntryNames(new Blob([new Uint8Array(bytes)]))).toEqual([
      'song/a.bms',
      'song/a.wav',
      'readme.txt',
    ]);
  });

  test('reads a central directory that starts before the tail it searches', async () => {
    // A large stored entry pushes the directory more than 64 KiB away from the end record's search window start.
    const big = 'a'.repeat(200_000);
    const bytes = zipSync({ 'x.bmson': strToU8('{}'), 'big.txt': [strToU8(big), { level: 0 }] });
    expect(await readZipEntryNames(new Blob([new Uint8Array(bytes)]))).toEqual(['x.bmson', 'big.txt']);
  });

  test('gives up on bytes that are not a ZIP', async () => {
    expect(await readZipEntryNames(new Blob([strToU8('not a zip')]))).toBeUndefined();
    expect(locateZipCentralDirectory(strToU8('not a zip'))).toBeUndefined();
  });

  test('takes an archive holding a chart, or one it cannot read, as a chart archive', () => {
    expect(isChartArchive(['pack/song/a.bme', 'pack/song/a.ogg'])).toBe(true);
    expect(isChartArchive(['skin/LR2files/Theme/play.lr2skin'])).toBe(false);
    expect(isChartArchive(undefined)).toBe(true);
  });

  test('sends chart archives whole and expands the rest', async () => {
    const charts = file(zip({ 'a.bms': '#TITLE A' }), 'charts.zip', 'drop/charts.zip');
    const skin = file(zip({ 'Theme/skin.json': '{}' }), 'skin.zip');
    const expand = async (bytes: Uint8Array, label: string): Promise<File[]> => [
      new File([new Uint8Array(bytes.subarray(0, 1))], `${label}:expanded`),
    ];
    const sorted = await sortDroppedArchives([charts, skin], expand);
    // Node's `File` has no `webkitRelativePath`; a browser's reads ''.
    expect(sorted.chartArchives.map((archive) => [archive.name, archive.webkitRelativePath || ''])).toEqual([
      ['charts.zip', ''],
    ]);
    expect(sorted.chartArchives[0]).not.toBe(charts);
    expect(sorted.expandedFiles.map((entry) => entry.name)).toEqual(['skin.zip:expanded']);
  });
});
