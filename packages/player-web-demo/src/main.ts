import {
  BrowserSongLibrary,
  PixiGameplayView,
  PixiResultView,
  PixiSceneHost,
  PixiSongSelectView,
  describeSongCollection,
  loadLr2ThemeSkinsFromFiles,
  pickLr2PlaySkin,
  readDroppedFiles,
  resolveSongSource,
  splitDroppedSongAndThemeFiles,
  summarizeLr2PlaySkins,
  type BrowserSongCollection,
  type BrowserSongEntry,
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
  <div class="shell">
    <div class="toolbar">
      <label>BMS folder / ZIP<input id="songs" type="file" webkitdirectory multiple /></label>
      <label class="autoplay"><input id="autoplay" type="checkbox" /> Auto play</label>
      <label class="autoplay"><input id="compressor" type="checkbox" checked /> Compressor</label>
      <button id="back" type="button">Song select</button>
      <span class="status" id="status">Ready</span>
    </div>
    <div class="stage" id="stage"><div class="drop">Drop BMS folder + LR2 theme together (or either one)</div></div>
  </div>
`;

interface PlayerWebDemoElements {
  stage: HTMLDivElement;
  shell: HTMLDivElement;
  status: HTMLSpanElement;
  songInput: HTMLInputElement;
  autoPlayInput: HTMLInputElement;
  compressorInput: HTMLInputElement;
  backButton: HTMLButtonElement;
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
  private selectView: PixiSongSelectView | undefined;
  private gameplayView: PixiGameplayView | undefined;
  private resultView: PixiResultView | undefined;
  private hostMounted = false;
  /**
   * Last-known cursor / folder state of the select view, captured before
   * gameplay so returning to song select restores the user's position.
   */
  private lastSelectNavigation: PixiSongSelectNavigation | undefined;

  public constructor(private readonly elements: PlayerWebDemoElements) {}

  public start(): void {
    void this.showSelect();

    this.elements.songInput.addEventListener('change', () => {
      const files = this.elements.songInput.files;
      if (!files) {
        return;
      }
      void (async () => {
        await this.loadSongs([...files]);
        await this.showSelect();
      })();
    });

    this.elements.backButton.addEventListener('click', () => {
      void this.showSelect();
    });

    this.elements.compressorInput.addEventListener('change', () => {
      this.gameplayView?.setAudioCompressor(this.elements.compressorInput.checked);
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

  private async handleDrop(dataTransfer: DataTransfer): Promise<void> {
    const files = await readDroppedFiles(dataTransfer);
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
    const parts: string[] = [];
    if (playSkinSummary) {
      parts.push(`Theme: ${playSkinSummary}`);
    }
    if (this.collection.songs.length > 0) {
      parts.push(describeSongCollection(this.collection));
    }
    if (parts.length > 0) {
      this.elements.status.textContent = parts.join('  •  ');
    }
    await this.showSelect();
  }

  private async loadSongs(files: File[]): Promise<void> {
    this.elements.status.textContent = 'Loading songs...';
    this.collection = await this.library.loadFromFiles(files);
    this.elements.status.textContent = describeSongCollection(this.collection);
  }

  private async loadTheme(files: File[]): Promise<void> {
    this.elements.status.textContent = 'Loading LR2 theme...';
    const loadedTheme = await loadLr2ThemeSkinsFromFiles(files);
    for (const variant of Object.keys(this.playSkins) as Lr2PlayVariant[]) {
      delete this.playSkins[variant];
    }
    Object.assign(this.playSkins, loadedTheme.playSkins);
    this.selectSkin = loadedTheme.selectSkin;
    this.resultSkin = loadedTheme.resultSkin;
    const parts: string[] = [];
    const playSummary = summarizeLr2PlaySkins(this.playSkins, ' / ');
    if (playSummary) {
      parts.push(`Play: ${playSummary}`);
    }
    if (this.selectSkin) parts.push(`Select: ${this.selectSkin.name}`);
    if (this.resultSkin) parts.push(`Result: ${this.resultSkin.name}`);
    this.elements.status.textContent = parts.length > 0 ? `Theme — ${parts.join(', ')}` : 'No LR2 skin found';
  }

  private async showSelect(): Promise<void> {
    this.elements.shell.classList.remove('playing');
    await this.ensureHostMounted();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.resultView?.dispose();
    this.resultView = undefined;
    if (this.selectView) {
      this.selectView.setVisible(true);
      this.selectView.setSkin(this.selectSkin);
      this.selectView.setCollection(this.collection);
      if (this.lastSelectNavigation) {
        this.selectView.setNavigation(this.lastSelectNavigation);
      }
      return;
    }
    this.selectView = new PixiSongSelectView({
      skin: this.selectSkin,
      initialNavigation: this.lastSelectNavigation,
      onSongSelected: (song) => {
        void this.playSong(song);
      },
    });
    await this.selectView.mount(this.sceneHost);
    this.selectView.setCollection(this.collection);
  }

  private async playSong(song: BrowserSongEntry): Promise<void> {
    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.gameplayView?.dispose();
    const playSkin = pickLr2PlaySkin(this.playSkins, song);
    this.gameplayView = new PixiGameplayView({
      skin: playSkin,
      autoPlay: this.elements.autoPlayInput.checked,
      audioCompressor: this.elements.compressorInput.checked,
      onExit: () => {
        void this.showSelect();
      },
      onChartFinished: (result) => {
        void this.showResult(result);
      },
      onRestart: () => {
        void this.playSong(song);
      },
    });
    this.elements.status.textContent = `Playing: ${song.title}`;
    await this.gameplayView.mount(this.sceneHost, song, resolveSongSource(this.collection, song));
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
  backButton: document.querySelector<HTMLButtonElement>('#back')!,
}).start();
