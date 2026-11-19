import { describe, expect, test, vi } from 'vite-plus/test';
import {
  listFolder,
  listFolderInWorker,
  openFolderListing,
  sameFolderListing,
  serveFolderListing,
  type FolderDirectoryLike,
  type FolderFileLike,
  type FolderListing,
  type FolderListingWorkerMessage,
} from './folder-listing.ts';

type Tree = { [name: string]: Tree | string };

/** A directory handle over `tree` (a string is a file's text), counting the files opened through it. */
function fakeFolder(name: string, tree: Tree, opened: string[] = [], lastModified = 1000): FolderDirectoryLike {
  const fileOf = (fileName: string, text: string): FolderFileLike => ({
    kind: 'file',
    name: fileName,
    getFile: async () => {
      opened.push(fileName);
      return new File([text], fileName, { lastModified });
    },
  });
  const child = (childName: string): FolderFileLike | FolderDirectoryLike => {
    const value = tree[childName];
    if (value === undefined) throw new DOMException(`${childName} is gone`, 'NotFoundError');
    return typeof value === 'string' ? fileOf(childName, value) : fakeFolder(childName, value, opened, lastModified);
  };
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const childName of Object.keys(tree)) yield child(childName);
    },
    getDirectoryHandle: async (childName) => child(childName) as FolderDirectoryLike,
    getFileHandle: async (childName) => child(childName) as FolderFileLike,
  };
}

const PACK: Tree = {
  'readme.txt': 'hello',
  'Song B': { 'b.bms': '#TITLE b', 'kick.wav': 'audio' },
  'Song A': { 'a.bme': '#TITLE alpha', sub: { 'x.png': 'image' }, empty: {} },
};

describe('listFolder', () => {
  test('lists every file by directory in a fixed order, with the size and age of each chart file', async () => {
    const opened: string[] = [];
    const listing = await listFolder(fakeFolder('Pack', PACK, opened));
    expect(listing.text).toBe(
      [
        'Pack/',
        'readme.txt',
        'Pack/Song A/',
        'a.bme',
        'Pack/Song A/sub/',
        'x.png',
        'Pack/Song B/',
        'b.bms',
        'kick.wav',
      ].join('\n'),
    );
    expect(listing.fileCount).toBe(5);
    expect(listing.charts).toEqual([
      { path: 'Pack/Song A/a.bme', size: 12, lastModified: 1000 },
      { path: 'Pack/Song B/b.bms', size: 8, lastModified: 1000 },
    ]);
    // Only the chart files are opened, for their size and modification time.
    expect(opened.sort()).toEqual(['a.bme', 'b.bms']);
  });

  test('gives the same listing however the directories come back', async () => {
    const reversed: Tree = {
      'Song A': PACK['Song A']!,
      'Song B': { 'kick.wav': 'audio', 'b.bms': '#TITLE b' },
      'readme.txt': 'hello',
    };
    expect(
      sameFolderListing(await listFolder(fakeFolder('Pack', PACK)), await listFolder(fakeFolder('Pack', reversed))),
    ).toBe(true);
  });

  test('reports the files found so far, and lists an empty folder as nothing', async () => {
    const many: Tree = {};
    for (let index = 0; index < 600; index += 1) many[`f${index}.wav`] = '';
    const counts: number[] = [];
    await listFolder(fakeFolder('Pack', { a: many, b: many }), (count) => counts.push(count));
    expect(counts).toEqual([600, 1200]);
    expect(await listFolder(fakeFolder('Empty', {}))).toEqual({ text: '', fileCount: 0, charts: [] });
  });

  test('leaves out a name that holds a line break, and a chart file that cannot be opened has no entry', async () => {
    const folder = fakeFolder('Pack', { 'odd\nname.bms': 'x', 'a.bms': 'x' });
    const values = folder.values.bind(folder);
    const broken: FolderDirectoryLike = {
      ...folder,
      async *values() {
        for await (const handle of values()) {
          yield handle.kind === 'file' ? { ...handle, getFile: () => Promise.reject(new Error('locked')) } : handle;
        }
      },
    };
    expect(await listFolder(broken)).toEqual({ text: 'Pack/\na.bms', fileCount: 1, charts: [] });
  });

  test('rejects when a directory cannot be read', async () => {
    const folder = fakeFolder('Pack', { Song: { 'a.bms': 'x' } });
    const failing: FolderDirectoryLike = {
      ...folder,
      async *values() {
        yield {
          kind: 'directory',
          name: 'Song',
          // eslint-disable-next-line require-yield
          async *values() {
            throw new DOMException('gone', 'NotFoundError');
          },
        } as unknown as FolderDirectoryLike;
      },
    };
    await expect(listFolder(failing)).rejects.toThrow('gone');
  });
});

describe('sameFolderListing', () => {
  const listing: FolderListing = {
    text: 'Pack/\na.bms',
    fileCount: 1,
    charts: [{ path: 'Pack/a.bms', size: 10, lastModified: 5 }],
  };

  test('tells a file added, a chart edited and a chart touched', () => {
    expect(sameFolderListing(listing, { ...listing, charts: [{ ...listing.charts[0]! }] })).toBe(true);
    expect(sameFolderListing(listing, { ...listing, text: 'Pack/\na.bms\nb.wav' })).toBe(false);
    expect(sameFolderListing(listing, { ...listing, charts: [{ ...listing.charts[0]!, size: 11 }] })).toBe(false);
    expect(sameFolderListing(listing, { ...listing, charts: [{ ...listing.charts[0]!, lastModified: 6 }] })).toBe(
      false,
    );
    expect(sameFolderListing(listing, { ...listing, charts: [] })).toBe(false);
  });
});

describe('openFolderListing', () => {
  test('names each file by its path and opens it through the folder only when it is read', async () => {
    const opened: string[] = [];
    const folder = fakeFolder('Pack', PACK, opened);
    const lookups = vi.spyOn(folder, 'getDirectoryHandle');
    const files = openFolderListing(folder, (await listFolder(fakeFolder('Pack', PACK))).text);
    expect(files.map((file) => file.webkitRelativePath)).toEqual([
      'Pack/readme.txt',
      'Pack/Song A/a.bme',
      'Pack/Song A/sub/x.png',
      'Pack/Song B/b.bms',
      'Pack/Song B/kick.wav',
    ]);
    expect(files.map((file) => file.name)).toEqual(['readme.txt', 'a.bme', 'x.png', 'b.bms', 'kick.wav']);
    expect(opened).toEqual([]);
    await expect(files[4]!.text()).resolves.toBe('audio');
    await expect(files[3]!.text()).resolves.toBe('#TITLE b');
    await expect(files[0]!.text()).resolves.toBe('hello');
    expect(opened).toEqual(['kick.wav', 'b.bms', 'readme.txt']);
    // The two files of `Song B` share one lookup of their directory.
    expect(lookups).toHaveBeenCalledTimes(1);
  });

  test('lists nothing for an empty listing', () => {
    expect(openFolderListing(fakeFolder('Pack', {}), '')).toEqual([]);
  });

  test('fails the read of a file that is gone, and looks its directory up again the next time', async () => {
    const tree: Tree = {};
    const [file] = openFolderListing(fakeFolder('Pack', tree), 'Pack/Song/\na.bms');
    await expect(file!.text()).rejects.toThrow('Song is gone');
    tree.Song = { 'a.bms': 'back' };
    await expect(file!.text()).resolves.toBe('back');
  });
});

/** A worker that answers a posted folder with `messages`, or fails to start. */
function fakeWorker(
  messages: readonly FolderListingWorkerMessage[],
  options: { fails?: boolean; transferError?: 'send' | 'receive' } = {},
) {
  const worker = {
    onmessage: null as ((event: MessageEvent<FolderListingWorkerMessage>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as ((event: MessageEvent) => void) | null,
    terminate: vi.fn(),
    postMessage: vi.fn(() => {
      if (options.transferError === 'send') throw new DOMException('Cannot send a directory', 'DataCloneError');
      queueMicrotask(() => {
        if (options.transferError === 'receive') {
          worker.onmessageerror?.(new MessageEvent('messageerror'));
          return;
        }
        if (options.fails === true) {
          worker.onerror?.({ preventDefault: () => {} } as ErrorEvent);
          return;
        }
        for (const message of messages)
          worker.onmessage?.({ data: message } as MessageEvent<FolderListingWorkerMessage>);
      });
    }),
  };
  return worker;
}

describe('listFolderInWorker', () => {
  const listing: FolderListing = { text: 'Pack/\na.bms', fileCount: 1, charts: [] };
  const folder = fakeFolder('Pack', { 'a.wav': '' });

  test('posts the folder to a worker and resolves with its listing, passing its progress on', async () => {
    const worker = fakeWorker([{ fileCount: 256 }, { listing }]);
    const counts: number[] = [];
    await expect(
      listFolderInWorker(
        () => worker as unknown as Worker,
        folder,
        (count) => counts.push(count),
      ),
    ).resolves.toEqual(listing);
    expect(worker.postMessage).toHaveBeenCalledWith({ folder });
    expect(counts).toEqual([256]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  test("rejects with the walk's error under its name", async () => {
    const worker = fakeWorker([{ error: { name: 'NotFoundError', message: 'gone' } }]);
    await expect(listFolderInWorker(() => worker as unknown as Worker, folder)).rejects.toMatchObject({
      name: 'NotFoundError',
      message: 'gone',
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  test('walks the folder itself when the worker cannot be started or dies', async () => {
    const here = { text: 'Pack/\na.wav', fileCount: 1, charts: [] };
    await expect(
      listFolderInWorker(() => {
        throw new Error('no workers');
      }, folder),
    ).resolves.toEqual(here);
    const worker = fakeWorker([], { fails: true });
    await expect(listFolderInWorker(() => worker as unknown as Worker, folder)).resolves.toEqual(here);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  test('terminates the worker if playback interrupts the folder walk', async () => {
    const worker = fakeWorker([]);
    const controller = new AbortController();
    const walking = listFolderInWorker(() => worker as unknown as Worker, folder, undefined, controller.signal);
    controller.abort();
    await expect(walking).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  test.each(['send', 'receive'] as const)(
    'walks on the page when the worker cannot %s a message',
    async (transferError) => {
      const worker = fakeWorker([], { transferError });
      await expect(listFolderInWorker(() => worker as unknown as Worker, folder)).resolves.toEqual({
        text: 'Pack/\na.wav',
        fileCount: 1,
        charts: [],
      });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['DataCloneError', 'NotAllowedError', 'SecurityError'])(
    'walks on the page when the worker reports %s',
    async (name) => {
      const worker = fakeWorker([{ error: { name, message: 'worker cannot read the folder' } }]);
      await expect(listFolderInWorker(() => worker as unknown as Worker, folder)).resolves.toEqual({
        text: 'Pack/\na.wav',
        fileCount: 1,
        charts: [],
      });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );
});

describe('serveFolderListing', () => {
  test('walks the folder it is posted and posts back the listing, or the error that ended the walk', async () => {
    const posted: FolderListingWorkerMessage[] = [];
    const scope: Parameters<typeof serveFolderListing>[0] = {
      onmessage: null,
      onmessageerror: null,
      postMessage: (message) => posted.push(message),
    };
    serveFolderListing(scope);
    scope.onmessage!({ data: { folder: fakeFolder('Pack', { 'a.bms': 'x' }) } } as MessageEvent<{
      folder: FolderDirectoryLike;
    }>);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      listing: { text: 'Pack/\na.bms', fileCount: 1, charts: [{ path: 'Pack/a.bms', size: 1, lastModified: 1000 }] },
    });
    const unreadable = {
      kind: 'directory',
      name: 'Pack',
      // eslint-disable-next-line require-yield
      async *values() {
        throw new DOMException('gone', 'NotFoundError');
      },
    } as unknown as FolderDirectoryLike;
    scope.onmessage!({ data: { folder: unreadable } } as MessageEvent<{ folder: FolderDirectoryLike }>);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual({ error: { name: 'NotFoundError', message: 'gone' } });
    scope.onmessageerror!(new MessageEvent('messageerror'));
    expect(posted[2]).toMatchObject({ error: { name: 'DataCloneError' } });
  });
});
