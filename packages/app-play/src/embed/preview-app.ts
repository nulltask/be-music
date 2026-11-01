// The embed's preview player: loads the `?track=` archive, lists its charts when it has several, and plays the one
// picked from the preview skin, with video controls: in AUTO, or played by the viewer with `?mode=play` or the AUTO checkbox cleared. `?course=` selects an LR2 / beatoraja course file;
// staged courses advance automatically, NONSTOP courses use the shared stitching pipeline. `?chart=` naming a chart
// (`findEmbedChart`) plays it on its own, as a track of one chart does. A play ends back on the list, or — for a chart played on its own — on a
// replay button. Nothing is recorded.

import { playerText } from '../player-copy.ts';
import { createAudioService, setMasterVolume, type AudioService } from '@be-music/player-browser/audio';
import {
  BrowserChartCollectionStore,
  loadAssetBytes,
  resolveChartImageAsset,
  resolveChartSource,
  type BrowserChartCollection,
} from '@be-music/player-browser/collection';
import {
  createPlayScene,
  PixiSceneHost,
  type PlayScene,
  type PlaySceneCourse,
  type PlaySceneSettings,
} from '@be-music/player-browser/host';
import type { LibraryChart, LibraryCourse, PlayResult } from '@be-music/player-scene-model';
import type { BrowserAssetSource } from '@be-music/player-browser/collection';
import type { CourseRunStagePlan } from '@be-music/player-engine/course';
import { prepareNonstopPlay } from '../nonstop-course.ts';
import { describeUnplayableCourse, describeNonstopPrepareFailure } from '../course-flow.ts';
import { loadEmbedCourses, previewCourseOptions, PreviewCourseRun } from './course-preview.ts';
import {
  defineBeMusicElements,
  resolveSeekTarget,
  type BeMusicPreviewSelectElement,
  type BeMusicUIEvent,
} from '@be-music/player-ui';
import { basecoatTheme } from '@be-music/player-ui/themes/basecoat';
import { previewArtworkPath } from './artwork.ts';
import { findEmbedChart } from './chart-match.ts';
import { createPreviewSkin, type PreviewChrome, type PreviewChromeState } from './preview-skin.ts';
import {
  embedModeOfAutoPlay,
  embedStageTapPauses,
  embedWaitsToDownload,
  type EmbedMode,
  type EmbedTrack,
} from './track-url.ts';
import { readDeviceSignals, resolveDeviceProfile } from '../device-profile.ts';
import { describeDownload, readDownloadSize } from './download-size.ts';

/** How far ← / → seek. */
const SEEK_STEP_SECONDS = 5;

function imageType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'bmp') return 'image/bmp';
  return 'image/png';
}

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
  /** AUTO (`'preview'`), or the viewer's own play (`'play'`): `?mode=` at first, then the AUTO checkbox. */
  private mode: EmbedMode = 'preview';
  private collection: BrowserChartCollection | undefined;
  /** The track's name, from its archive's file name. */
  private trackName = '';
  private scene: PlayScene | undefined;
  /** The chart the scene plays, and whether it has started (its play button was pressed, or it was picked). */
  private current: { chart: LibraryChart; started: boolean } | undefined;
  /** The chart played on its own (`?chart=`, or a track of one chart): its play ends on a replay button. */
  private single: LibraryChart | undefined;
  private courses: readonly LibraryCourse[] | undefined;
  private singleCourse: LibraryCourse | undefined;
  private courseRun: PreviewCourseRun | undefined;
  /** Object URLs of the list's stage files and banners. Revoked when the list is built again. */
  private artworkUrls: string[] = [];

  public constructor(elements: PreviewAppElements) {
    this.elements = elements;
    this.chrome = new PreviewChromeController(elements.root);
    defineBeMusicElements(undefined, { theme: basecoatTheme });
  }

  private get charts(): readonly LibraryChart[] {
    return this.collection?.charts ?? [];
  }

  /** Loads `track` and shows its list, or its single chart behind a play button. */
  public async open(track: EmbedTrack | undefined): Promise<void> {
    if (track === undefined) {
      this.showMessage(playerText().embed.needTrack);
      return;
    }
    this.mode = track.mode;
    this.trackName = track.fileName.replace(/\.zip$/iu, '');
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (embedWaitsToDownload(resolveDeviceProfile(readDeviceSignals()), saveData)) await this.waitForLoad(track);
    const progress = new LoadingProgress();
    this.showOverlay(progress.element);
    try {
      await this.host.mount(this.elements.stage);
      window.addEventListener('keydown', this.handleKey, true);
      const bytes = await downloadTrack(track.fetchURL, (loaded, total) => progress.downloading(loaded, total));
      const file = new File([bytes], track.fileName);
      progress.reading(0, 0);
      this.collection = await new BrowserChartCollectionStore().loadFromFiles([file], {
        onProgress: ({ current, total }) => progress.reading(current, total),
      });
    } catch (error) {
      this.showMessage(playerText().embed.loadFailed(error instanceof Error ? error.message : String(error)));
      return;
    }
    const coursePath = track.course;
    if (coursePath !== undefined) {
      await this.tryPlay(async () => {
        this.courses = await loadEmbedCourses(this.collection!, coursePath);
        if (track.courseName !== undefined) {
          const namedCourse = this.courses.find((course) => course.definition.name === track.courseName);
          if (namedCourse === undefined) throw new Error(`Course not found: ${track.courseName}`);
          this.singleCourse = namedCourse;
        } else if (this.courses.length === 1) this.singleCourse = this.courses[0];
        if (this.singleCourse !== undefined) await this.startCourse(this.singleCourse, 'play');
        else this.showSelect();
      });
      return;
    }
    const named = track.chart === undefined ? undefined : findEmbedChart(this.charts, track.chart);
    this.single = named ?? (this.charts.length === 1 ? this.charts[0] : undefined);
    if (this.single !== undefined) {
      await this.prepare(this.single, 'play');
    } else if (this.charts.length === 0) {
      this.showMessage(playerText().embed.noChart);
    } else {
      this.showSelect();
    }
  }

  /**
   * Shows the Load button with the track's file name, and its size once a HEAD request tells it, and resolves once the
   * button is pressed.
   */
  private waitForLoad(track: EmbedTrack): Promise<void> {
    const load = document.createElement('be-music-preview-start');
    Object.assign(load, { mode: 'load', caption: describeDownload(track.fileName, undefined) });
    this.showOverlay(load);
    void fetch(track.fetchURL, { method: 'HEAD', redirect: 'follow' })
      .then((response) => {
        if (response.ok) load.caption = describeDownload(track.fileName, readDownloadSize(response.headers));
      })
      .catch(() => undefined);
    return new Promise((resolve) => load.addEventListener('play-request', () => resolve(), { once: true }));
  }

  private showSelect(): void {
    this.revokeArtwork();
    const list = document.createElement('be-music-preview-select');
    this.courseRun = undefined;
    list.charts = this.courses === undefined ? this.charts : [];
    list.courses = this.courses;
    list.heading = this.trackName;
    list.autoPlay = this.mode === 'preview';
    list.addEventListener('auto-play-change', (event) => {
      this.mode = embedModeOfAutoPlay((event as BeMusicUIEvent<'auto-play-change'>).detail.autoPlay);
    });
    const images = new Map<string, string>();
    list.images = images;
    list.addEventListener('activate-request', (event) => {
      const index = (event as BeMusicUIEvent<'activate-request'>).detail.index;
      if (this.courses !== undefined) {
        const course = this.courses[index];
        if (course !== undefined) void this.tryPlay(() => this.startCourse(course));
      } else {
        const chart = this.charts[index];
        if (chart !== undefined) void this.tryPlay(() => this.play(chart));
      }
    });
    this.showOverlay(list);
    if (this.courses === undefined) void this.fillArtwork(list, images);
  }

  /** Loads each chart's `#STAGEFILE`, or its `#BANNER`, and puts the picture on its row. */
  private async fillArtwork(list: BeMusicPreviewSelectElement, images: Map<string, string>): Promise<void> {
    const collection = this.collection;
    if (collection === undefined) return;
    for (const chart of this.charts) {
      if (this.elements.overlay.firstElementChild !== list) return;
      const path = previewArtworkPath(chart);
      const source = path === undefined ? undefined : resolveChartSource(collection, chart);
      if (path === undefined || source === undefined) continue;
      const bytes = await loadAssetBytes(resolveChartImageAsset(source, chart.chartPath, path));
      if (this.elements.overlay.firstElementChild !== list || bytes === undefined) continue;
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type: imageType(path) }));
      this.artworkUrls.push(url);
      images.set(chart.id, url);
      list.images = new Map(images);
    }
  }

  private revokeArtwork(): void {
    for (const url of this.artworkUrls) URL.revokeObjectURL(url);
    this.artworkUrls = [];
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
  private async prepare(
    chart: LibraryChart,
    button: 'play' | 'replay' | undefined,
    overrides: { source?: BrowserAssetSource; course?: PlaySceneCourse; settings?: PlaySceneSettings } = {},
  ): Promise<void> {
    await this.closeScene();
    const scene = createPlayScene(
      {
        family: 'built-in',
        skin: createPreviewSkin(this.chrome, { stageTapPauses: embedStageTapPauses(this.mode) }),
      },
      {
        chart,
        ...this.sourceOf(chart),
        ...overrides,
        settings: { ...overrides.settings, autoPlay: this.mode === 'preview', layoutMode: 'standard' },
        audio: this.audio,
        host: this.host,
        on: {
          finish: (result) => void this.tryPlay(() => this.ended(scene, result)),
          exit: () => void this.tryPlay(() => this.ended(scene)),
          restart: () => void this.tryPlay(() => this.ended(scene)),
        },
      },
    );
    this.scene = scene;
    this.current = { chart, started: false };
    await this.host.setScene(scene);
    let start: HTMLElement | undefined;
    if (button !== undefined) {
      start = document.createElement('be-music-preview-start');
      Object.assign(start, { mode: button, disabled: true, autoPlay: this.mode === 'preview' });
      start.addEventListener('play-request', () => this.begin());
      // The scene was made for the other mode: make it again, behind the same button.
      start.addEventListener('auto-play-change', (event) => {
        this.mode = embedModeOfAutoPlay((event as BeMusicUIEvent<'auto-play-change'>).detail.autoPlay);
        void this.tryPlay(() => this.prepare(chart, button, overrides));
      });
      this.showOverlay(start);
    }
    await scene.prepare();
    if (this.scene !== scene) return;
    if (start !== undefined) Object.assign(start, { disabled: false });
  }

  /** Prepares a course from its first stage; its Replay button also starts from the first stage. */
  private async startCourse(course: LibraryCourse, button?: 'play' | 'replay'): Promise<void> {
    if (!course.playable) throw new Error(describeUnplayableCourse(course));
    this.showOverlay(undefined);
    this.courseRun = undefined;
    if (course.definition.kind === 'nonstop') {
      const result = prepareNonstopPlay(course, {
        sourceOf: (chart) => this.sourceOf(chart).source,
      });
      if (!result.ok) throw new Error(describeNonstopPrepareFailure(course.definition.name, result));
      const { chart, source, stitched } = result.prepared;
      const options = previewCourseOptions(course);
      await this.prepare(chart, button, {
        ...options,
        source,
        settings: { ...options.settings, nonstop: stitched.map },
      });
    } else {
      this.courseRun = new PreviewCourseRun(course);
      const plan = this.courseRun.next();
      if (plan === undefined) throw new Error(playerText().embed.noStage);
      await this.prepareCourseStage(plan, button);
    }
    if (button === undefined) this.begin();
  }

  private async prepareCourseStage(plan: CourseRunStagePlan<LibraryChart>, button?: 'play' | 'replay'): Promise<void> {
    const options = previewCourseOptions(this.courseRun!.course, plan);
    await this.prepare(plan.stage, button, options);
  }

  private async tryPlay(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      await this.closeScene();
      this.showMessage(error instanceof Error ? error.message : String(error));
    }
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
  private async ended(scene: PlayScene, result?: PlayResult): Promise<void> {
    if (this.scene !== scene) return;
    if (this.courses !== undefined) {
      const next = result === undefined ? undefined : this.courseRun?.finish(result);
      if (next !== undefined) {
        await this.prepareCourseStage(next);
        this.begin();
      } else if (this.singleCourse !== undefined) {
        await this.startCourse(this.singleCourse, 'replay');
      } else {
        await this.closeScene();
        this.showSelect();
      }
      return;
    }
    const chart = this.current?.chart;
    if (chart === undefined || chart !== this.single) {
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
    message.className = 'preview-message text-muted-foreground text-sm';
    message.textContent = text;
    this.showOverlay(message);
  }

  private showOverlay(content: HTMLElement | undefined): void {
    this.elements.overlay.replaceChildren(...(content ? [content] : []));
    this.elements.overlay.hidden = content === undefined;
  }

  /**
   * The preview's shortcuts, ahead of the play's own keys: Space plays a play not started yet (a started one pauses
   * through the play itself), ← / → seek, M mutes and F toggles full screen. While the viewer plays (`?mode=play`), M and F
   * are lanes, so they go to the play.
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
        if (this.playsLanes(current)) return;
        take();
        const { volume, muted } = this.chrome.state();
        this.chrome.setVolume(volume, !muted);
        return;
      }
      case 'KeyF':
        if (this.playsLanes(current)) return;
        take();
        this.chrome.toggleFullscreen();
        return;
    }
  };

  /** The viewer is playing `current` by hand: the letter keys are its lanes. */
  private playsLanes(current: { started: boolean } | undefined): boolean {
    return this.mode === 'play' && current?.started === true;
  }
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

/**
 * Fetches the track archive, reporting the bytes received (`total` is 0 when the response gives no length, or when it
 * is compressed in transit and the length counts the compressed bytes).
 */
async function downloadTrack(url: string, onProgress: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const encoded = (response.headers.get('content-encoding') ?? 'identity') !== 'identity';
  const length = Number(response.headers.get('content-length'));
  const total = !encoded && Number.isFinite(length) && length > 0 ? length : 0;
  if (response.body === null) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** The track's loading state over the stage: what is happening, and a bar that fills as it goes. */
class LoadingProgress {
  public readonly element: HTMLElement;
  private readonly label: HTMLElement;
  private readonly bar: HTMLProgressElement;

  public constructor() {
    this.element = document.createElement('div');
    this.element.className = 'card preview-loading gap-2 p-4';
    this.label = document.createElement('p');
    this.label.className = 'text-muted-foreground text-sm';
    this.bar = document.createElement('progress');
    this.bar.className = 'progress';
    this.bar.setAttribute('aria-label', playerText().embed.loadingTrack);
    this.element.append(this.label, this.bar);
    this.downloading(0, 0);
  }

  public downloading(loaded: number, total: number): void {
    const size =
      total > 0 ? `${formatMegabytes(loaded)} / ${formatMegabytes(total)} MB` : `${formatMegabytes(loaded)} MB`;
    this.show(playerText().embed.downloading(size), loaded, total);
  }

  public reading(current: number, total: number): void {
    this.show(playerText().embed.reading(current, total), current, total);
  }

  /** An indeterminate bar while the total is unknown. */
  private show(text: string, value: number, max: number): void {
    this.label.textContent = text;
    if (max > 0) {
      this.bar.max = max;
      this.bar.value = Math.min(value, max);
    } else {
      this.bar.removeAttribute('value');
    }
  }
}

function formatMegabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}
