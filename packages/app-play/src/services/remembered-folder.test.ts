import { expect, test, vi } from 'vite-plus/test';
import type { LoadProgress } from '@be-music/player-browser/collection';
import {
  captureDroppedFolders,
  readRememberedFolders,
  rememberedFolderPrefixes,
  type RememberedFolder,
} from './remembered-folder.ts';

function folderOf(name: string, fileNames: readonly string[], failAfter?: number): RememberedFolder {
  return {
    name,
    async *values() {
      for (const [index, fileName] of fileNames.entries()) {
        if (index === failAfter) throw new DOMException('Folder is gone', 'NotFoundError');
        yield { kind: 'file', name: fileName, getFile: async () => new File([''], fileName) };
      }
    },
  } as unknown as RememberedFolder;
}

test('keeps the folder path and opens assets only on demand', async () => {
  const getFile = vi.fn(async () => new File(['audio'], 'kick.wav'));
  const folder = {
    name: 'Pack',
    async *values() {
      yield {
        kind: 'directory',
        name: 'Track',
        async *values() {
          yield { kind: 'file', name: 'kick.wav', getFile };
        },
      };
    },
  } as unknown as RememberedFolder;

  const {
    files: [file],
  } = await readRememberedFolders([folder]);
  expect(file?.webkitRelativePath).toBe('Pack/Track/kick.wav');
  expect(getFile).not.toHaveBeenCalled();
  await expect(file?.text()).resolves.toBe('audio');
  expect(getFile).toHaveBeenCalledOnce();
});

test('captures directory handles before the drop expires and skips unsupported or failed items', async () => {
  const folder = { kind: 'directory', name: 'Pack' };
  let dropActive = true;
  const capture = vi.fn(async () => {
    if (!dropActive) throw new Error('Drop expired');
    return folder;
  });
  const transfer = {
    items: [
      { kind: 'file', getAsFileSystemHandle: capture },
      { kind: 'file', getAsFileSystemHandle: async () => ({ kind: 'file', name: 'pack.zip' }) },
      {
        kind: 'file',
        getAsFileSystemHandle: async () => {
          throw new Error('Unavailable');
        },
      },
      { kind: 'file' },
    ],
  } as unknown as DataTransfer;
  const pending = captureDroppedFolders(transfer);
  dropActive = false;

  await expect(pending).resolves.toEqual([folder]);
  expect(capture).toHaveBeenCalledOnce();
});

test('lists every folder before reporting the total, counting on across the folders', async () => {
  const events: LoadProgress[] = [];
  const a = folderOf('A', ['a.bms', 'a.wav']);
  const b = folderOf('B', ['b.bms']);
  const { files, read } = await readRememberedFolders([a, b], { onProgress: (event) => events.push(event) });

  expect(files.map((file) => file.webkitRelativePath)).toEqual(['A/a.bms', 'A/a.wav', 'B/b.bms']);
  expect(read).toEqual([a, b]);
  expect(events[0]).toEqual({ phase: 'enumerating', current: 0, total: -1 });
  expect(events.at(-1)).toEqual({ phase: 'enumerating', current: 3, total: 3 });
  expect(events.slice(0, -1).every((event) => event.total === -1)).toBe(true);
});

test('skips a folder that cannot be read, with its files, and still lists the others', async () => {
  const onError = vi.fn();
  const gone = folderOf('Gone', ['x.bms', 'y.bms'], 1);
  const kept = folderOf('Kept', ['k.bms']);
  const { files, read } = await readRememberedFolders([gone, kept], { onError });

  expect(files.map((file) => file.webkitRelativePath)).toEqual(['Kept/k.bms']);
  expect(read).toEqual([kept]);
  expect(onError).toHaveBeenCalledWith(gone, expect.any(DOMException));
});

test('lists same-named folders under numbered names so their paths stay apart', async () => {
  const { files } = await readRememberedFolders([folderOf('BMS', ['a.bms']), folderOf('BMS', ['a.bms'])]);
  expect(files.map((file) => file.webkitRelativePath)).toEqual(['BMS/a.bms', 'BMS (2)/a.bms']);
});

test('numbers a repeated folder name past a name already taken', () => {
  expect(rememberedFolderPrefixes(['A', 'A (2)', 'A', 'B'])).toEqual(['A', 'A (2)', 'A (3)', 'B']);
  expect(rememberedFolderPrefixes([])).toEqual([]);
});
