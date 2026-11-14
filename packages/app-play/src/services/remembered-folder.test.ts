import { expect, test, vi } from 'vite-plus/test';
import { captureDroppedFolders, readRememberedFolder, type RememberedFolder } from './remembered-folder.ts';

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

  const [file] = await readRememberedFolder(folder);
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
