import type { BrowserDroppedFile } from '@be-music/player-web/collection';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { DropTarget, type DropTargetOptions } from './drop-target.ts';

function fakeElement(): HTMLDivElement & HTMLInputElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: () => {},
    style: {},
    textContent: '',
  } as unknown as HTMLDivElement & HTMLInputElement;
}

/**
 * A drop's `DataTransfer`. The browser's reads empty once the `drop` handler has returned; this one does after
 * `expire()`. With `entries`, its items hand the files as `FileSystemFileEntry`s (a folder drop); without, it has only
 * `files` (as some browsers hand dropped files).
 */
function fakeDrop(files: readonly File[], options: { entries?: boolean } = {}) {
  let live = true;
  const entryOf = (file: File) => ({
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: `/${file.name}`,
    file: (resolve: (file: File) => void) => resolve(file),
  });
  const transfer = {
    get items() {
      return live && options.entries === true ? files.map((file) => ({ webkitGetAsEntry: () => entryOf(file) })) : [];
    },
    get files() {
      return live ? [...files] : [];
    },
  } as unknown as DataTransfer;
  return {
    transfer,
    expire: () => {
      live = false;
    },
  };
}

function harness(overrides: Partial<DropTargetOptions> = {}) {
  const elements = {
    loadingOverlay: fakeElement(),
    loadingLabel: fakeElement(),
    loadingBarFill: fakeElement(),
    loadingCounter: fakeElement(),
    songInput: fakeElement(),
    filesInput: fakeElement(),
  };
  const loaded: string[][] = [];
  const options: DropTargetOptions = {
    elements,
    leaveSelect: vi.fn(async () => true),
    processIncomingFiles: vi.fn(async (files: BrowserDroppedFile[]) => {
      // The overlay is up while the library loads.
      expect(elements.loadingOverlay.classList.contains('visible')).toBe(true);
      loaded.push(files.map((file) => file.name));
    }),
    loadPickedFiles: vi.fn(async () => {}),
    recordLoad: vi.fn(),
    ...overrides,
  };
  return { target: new DropTarget(options), options, elements, loaded };
}

const skinDropPrompt = { close: vi.fn() };

beforeEach(() => {
  skinDropPrompt.close.mockClear();
  vi.stubGlobal('document', {
    querySelector: (selector: string) => (selector === '#skin-drop' ? skinDropPrompt : null),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DropTarget.handleDrop', () => {
  test("reads a drop's files before it first yields, as the browser empties the drop once its handler returns", async () => {
    const { target, loaded } = harness();
    const drop = fakeDrop([new File(['#TITLE a'], 'a.bms'), new File(['x'], 'a.wav')]);
    const handled = target.handleDrop(drop.transfer);
    drop.expire();
    await handled;
    expect(loaded).toEqual([['a.bms', 'a.wav']]);
  });

  test("reads a folder drop's entries before it first yields", async () => {
    const { target, loaded } = harness();
    const drop = fakeDrop([new File(['#TITLE a'], 'a.bms'), new File(['x'], 'a.wav')], { entries: true });
    const handled = target.handleDrop(drop.transfer);
    drop.expire();
    await handled;
    expect(loaded.map((names) => [...names].sort())).toEqual([['a.bms', 'a.wav']]);
  });

  test('takes the select screen off the stage without waiting for it to go before reading', async () => {
    const leaveSelect = vi.fn(() => new Promise<boolean>(() => {}));
    const { target, loaded } = harness({ leaveSelect });
    const drop = fakeDrop([new File(['#TITLE a'], 'a.bms')]);
    const handled = target.handleDrop(drop.transfer);
    drop.expire();
    await handled;
    expect(leaveSelect).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual([['a.bms']]);
  });

  test('closes the "Drop a skin" prompt, and takes the overlay down and counts the load once it is done', async () => {
    const { target, options, elements } = harness();
    await target.handleDrop(fakeDrop([new File(['#TITLE a'], 'a.bms')]).transfer);
    expect(skinDropPrompt.close).toHaveBeenCalledTimes(1);
    expect(elements.loadingOverlay.classList.contains('visible')).toBe(false);
    expect(options.recordLoad).toHaveBeenCalledTimes(1);
  });

  test('takes the overlay down and counts the load when the load fails', async () => {
    const processIncomingFiles = vi.fn(async () => {
      throw new Error('unreadable');
    });
    const { target, options, elements } = harness({ processIncomingFiles });
    await expect(target.handleDrop(fakeDrop([new File(['x'], 'a.bms')]).transfer)).rejects.toThrow('unreadable');
    expect(elements.loadingOverlay.classList.contains('visible')).toBe(false);
    expect(options.recordLoad).toHaveBeenCalledTimes(1);
  });
});
