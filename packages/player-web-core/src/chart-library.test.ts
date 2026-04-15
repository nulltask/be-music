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

  test('derives richer song summary fields from chart metadata and resolved control flow', async () => {
    const directoryFile = createUtf8File(
      'summary.bms',
      [
        '#TITLE Summary Sample',
        '#ARTIST Codex',
        '#SUBARTIST Guest',
        '#GENRE TEST',
        '#PLAYER 1',
        '#PLAYLEVEL 7',
        '#DIFFICULTY 3',
        '#RANK 4',
        '#BANNER banner.png',
        '#BPM 150',
        '#BPM01 200',
        '#RANDOM 2',
        '#IF 1',
        '#00111:01',
        '#ENDIF',
        '#ENDRANDOM',
        '#00208:01',
        '#00311:02',
      ].join('\n'),
      'summary-pack/summary.bms',
    );
    Object.defineProperty(directoryFile, 'webkitRelativePath', {
      configurable: true,
      value: 'summary-pack/summary.bms',
    });

    const collection = await loadSongCollectionFromFiles([directoryFile]);
    const song = collection.songs[0];

    expect(song?.subartist).toBe('Guest');
    expect(song?.bannerPath).toBe('banner.png');
    expect(song?.player).toBe(1);
    expect(song?.difficulty).toBe(3);
    expect(song?.playLevel).toBe(7);
    expect(song?.rank).toBe(4);
    expect(song?.rankLabel).toBe('VERY EASY');
    expect(song?.totalNotes).toBe(2);
    expect(song?.bpmInitial).toBe(150);
    expect(song?.bpmMin).toBe(150);
    expect(song?.bpmMax).toBe(200);
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
