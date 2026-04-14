import { zipSync, strToU8 } from 'fflate';
import { describe, expect, test } from 'vitest';
import { loadSongCollectionFromFiles } from './chart-library.ts';

function createUtf8File(name: string, contents: string, webkitRelativePath = ''): File {
  return new File([contents], name, {
    type: 'text/plain',
  }) as File & { webkitRelativePath?: string };
}

describe('player-web-core chart library', () => {
  test('loads chart metadata from dropped directory files', async () => {
    const directoryFile = createUtf8File(
      'sample.bms',
      ['#TITLE Browser Sample', '#ARTIST Codex', '#GENRE TEST', '#BPM 150', '#00111:01'].join('\n'),
      'browser-pack/sample.bms',
    );
    Object.defineProperty(directoryFile, 'webkitRelativePath', {
      configurable: true,
      value: 'browser-pack/sample.bms',
    });

    const collection = await loadSongCollectionFromFiles([directoryFile]);
    expect(collection.errors).toHaveLength(0);
    expect(collection.sources).toHaveLength(1);
    expect(collection.songs).toHaveLength(1);
    expect(collection.songs[0]?.title).toBe('Browser Sample');
    expect(collection.songs[0]?.artist).toBe('Codex');
    expect(collection.songs[0]?.sourceKind).toBe('directory');
  });

  test('loads chart metadata from dropped zip archives', async () => {
    const archiveBytes = zipSync({
      'sample-folder/test.bms': strToU8(['#TITLE Zipped Sample', '#ARTIST Archive', '#BPM 130', '#00111:01'].join('\n')),
    });
    const archiveFile = new File(
      [archiveBytes.buffer.slice(archiveBytes.byteOffset, archiveBytes.byteOffset + archiveBytes.byteLength) as ArrayBuffer],
      'sample.zip',
      {
        type: 'application/zip',
      },
    );

    const collection = await loadSongCollectionFromFiles([archiveFile]);
    expect(collection.errors).toHaveLength(0);
    expect(collection.sources).toHaveLength(1);
    expect(collection.songs).toHaveLength(1);
    expect(collection.songs[0]?.title).toBe('Zipped Sample');
    expect(collection.songs[0]?.sourceKind).toBe('zip');
  });
});
