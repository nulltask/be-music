import { resolveBrowserSongForGameplay } from './browser-control-flow.ts';
import { createBrowserSongPreviewController, type BrowserSongPreviewController } from './browser-preview-playback.ts';
import { loadSongCollectionFromDrop, loadSongCollectionFromFiles } from './chart-library.ts';
import { PixiGameplayView } from './pixi-gameplay-view.ts';
import { PixiSongListView, type PixiSongListViewOptions } from './pixi-song-list-view.ts';
import type { BrowserSongAssetSource, BrowserSongCollection, BrowserSongEntry } from './types.ts';

export interface BrowserSongLibraryOptions extends PixiSongListViewOptions {
  onCollectionChange?: (collection: BrowserSongCollection) => void;
  onSongExit?: (song: BrowserSongEntry) => void;
}

export class BrowserSongLibrary {
  private readonly options: BrowserSongLibraryOptions;
  private listView: PixiSongListView | undefined;
  private gameplayView: PixiGameplayView | undefined;
  private mountedContainer: HTMLElement | undefined;
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  private selectedSong: BrowserSongEntry | undefined;
  private currentSong: BrowserSongEntry | undefined;
  private previewController: BrowserSongPreviewController | undefined;

  public constructor(options: BrowserSongLibraryOptions = {}) {
    this.options = options;
  }

  public async mount(container: HTMLElement): Promise<void> {
    this.mountedContainer = container;
    await this.showListView();
  }

  public setCollection(collection: BrowserSongCollection): void {
    this.collection = collection;
    this.listView?.setCollection(collection);
    this.selectedSong = resolveSelectedSong(collection, this.selectedSong?.id ?? this.currentSong?.id);
    if (this.selectedSong) {
      this.listView?.setSelectedSong(this.selectedSong.id);
    }
    this.syncPreviewFocus();
    this.options.onCollectionChange?.(collection);
  }

  public async loadFromDrop(dataTransfer: DataTransfer): Promise<BrowserSongCollection> {
    this.ensureListView().setStatus('Loading dropped source…');
    const collection = await loadSongCollectionFromDrop(dataTransfer);
    this.ensureListView().setStatus(buildStatusMessage(collection));
    this.setCollection(collection);
    this.ensureListView().focus();
    return collection;
  }

  public async loadFromFiles(files: Iterable<File>): Promise<BrowserSongCollection> {
    this.ensureListView().setStatus('Loading files…');
    const collection = await loadSongCollectionFromFiles(files);
    this.ensureListView().setStatus(buildStatusMessage(collection));
    this.setCollection(collection);
    this.ensureListView().focus();
    return collection;
  }

  public setStatus(text: string): void {
    this.ensureListView().setStatus(text);
  }

  public async startSong(song: BrowserSongEntry): Promise<void> {
    this.selectedSong = song;
    this.currentSong = song;
    this.options.onSongActivate?.(song);
    await this.showGameplayView(song);
  }

  public async exitSong(): Promise<void> {
    const currentSong = this.currentSong;
    this.currentSong = undefined;
    await this.showListView();
    if (currentSong) {
      this.options.onSongExit?.(currentSong);
    }
  }

  public dispose(): void {
    void this.previewController?.dispose();
    this.listView?.dispose();
    this.gameplayView?.dispose();
    this.listView = undefined;
    this.gameplayView = undefined;
    this.previewController = undefined;
    this.mountedContainer = undefined;
  }

  private ensureListView(): PixiSongListView {
    if (!this.listView) {
      this.listView = new PixiSongListView({
        onSongSelect: (song) => {
          this.selectedSong = song;
          this.syncPreviewFocus();
          this.options.onSongSelect?.(song);
        },
        onSongActivate: (song) => {
          void this.startSong(song);
        },
      });
    }
    return this.listView;
  }

  private async showListView(): Promise<void> {
    const container = this.requireMountedContainer();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    container.replaceChildren();
    const view = this.ensureListView();
    await view.mount(container);
    view.setCollection(this.collection);
    view.setStatus(buildStatusMessage(this.collection));
    this.selectedSong = resolveSelectedSong(this.collection, this.selectedSong?.id ?? this.currentSong?.id);
    if (this.selectedSong) {
      view.setSelectedSong(this.selectedSong.id);
    }
    view.focus();
    this.syncPreviewFocus();
  }

  private async showGameplayView(song: BrowserSongEntry): Promise<void> {
    const container = this.requireMountedContainer();
    const source = resolveSongSource(this.collection.sources, song);
    const gameplaySong = resolveBrowserSongForGameplay(song);
    this.ensurePreviewController().clear();
    this.listView?.dispose();
    this.listView = undefined;
    this.gameplayView?.dispose();
    this.gameplayView = new PixiGameplayView({
      onExit: () => {
        void this.exitSong();
      },
    });
    container.replaceChildren();
    await this.gameplayView.mount(container, gameplaySong, source);
  }

  private requireMountedContainer(): HTMLElement {
    if (!this.mountedContainer) {
      throw new Error('BrowserSongLibrary is not mounted.');
    }
    return this.mountedContainer;
  }

  private ensurePreviewController(): BrowserSongPreviewController {
    if (!this.previewController) {
      this.previewController = createBrowserSongPreviewController();
    }
    return this.previewController;
  }

  private syncPreviewFocus(): void {
    const selectedSong = this.selectedSong;
    if (!selectedSong) {
      this.ensurePreviewController().clear();
      return;
    }
    const source = resolveSongSource(this.collection.sources, selectedSong);
    this.ensurePreviewController().focus(selectedSong, source);
  }
}

function resolveSongSource(
  sources: ReadonlyArray<BrowserSongAssetSource>,
  song: BrowserSongEntry,
): BrowserSongAssetSource | undefined {
  return sources.find((source) => source.id === song.sourceId);
}

function resolveSelectedSong(
  collection: BrowserSongCollection,
  preferredSongId: string | undefined,
): BrowserSongEntry | undefined {
  if (preferredSongId) {
    const preferredSong = collection.songs.find((song) => song.id === preferredSongId);
    if (preferredSong) {
      return preferredSong;
    }
  }
  return collection.songs[0];
}

function buildStatusMessage(collection: BrowserSongCollection): string {
  if (collection.songs.length === 0) {
    return collection.errors.length > 0
      ? `No playable charts were extracted. ${collection.errors.length} parse issue(s) found.`
      : 'No playable charts were found in the dropped source.';
  }
  return `Loaded ${collection.songs.length} chart${collection.songs.length === 1 ? '' : 's'} from ${collection.sources.length} source${collection.sources.length === 1 ? '' : 's'}.`;
}
