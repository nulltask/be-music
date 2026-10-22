// The embed's preview player: loads the `?track=` archive, lists its charts when it has several, and plays the one
// picked in AUTO from the preview skin, with video controls. A play ends back on the list, or — for a single chart —
// on a replay button. Nothing is judged from input and nothing is recorded.

import { createAudioService, setMasterVolume, type AudioService } from '@be-music/player-browser/audio';
import {
  BrowserChartCollectionStore,
  resolveChartSource,
  type BrowserChartCollection,
} from '@be-music/player-browser/collection';
import { createPlayScene, PixiSceneHost, type PlayScene } from '@be-music/player-browser/host';
import type { LibraryChart } from '@be-music/player-scene-model';
import { defineBeMusicElements, resolveSeekTarget, type BeMusicUIEvent } from '@be-music/player-ui';
import { createPreviewSkin, type PreviewChrome, type PreviewChromeState } from './preview-skin.ts';
import type { EmbedTrack } from './track-url.ts';

/** How far ← / → seek. */
const SEEK_STEP_SECONDS = 5;

export interface PreviewAppElements {
  /** Fills the page; the full-screen target. */
  readonly root: HTMLElement;
  /** The stage the host mounts in. */
  readonly stage: HTMLElement;
  /** The select list, the play and replay buttons and messages go here, over the stage. */
  readonly overlay: HTMLElement;
}

/** The preview player of one embed page. See the module comment. */
export class PreviewApp {
  private readonly elements: PreviewAppElements;
  private readonly host = new PixiSceneHost();
  private readonly audio: AudioService = createAudioService();
  private readonly chrome: PreviewChromeController;
  private collection: BrowserChartCollection | undefined;
  /** The track's name, from its archive's file name. */
  private trackName = '';
  private scene: PlayScene | undefined;
  /** The chart the scene plays, and whether it has started (its play button was pressed, or it was picked). */
  private current: { chart: LibraryChart; started: boolean } | undefined;

  public constructor(elements: PreviewAppElements) {
    this.elements = elements;
    this.chrome = new PreviewChromeController(elements.root);
    defineBeMusicElements();
  }

  private get charts(): readonly LibraryChart[] {
    return this.collection?.charts ?? [];
  }

  /** Loads `track` and shows its list, or its single chart behind a play button. */
  public async open(track: EmbedTrack | undefined): Promise<void> {
    if (track === undefined) {
      this.showMessage('Add ?track= with the URL of a chart archive (.zip) to preview it.');
      return;
    }
    this.trackName = track.fileName.replace(/\.zip$/iu, '');
    this.showMessage('Loading track…');
    try {
      await this.host.mount(this.elements.stage);
      window.addEventListener('keydown', this.handleKey, true);
      const response = await fetch(track.fetchURL, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const file = new File([await response.arrayBuffer()], track.fileName);
      this.collection = await new BrowserChartCollectionStore().loadFromFiles([file], {
        onProgress: (progress) =>
          this.showMessage(
            progress.total > 0 ? `Loading track… ${progress.current} / ${progress.total}` : 'Loading track…',
          ),
      });
    } catch (error) {
      this.showMessage(`Could not load the track: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (this.charts.length === 0) {
      this.showMessage('The track holds no playable chart.');
    } else if (this.charts.length === 1) {
      await this.prepare(this.charts[0]!, 'play');
    } else {
      this.showSelect();
    }
  }

  private showSelect(): void {
    const list = document.createElement('be-music-preview-select');
    list.charts = this.charts;
    list.heading = this.trackName;
    list.addEventListener('activate-request', (event) => {
      const chart = this.charts[(event as BeMusicUIEvent<'activate-request'>).detail.index];
      if (chart !== undefined) void this.play(chart);
    });
    this.showOverlay(list);
  }

  /** Plays `chart` at once: picking it from the list is the gesture that lets the audio start. */
  private async play(chart: LibraryChart): Promise<void> {
    this.showOverlay(undefined);
    await this.prepare(chart, undefined);
    this.begin();
  }

  /**
   * Shows `chart`'s play loading, with the play (or replay) button over it when `button` is set: the button starts it
   * once the play is loaded.
   */
  private async prepare(chart: LibraryChart, button: 'play' | 'replay' | undefined): Promise<void> {
    await this.closeScene();
    const scene = createPlayScene(
      { family: 'built-in', skin: createPreviewSkin(this.chrome) },
      {
        chart,
        ...this.sourceOf(chart),
        settings: { autoPlay: true, layoutMode: 'standard' },
        audio: this.audio,
        host: this.host,
        on: {
          finish: () => void this.ended(scene),
          exit: () => void this.ended(scene),
          restart: () => void this.ended(scene),
        },
      },
    );
    this.scene = scene;
    this.current = { chart, started: false };
    await this.host.setScene(scene);
    let start: HTMLElement | undefined;
    if (button !== undefined) {
      start = document.createElement('be-music-preview-start');
      Object.assign(start, { mode: button, disabled: true });
      start.addEventListener('play-request', () => this.begin());
      this.showOverlay(start);
    }
    await scene.prepare();
    if (this.scene !== scene) return;
    if (start !== undefined) Object.assign(start, { disabled: false });
  }

  private sourceOf(chart: LibraryChart): { source?: ReturnType<typeof resolveChartSource> } {
    const source = this.collection === undefined ? undefined : resolveChartSource(this.collection, chart);
    return source === undefined ? {} : { source };
  }

  /** Starts the prepared play (its intro, then the chart). */
  private begin(): void {
    const current = this.current;
    if (this.scene === undefined || current === undefined || current.started) return;
    current.started = true;
    this.showOverlay(undefined);
    this.scene.start();
  }

  /** A play ended (or was left): back to the list, or to the single chart behind a replay button. */
  private async ended(scene: PlayScene): Promise<void> {
    if (this.scene !== scene) return;
    const chart = this.current?.chart;
    if (this.charts.length > 1 || chart === undefined) {
      await this.closeScene();
      this.showSelect();
      return;
    }
    await this.prepare(chart, 'replay');
  }

  private async closeScene(): Promise<void> {
    const scene = this.scene;
    this.scene = undefined;
    this.current = undefined;
    if (scene === undefined) return;
    await this.host.setScene(undefined);
    scene.dispose();
  }

  private showMessage(text: string): void {
    const message = document.createElement('p');
    message.className = 'preview-message';
    message.textContent = text;
    this.showOverlay(message);
  }

  private showOverlay(content: HTMLElement | undefined): void {
    this.elements.overlay.replaceChildren(...(content ? [content] : []));
    this.elements.overlay.hidden = content === undefined;
  }

  /**
   * The preview's shortcuts, ahead of the play's own keys: Space plays a play not started yet (a started one pauses
   * through the play itself), ← / → seek, M mutes and F toggles full screen.
   */
  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/u.test(target.tagName))
    )
      return;
    const scene = this.scene;
    const current = this.current;
    const take = (): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    switch (event.code) {
      case 'Space':
        if (scene !== undefined && current !== undefined && !current.started && !event.repeat) {
          take();
          this.begin();
        }
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (scene === undefined || !current?.started) return;
        take();
        const frame = scene.controller.getSnapshot();
        if (frame === undefined || !frame.seekable) return;
        const step = event.code === 'ArrowLeft' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
        void scene.seek(resolveSeekTarget(frame.seconds, step, frame.state.totalSeconds));
        return;
      }
      case 'KeyM': {
        take();
        const { volume, muted } = this.chrome.state();
        this.chrome.setVolume(volume, !muted);
        return;
      }
      case 'KeyF':
        take();
        this.chrome.toggleFullscreen();
        return;
    }
  };
}

/** The page's volume, mute and full-screen state, shared with the preview HUD. */
class PreviewChromeController implements PreviewChrome {
  private current: PreviewChromeState = { volume: 1, muted: false, fullscreen: false };
  private readonly listeners = new Set<() => void>();
  private readonly root: HTMLElement;

  public constructor(root: HTMLElement) {
    this.root = root;
    document.addEventListener('fullscreenchange', () =>
      this.update({ fullscreen: document.fullscreenElement !== null }),
    );
  }

  public state(): PreviewChromeState {
    return this.current;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public setVolume(volume: number, muted: boolean): void {
    const level = Math.max(0, Math.min(1, volume));
    // Unmuting at zero would stay silent: it comes back at full volume.
    const next = !muted && level === 0 ? 1 : level;
    setMasterVolume(muted ? 0 : next);
    this.update({ volume: next, muted });
  }

  public toggleFullscreen(): void {
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
    else void this.root.requestFullscreen?.().catch(() => undefined);
  }

  private update(change: Partial<PreviewChromeState>): void {
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener();
  }
}
