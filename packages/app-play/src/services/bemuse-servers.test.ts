import { describe, expect, test } from 'vite-plus/test';
import { readBemuseServerFiles } from './bemuse-servers.ts';

function chunk(payload: string): Uint8Array {
  const header = new TextEncoder().encode('BEMUSEPACK');
  const body = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(14 + body.length);
  bytes.set(header, 0);
  bytes.set(body, 14);
  return bytes;
}

function fakeServer(routes: Record<string, unknown>) {
  const requested: string[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    requested.push(init?.method === 'HEAD' ? `HEAD ${url}` : url);
    const body = routes[url];
    if (body === undefined) return new Response('missing', { status: 404 });
    if (init?.method === 'HEAD') return new Response(null);
    if (body instanceof Uint8Array) return new Response(new Uint8Array(body));
    if (typeof body === 'string') return new Response(body);
    return new Response(JSON.stringify(body));
  };
  return { fetch, requested };
}

async function text(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  return new TextDecoder().decode(await file.arrayBuffer());
}

const read = (indexURL: string, fetch: ReturnType<typeof fakeServer>['fetch']) =>
  readBemuseServerFiles(indexURL, { fetch, useChartCache: false });

describe('readBemuseServerFiles', () => {
  test('lays a packaged song out as a folder tree and cuts its sound files out of their chunks on demand', async () => {
    const server = fakeServer({
      'https://ex.com/server/index.json': {
        songs: [
          {
            id: 'a',
            title: 'A',
            path: '../songs/[x]a/',
            replaygain: '-8.00 dB',
            charts: [{ file: 'a.bms' }, { file: 'sub/a2.bms' }],
          },
          { id: 'b', title: 'B', path: '../songs/b/', charts: [{ file: 'b.bms' }] },
        ],
      },
      'https://ex.com/songs/[x]a/assets/metadata.json': {
        files: [
          { name: 'kick.m4a', ref: [0, 0, 4] },
          { name: 'snare.m4a', ref: [0, 4, 9] },
        ],
        refs: [{ path: 'm4a.1.abcd.bemuse', hash: 'abcd' }],
      },
      'https://ex.com/songs/[x]a/assets/m4a.1.abcd.bemuse': chunk('KICKSNARE'),
      'https://ex.com/songs/[x]a/a.bms': '#TITLE A\n#WAV01 kick.wav\n#BMP01 bg.bmp\n#STAGEFILE title.png\n',
      'https://ex.com/songs/[x]a/sub/a2.bms': '#TITLE A2\n',
      'https://ex.com/songs/[x]a/title.png': 'PNG',
    });
    const result = await read('https://ex.com/server/index.json', server.fetch);
    expect(result.folder).toBe('Bemuse ex.com server');
    expect(result.skipped.map((entry) => entry.track)).toEqual(['B']);
    const root = 'Bemuse ex.com server/[x]a';
    expect(result.files.map((file) => file.webkitRelativePath)).toEqual([
      `${root}/a.bms`,
      `${root}/sub/a2.bms`,
      `${root}/kick.m4a`,
      `${root}/snare.m4a`,
      // A packaged song serves only images and videos beside its package (Bemuse's fallbackPattern): not `bg.bmp`.
      `${root}/title.png`,
    ]);
    expect(result.songs).toHaveLength(1);
    expect(result.songs[0]!.folder).toBe(root);
    expect(result.songs[0]!.extras.gain).toBeCloseTo(10 ** (-4 / 20));
    // The default preview is only listed when the song serves it.
    expect(result.songs[0]!.extras.previewPath).toBeUndefined();
    expect(server.requested).toContain('HEAD https://ex.com/songs/[x]a/_bemuse_preview.mp3');
    // No sound chunk is fetched while listing.
    expect(server.requested.some((url) => url.endsWith('.bemuse'))).toBe(false);
    const byPath = new Map(result.files.map((file) => [file.webkitRelativePath, file]));
    expect(await text(byPath.get(`${root}/snare.m4a`)!)).toBe('SNARE');
    expect(await text(byPath.get(`${root}/kick.m4a`)!)).toBe('KICK');
    expect(await text(byPath.get(`${root}/title.png`)!)).toBe('PNG');
    expect(server.requested.filter((url) => url.endsWith('.bemuse'))).toHaveLength(1);
  });

  test('reads a song without a package from its folder, sounds under the names Bemuse tries', async () => {
    const server = fakeServer({
      'https://ex.com/index.json': {
        songs: [{ id: 'c', path: 'c', bemusepack_url: null, charts: [{ file: 'c.bms' }] }],
      },
      'https://ex.com/c/c.bms': '#WAV01 kick.wav\n#WAV02 hat.wav\n#BMP01 bg.bmp\n',
      'https://ex.com/c/kick.m4a': 'M4A',
      'https://ex.com/c/hat.wav': 'WAV',
      'https://ex.com/c/bg.bmp': 'BMP',
    });
    const result = await read('https://ex.com/index.json', server.fetch);
    const byPath = new Map(result.files.map((file) => [file.webkitRelativePath, file]));
    expect([...byPath.keys()]).toEqual([
      'Bemuse ex.com/c/c.bms',
      'Bemuse ex.com/c/bg.bmp',
      'Bemuse ex.com/c/kick.wav',
      'Bemuse ex.com/c/hat.wav',
    ]);
    expect(await text(byPath.get('Bemuse ex.com/c/kick.wav')!)).toBe('M4A');
    expect(await text(byPath.get('Bemuse ex.com/c/hat.wav')!)).toBe('WAV');
    expect(await text(byPath.get('Bemuse ex.com/c/bg.bmp')!)).toBe('BMP');
  });

  test('lists the preview, video and images a song names as extras', async () => {
    const server = fakeServer({
      'https://ex.com/index.json': {
        songs: [
          {
            path: 's',
            preview_url: 'data/preview.ogg',
            video_url: 'https://cdn.ex.com/v.webm',
            video_offset: '1.5',
            eyecatch_image_url: 'eye.jpg',
            charts: [{ file: 's.bms' }],
          },
        ],
      },
      'https://ex.com/s/assets/metadata.json': { files: [], refs: [] },
      'https://ex.com/s/s.bms': '#TITLE S\n',
      'https://cdn.ex.com/v.webm': 'VIDEO',
    });
    const result = await read('https://ex.com/index.json', server.fetch);
    expect(result.songs[0]!.extras).toEqual({
      gain: 10 ** ((-12.2 + 4) / 20),
      previewPath: '__bemuse__/preview.ogg',
      video: { path: '__bemuse__/video.webm', offsetSeconds: 1.5 },
      stageFilePath: '__bemuse__/eyecatch.jpg',
    });
    const video = result.files.find((file) => file.webkitRelativePath.endsWith('__bemuse__/video.webm'))!;
    expect(await text(video)).toBe('VIDEO');
    expect(result.songs[0]!.files.has('__bemuse__/video.webm')).toBe(true);
  });

  test('gives songs that share a folder name distinct folders', async () => {
    const song = (path: string) => ({ path, charts: [{ file: 'x.bms' }] });
    const metadata = { files: [], refs: [] };
    const server = fakeServer({
      'https://ex.com/index.json': { songs: [song('a/song/'), song('b/song/')] },
      'https://ex.com/a/song/assets/metadata.json': metadata,
      'https://ex.com/b/song/assets/metadata.json': metadata,
      'https://ex.com/a/song/x.bms': '',
      'https://ex.com/b/song/x.bms': '',
    });
    const result = await read('https://ex.com/index.json', server.fetch);
    expect(result.files.map((file) => file.webkitRelativePath)).toEqual([
      'Bemuse ex.com/song/x.bms',
      'Bemuse ex.com/song (2)/x.bms',
    ]);
  });

  test('fails when the index cannot be read', async () => {
    const server = fakeServer({});
    await expect(read('https://ex.com/index.json', server.fetch)).rejects.toThrow(/HTTP 404/);
  });
});
