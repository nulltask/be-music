// The page as a drop target: files dragged onto the window, or picked with the Debug Menu's "Open folder" / "Open files"
// buttons, are read behind the loading overlay while the select screen is off the stage, then handed to the library.

import { readDroppedFiles, type BrowserDroppedFile } from '@be-music/player-web/collection';
import {
  applyLoadProgress,
  hideLoadingOverlay,
  showLoadingOverlay,
  type LoadingOverlayElements,
} from '../loading-overlay.ts';
import type { PlayerWebDemoElements } from '../types.ts';

export interface DropTargetOptions {
  /** The loading overlay a load shows while it reads, and the Debug Menu's hidden file inputs. */
  readonly elements: LoadingOverlayElements & Pick<PlayerWebDemoElements, 'chartInput' | 'filesInput'>;
  /** Takes the select screen off the stage while files load, when it is the one showing. */
  readonly leaveSelect: () => Promise<boolean>;
  /** Loads a drop's (or the folder picker's) files (`LibraryService`). */
  readonly processIncomingFiles: (files: BrowserDroppedFile[]) => Promise<void>;
  /** Loads the "Open files" picker's files (`LibraryService`). */
  readonly loadPickedFiles: (files: File[]) => Promise<void>;
  /** A drop or a file pick has finished loading (the test hook's `loads`). */
  readonly recordLoad: () => void;
}

/** Drags and drops on the window, and the Debug Menu's file pickers. */
export class DropTarget {
  private readonly elements: DropTargetOptions['elements'];
  private readonly leaveSelect: DropTargetOptions['leaveSelect'];
  private readonly processIncomingFiles: DropTargetOptions['processIncomingFiles'];
  private readonly loadPickedFiles: DropTargetOptions['loadPickedFiles'];
  private readonly recordLoad: DropTargetOptions['recordLoad'];

  public constructor(options: DropTargetOptions) {
    this.elements = options.elements;
    this.leaveSelect = options.leaveSelect;
    this.processIncomingFiles = options.processIncomingFiles;
    this.loadPickedFiles = options.loadPickedFiles;
    this.recordLoad = options.recordLoad;
  }

  /** Listens to the Debug Menu's file pickers, and to files dragged onto the window. */
  public wire(): void {
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
      const files = await readDroppedFiles(dataTransfer, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      await this.processIncomingFiles(files);
    } finally {
      // Always tear the overlay down — even when one of the sub-loaders threw or `splitDroppedChartAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would leave the UI permanently masked.
      hideLoadingOverlay(this.elements);
      this.recordLoad();
    }
  }
}
