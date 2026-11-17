import { md5HexOfBytes } from '@be-music/player-browser/collection';
import { describe, expect, test } from 'vite-plus/test';
import type { BemuseChunkStore } from './bemuse-chunk-store.ts';
import { readBemuseServerFiles } from './bemuse-servers.ts';
import { createMemoryRemoteStore } from './remote-cache.ts';

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
  /** The requests sent as revalidations (`cache: 'no-cache'`). */
  const revalidated: string[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    requested.push(init?.method === 'HEAD' ? `HEAD ${url}` : url);
    if (init?.cache === 'no-cache') revalidated.push(url);
    const body = routes[url];
    if (body === undefined) return new Response('missing', { status: 404 });
    if (init?.method === 'HEAD') return new Response(null);
    if (body instanceof Uint8Array) return new Response(new Uint8Array(body));
    if (typeof body === 'string') return new Response(body);
    return new Response(JSON.stringify(body));
  };
  return { fetch, requested, revalidated };
}

async function text(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  return new TextDecoder().decode(await file.arrayBuffer());
}

const read = (indexURL: string, fetch: ReturnType<typeof fakeServer>['fetch']) =>
  readBemuseServerFiles(indexURL, { fetch, useCaches: false });

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

describe('readBemuseServerFiles with kept copies', () => {
  const INDEX = 'https://ex.com/index.json';
  const HOUR = 60 * 60 * 1000;
  const payload = 'KICKSNARE';
  const hash = md5HexOfBytes(new TextEncoder().encode(payload));
  const song = { id: 'a', path: 'a/', charts: [{ file: 'a.bms' }] };
  const routes = (): Record<string, unknown> => ({
    [INDEX]: { songs: [song] },
    'https://ex.com/a/assets/metadata.json': {
      files: [
        { name: 'kick.m4a', ref: [0, 0, 4] },
        { name: 'snare.m4a', ref: [0, 4, 9] },
      ],
      refs: [{ path: `m4a.1.${hash.slice(0, 8)}.bemuse`, hash }],
    },
    [`https://ex.com/a/assets/m4a.1.${hash.slice(0, 8)}.bemuse`]: chunk(payload),
    'https://ex.com/a/a.bms': '#TITLE A\n',
  });

  function memoryChunkStore(): BemuseChunkStore & { chunks: Map<string, Uint8Array> } {
    const chunks = new Map<string, Uint8Array>();
    return { chunks, get: async (url) => chunks.get(url), put: async (url, bytes) => void chunks.set(url, bytes) };
  }

  function setup(routeTable = routes()) {
    const server = fakeServer(routeTable);
    const remoteStore = createMemoryRemoteStore();
    const chunkStore = memoryChunkStore();
    let nowMs = 1_000_000;
    const readAt = (at: number, options: { refreshedSince?: number } = {}) => {
      nowMs = at;
      return readBemuseServerFiles(INDEX, {
        fetch: server.fetch,
        useCaches: false,
        remoteStore,
        chunkStore,
        now: () => nowMs,
        ...options,
      });
    };
    return { server, routeTable, remoteStore, chunkStore, readAt };
  }

  const fileText = async (result: Awaited<ReturnType<typeof readBemuseServerFiles>>, name: string) =>
    text(result.files.find((file) => file.webkitRelativePath.endsWith(`/${name}`))!);

  test('asks the server for nothing on a second visit within a day, chunks included', async () => {
    const { server, chunkStore, readAt } = setup();
    const first = await readAt(1_000_000);
    expect(first.indexSource).toBe('network');
    // Revalidations, so a server with validators answers an unchanged file with a 304.
    expect(server.revalidated).toEqual([INDEX, 'https://ex.com/a/assets/metadata.json', 'https://ex.com/a/a.bms']);
    expect(await fileText(first, 'snare.m4a')).toBe('SNARE');
    expect(chunkStore.chunks.size).toBe(1);
    server.requested.length = 0;

    const second = await readAt(1_000_000 + 23 * HOUR);
    expect(second.indexSource).toBe('cache');
    expect(await fileText(second, 'kick.m4a')).toBe('KICK');
    expect(await fileText(second, 'a.bms')).toBe('#TITLE A\n');
    expect(server.requested).toEqual([]);
  });

  test('asks for the index again after a day or a reload, and for a song only when the index lists it anew', async () => {
    const { server, routeTable, readAt } = setup();
    await readAt(1_000_000);
    server.requested.length = 0;
    await readAt(1_000_000 + 25 * HOUR);
    expect(server.requested).toEqual([INDEX]);

    server.requested.length = 0;
    await readAt(1_000_000 + 26 * HOUR, { refreshedSince: 1_000_000 + 26 * HOUR });
    expect(server.requested).toEqual([INDEX]);

    routeTable[INDEX] = { songs: [{ ...song, title: 'A (renamed)' }] };
    server.requested.length = 0;
    await readAt(1_000_000 + 27 * HOUR, { refreshedSince: 1_000_000 + 27 * HOUR });
    expect(server.requested).toEqual([
      INDEX,
      'https://ex.com/a/assets/metadata.json',
      'https://ex.com/a/a.bms',
      // The default preview's check goes with the song too.
      'HEAD https://ex.com/a/_bemuse_preview.mp3',
    ]);
  });

  test('keeps listing a server from its kept index while the server cannot be reached', async () => {
    const { server, routeTable, readAt } = setup();
    await readAt(1_000_000);
    delete routeTable[INDEX];
    const result = await readAt(1_000_000 + 30 * HOUR);
    expect(result.indexSource).toBe('stale');
    expect(result.songs).toHaveLength(1);
    expect(server.requested.at(-1)).toBe(INDEX);
  });

  test('reads a repacked song’s asset index again when a kept one names a chunk the server no longer has', async () => {
    const { server, routeTable, readAt } = setup();
    await readAt(1_000_000);
    const repacked = 'KICKSNARE';
    const newHash = md5HexOfBytes(new TextEncoder().encode(`${repacked}!`));
    for (const key of Object.keys(routeTable)) if (key.endsWith('.bemuse')) delete routeTable[key];
    routeTable['https://ex.com/a/assets/metadata.json'] = {
      files: [
        { name: 'kick.m4a', ref: [0, 0, 4] },
        { name: 'snare.m4a', ref: [0, 4, 9] },
      ],
      refs: [{ path: 'm4a.1.new.bemuse', hash: newHash }],
    };
    routeTable['https://ex.com/a/assets/m4a.1.new.bemuse'] = chunk(`${repacked}!`);
    const result = await readAt(1_000_000 + HOUR);
    server.requested.length = 0;
    expect(await fileText(result, 'snare.m4a')).toBe('SNARE');
    expect(await fileText(result, 'kick.m4a')).toBe('KICK');
    expect(server.requested.filter((url) => url.endsWith('metadata.json'))).toHaveLength(1);
  });

  test('keeps a chart whose bytes are not the MD5 the index lists, since the index lists the song the same way', async () => {
    const table = routes();
    table[INDEX] = { songs: [{ ...song, charts: [{ file: 'a.bms', md5: '0'.repeat(32) }] }] };
    const { server, readAt } = setup(table);
    await readAt(1_000_000);
    server.requested.length = 0;
    await readAt(1_000_000 + HOUR);
    expect(server.requested).toEqual([]);
  });

  test('keeps only chunks whose payload has the hash the asset index gives', async () => {
    const table = routes();
    (table['https://ex.com/a/assets/metadata.json'] as { refs: { hash: string }[] }).refs[0]!.hash = '0'.repeat(32);
    const { chunkStore, readAt } = setup(table);
    const result = await readAt(1_000_000);
    expect(await fileText(result, 'kick.m4a')).toBe('KICK');
    expect(chunkStore.chunks.size).toBe(0);
  });
});
