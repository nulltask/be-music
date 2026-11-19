import { expect, test, vi } from 'vite-plus/test';
import { captureDroppedFolders } from './remembered-folder.ts';

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
