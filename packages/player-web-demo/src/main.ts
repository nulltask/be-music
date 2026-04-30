import {
  BrowserSongLibrary,
  PixiGameplayView,
  PixiResultView,
  PixiSceneHost,
  PixiSongSelectView,
  describeSongCollection,
  downloadBlob,
  loadLr2ThemeSkinsFromFiles,
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
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = `
  <div class="shell empty">
    <div class="toolbar">
      <label>BMS folder / ZIP<input id="songs" type="file" webkitdirectory multiple /></label>
      <label class="autoplay"><input id="autoplay" type="checkbox" /> Auto play</label>
      <label class="autoplay"><input id="compressor" type="checkbox" /> Compressor</label>
      <span class="comp-stages" id="comp-stages">
        <label class="autoplay"><input id="comp-key" type="checkbox" checked /> Key</label>
        <label class="autoplay"><input id="comp-bgm" type="checkbox" checked /> BGM</label>
        <label class="autoplay"><input id="comp-master" type="checkbox" checked /> Master</label>
      </span>
      <button id="record" class="record" type="button">● Record</button>
      <button id="back" type="button">Song select</button>
      <span class="status" id="status">Ready</span>
    </div>
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
  status: HTMLSpanElement;
  songInput: HTMLInputElement;
  autoPlayInput: HTMLInputElement;
  compressorInput: HTMLInputElement;
  /**
   * Container for the per-stage compressor toggles (`Key` / `BGM`
   * / `Master`). Hidden via a CSS class when the active compressor
   * mode is `'legacy'` (single-comp architecture has no per-stage
   * concept) or `'off'` (every stage is bypassed wholesale, so
   * showing per-stage toggles would be misleading).
   */
  compStages: HTMLSpanElement;
  compKeyInput: HTMLInputElement;
  compBgmInput: HTMLInputElement;
  compMasterInput: HTMLInputElement;
  backButton: HTMLButtonElement;
  /**
   * Floating DOM `<input>` overlay positioned near the LR2 default
   * skin's search-text rect. Focus is given to it when the user
   * clicks the skin's `#SRC_TEXT,st=30,edit=1` region or hits the
   * `/` shortcut; typing into it filters the song list via
   * `PixiSongSelectView.setSearchQuery`.
   */
  searchInput: HTMLInputElement;
  /**
   * Toggle button that flips the gameplay view's recorder on /
   * off. Active state is reflected with a `.recording` class
   * (red glow) so the user can tell they're capturing. Only
   * meaningful while a chart is playing — the click handler
   * silently no-ops when no gameplay view is mounted.
   */
  recordButton: HTMLButtonElement;
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
  public constructor(private readonly elements: PlayerWebDemoElements) {
    // Pick up the `?compressor=split|legacy|off` URL flag once at
    // boot. We resolve it through `parseCompressorMode` (the same
    // helper exported from `audio-bus.ts`) so the recognised values
    // stay synced with the runtime API. Unrecognised / missing flag
    // → fall through to defaults: architecture `'split'`, checkbox
    // unchecked (compressor off).
    //
    // `?compressor=split|legacy` is an explicit opt-in to that
    // architecture and implies compression should be ON, so the
    // checkbox is checked too. `?compressor=off` is redundant with
    // the new default (checkbox starts unchecked) but kept as an
    // explicit form for documentation / scripted launches.
    const flag: CompressorMode | undefined = parseCompressorMode(
      new URL(window.location.href).searchParams.get('compressor'),
    );
    if (flag === 'split' || flag === 'legacy') {
      this.compressorMode = flag;
      this.elements.compressorInput.checked = true;
    } else if (flag === 'off') {
      this.elements.compressorInput.checked = false;
    }
  }

  public start(): void {
    void this.showSelect();

    this.elements.songInput.addEventListener('change', () => {
      const files = this.elements.songInput.files;
      if (!files) {
        return;
      }
      void (async () => {
        // Browser file-picker drops go through the same loading
        // overlay as drag-drop so a folder picked via the toolbar
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

    this.elements.backButton.addEventListener('click', () => {
      void this.showSelect();
    });

    this.elements.compressorInput.addEventListener('change', () => {
      this.gameplayView?.setAudioCompressor(this.elements.compressorInput.checked);
      this.refreshCompressorStageVisibility();
    });
    this.elements.compKeyInput.addEventListener('change', () => {
      this.gameplayView?.setAudioCompressorStageEnabled('key', this.elements.compKeyInput.checked);
    });
    this.elements.compBgmInput.addEventListener('change', () => {
      this.gameplayView?.setAudioCompressorStageEnabled('bgm', this.elements.compBgmInput.checked);
    });
    this.elements.compMasterInput.addEventListener('change', () => {
      this.gameplayView?.setAudioCompressorStageEnabled('master', this.elements.compMasterInput.checked);
    });
    this.refreshCompressorStageVisibility();

    // Record toggle: starts the gameplay recorder while a chart
    // is playing, stops + downloads the WebM blob on a second
    // click. Silently no-ops when no gameplay view exists.
    this.elements.recordButton.addEventListener('click', () => {
      void this.toggleRecording();
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
   * Hide the per-stage `Key` / `BGM` / `Master` checkboxes when
   * they don't apply to the current state:
   *
   * - Compressor checkbox unchecked → bus is in `'off'` mode, every
   *   stage is bypassed already.
   * - `?compressor=legacy` → the legacy architecture has just one
   *   compressor; per-stage toggles don't map onto it.
   *
   * The CSS class drives `display: none` on the container so the
   * toolbar reflows around the missing element.
   */
  private refreshCompressorStageVisibility(): void {
    const visible = this.elements.compressorInput.checked && this.compressorMode === 'split';
    this.elements.compStages.classList.toggle('hidden', !visible);
  }

  /**
   * Flip the gameplay recorder on / off. First click during a
   * play session begins capture; second click finalizes the
   * blob and triggers a browser download as
   * `<song>.webm`. Errors (codec unavailable, no gameplay view)
   * surface to the status panel.
   */
  private async toggleRecording(): Promise<void> {
    const gameplay = this.gameplayView;
    if (!gameplay) {
      this.elements.status.textContent = 'Recording: start a chart first';
      return;
    }
    if (gameplay.isRecording()) {
      this.elements.recordButton.disabled = true;
      try {
        const result = await gameplay.stopRecording();
        if (result) {
          const filename = `${this.recordingFilenameBase}.webm`;
          downloadBlob(result.blob, filename);
          const seconds = (result.durationMs / 1000).toFixed(1);
          const sizeMb = (result.blob.size / (1024 * 1024)).toFixed(1);
          this.elements.status.textContent = `Saved ${filename} (${seconds}s, ${sizeMb} MB)`;
        }
      } finally {
        this.elements.recordButton.classList.remove('recording');
        this.elements.recordButton.textContent = '● Record';
        this.elements.recordButton.disabled = false;
      }
      return;
    }
    try {
      gameplay.startRecording();
      this.elements.recordButton.classList.add('recording');
      this.elements.recordButton.textContent = '■ Stop';
      this.elements.status.textContent = 'Recording…';
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[record] start failed', error);
      this.elements.status.textContent = `Recording unavailable: ${(error as Error).message}`;
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
        this.elements.status.textContent = describeSongCollection(this.collection);
      } else if (this.selectSkin || this.resultSkin || Object.keys(this.playSkins).length > 0) {
        this.elements.status.textContent = 'Theme loaded';
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
    this.elements.status.textContent = 'Loading songs...';
    this.collection = await this.library.loadFromFiles(files, {
      onProgress: (progress) => this.applyLoadProgress(progress),
    });
    // Suppress the "0 charts loaded" reading — that text reads
    // like a parse error to the user. The post-load status text
    // is set by `handleDrop` once both theme + songs land, so a
    // mid-flight transient is plenty.
    if (this.collection.songs.length > 0) {
      this.elements.status.textContent = describeSongCollection(this.collection);
    }
  }

  private async loadTheme(files: File[]): Promise<void> {
    this.elements.status.textContent = 'Loading LR2 theme...';
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
      autoPlay: overrides.autoPlay ?? this.elements.autoPlayInput.checked,
      audioCompressor: this.elements.compressorInput.checked,
      audioCompressorMode: this.compressorMode,
      audioCompressorStages: {
        key: this.elements.compKeyInput.checked,
        bgm: this.elements.compBgmInput.checked,
        master: this.elements.compMasterInput.checked,
      },
      onExit: () => {
        // Stop + download any in-flight recording before we
        // unmount; otherwise the chunk buffer would be discarded
        // on dispose. ESC = "I'm done with this take" semantics
        // are friendlier than silently throwing the bytes away.
        void this.finalizeRecordingIfActive();
        void this.showSelect();
      },
      onChartFinished: (result) => {
        // Same finalise-then-transition flow as the ESC path; a
        // chart that ran to completion deserves the same auto-
        // download convenience.
        void this.finalizeRecordingIfActive();
        void this.showResult(result);
      },
      onRestart: () => {
        void this.finalizeRecordingIfActive();
        void this.playSong(song);
      },
    });
    this.elements.status.textContent = `Playing: ${song.title}`;
    await this.gameplayView.mount(this.sceneHost, song, resolveSongSource(this.collection, song));
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
    this.elements.status.textContent = `Result: ${data.song.title}`;
  }
}

new PlayerWebDemoApp({
  stage: document.querySelector<HTMLDivElement>('#stage')!,
  shell: document.querySelector<HTMLDivElement>('.shell')!,
  status: document.querySelector<HTMLSpanElement>('#status')!,
  songInput: document.querySelector<HTMLInputElement>('#songs')!,
  autoPlayInput: document.querySelector<HTMLInputElement>('#autoplay')!,
  compressorInput: document.querySelector<HTMLInputElement>('#compressor')!,
  compStages: document.querySelector<HTMLSpanElement>('#comp-stages')!,
  compKeyInput: document.querySelector<HTMLInputElement>('#comp-key')!,
  compBgmInput: document.querySelector<HTMLInputElement>('#comp-bgm')!,
  compMasterInput: document.querySelector<HTMLInputElement>('#comp-master')!,
  backButton: document.querySelector<HTMLButtonElement>('#back')!,
  searchInput: document.querySelector<HTMLInputElement>('#search')!,
  recordButton: document.querySelector<HTMLButtonElement>('#record')!,
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
