import {
  BrowserSongLibrary,
  PixiGameplayView,
  PixiResultView,
  PixiSceneHost,
  PixiSongSelectView,
  describeSongCollection,
  downloadBlob,
  loadLr2ThemeSkinsFromFiles,
  makeWebmSeekable,
  parseCompressorMode,
  pickLr2PlaySkin,
  readDroppedFiles,
  resolveSongSource,
  splitDroppedSongAndThemeFiles,
  summarizeLr2PlaySkins,
  type BrowserSongCollection,
  type BrowserSongEntry,
  type CompressorMode,
  type LoadProgress,
  type Lr2PlayVariant,
  type Lr2PlaySkinMap,
  type Lr2Skin,
  type PixiGameplayResultData,
  type PixiSongSelectNavigation,
} from '@be-music/player-web-core';
// lil-gui auto-injects its stylesheet at construction time (see
// `injectStyles` option, default `true`), so we don't import its
// CSS explicitly — its package.json doesn't expose the file via
// `exports` anyway.
import GUI, { type Controller } from 'lil-gui';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = `
  <div class="shell empty">
    <!--
      Hidden file input — triggered by the GUI's "Open folder /
      ZIP" button. lil-gui has no native file controller, so we
      forward a synthetic click to this hidden input from the
      function controller's handler. \`webkitdirectory\` makes the
      browser show a folder picker on Chromium / Safari; multiple
      ZIPs / charts can also be selected via the same input.
    -->
    <input id="songs" type="file" webkitdirectory multiple class="hidden-file-input" />
    <input id="search" class="search-input" type="search" placeholder="Search title / artist / genre..." />
    <div class="stage" id="stage">
      <!--
        Drop hint. Visible whenever the shell carries the
        \`.empty\` class (no songs loaded yet) so the user has a
        clear "drop a folder here" target up-front, plus during
        an active drag (\`.dragging\`) so the hint reappears even
        once charts are loaded. Falls behind the canvas otherwise.
      -->
      <div class="drop">Drop BMS folder + LR2 theme together (or either one)</div>
    </div>
    <!--
      Loading overlay. Hidden by default; revealed via the
      "visible" class while a folder / ZIP drop is mid-load. The
      bar below moves between "indeterminate" (CSS animation) and
      "determinate" (inline width %) states depending on whether
      the active phase reports a known total. The card sits in the
      centre of the shell so it's visible regardless of which
      scene is currently mounted (select / gameplay / result).
    -->
    <div class="loading-overlay" id="loading-overlay" aria-hidden="true">
      <div class="loading-card" role="status" aria-live="polite">
        <div class="loading-label" id="loading-label">Loading…</div>
        <div class="loading-bar"><div class="loading-bar-fill" id="loading-bar-fill"></div></div>
        <div class="loading-counter" id="loading-counter"></div>
      </div>
    </div>
  </div>
`;

interface PlayerWebDemoElements {
  stage: HTMLDivElement;
  shell: HTMLDivElement;
  /**
   * Hidden `<input type="file" webkitdirectory>` triggered from a
   * lil-gui function controller. The DOM element survives across
   * lil-gui rebuilds (e.g. theme changes) so the underlying
   * `change` listener stays bound through the session.
   */
  songInput: HTMLInputElement;
  /**
   * Floating DOM `<input>` overlay positioned near the LR2 default
   * skin's search-text rect. Focus is given to it when the user
   * clicks the skin's `#SRC_TEXT,st=30,edit=1` region or hits the
   * `/` shortcut; typing into it filters the song list via
   * `PixiSongSelectView.setSearchQuery`.
   */
  searchInput: HTMLInputElement;
  /**
   * Centred overlay shown while a dropped folder / ZIP is being
   * read + parsed. Toggled via the `.visible` class so CSS
   * controls the fade-in / fade-out, and the `aria-hidden`
   * attribute mirrors the visibility for screen readers.
   */
  loadingOverlay: HTMLDivElement;
  loadingLabel: HTMLDivElement;
  loadingBarFill: HTMLDivElement;
  loadingCounter: HTMLDivElement;
}

/**
 * Plain-data state object backing the lil-gui controllers. Each
 * key matches a controller; reads / writes go through the
 * same `state.foo` reference so a programmatic update (e.g.
 * `setAudioCompressor` triggered by a URL flag) can call
 * `controller.updateDisplay()` and the GUI reflects the new
 * value. Function members are bound to the host so `this` keeps
 * its meaning when lil-gui invokes them.
 */
interface DemoGuiState {
  autoPlay: boolean;
  compressor: boolean;
  compressorKey: boolean;
  compressorBgm: boolean;
  compressorMaster: boolean;
  /**
   * Read-only status text (loading summaries, "Playing: …",
   * recording state, etc.). Bound to a disabled string
   * controller so users can copy it out of the GUI but can't
   * edit it. The runtime updates this via {@link setStatus}
   * which also pushes the new value into the controller.
   */
  status: string;
  /** Triggered by clicking the GUI's "Open folder / ZIP" button. */
  openFolder: () => void;
  /** Triggered by clicking the GUI's record toggle. */
  record: () => void;
}

class PlayerWebDemoApp {
  private readonly library = new BrowserSongLibrary();
  /**
   * Per-variant play skins, keyed by `Lr2PlayVariant`. Loaded once at
   * theme-drop time so a DP chart can pick `playSkins['14']` while a
   * regular SP chart picks `playSkins['7']`.
   */
  private readonly playSkins: Lr2PlaySkinMap = {};
  /**
   * Single PixiJS host shared by every scene (select / gameplay / result).
   * Scenes are attached and detached through `PixiSceneHost` instead of
   * constructing a separate Pixi `Application` per view.
   */
  private readonly sceneHost = new PixiSceneHost();
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  private selectSkin: Lr2Skin | undefined;
  private resultSkin: Lr2Skin | undefined;
  /**
   * Loop-playable BGM bytes for the song-select scene
   * (`LR2files/Bgm/<theme>/select.wav` from the dropped theme).
   * Forwarded to `PixiSongSelectView` via the constructor option
   * on first mount and via `setSelectBgm` on subsequent theme
   * drops mid-session.
   */
  private selectBgmBytes: Uint8Array | undefined;
  /**
   * One-shot song-decided sound bytes
   * (`LR2files/Bgm/<theme>/decide.wav`). Played by
   * `PixiSongSelectView.playDecideSound` on the select →
   * gameplay transition.
   */
  private decideBgmBytes: Uint8Array | undefined;
  /**
   * LR2 system sound-effect bundle
   * (`LR2files/Sound/lr2/<name>.wav`). Each slot maps to a
   * `PixiSongSelectView` system-sound name (cursorMove /
   * folderOpen / folderClose). Forwarded via the constructor
   * option on first mount and via `setSystemSounds` on
   * subsequent theme drops.
   */
  private systemSoundBundle: { cursorMove?: Uint8Array; folderOpen?: Uint8Array; folderClose?: Uint8Array } = {};
  private selectView: PixiSongSelectView | undefined;
  private gameplayView: PixiGameplayView | undefined;
  private resultView: PixiResultView | undefined;
  private hostMounted = false;
  /**
   * Last-known cursor / folder state of the select view, captured before
   * gameplay so returning to song select restores the user's position.
   */
  private lastSelectNavigation: PixiSongSelectNavigation | undefined;
  /**
   * Compressor architecture for `audioCompressorMode` on every
   * gameplay mount. Defaults to `'split'` (the new 3-stage bus —
   * see `audio-bus.ts` for the design rationale); the demo accepts
   * a `?compressor=legacy` URL flag for A/B comparison against the
   * old single-compressor topology, and `?compressor=off` to spawn
   * gameplay with the bypass path active out of the gate (the
   * checkbox can also reach `off` mid-session).
   */
  private compressorMode: 'split' | 'legacy' = 'split';
  /**
   * GUI state object the lil-gui controllers read / write. Held
   * on the instance so the GUI build code and the runtime
   * handlers (`toggleRecording` etc.) share a single source of
   * truth — programmatic updates go through `state.foo = …` +
   * `controller.updateDisplay()`.
   */
  private readonly guiState: DemoGuiState;
  /**
   * lil-gui handles for controllers we need to address by name
   * after construction — toggling the per-stage folder
   * visibility, renaming the record button, and reflecting URL-
   * flag-driven compressor changes back into the GUI.
   */
  private gui: GUI | undefined;
  private compressorStageFolder: GUI | undefined;
  private recordController: Controller | undefined;
  /**
   * Disabled string controller used as the read-only status
   * row inside the lil-gui panel. We hold a reference so
   * {@link setStatus} can call `updateDisplay()` directly
   * rather than relying on lil-gui's `.listen()` polling.
   */
  private statusController: Controller | undefined;
  /**
   * `true` after the user clicks Record on the song-select
   * screen but before they actually pick a song. Consumed (and
   * cleared) by `playSong` immediately after the gameplay view
   * mounts, kicking off `startRecording()` so the very first
   * frame of the chart is captured.
   *
   * A second click on Record before picking a song flips this
   * back to `false` ("disarm"), and any non-pick path that
   * leaves the select view (e.g. dropping a new folder mid-
   * armed) is responsible for clearing it via {@link disarmAutoRecord}
   * so the flag doesn't survive into a future session that
   * shouldn't be auto-captured.
   */
  private autoRecordArmed = false;
  public constructor(private readonly elements: PlayerWebDemoElements) {
    this.guiState = {
      autoPlay: false,
      compressor: false,
      compressorKey: true,
      compressorBgm: true,
      compressorMaster: true,
      status: 'Ready',
      openFolder: () => this.elements.songInput.click(),
      record: () => {
        void this.toggleRecording();
      },
    };
    // Pick up the `?compressor=split|legacy|off` URL flag once at
    // boot. We resolve it through `parseCompressorMode` (the same
    // helper exported from `audio-bus.ts`) so the recognised values
    // stay synced with the runtime API. Unrecognised / missing flag
    // → fall through to defaults: architecture `'split'`, GUI
    // checkbox unchecked (compressor off).
    //
    // `?compressor=split|legacy` is an explicit opt-in to that
    // architecture and implies compression should be ON, so the
    // checkbox is pre-checked too. `?compressor=off` is redundant
    // with the new default but kept as an explicit form for
    // documentation / scripted launches.
    const flag: CompressorMode | undefined = parseCompressorMode(
      new URL(window.location.href).searchParams.get('compressor'),
    );
    if (flag === 'split' || flag === 'legacy') {
      this.compressorMode = flag;
      this.guiState.compressor = true;
    } else if (flag === 'off') {
      this.guiState.compressor = false;
    }
  }

  public start(): void {
    this.buildGui();
    void this.showSelect();

    this.elements.songInput.addEventListener('change', () => {
      const files = this.elements.songInput.files;
      if (!files) {
        return;
      }
      void (async () => {
        // Browser file-picker drops go through the same loading
        // overlay as drag-drop so a folder picked via the GUI
        // shows progress too. Hide the select scene up-front so
        // its rendering / BGM stays paused while we read + parse
        // — the user shouldn't see the song list flicker mid-load.
        this.showLoadingOverlay();
        this.selectView?.setVisible(false);
        try {
          await this.loadSongs([...files]);
        } finally {
          this.hideLoadingOverlay();
        }
        await this.showSelect();
      })();
    });

    // Global `/` shortcut focuses the search input. Standard
    // editor convention — same as GitHub / Slack / Discord. We
    // suppress the actual `/` character so it doesn't end up in
    // the input field.
    window.addEventListener('keydown', (event) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      // Don't hijack `/` when the user is already typing into
      // some other input.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      this.elements.searchInput.focus();
      this.elements.searchInput.select();
    });
    // Search input: forward every keystroke to the select view so
    // the bar list filters live. Escape clears the filter and
    // returns focus to the canvas (so arrow-key navigation works
    // again immediately).
    this.elements.searchInput.addEventListener('input', () => {
      this.selectView?.setSearchQuery(this.elements.searchInput.value);
    });
    this.elements.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.elements.searchInput.value = '';
        this.selectView?.setSearchQuery('');
        this.elements.searchInput.blur();
      } else if (event.key === 'Enter') {
        // Pressing Enter while typing should let the user pick the
        // currently-focused (filtered) result without leaving the
        // input first. `keydown` on the window won't fire on the
        // select view (the input has focus), so route the action
        // explicitly.
        event.preventDefault();
        // No public "trigger Enter" API on the view; setSearchQuery
        // already moved the cursor to 0 after each keystroke, so
        // closing the input + giving focus back to the canvas is
        // enough for the user's next Enter press to pick that song.
        this.elements.searchInput.blur();
      }
    });

    window.addEventListener('dragover', (event) => {
      event.preventDefault();
      document.body.classList.add('dragging');
    });

    window.addEventListener('dragleave', () => {
      document.body.classList.remove('dragging');
    });

    window.addEventListener('drop', (event) => {
      event.preventDefault();
      document.body.classList.remove('dragging');
      if (event.dataTransfer) {
        void this.handleDrop(event.dataTransfer);
      }
    });
  }

  private async ensureHostMounted(): Promise<void> {
    if (this.hostMounted) return;
    this.hostMounted = true;
    await this.sceneHost.mount(this.elements.stage);
  }

  /**
   * Hide the per-stage `Key` / `BGM` / `Master` folder when it
   * doesn't apply to the current state:
   *
   * - Compressor checkbox unchecked → bus is in `'off'` mode, every
   *   stage is bypassed already.
   * - `?compressor=legacy` → the legacy architecture has just one
   *   compressor; per-stage toggles don't map onto it.
   *
   * lil-gui's `show(false)` collapses the folder out of the panel
   * entirely, matching the previous `display: none` behaviour.
   */
  private refreshCompressorStageVisibility(): void {
    const visible = this.guiState.compressor && this.compressorMode === 'split';
    this.compressorStageFolder?.show(visible);
  }

  /**
   * Builds the floating lil-gui control panel and wires every
   * controller to the gameplay / scene state. Centralising this
   * in one method lets us bind handles to specific controllers
   * (`recordController`, `compressorStageFolder`) up-front, so
   * runtime code can address them by name (renaming the record
   * button when capture starts, hiding the per-stage folder on
   * compressor mode change) without re-querying the DOM.
   */
  private buildGui(): void {
    const gui = new GUI({ title: 'be-music demo', width: 280 });
    this.gui = gui;
    // Status row pinned to the top of the panel — first thing
    // the user sees, so a glance at the GUI is enough to tell
    // whether a load is in flight, what's currently playing, or
    // where a saved recording landed. Disabled so the field
    // reads as a passive read-out instead of an editable input.
    // Updates are pushed explicitly via `setStatus`; cheaper
    // than lil-gui's `.listen()` polling and the only writer is
    // this class anyway.
    this.statusController = gui.add(this.guiState, 'status').name('Status').disable();
    this.statusController.domElement.classList.add('status-row');
    gui.add(this.guiState, 'openFolder').name('Open folder / ZIP');
    gui
      .add(this.guiState, 'autoPlay')
      .name('Auto play')
      .onChange((value: boolean) => {
        // `autoPlay` is consumed at gameplay-mount time; nothing
        // to push onto a live view because the gameplay scene
        // captures the flag in its constructor. The `value` arg
        // satisfies lil-gui's typed signature without us needing
        // to re-read `state.autoPlay` ourselves.
        this.guiState.autoPlay = value;
      });
    gui
      .add(this.guiState, 'compressor')
      .name('Compressor')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressor(value);
        this.refreshCompressorStageVisibility();
      });
    const stages = gui.addFolder('Compressor stages');
    this.compressorStageFolder = stages;
    stages
      .add(this.guiState, 'compressorKey')
      .name('Key')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('key', value);
      });
    stages
      .add(this.guiState, 'compressorBgm')
      .name('BGM')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('bgm', value);
      });
    stages
      .add(this.guiState, 'compressorMaster')
      .name('Master')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('master', value);
      });
    this.recordController = gui.add(this.guiState, 'record').name('● Record');
    this.refreshCompressorStageVisibility();
  }

  /**
   * Single chokepoint for status-text updates. Writes the new
   * value into `guiState` and refreshes the lil-gui controller
   * so the read-only row repaints with the new text.
   */
  private setStatus(text: string): void {
    this.guiState.status = text;
    this.statusController?.updateDisplay();
  }

  /**
   * Flip the gameplay recorder on / off. First click during a
   * play session begins capture; second click finalizes the
   * blob and triggers a browser download as
   * `<song>.webm`. Errors (codec unavailable, no gameplay view)
   * surface to the status panel.
   *
   * Visual state lives entirely on the lil-gui record controller:
   * `name()` swaps the label between `● Record` / `■ Stop`, and
   * `disable()` greys it out while the WebM blob is being
   * assembled on stop. The `.recording` CSS class on the
   * controller's DOM element drives the red-glow accent so the
   * lil-gui style takes precedence over our highlight.
   */
  private async toggleRecording(): Promise<void> {
    const gameplay = this.gameplayView;
    const controller = this.recordController;
    if (!gameplay) {
      // No chart is playing yet — interpret the click as "arm
      // capture for the next song I pick" so the user can stage
      // recording from the song-select screen without having to
      // hit Record at the precise moment gameplay starts. A
      // second click before picking a song disarms.
      this.autoRecordArmed = !this.autoRecordArmed;
      if (this.autoRecordArmed) {
        controller?.domElement.classList.add('arming');
        controller?.name('◉ Recording on next song');
        this.setStatus('Recording armed — pick a song to start capturing');
      } else {
        controller?.domElement.classList.remove('arming');
        controller?.name('● Record');
        this.setStatus('Recording disarmed');
      }
      return;
    }
    if (gameplay.isRecording()) {
      controller?.disable();
      this.setStatus('Finalising recording…');
      try {
        const result = await gameplay.stopRecording();
        if (result) {
          // `MediaRecorder`'s native WebM stream is play-only —
          // post-process the blob to inject `Duration` + `Cues`
          // so external players can seek inside it. Cheap on the
          // typical chart-length take (a few hundred ms for a
          // 1-3 minute recording on M-series hardware) and
          // gracefully falls back to the raw blob if the patch
          // fails, so a corrupt take is never silently lost.
          const seekable = await makeWebmSeekable(result.blob);
          const filename = `${this.recordingFilenameBase}.webm`;
          downloadBlob(seekable, filename);
          const seconds = (result.durationMs / 1000).toFixed(1);
          const sizeMb = (seekable.size / (1024 * 1024)).toFixed(1);
          this.setStatus(`Saved ${filename} (${seconds}s, ${sizeMb} MB)`);
        }
      } finally {
        controller?.domElement.classList.remove('recording');
        controller?.name('● Record');
        controller?.enable();
      }
      return;
    }
    try {
      gameplay.startRecording();
      controller?.domElement.classList.add('recording');
      controller?.name('■ Stop');
      this.setStatus('Recording…');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[record] start failed', error);
      this.setStatus(`Recording unavailable: ${(error as Error).message}`);
    }
  }

  /**
   * Filename base for the next saved recording. Derived from the
   * currently-playing song's title (sanitised for filesystem
   * safety) or `gameplay-<timestamp>` when no song info is
   * available. Updated on every `playSong` so back-to-back
   * recordings don't overwrite each other in the user's
   * downloads folder.
   */
  private recordingFilenameBase = 'gameplay';

  /**
   * Reveals the centred loading overlay and reset its readout to a
   * neutral "Loading…" state. The actual phase / counter text fills
   * in via `applyLoadProgress` as events fire from the loaders.
   */
  private showLoadingOverlay(): void {
    this.elements.loadingOverlay.classList.add('visible');
    this.elements.loadingOverlay.setAttribute('aria-hidden', 'false');
    this.elements.loadingLabel.textContent = 'Loading…';
    this.elements.loadingCounter.textContent = '';
    // Reset to indeterminate (no inline width) until the first
    // `applyLoadProgress` lands. The CSS animates the bar so the
    // user sees motion even before the first phase event fires.
    this.elements.loadingBarFill.classList.add('indeterminate');
    this.elements.loadingBarFill.style.width = '';
  }

  private hideLoadingOverlay(): void {
    this.elements.loadingOverlay.classList.remove('visible');
    this.elements.loadingOverlay.setAttribute('aria-hidden', 'true');
  }

  /**
   * Maps a `LoadProgress` event from the player-web-core loaders
   * onto the overlay DOM. Phases:
   *
   * - `enumerating` — total is `-1` (we're still walking the drop
   *   tree). Show the running file count + the current path,
   *   leave the bar in indeterminate animation mode.
   * - `reading` / `parsing` / `theme` — total is known. Switch
   *   the bar to determinate mode and set its width to
   *   `current / total`.
   *
   * Phase prefixes (`Reading files…` etc.) come from the
   * `phaseLabels` map; the per-item label surfaces the underlying
   * filename / sub-task so the user can see which file is the
   * current bottleneck.
   */
  private applyLoadProgress(progress: LoadProgress): void {
    const phaseLabel = phaseLabels[progress.phase];
    const counterFragments: string[] = [];
    if (progress.total > 0) {
      // Determinate phase — set explicit width and pin the
      // counter to "X / N (P%)" so the user can eyeball ETA.
      const ratio = Math.max(0, Math.min(1, progress.current / progress.total));
      this.elements.loadingBarFill.classList.remove('indeterminate');
      this.elements.loadingBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;
      counterFragments.push(`${progress.current} / ${progress.total}`);
    } else {
      // Indeterminate (enumeration) — only `current` is meaningful.
      this.elements.loadingBarFill.classList.add('indeterminate');
      this.elements.loadingBarFill.style.width = '';
      if (progress.current > 0) {
        counterFragments.push(`${progress.current}`);
      }
    }
    if (progress.label) {
      counterFragments.push(progress.label);
    }
    this.elements.loadingLabel.textContent = phaseLabel;
    this.elements.loadingCounter.textContent = counterFragments.join(' · ');
  }

  private async handleDrop(dataTransfer: DataTransfer): Promise<void> {
    // Show the overlay before we even start enumerating files —
    // walking a deep `webkitGetAsEntry` tree on a chart pack with
    // tens of thousands of WAVs visibly stalls the UI for several
    // seconds, and we want the user to see "we're working on it"
    // immediately rather than after the slow phase finishes.
    this.showLoadingOverlay();
    // Take the select scene offline for the duration of the load.
    // `setVisible(false)` pauses BGM + the rAF tick + the song
    // list rendering, so:
    //
    // - the loaded LR2 theme's `select.wav` doesn't start the
    //   moment the (small) theme bundle finishes parsing while
    //   the (large) song collection is still being read,
    // - the song list doesn't visually shuffle as new entries
    //   land,
    // - and the user only sees the overlay until everything is
    //   ready — not a half-rendered scene behind it.
    //
    // `showSelect()` at the end of the try block re-enables the
    // scene with the freshly populated state in one shot.
    this.selectView?.setVisible(false);
    try {
      const files = await readDroppedFiles(dataTransfer, {
        onProgress: (progress) => this.applyLoadProgress(progress),
      });
      if (files.length === 0) {
        return;
      }
      const { themeFiles, songFiles } = splitDroppedSongAndThemeFiles(files);
      // eslint-disable-next-line no-console
      console.log(`[drop] received ${files.length} file(s) · theme=${themeFiles.length} · songs=${songFiles.length}`);
      const tasks: Array<Promise<unknown>> = [];
      if (themeFiles.length > 0) {
        tasks.push(this.loadTheme(themeFiles));
      }
      if (songFiles.length > 0) {
        tasks.push(this.loadSongs(songFiles));
      }
      if (tasks.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[drop] nothing to load — neither theme nor chart files matched');
        return;
      }
      await Promise.all(tasks);
      const playSkinSummary = summarizeLr2PlaySkins(this.playSkins);
      // eslint-disable-next-line no-console
      console.log(
        `[drop] loaded · songs=${this.collection.songs.length} · errors=${
          this.collection.errors.length
        } · play-skins=${playSkinSummary || 'none'} · select-skin=${this.selectSkin?.name ?? 'none'}`,
      );
      if (this.collection.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[drop] parse errors:', this.collection.errors);
      }
      // Status panel stays terse on purpose — only show "loaded"
      // when there's something to celebrate, and skip the
      // per-key-mode skin enumeration since the user can see the
      // active skin in-canvas. "0 charts loaded" is suppressed so
      // a theme-only drop doesn't read like an error.
      if (this.collection.songs.length > 0) {
        this.setStatus(describeSongCollection(this.collection));
      } else if (this.selectSkin || this.resultSkin || Object.keys(this.playSkins).length > 0) {
        this.setStatus('Theme loaded');
      }
      await this.showSelect();
    } finally {
      // Always tear the overlay down — even when one of the
      // sub-loaders threw or `splitDroppedSongAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would
      // leave the UI permanently masked.
      this.hideLoadingOverlay();
    }
  }

  private async loadSongs(files: File[]): Promise<void> {
    this.setStatus('Loading songs...');
    this.collection = await this.library.loadFromFiles(files, {
      onProgress: (progress) => this.applyLoadProgress(progress),
    });
    // Suppress the "0 charts loaded" reading — that text reads
    // like a parse error to the user. The post-load status text
    // is set by `handleDrop` once both theme + songs land, so a
    // mid-flight transient is plenty.
    if (this.collection.songs.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    }
  }

  private async loadTheme(files: File[]): Promise<void> {
    this.setStatus('Loading LR2 theme...');
    const loadedTheme = await loadLr2ThemeSkinsFromFiles(files, {
      onProgress: (progress) => this.applyLoadProgress(progress),
    });
    for (const variant of Object.keys(this.playSkins) as Lr2PlayVariant[]) {
      delete this.playSkins[variant];
    }
    Object.assign(this.playSkins, loadedTheme.playSkins);
    this.selectSkin = loadedTheme.selectSkin;
    this.resultSkin = loadedTheme.resultSkin;
    this.selectBgmBytes = loadedTheme.selectBgm?.bytes;
    this.decideBgmBytes = loadedTheme.decideBgm?.bytes;
    this.systemSoundBundle = {
      cursorMove: loadedTheme.systemSounds.cursorMove?.bytes,
      folderOpen: loadedTheme.systemSounds.folderOpen?.bytes,
      folderClose: loadedTheme.systemSounds.folderClose?.bytes,
    };
    // BGM / decide / system-sound bytes are stashed on the host
    // here, but NOT pushed onto the live select view yet — that
    // happens in `showSelect()` once every load task has resolved.
    // Otherwise the small theme bundle would land first and start
    // BGM playing before the larger song collection has even
    // finished parsing, which felt jarring with a loading
    // overlay still on screen.
    //
    // We deliberately don't paint a per-skin "Play: 7K=… / 14K=…"
    // status here. The skin is observable in-canvas the moment
    // the user enters song-select; spelling it out in the toolbar
    // status panel was redundant and made the toolbar wider than
    // it needed to be. `handleDrop` writes a terse "Theme
    // loaded" / "N charts loaded" once everything lands.
  }

  private async showSelect(): Promise<void> {
    this.elements.shell.classList.remove('playing');
    // The `.empty` class drives the centred "Drop BMS folder…"
    // hint. Toggle it off the moment we have charts to show, and
    // back on after a wipe / failed drop so the hint comes back
    // instead of leaving the user staring at a blank canvas.
    this.elements.shell.classList.toggle('empty', this.collection.songs.length === 0);
    await this.ensureHostMounted();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.resultView?.dispose();
    this.resultView = undefined;
    if (this.selectView) {
      // Push the latest theme assets onto the view BEFORE flipping
      // it visible. Order matters — `setSelectBgm` no-ops when the
      // bytes haven't changed, so back-from-play is silent; on a
      // fresh theme drop it stops the old loop, swaps the bytes,
      // and (because we're still hidden) defers the actual
      // `start()` until `setVisible(true)` lands a moment later.
      // Doing it the other way round would briefly start the
      // prior theme's BGM during the visibility flip.
      this.selectView.setSkin(this.selectSkin);
      this.selectView.setSelectBgm(this.selectBgmBytes);
      this.selectView.setDecideBgm(this.decideBgmBytes);
      this.selectView.setSystemSounds(this.systemSoundBundle);
      this.selectView.setCollection(this.collection);
      this.selectView.setVisible(true);
      if (this.lastSelectNavigation) {
        this.selectView.setNavigation(this.lastSelectNavigation);
      }
      return;
    }
    this.selectView = new PixiSongSelectView({
      skin: this.selectSkin,
      selectBgm: this.selectBgmBytes,
      decideBgm: this.decideBgmBytes,
      systemSounds: this.systemSoundBundle,
      initialNavigation: this.lastSelectNavigation,
      onSongSelected: (song) => {
        // Fire the decide cue first — it plays through the
        // select view's AudioContext which keeps running even
        // after the view is hidden, so the cue isn't cut by the
        // gameplay mount.
        void this.selectView?.playDecideSound();
        void this.playSong(song);
      },
      onSongAutoPlay: (song) => {
        // The skin's AUTOPLAY button forces the auto flag on for
        // this session regardless of the toolbar checkbox state.
        // We DON'T mutate the checkbox here — the user might want
        // to keep it off for the next manual play.
        void this.selectView?.playDecideSound();
        void this.playSong(song, { autoPlay: true });
      },
      onSearchActivate: () => {
        this.elements.searchInput.focus();
        this.elements.searchInput.select();
      },
    });
    await this.selectView.mount(this.sceneHost);
    this.selectView.setCollection(this.collection);
  }

  private async playSong(song: BrowserSongEntry, overrides: { autoPlay?: boolean } = {}): Promise<void> {
    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.gameplayView?.dispose();
    // Refresh the recording filename base for the upcoming play —
    // each session writes to a unique file in the user's downloads
    // folder rather than overwriting the previous one.
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    const playSkin = pickLr2PlaySkin(this.playSkins, song);
    this.gameplayView = new PixiGameplayView({
      skin: playSkin,
      autoPlay: overrides.autoPlay ?? this.guiState.autoPlay,
      audioCompressor: this.guiState.compressor,
      audioCompressorMode: this.compressorMode,
      audioCompressorStages: {
        key: this.guiState.compressorKey,
        bgm: this.guiState.compressorBgm,
        master: this.guiState.compressorMaster,
      },
      onExit: () => {
        // Sequence finalize → transition. The transition methods
        // (`showSelect` / `showResult` / `playSong`) all dispose
        // the gameplay view, which closes its AudioContext and
        // tears down the bus the recorder taps. If we kicked the
        // transition off in parallel with `finalizeRecordingIfActive`,
        // `MediaRecorder.stop()` would race the dispose and lose
        // its `'stop'` event under the closed context — the user
        // would never see the auto-download. ESC / chart-end /
        // restart all converge on the same flow for that reason.
        void this.finishGameplayThen(() => this.showSelect());
      },
      onChartFinished: (result) => {
        void this.finishGameplayThen(() => this.showResult(result));
      },
      onRestart: () => {
        void this.finishGameplayThen(() => this.playSong(song));
      },
    });
    this.setStatus(`Playing: ${song.title}`);
    await this.gameplayView.mount(this.sceneHost, song, resolveSongSource(this.collection, song));
    // Consume the "user pressed Record on the select screen"
    // flag now that gameplay is mounted — `startRecording`
    // requires the gameplay AudioContext to exist, which only
    // happens after `mount`. Failing here is non-fatal: the
    // select-screen click already nudged the user that capture
    // would start; if it doesn't (codec missing / no
    // MediaRecorder), the surfaced error replaces the armed
    // status without breaking gameplay.
    if (this.autoRecordArmed) {
      this.autoRecordArmed = false;
      const controller = this.recordController;
      controller?.domElement.classList.remove('arming');
      try {
        this.gameplayView.startRecording();
        controller?.domElement.classList.add('recording');
        controller?.name('■ Stop');
        this.setStatus('Recording…');
      } catch (error) {
        controller?.name('● Record');
        // eslint-disable-next-line no-console
        console.warn('[record] auto-start failed', error);
        this.setStatus(`Recording unavailable: ${(error as Error).message}`);
      }
    }
  }

  /**
   * If a recording is active, calls {@link toggleRecording} to
   * finalise + download. Used at chart end / exit / restart so
   * the user doesn't lose footage when transitioning out of
   * gameplay.
   */
  private async finalizeRecordingIfActive(): Promise<void> {
    if (this.gameplayView?.isRecording()) {
      await this.toggleRecording();
    }
  }

  /**
   * Closes out an in-flight recording (if any) and then runs the
   * caller-supplied transition (`showSelect` / `showResult` /
   * `playSong`). Sequencing here is non-negotiable: every one of
   * those transitions disposes the gameplay view, which in turn
   * closes the AudioContext the `MediaRecorder` is tapping. Doing
   * the dispose first leaves `MediaRecorder.stop()` waiting on a
   * `'stop'` event that never fires because its source stream
   * died — the user would see the result screen pop up but never
   * get the saved WebM. Awaiting `finalizeRecordingIfActive`
   * first lets the recorder flush + download cleanly before the
   * graph it depends on goes away.
   */
  private async finishGameplayThen(transition: () => Promise<void>): Promise<void> {
    await this.finalizeRecordingIfActive();
    await transition();
  }

  private async showResult(data: PixiGameplayResultData): Promise<void> {
    await this.ensureHostMounted();
    this.resultView?.dispose();
    this.resultView = new PixiResultView({
      skin: this.resultSkin,
      collection: this.collection,
      onContinue: () => {
        void this.showSelect();
      },
    });
    await this.resultView.mount(this.sceneHost, data);
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.setStatus(`Result: ${data.song.title}`);
  }
}

new PlayerWebDemoApp({
  stage: document.querySelector<HTMLDivElement>('#stage')!,
  shell: document.querySelector<HTMLDivElement>('.shell')!,
  songInput: document.querySelector<HTMLInputElement>('#songs')!,
  searchInput: document.querySelector<HTMLInputElement>('#search')!,
  loadingOverlay: document.querySelector<HTMLDivElement>('#loading-overlay')!,
  loadingLabel: document.querySelector<HTMLDivElement>('#loading-label')!,
  loadingBarFill: document.querySelector<HTMLDivElement>('#loading-bar-fill')!,
  loadingCounter: document.querySelector<HTMLDivElement>('#loading-counter')!,
}).start();

/**
 * Human-readable labels shown alongside the loading-overlay
 * progress bar. Keyed by the `LoadProgressPhase` discriminator the
 * `player-web-core` loaders emit. The web UI is English-only, so
 * these strings stay in English even though the surrounding
 * project conversation is in Japanese.
 */
const phaseLabels: Record<LoadProgress['phase'], string> = {
  enumerating: 'Collecting files…',
  reading: 'Reading files…',
  parsing: 'Parsing charts…',
  theme: 'Loading LR2 theme…',
};

/**
 * Produces a filesystem-safe base for the auto-downloaded
 * recording filename. Strips characters that browsers / OSes
 * reject (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`),
 * collapses runs of whitespace into single spaces, and trims
 * the result to a sensible cap so an absurdly long song title
 * doesn't produce a path the OS rejects on save.
 */
function sanitizeFilenameStem(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80);
}
