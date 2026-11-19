// The page as a drop target: files dragged onto the window, or picked with the Options dialog's "Open folder" / "Open files"
// buttons, are read behind the loading overlay while the select screen is off the stage, then handed to the library.

import {
  dropEntries,
  readDropEntries,
  readDroppedFiles,
  type BrowserDroppedFile,
  type LoadProgress,
} from '@be-music/player-browser/collection';
import {
  applyLoadProgress,
  hideLoadingOverlay,
  showLoadingOverlay,
  type LoadingOverlayElements,
} from '../loading-overlay.ts';
import { html, render } from 'lit';
import { playerText } from '../player-copy.ts';
import { localized } from '../ui/localized.ts';
import {
  pickRememberedFolder,
  captureDroppedFolders,
  storedFolders,
  type RememberedFolder,
} from '../services/remembered-folder.ts';
import {
  folderReadPermission,
  isSameFolder,
  isUnansweredFolder,
  requestFolderReadPermission,
} from '../services/folder-handle.ts';
import {
  RememberedFolderSession,
  type RememberedFolderSessionDeps,
  type SnapshotFolder,
} from '../services/folder-snapshots.ts';
import type { LibraryLoadOrigin } from '../services/library.ts';
import type { PlayerWebElements } from '../types.ts';

export interface DropTargetOptions {
  /** The loading overlay a load shows while it reads, and the Options dialog's hidden file inputs. */
  readonly elements: LoadingOverlayElements & Pick<PlayerWebElements, 'chartInput' | 'filesInput'>;
  /** Takes the select screen off the stage while files load, when it is the one showing. */
  readonly leaveSelect: () => Promise<boolean>;
  /** Loads a drop's (or the folder picker's) files (`LibraryService`). */
  readonly processIncomingFiles: (
    files: BrowserDroppedFile[],
    origin?: LibraryLoadOrigin,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly runBackgroundRefresh?: <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  /** Reads the library's charts again where it stands: a folder listed from its snapshot changed on disk. */
  readonly refreshCharts: () => Promise<void>;
  /** How a remembered folder is walked, and where its snapshot is kept (`RememberedFolderSession`). */
  readonly folders: RememberedFolderSessionDeps;
  /** Loads the "Open files" picker's files (`LibraryService`). */
  readonly loadPickedFiles: (files: File[]) => Promise<void>;
  /** A drop or a file pick has finished loading (the test hook's `loads`). */
  readonly recordLoad: () => void;
  readonly resumeSelect: () => Promise<void>;
  readonly setStatus: (text: string) => void;
}

/** Drags and drops on the window, and the Options dialog's file pickers. */
export class DropTarget {
  private readonly elements: DropTargetOptions['elements'];
  private readonly leaveSelect: DropTargetOptions['leaveSelect'];
  private readonly processIncomingFiles: DropTargetOptions['processIncomingFiles'];
  private readonly loadPickedFiles: DropTargetOptions['loadPickedFiles'];
  private readonly recordLoad: DropTargetOptions['recordLoad'];

  private readonly options: DropTargetOptions;
  private folderBusy = false;
  private savedFolders: RememberedFolder[] = [];
  private readonly droppedFolderNames = new Set<string>();
  private folderWrites = Promise.resolve();
  private savedFoldersReady: Promise<void> | undefined;
  private reconnectFolders: RememberedFolder[] = [];
  /** Each folder loaded on this page, with what the library knows of its files. */
  private readonly sessions = new Map<RememberedFolder, RememberedFolderSession>();

  public constructor(options: DropTargetOptions) {
    this.options = options;
    this.elements = options.elements;
    this.leaveSelect = options.leaveSelect;
    this.processIncomingFiles = options.processIncomingFiles;
    this.loadPickedFiles = options.loadPickedFiles;
    this.recordLoad = options.recordLoad;
  }

  public async openFolder(): Promise<void> {
    if (this.folderBusy) return;
    this.folderBusy = true;
    try {
      const picker = pickRememberedFolder();
      if (!picker) {
        this.elements.chartInput.click();
        return;
      }
      const folder = await picker;
      await this.loadFolder(folder);
      await this.rememberLoadedFolders([folder]);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.reportFolderError(error);
    } finally {
      this.folderBusy = false;
    }
  }

  public async restoreFolder(refreshAfter?: Promise<void>): Promise<void> {
    if (!globalThis.indexedDB || this.folderBusy) return;
    this.folderBusy = true;
    try {
      await this.readSavedFolders();
      // Asked of every folder at once: a query the browser leaves unanswered holds up the start only until it times out.
      const folders = [...this.reconnectFolders];
      const permissions = await Promise.all(folders.map((folder) => folderReadPermission(folder)));
      for (const [index, folder] of folders.entries()) {
        try {
          if (permissions[index] !== 'granted') continue;
          if (refreshAfter === undefined) {
            await this.loadFolder(folder, true);
          } else {
            const files = await this.sessionOf(folder).restore();
            if (files === undefined) {
              void refreshAfter
                .then(() => this.runBackgroundRefresh((signal) => this.loadFolder(folder, true, undefined, signal)))
                .catch((error: unknown) => this.reportFolderError(error));
            } else {
              await this.loadFolder(folder, true, { files, refreshAfter });
            }
          }
          this.reconnectFolders = this.reconnectFolders.filter((pending) => pending !== folder);
        } catch (error) {
          this.reportFolderError(error);
        }
      }
      await this.forgetUnansweredFolders(folders);
      this.renderReconnect();
    } catch (error) {
      this.reportFolderError(error);
    } finally {
      this.folderBusy = false;
      this.renderFolderManager();
    }
  }

  private renderReconnect(): void {
    for (const root of document.querySelectorAll<HTMLElement>('[data-remembered-folder-actions]')) {
      render(
        this.reconnectFolders.map(
          (folder) => html`
            <button class="btn" @click=${() => void this.reconnectFolder(folder)}>
              ${localized(() => playerText().shell.reconnectFolder(folder.name))}
            </button>
          `,
        ),
        root,
      );
    }
  }

  private renderFolderManager(): void {
    const root = document.querySelector<HTMLElement>('[data-remembered-folder-manager]');
    if (!root) return;
    const canPick = globalThis.indexedDB !== undefined && 'showDirectoryPicker' in window;
    const savedNames = new Set(this.savedFolders.map(({ name }) => name));
    const sessionNames = [...this.droppedFolderNames].filter((name) => !savedNames.has(name));
    const savedFolders = html`
      <section aria-labelledby="load-folders-heading">
        <h3 id="load-folders-heading">${localized('savedFolders')}</h3>
        <p>${localized('savedFoldersHint')}</p>
        <ul class="remembered-folder-list">
          ${this.savedFolders.map(
            (folder) => html`
              <li>
                <span>${folder.name}</span>
                <button
                  type="button"
                  class="btn"
                  ?disabled=${!canPick}
                  aria-label=${localized(() => playerText().shell.changeSavedFolder(folder.name))}
                  @click=${() => void this.editSavedFolder(folder, true)}
                >
                  ${localized('changeFolder')}
                </button>
                <button
                  type="button"
                  class="btn"
                  aria-label=${localized(() => playerText().shell.removeSavedFolder(folder.name))}
                  @click=${() => void this.editSavedFolder(folder, false)}
                >
                  ${localized('removeFolder')}
                </button>
              </li>
            `,
          )}
        </ul>
        <button
          type="button"
          class="btn"
          ?disabled=${!canPick}
          @click=${() => void this.editSavedFolder(undefined, true)}
        >
          ${localized('addFolder')}
        </button>
      </section>
    `;
    const sessionFolders =
      sessionNames.length > 0
        ? html`
            <section aria-labelledby="session-folders-heading">
              <h3 id="session-folders-heading">${localized('sessionFolders')}</h3>
              <ul class="remembered-folder-list">
                ${sessionNames.map((name) => html`<li><span>${name}</span></li>`)}
              </ul>
            </section>
          `
        : null;
    render(html`${canPick || this.savedFolders.length > 0 ? savedFolders : null}${sessionFolders}`, root);
  }

  private async editSavedFolder(previous: RememberedFolder | undefined, pick: boolean): Promise<void> {
    if (this.folderBusy) return;
    this.folderBusy = true;
    try {
      const folder = pick ? await pickRememberedFolder() : undefined;
      if (pick && !folder) return;
      await this.updateSavedFolders(async (saved) => {
        if (folder) {
          for (const existing of saved) {
            if (await isSameFolder(existing, folder)) {
              return existing === previous ? saved : saved.filter((item) => item !== previous);
            }
          }
        }
        if (previous) return saved.flatMap((item) => (item === previous ? (folder ? [folder] : []) : [item]));
        return folder ? [...saved, folder] : saved;
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.reportFolderError(error);
    } finally {
      this.folderBusy = false;
    }
  }

  private readSavedFolders(): Promise<void> {
    return (this.savedFoldersReady ??= storedFolders()
      .then((folders) => {
        this.savedFolders = folders;
        this.reconnectFolders = [...folders];
        this.renderFolderManager();
      })
      .catch((error: unknown) => {
        this.savedFoldersReady = undefined;
        throw error;
      }));
  }

  private updateSavedFolders(
    update: (saved: readonly RememberedFolder[]) => Promise<readonly RememberedFolder[]>,
  ): Promise<void> {
    const write = this.folderWrites.then(async () => {
      await this.readSavedFolders();
      const next = await update(this.savedFolders);
      this.savedFolders = await storedFolders(next);
      this.reconnectFolders = this.reconnectFolders.filter((folder) => this.savedFolders.includes(folder));
      // A folder no longer remembered keeps no snapshot.
      void this.options.folders.snapshots
        ?.prune(this.savedFolders as unknown as SnapshotFolder[])
        .catch((error: unknown) => console.warn('folder snapshots not pruned', error));
      this.renderReconnect();
      this.renderFolderManager();
    });
    this.folderWrites = write.catch(() => undefined);
    return write;
  }

  private rememberLoadedFolders(folders: readonly RememberedFolder[]): Promise<void> {
    return this.updateSavedFolders(async (saved) => {
      const next = [...saved];
      for (const folder of folders) {
        let index = 0;
        while (index < next.length && !(await isSameFolder(folder, next[index]!))) index += 1;
        next[index] = folder;
      }
      return next;
    });
  }

  /** Loads a saved folder the start could not, once the player allows it to be read. */
  private async reconnectFolder(folder: RememberedFolder): Promise<void> {
    if (this.folderBusy) return;
    this.folderBusy = true;
    try {
      if ((await requestFolderReadPermission(folder)) !== 'granted') {
        await this.forgetUnansweredFolders([folder]);
        return;
      }
      await this.loadFolder(folder);
      this.reconnectFolders = this.reconnectFolders.filter((pending) => pending !== folder);
    } catch (error) {
      this.reportFolderError(error);
    } finally {
      this.folderBusy = false;
      this.renderReconnect();
    }
  }

  /**
   * Takes the folders among `folders` whose handle went unanswered out of the saved folders, and says so: the browser
   * answers nothing about such a handle on any later visit either, so it could never load. The player adds the folder
   * again to load it.
   */
  private async forgetUnansweredFolders(folders: readonly RememberedFolder[]): Promise<void> {
    const forgotten = folders.filter((folder) => isUnansweredFolder(folder));
    if (forgotten.length === 0) return;
    try {
      await this.updateSavedFolders(async (saved) => saved.filter((folder) => !forgotten.includes(folder)));
    } catch (error) {
      this.reportFolderError(error);
      return;
    }
    this.options.setStatus(playerText().shell.forgotUnansweredFolders(forgotten.map(({ name }) => name)));
  }

  /**
   * Lists a folder's charts: from its snapshot when it has one, which touches no file, and otherwise by walking it. A
   * folder listed from its snapshot is then walked in the background ({@link verifyFolder}).
   */
  private async loadFolder(
    folder: RememberedFolder,
    startup = false,
    cached?: { files: BrowserDroppedFile[]; refreshAfter: Promise<void> },
    signal?: AbortSignal,
  ): Promise<void> {
    const loaded = this.sessionOf(folder);
    if (!startup) showLoadingOverlay(this.elements);
    let leftSelect = false;
    let restored = false;
    let cacheMiss = false;
    try {
      if (!startup) leftSelect = await this.leaveSelect();
      let files = cached?.files ?? (await loaded.restore());
      signal?.throwIfAborted();
      restored = files !== undefined;
      files ??= await loaded.read(
        startup
          ? undefined
          : (fileCount) => applyLoadProgress(this.elements, { phase: 'enumerating', current: fileCount, total: -1 }),
        signal,
      );
      await this.processIncomingFiles(
        files,
        {
          startup,
          readFiles: (signal) => loaded.read(undefined, signal),
          chartKeys: loaded,
          ...(cached === undefined
            ? {}
            : {
                readAuxiliaryAfter: cached.refreshAfter,
                onChartCacheMiss: () => {
                  cacheMiss = true;
                },
              }),
          onLoaded: () => {
            void loaded.save().catch((error: unknown) => console.warn('folder snapshot not kept', error));
          },
        },
        signal,
      );
    } finally {
      if (!startup) hideLoadingOverlay(this.elements);
      if (leftSelect) await this.options.resumeSelect();
      if (!signal?.aborted) this.recordLoad();
    }
    if (restored) {
      void (cached?.refreshAfter ?? Promise.resolve())
        .then(() => this.verifyFolder(loaded, cacheMiss))
        .catch((error: unknown) => this.reportFolderError(error));
    }
  }

  private sessionOf(folder: RememberedFolder): RememberedFolderSession {
    let session = this.sessions.get(folder);
    if (session === undefined) {
      session = new RememberedFolderSession(folder as unknown as SnapshotFolder, this.options.folders);
      this.sessions.set(folder, session);
    }
    return session;
  }

  /**
   * Walks a folder listed from its snapshot, and has the library read it again when it changed since. A folder that
   * can no longer be read is reported and leaves the library.
   */
  private async verifyFolder(session: RememberedFolderSession, cacheMiss: boolean): Promise<void> {
    try {
      if (!(await this.runBackgroundRefresh((signal) => session.verify(cacheMiss, signal)))) return;
    } catch (error) {
      this.reportFolderError(error);
    }
    try {
      await this.options.refreshCharts();
    } catch (error) {
      this.reportFolderError(error);
    }
  }

  private runBackgroundRefresh<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.options.runBackgroundRefresh?.(work) ?? work(new AbortController().signal);
  }

  private reportFolderError(error: unknown): void {
    const message = playerText().shell.rememberedFolderError;
    this.options.setStatus(message);
    console.warn(message, error);
  }

  /** Listens to the Options dialog's file pickers, and to files dragged onto the window. */
  public wire(): void {
    this.elements.chartInput.addEventListener('open-folder', () => void this.openFolder());
    const onFilesPicked = (input: HTMLInputElement, load: (files: File[]) => Promise<void>) => {
      const files = input.files;
      if (!files || files.length === 0) {
        return;
      }
      const fileList = [...files];
      // Reset the input value immediately so picking the SAME folder a second time still fires `change`. Browsers
      // suppress repeat `change` events when the new selection matches the previous value — without this, a user
      // re-picking after a misclick or an interrupted load would see the input silently ignore them.
      input.value = '';
      void (async () => {
        // Browser file-picker drops go through the same loading overlay as drag-drop so a folder picked via the GUI
        // shows progress too. Take the select scene off the stage up-front so its rendering / BGM stays paused while we
        // read + parse — the user shouldn't see the song list flicker mid-load.
        showLoadingOverlay(this.elements);
        await this.leaveSelect();
        try {
          // Route through the same post-enumeration pipeline as drag-drop so the picker's selection produces a theme +
          // songs split (handy when a user hand-picks a folder whose root carries both an LR2 theme and a BMS pack),
          // instead of the previous `loadCharts`-only path that quietly skipped any LR2 assets in the selection.
          await load(fileList);
        } finally {
          hideLoadingOverlay(this.elements);
          this.recordLoad();
        }
      })();
    };
    this.elements.chartInput.addEventListener('change', () =>
      onFilesPicked(this.elements.chartInput, (files) => this.processIncomingFiles(files)),
    );
    this.elements.filesInput.addEventListener('change', () =>
      onFilesPicked(this.elements.filesInput, (files) => this.loadPickedFiles(files)),
    );

    // Drag state via a depth counter rather than a plain add/remove pair on dragover/dragleave. The browser fires
    // `dragleave` not just when the cursor exits the window but also every time it crosses into a child element —
    // without counting, the `.dragging` class flickers off whenever the user drags across the canvas → toolbar
    // boundary, so the overlay would strobe (or, with `dragleave` firing once at the end, disappear before the user can
    // read the hint).
    //
    // Increment on every `dragenter`, decrement on every `dragleave`. We're truly outside the window once the counter
    // hits zero, at which point the class comes off. `drop` and the rare `dragend` reset the counter so a pathological
    // event sequence (browser quirk, devtools overlay, etc.) can't leave the class stuck on.
    let dragDepth = 0;
    const setDragging = (active: boolean): void => {
      document.body.classList.toggle('dragging', active);
    };
    window.addEventListener('dragenter', (event) => {
      event.preventDefault();
      dragDepth += 1;
      if (dragDepth === 1) {
        setDragging(true);
      }
    });
    // `dragover` still has to call `preventDefault` for the browser to treat the page as a valid drop target. We don't
    // toggle state here — that's `dragenter` / `dragleave`'s job — but skipping the preventDefault would silently turn
    // drops into "open file in browser" navigations.
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragging(false);
      }
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      dragDepth = 0;
      setDragging(false);
      if (event.dataTransfer) {
        void this.handleDrop(event.dataTransfer);
      }
    });
    // Belt-and-braces: the spec lets `dragend` fire on the source element when a drag is canceled (Esc, drop on a
    // non-target). For files dragged in from the OS it shouldn't normally fire on `window`, but if a custom source ever
    // does we still want to clear state.
    window.addEventListener('dragend', () => {
      dragDepth = 0;
      setDragging(false);
    });
  }

  /**
   * Reads a drop's files and loads them. The browser empties a drop's `DataTransfer` once the `drop` handler returns, so
   * its items are read before this first yields.
   */
  public async handleDrop(dataTransfer: DataTransfer): Promise<void> {
    const folders = captureDroppedFolders(dataTransfer);
    // The "Drop a skin" prompt has done its job once something lands.
    document.querySelector<HTMLDialogElement>('#skin-drop')?.close();
    // Show the overlay before we even start enumerating files — walking a deep `webkitGetAsEntry` tree on a chart pack
    // with tens of thousands of WAVs visibly stalls the UI for several seconds, and we want the user to see "we're
    // working on it" immediately rather than after the slow phase finishes.
    showLoadingOverlay(this.elements);
    // Take the select scene off the stage for the duration of the load. Its exit pauses BGM + the rAF tick + the song
    // list rendering, so:
    //
    // - the loaded LR2 theme's `select.wav` doesn't start the moment the (small) theme bundle finishes parsing while
    //   the (large) song collection is still being read,
    // - the song list doesn't visually shuffle as new entries land,
    // - and the user only sees the overlay until everything is ready — not a half-rendered scene behind it.
    //
    // `showSelect()` at the end of the try block shows the scene again with the freshly populated state in one shot.
    // Not awaited: the drop's items must be read before this handler yields.
    void this.leaveSelect();
    try {
      // The drop's entries are kept with its charts, so the folder reload can walk its folders again.
      const entries = dropEntries(dataTransfer);
      const progress = { onProgress: (value: LoadProgress) => applyLoadProgress(this.elements, value) };
      const files =
        entries.length > 0 ? await readDropEntries(entries, progress) : await readDroppedFiles(dataTransfer, progress);
      const handles = await folders;
      const folderNames = new Set(handles.map((folder) => folder.name));
      for (const entry of entries) if (entry.isDirectory) folderNames.add(entry.name);
      if (entries.length === 0) {
        for (const file of files) {
          const path = file.webkitRelativePath || '';
          const separator = path.indexOf('/');
          if (separator > 0) folderNames.add(path.slice(0, separator));
        }
      }
      const isFolderDrop = folderNames.size > 0;
      if (isFolderDrop && globalThis.indexedDB) {
        try {
          await this.readSavedFolders();
        } catch (error) {
          this.reportFolderError(error);
        }
      }
      // A dropped folder that will be remembered keeps the cache keys of its charts, so its snapshot is whole after
      // this one load: the next visit lists it without reading a file. Folders of one name cannot be told apart by
      // path, and go without.
      const names = new Set(handles.map((handle) => handle.name));
      const sessions = names.size === handles.length ? handles.map((handle) => this.sessionOf(handle)) : [];
      await this.processIncomingFiles(files, {
        ...(entries.length > 0 ? { entries } : {}),
        showLibraryRoot: isFolderDrop && (this.savedFolders.length > 0 || this.droppedFolderNames.size > 0),
        ...(sessions.length > 0
          ? {
              chartKeys: {
                known: () => undefined,
                learned: (path, key) =>
                  sessions.find((session) => path.startsWith(`${session.folder.name}/`))?.learned(path, key),
              },
            }
          : {}),
      });
      for (const name of folderNames) this.droppedFolderNames.add(name);
      if (handles.length > 0 && globalThis.indexedDB) {
        try {
          await this.rememberLoadedFolders(handles);
          for (const session of sessions) {
            void session.capture().catch((error: unknown) => console.warn('folder snapshot not kept', error));
          }
        } catch (error) {
          this.reportFolderError(error);
        }
      }
      if (isFolderDrop) this.renderFolderManager();
    } finally {
      // Always tear the overlay down — even when one of the sub-loaders threw or `splitDroppedChartAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would leave the UI permanently masked.
      hideLoadingOverlay(this.elements);
      this.recordLoad();
    }
  }
}
