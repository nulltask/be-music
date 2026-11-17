import { describe, expect, test } from 'vite-plus/test';
import {
  BEMUSE_SERVER_URLS_STORAGE_KEY,
  DEFAULT_BEMUSE_SERVER_URLS,
  BEMUSE_UNPACKED_FILE_PATTERN,
  bemuseReplayGainLinear,
  bemuseSoundFileCandidates,
  parseBemuseReplayGain,
  scanChartFileReferences,
  bemusePackPayload,
  bemuseServerIndexURL,
  bemuseServerLabel,
  extractBemuseAssetFile,
  parseBemuseAssetIndex,
  parseBemuseServerIndex,
  parseStoredBemuseServerURLs,
  readStoredBemuseServerURLs,
  storeBemuseServerURLs,
} from './bemuse-server.ts';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function chunk(payload: number[], metadata: number[] = []): Uint8Array {
  const header = new TextEncoder().encode('BEMUSEPACK');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, metadata.length, true);
  return new Uint8Array([...header, ...length, ...metadata, ...payload]);
}

describe('bemuseServerIndexURL', () => {
  test('reads a server folder as its index.json, as Bemuse does', () => {
    expect(bemuseServerIndexURL('https://music4.bemuse.ninja/server')).toBe(
      'https://music4.bemuse.ninja/server/index.json',
    );
    expect(bemuseServerIndexURL(' https://music4.bemuse.ninja/server/ ')).toBe(
      'https://music4.bemuse.ninja/server/index.json',
    );
    expect(bemuseServerIndexURL('https://music4.bemuse.ninja/server/index.json')).toBe(
      'https://music4.bemuse.ninja/server/index.json',
    );
    expect(bemuseServerIndexURL('https://example.com')).toBe('https://example.com/index.json');
  });

  test('keeps a single-song server as it is', () => {
    expect(bemuseServerIndexURL('https://example.com/song/bemuse-song.json')).toBe(
      'https://example.com/song/bemuse-song.json',
    );
  });

  test('rejects relative and non-http(s) URLs', () => {
    expect(bemuseServerIndexURL('')).toBeUndefined();
    expect(bemuseServerIndexURL('server')).toBeUndefined();
    expect(bemuseServerIndexURL('javascript:alert(1)')).toBeUndefined();
  });

  test('bemuseServerLabel names the host and folder', () => {
    expect(bemuseServerLabel('https://music4.bemuse.ninja/server/index.json')).toBe('music4.bemuse.ninja/server');
    expect(bemuseServerLabel('https://example.com/index.json')).toBe('example.com');
    expect(bemuseServerLabel('https://example.com/a/bemuse-song.json')).toBe('example.com/a');
  });
});

describe('parseBemuseServerIndex', () => {
  const indexURL = 'https://example.com/server/index.json';

  test('resolves song folders against the server folder and the asset index per bemusepack_url', () => {
    const index = parseBemuseServerIndex(
      {
        songs: [
          {
            id: 'a',
            title: 'A',
            artist: 'X',
            path: 'https://cdn.example.com/songs/[x]a',
            charts: [{ file: 'a_5.bms' }, { file: 'a_7.bms' }, { file: 'a_5.bms' }],
          },
          { id: 'b', title: 'B', path: '../songs/b/', bemusepack_url: 'pack/meta.json', charts: [{ file: 'b.bmson' }] },
          { id: 'c', path: 'c', bemusepack_url: null, charts: [{ file: 'c.bms' }] },
        ],
      },
      indexURL,
    );
    expect(index.tracks).toEqual([
      {
        id: 'a',
        title: 'A',
        artist: 'X',
        baseURL: 'https://cdn.example.com/songs/[x]a/',
        charts: [
          { file: 'a_5.bms', md5: undefined },
          { file: 'a_7.bms', md5: undefined },
        ],
        assetIndexURL: 'https://cdn.example.com/songs/[x]a/assets/metadata.json',
        preview: { url: 'https://cdn.example.com/songs/[x]a/_bemuse_preview.mp3', isDefault: true },
        video: undefined,
        eyecatchImageURL: undefined,
        backImageURL: undefined,
        replayGainDb: undefined,
      },
      {
        id: 'b',
        title: 'B',
        artist: '',
        baseURL: 'https://example.com/songs/b/',
        charts: [{ file: 'b.bmson', md5: undefined }],
        assetIndexURL: 'https://example.com/songs/b/pack/meta.json',
        preview: { url: 'https://example.com/songs/b/_bemuse_preview.mp3', isDefault: true },
        video: undefined,
        eyecatchImageURL: undefined,
        backImageURL: undefined,
        replayGainDb: undefined,
      },
      {
        id: 'c',
        title: '',
        artist: '',
        baseURL: 'https://example.com/server/c/',
        charts: [{ file: 'c.bms', md5: undefined }],
        assetIndexURL: undefined,
        preview: { url: 'https://example.com/server/c/_bemuse_preview.mp3', isDefault: true },
        video: undefined,
        eyecatchImageURL: undefined,
        backImageURL: undefined,
        replayGainDb: undefined,
      },
    ]);
  });

  test('skips songs without a path or a chart file', () => {
    const index = parseBemuseServerIndex(
      { songs: [{ id: 'a', charts: [{ file: 'a.bms' }] }, { id: 'b', path: 'b', charts: [] }, null] },
      indexURL,
    );
    expect(index.tracks).toEqual([]);
  });

  test('reads a single-song bemuse-song.json from its own folder', () => {
    const index = parseBemuseServerIndex(
      { title: 'S', charts: [{ file: 's.bms' }] },
      'https://example.com/s/bemuse-song.json',
    );
    expect(index.tracks).toHaveLength(1);
    expect(index.tracks[0]).toMatchObject({
      id: 'song',
      baseURL: 'https://example.com/s/',
      charts: [{ file: 's.bms', md5: undefined }],
    });
  });

  test('throws on a file that is not a server index', () => {
    expect(() => parseBemuseServerIndex({ foo: 1 }, indexURL)).toThrow(/no "songs" array/);
    expect(() => parseBemuseServerIndex([], indexURL)).toThrow(/no "songs" array/);
  });
});

describe('parseBemuseAssetIndex', () => {
  const url = 'https://example.com/songs/a/assets/metadata.json';

  test('reads files and resolves chunk paths against the asset folder', () => {
    const index = parseBemuseAssetIndex(
      {
        files: [
          { name: 'kick.ogg', ref: [0, 0, 10] },
          { name: 'snare.ogg', ref: [1, 4, 8] },
        ],
        refs: [
          { path: 'ogg.1.aaaa.bemuse', hash: 'aaaa', size: 24 },
          { path: 'ogg.2.bbbb.bemuse', hash: 'bbbb' },
        ],
      },
      url,
    );
    expect(index).toEqual({
      files: [
        { name: 'kick.ogg', chunk: 0, start: 0, end: 10 },
        { name: 'snare.ogg', chunk: 1, start: 4, end: 8 },
      ],
      chunkURLs: [
        'https://example.com/songs/a/assets/ogg.1.aaaa.bemuse',
        'https://example.com/songs/a/assets/ogg.2.bbbb.bemuse',
      ],
    });
  });

  test('rejects a missing chunk, a reversed range and a malformed ref', () => {
    const refs = [{ path: 'x.bemuse' }];
    expect(() => parseBemuseAssetIndex({ files: [{ name: 'a', ref: [1, 0, 1] }], refs }, url)).toThrow(/invalid ref/);
    expect(() => parseBemuseAssetIndex({ files: [{ name: 'a', ref: [0, 5, 1] }], refs }, url)).toThrow(/invalid ref/);
    expect(() => parseBemuseAssetIndex({ files: [{ name: 'a', ref: [0, -1, 1] }], refs }, url)).toThrow(/invalid ref/);
    expect(() => parseBemuseAssetIndex({ files: [{ name: 'a', ref: [0, 1] }], refs }, url)).toThrow(/ref/);
    expect(() => parseBemuseAssetIndex({ files: [], refs: [{}] }, url)).toThrow(/no path/);
    expect(() => parseBemuseAssetIndex({ files: [] }, url)).toThrow(/asset index/);
  });
});

describe('bemusePackPayload', () => {
  test('skips the header and the metadata block', () => {
    expect([...bemusePackPayload(chunk([1, 2, 3]))]).toEqual([1, 2, 3]);
    expect([...bemusePackPayload(chunk([7, 8], [9, 9, 9]))]).toEqual([7, 8]);
  });

  test('rejects a chunk without the magic or with a truncated header', () => {
    expect(() => bemusePackPayload(new Uint8Array(5))).toThrow(/too short/);
    expect(() => bemusePackPayload(new Uint8Array(20))).toThrow(/BEMUSEPACK/);
    const truncated = chunk([], [1, 2, 3]).subarray(0, 15);
    expect(() => bemusePackPayload(truncated)).toThrow(/runs past/);
  });

  test('extractBemuseAssetFile slices the payload by the ref range', () => {
    const payload = bemusePackPayload(chunk([0, 1, 2, 3, 4, 5]));
    expect([...extractBemuseAssetFile(payload, { name: 'a', chunk: 0, start: 2, end: 5 })]).toEqual([2, 3, 4]);
    expect(() => extractBemuseAssetFile(payload, { name: 'a', chunk: 0, start: 2, end: 9 })).toThrow(/runs past/);
  });
});

describe('stored Bemuse servers', () => {
  test('parseStoredBemuseServerURLs keeps valid, distinct index URLs', () => {
    expect(parseStoredBemuseServerURLs(null)).toEqual([]);
    expect(parseStoredBemuseServerURLs('{')).toEqual([]);
    expect(
      parseStoredBemuseServerURLs(
        JSON.stringify(['https://a.example/server', 'https://a.example/server/index.json', 'nope', 3]),
      ),
    ).toEqual(['https://a.example/server/index.json']);
  });

  test('readStoredBemuseServerURLs starts with the default servers until the list is changed', () => {
    const storage = memoryStorage();
    expect(readStoredBemuseServerURLs(storage)).toEqual(DEFAULT_BEMUSE_SERVER_URLS);
    expect(parseStoredBemuseServerURLs(JSON.stringify(DEFAULT_BEMUSE_SERVER_URLS))).toEqual(DEFAULT_BEMUSE_SERVER_URLS);
    // Removing every server is the player's choice too: an empty list stays empty.
    storeBemuseServerURLs([], storage);
    expect(readStoredBemuseServerURLs(storage)).toEqual([]);
    expect(
      readStoredBemuseServerURLs({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_BEMUSE_SERVER_URLS);
  });

  test('storeBemuseServerURLs round-trips through storage', () => {
    const storage = memoryStorage();
    expect(storeBemuseServerURLs(['https://a.example/s', 'https://b.example/'], storage)).toEqual([
      'https://a.example/s/index.json',
      'https://b.example/index.json',
    ]);
    expect(storage.getItem(BEMUSE_SERVER_URLS_STORAGE_KEY)).toBe(
      JSON.stringify(['https://a.example/s/index.json', 'https://b.example/index.json']),
    );
    expect(readStoredBemuseServerURLs(storage)).toEqual([
      'https://a.example/s/index.json',
      'https://b.example/index.json',
    ]);
  });
});

describe('song fields', () => {
  const indexURL = 'https://example.com/server/index.json';
  const track = (song: Record<string, unknown>) =>
    parseBemuseServerIndex(
      { songs: [{ path: 's', charts: [{ file: 'a.bms', md5: 'ABCDEF0123456789ABCDEF0123456789' }], ...song }] },
      indexURL,
    ).tracks[0]!;

  test('keeps a well-formed chart MD5, lower-cased', () => {
    expect(track({}).charts).toEqual([{ file: 'a.bms', md5: 'abcdef0123456789abcdef0123456789' }]);
    expect(
      parseBemuseServerIndex({ songs: [{ path: 's', charts: [{ file: 'a.bms', md5: 'nope' }] }] }, indexURL).tracks[0]!
        .charts[0]!.md5,
    ).toBeUndefined();
  });

  test('reads the preview: preview_url, the default file, and none for a tutorial', () => {
    expect(track({ preview_url: 'data/p.mp3' }).preview).toEqual({
      url: 'https://example.com/server/s/data/p.mp3',
      isDefault: false,
    });
    expect(track({}).preview?.isDefault).toBe(true);
    expect(track({ tutorial: 1 }).preview).toBeUndefined();
  });

  test('reads the video as Bemuse finds it', () => {
    expect(track({ video_url: 'https://v.example/a.webm', video_offset: '1.25', video_file: 'x.mp4' }).video).toEqual({
      urls: ['https://v.example/a.webm'],
      offsetSeconds: 1.25,
    });
    expect(track({ video_file: 'bga.webm' }).video).toEqual({
      urls: ['https://example.com/server/s/bga.webm', 'https://example.com/server/s/bga.mp4'],
      offsetSeconds: 0,
    });
    expect(track({ video_file: 'bga.avi', video_offset: 2 }).video).toEqual({
      urls: ['https://example.com/server/s/bga.mp4', 'https://example.com/server/s/bga.webm'],
      offsetSeconds: 2,
    });
    expect(track({ video_file: 'bga' }).video).toBeUndefined();
  });

  test('reads the images and the ReplayGain', () => {
    const song = track({ eyecatch_image_url: 'eye.png', back_image_url: '/back.jpg', replaygain: '-6.41 dB' });
    expect(song.eyecatchImageURL).toBe('https://example.com/server/s/eye.png');
    expect(song.backImageURL).toBe('https://example.com/back.jpg');
    expect(song.replayGainDb).toBe(-6.41);
  });
});

describe('Bemuse playback rules', () => {
  test('parseBemuseReplayGain reads only "<number> dB"', () => {
    expect(parseBemuseReplayGain('-6.41 dB')).toBe(-6.41);
    expect(parseBemuseReplayGain('+0.01 dB')).toBe(0.01);
    expect(parseBemuseReplayGain('-6.41')).toBeUndefined();
    expect(parseBemuseReplayGain('loud dB')).toBeUndefined();
    expect(parseBemuseReplayGain(-6)).toBeUndefined();
  });

  test('bemuseReplayGainLinear follows Bemuse: (gain + 4) dB, -12.2 dB without one', () => {
    expect(bemuseReplayGainLinear(-4)).toBe(1);
    expect(bemuseReplayGainLinear(2)).toBeCloseTo(10 ** (6 / 20));
    expect(bemuseReplayGainLinear(undefined)).toBeCloseTo(10 ** (-8.2 / 20));
  });

  test('bemuseSoundFileCandidates tries .ogg, .m4a, .flac, .mp3, then the name', () => {
    expect(bemuseSoundFileCandidates('sub\\kick.wav')).toEqual([
      'sub/kick.ogg',
      'sub/kick.m4a',
      'sub/kick.flac',
      'sub/kick.mp3',
      'sub/kick.wav',
    ]);
    expect(bemuseSoundFileCandidates('kick.ogg')).toEqual(['kick.ogg', 'kick.m4a', 'kick.flac', 'kick.mp3']);
  });

  test('BEMUSE_UNPACKED_FILE_PATTERN matches what Bemuse reads beside a package', () => {
    expect(BEMUSE_UNPACKED_FILE_PATTERN.test('bga.mp4')).toBe(true);
    expect(BEMUSE_UNPACKED_FILE_PATTERN.test('eye.png')).toBe(true);
    expect(BEMUSE_UNPACKED_FILE_PATTERN.test('bg.bmp')).toBe(false);
    expect(BEMUSE_UNPACKED_FILE_PATTERN.test('kick.ogg')).toBe(false);
  });
});

describe('scanChartFileReferences', () => {
  test('lists the files a BMS chart names, in every branch', () => {
    const bms = new TextEncoder().encode(
      '#WAV01 kick.wav\r\n#wav0a sub/hat.ogg  \n#PREVIEW pre.ogg\n#RANDOM 2\n#IF 1\n#BMP01 a.bmp\n#ENDIF\n' +
        '#STAGEFILE title.png\n#BANNER banner.jpg\n#BACKBMP back.png\n#00111:01\n',
    );
    expect(scanChartFileReferences('x.bms', bms)).toEqual({
      sounds: ['kick.wav', 'sub/hat.ogg', 'pre.ogg'],
      images: ['a.bmp', 'title.png', 'banner.jpg', 'back.png'],
    });
  });

  test('lists the files a bmson chart names', () => {
    const bmson = new TextEncoder().encode(
      JSON.stringify({
        info: { preview_music: 'p.ogg', eyecatch_image: 'eye.png', back_image: 'back.png' },
        sound_channels: [{ name: 'a.wav' }, { name: 'b.wav' }],
        bga: { bga_header: [{ id: 1, name: 'movie.mp4' }] },
      }),
    );
    expect(scanChartFileReferences('x.bmson', bmson)).toEqual({
      sounds: ['a.wav', 'b.wav', 'p.ogg'],
      images: ['eye.png', 'back.png', 'movie.mp4'],
    });
    expect(scanChartFileReferences('x.bmson', new TextEncoder().encode('{'))).toEqual({ sounds: [], images: [] });
  });
});
