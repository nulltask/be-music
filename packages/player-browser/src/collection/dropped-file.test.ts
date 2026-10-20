import { describe, expect, test } from 'vite-plus/test';
import {
  DeferredDroppedFile,
  type DroppedFileEntryLike,
  materializeDroppedFiles,
  withRelativePath,
} from './dropped-file.ts';
import { loadAssetBytes } from './file-lookup.ts';

function stubEntry(name: string, body: string): DroppedFileEntryLike & { opens: number } {
  const stub = {
    name,
    opens: 0,
    file(resolve: (file: File) => void) {
      stub.opens += 1;
      resolve(new File([body], name));
    },
  };
  return stub;
}

function failingEntry(name: string, failures: number): DroppedFileEntryLike & { opens: number } {
  const stub = {
    name,
    opens: 0,
    file(resolve: (file: File) => void, reject?: (error: unknown) => void) {
      stub.opens += 1;
      if (stub.opens <= failures) {
        reject?.(new Error('stale entry'));
        return;
      }
      resolve(new File(['ok'], name));
    },
  };
  return stub;
}

describe('DeferredDroppedFile', () => {
  test('carries the drop path without opening the entry', () => {
    const entry = stubEntry('kick.wav', 'RIFF');
    const file = new DeferredDroppedFile(entry, 'Pack/Song/kick.wav');
    expect(file.name).toBe('kick.wav');
    expect(file.webkitRelativePath).toBe('Pack/Song/kick.wav');
    expect(entry.opens).toBe(0);
  });

  test('opens the entry once and serves bytes and text from it', async () => {
    const entry = stubEntry('main.bms', '#TITLE x');
    const file = new DeferredDroppedFile(entry, 'Song/main.bms');
    expect(await file.text()).toBe('#TITLE x');
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe('#TITLE x');
    expect(entry.opens).toBe(1);
  });

  test('is readable through loadAssetBytes like a lazy File', async () => {
    const file = new DeferredDroppedFile(stubEntry('kick.wav', 'RIFF'), 'Song/kick.wav');
    expect(new TextDecoder().decode(await loadAssetBytes(file))).toBe('RIFF');
  });

  test('retries opening after a failure', async () => {
    const entry = failingEntry('kick.wav', 1);
    const file = new DeferredDroppedFile(entry, 'Song/kick.wav');
    await expect(file.getFile()).rejects.toThrow('stale entry');
    expect(await file.text()).toBe('ok');
    expect(entry.opens).toBe(2);
  });
});

describe('materializeDroppedFiles', () => {
  test('opens deferred handles in order and passes plain files through', async () => {
    const plain = withRelativePath(new File(['skin'], 'play_7.lr2skin'), 'Theme/play_7.lr2skin');
    const deferred = new DeferredDroppedFile(stubEntry('parts.png', 'png'), 'Theme/parts.png');
    const files = await materializeDroppedFiles([deferred, plain]);
    expect(files).toHaveLength(2);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0]!.webkitRelativePath).toBe('Theme/parts.png');
    expect(files[1]).toBe(plain);
  });

  test('drops handles that fail to open and reports them', async () => {
    const broken = new DeferredDroppedFile(failingEntry('gone.png', Infinity), 'Theme/gone.png');
    const ok = new DeferredDroppedFile(stubEntry('ok.png', 'png'), 'Theme/ok.png');
    const failed: string[] = [];
    const files = await materializeDroppedFiles([broken, ok], {
      onError: (file) => failed.push(file.webkitRelativePath),
    });
    expect(files.map((file) => file.webkitRelativePath)).toEqual(['Theme/ok.png']);
    expect(failed).toEqual(['Theme/gone.png']);
  });
});
