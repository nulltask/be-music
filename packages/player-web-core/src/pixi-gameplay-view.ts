import { createEmptyJson } from '../../json/src/index.ts';
import { Application, Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { BrowserAudioPlayback, type BrowserAudioPreparationProgress, type BrowserAudioPreparationResult } from './browser-audio-playback.ts';
import { createTimingResolver } from './timing.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from './types.ts';
import { extractWebTimedNotes, type WebTimedLandmineNote, type WebTimedPlayableNote } from './web-playable-notes.ts';

const BACKGROUND_COLOR = new Color('#030b16');
const PANEL_COLOR = new Color('#091625');
const PANEL_EDGE_COLOR = new Color('#17314b');
const JUDGE_LINE_COLOR = new Color('#7dd3fc');
const TEXT_PRIMARY_COLOR = new Color('#f3f7ff');
const TEXT_SECONDARY_COLOR = new Color('#8ba3bb');
const TEXT_MUTED_COLOR = new Color('#5c738b');
const LANDMINE_COLOR = new Color('#ff6b6b');
const LONG_NOTE_COLOR = new Color('#4ade80');
const LANE_GAP = 10;
const PANEL_PADDING = 24;
const HEADER_HEIGHT = 84;
const FOOTER_HEIGHT = 48;
const NOTE_WINDOW_SECONDS = 2.8;

const LANE_ORDER = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '23', '24', '25', '26', '27', '28', '29'] as const;

export interface PixiGameplayViewOptions {
  onExit?: () => void;
}

export class PixiGameplayView {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly background = new Graphics();
  private readonly panel = new Graphics();
  private readonly guideLayer = new Graphics();
  private readonly noteLayer = new Graphics();
  private readonly laneLabelLayer = new Container();
  private readonly headerText = new Text({
    text: '',
    style: new TextStyle({
      fill: TEXT_PRIMARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 28,
      fontWeight: '600',
    }),
  });
  private readonly metaText = new Text({
    text: '',
    style: new TextStyle({
      fill: TEXT_SECONDARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 14,
    }),
  });
  private readonly statsText = new Text({
    text: '',
    style: new TextStyle({
      fill: TEXT_SECONDARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 14,
    }),
  });
  private readonly footerText = new Text({
    text: 'Space pause • Escape back',
    style: new TextStyle({
      fill: TEXT_MUTED_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 13,
    }),
  });
  private readonly overlayText = new Text({
    text: '',
    style: new TextStyle({
      align: 'center',
      fill: TEXT_PRIMARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 24,
      fontWeight: '600',
    }),
  });
  private readonly options: PixiGameplayViewOptions;
  private mountedContainer: HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private animationFrame: number | undefined;
  private song: BrowserSongEntry | undefined;
  private audioPlayback: BrowserAudioPlayback | undefined;
  private playableNotes: WebTimedPlayableNote[] = [];
  private landmineNotes: WebTimedLandmineNote[] = [];
  private measureTimes: number[] = [];
  private laneChannels: string[] = ['11', '12', '13', '14', '15', '16', '18', '19'];
  private durationSeconds = 0;
  private timingResolver = createTimingResolver(createEmptyJson('json'));
  private maxBeat = 0;
  private startTimestampMs = 0;
  private pauseStartedMs = 0;
  private pausedAccumulatedMs = 0;
  private paused = false;
  private finished = false;
  private loadingAudio = false;
  private disposed = false;
  private lastRenderedSeconds = 0;
  private currentBpm = 0;
  private judgedCount = 0;
  private autoplayCombo = 0;
  private audioStatusText = 'Audio unavailable';

  public constructor(options: PixiGameplayViewOptions = {}) {
    this.options = options;
  }

  public async mount(container: HTMLElement, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    this.disposed = false;
    await this.app.init({
      antialias: true,
      backgroundAlpha: 0,
      eventMode: 'static',
      resizeTo: container,
    });
    this.song = song;
    this.mountedContainer = container;
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'be-music gameplay');
    container.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
    this.root.addChild(
      this.background,
      this.panel,
      this.guideLayer,
      this.noteLayer,
      this.laneLabelLayer,
      this.headerText,
      this.metaText,
      this.statsText,
      this.footerText,
      this.overlayText,
    );
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.app.canvas.addEventListener('keydown', this.handleKeyDown);
    this.resizeObserver = new ResizeObserver(() => this.render(this.getCurrentSeconds()));
    this.resizeObserver.observe(container);

    this.prepareSong(song);
    this.loadingAudio = true;
    this.paused = false;
    this.finished = false;
    this.pauseStartedMs = 0;
    this.pausedAccumulatedMs = 0;
    this.app.canvas.focus();
    this.render(0);
    const startLeadSeconds = await this.prepareAudio(song, source);
    if (this.disposed) {
      return;
    }
    this.loadingAudio = false;
    this.startTimestampMs = performance.now() + startLeadSeconds * 1000;
    this.render(0);
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
    this.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.app.canvas.removeEventListener('keydown', this.handleKeyDown);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    void this.audioPlayback?.dispose();
    this.audioPlayback = undefined;
    this.app.destroy(true, { children: true });
    this.mountedContainer = undefined;
  }

  private prepareSong(song: BrowserSongEntry): void {
    const timedNotes = extractWebTimedNotes(song.chart);
    this.timingResolver = createTimingResolver(song.chart);
    this.playableNotes = timedNotes.playableNotes;
    this.landmineNotes = timedNotes.landmineNotes;
    this.measureTimes = timedNotes.measureTimes;
    this.durationSeconds = timedNotes.durationSeconds;
    this.laneChannels = resolveLaneChannels(this.playableNotes, this.landmineNotes);
    this.currentBpm = this.timingResolver.bpmAtBeat(0);
    this.maxBeat = resolveMaxBeat(song.chart, this.timingResolver.beatResolver);
    this.judgedCount = 0;
    this.autoplayCombo = 0;
    this.lastRenderedSeconds = 0;
    this.audioStatusText = 'Audio unavailable';
    this.headerText.text = song.title;
    this.metaText.text = compactMeta([
      song.artist,
      song.genre,
      song.playLevel !== undefined ? `LEVEL ${song.playLevel}` : undefined,
      song.bpm !== undefined ? `BASE BPM ${formatBpm(song.bpm)}` : undefined,
    ]);
  }

  private readonly tick = (): void => {
    const currentSeconds = this.getCurrentSeconds();
    this.render(currentSeconds);
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private getCurrentSeconds(): number {
    if (this.paused) {
      return this.lastRenderedSeconds;
    }
    const elapsedMs = performance.now() - this.startTimestampMs - this.pausedAccumulatedMs;
    return Math.max(0, elapsedMs / 1000);
  }

  private readonly handlePointerDown = (): void => {
    this.app.canvas.focus();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.options.onExit?.();
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (this.loadingAudio) {
        return;
      }
      this.togglePause();
    }
  };

  private togglePause(): void {
    if (this.finished) {
      return;
    }
    if (this.paused) {
      this.paused = false;
      this.pausedAccumulatedMs += performance.now() - this.pauseStartedMs;
      void this.audioPlayback?.resume();
      return;
    }
    this.paused = true;
    this.pauseStartedMs = performance.now();
    void this.audioPlayback?.pause();
  }

  private render(currentSeconds: number): void {
    this.lastRenderedSeconds = Math.min(currentSeconds, this.durationSeconds);
    if (!this.finished && currentSeconds >= this.durationSeconds) {
      this.finished = true;
      this.paused = true;
      this.pauseStartedMs = performance.now();
    }

    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const laneAreaTop = PANEL_PADDING * 2 + HEADER_HEIGHT;
    const laneAreaBottom = height - FOOTER_HEIGHT - PANEL_PADDING * 2;
    const laneAreaHeight = Math.max(0, laneAreaBottom - laneAreaTop);
    const judgeY = laneAreaBottom - 18;
    const laneAreaWidth = Math.max(0, width - PANEL_PADDING * 4);
    const laneWidth = Math.max(28, (laneAreaWidth - (this.laneChannels.length - 1) * LANE_GAP) / this.laneChannels.length);
    const pixelsPerSecond = Math.max(90, (judgeY - laneAreaTop - 20) / NOTE_WINDOW_SECONDS);

    this.background.clear().rect(0, 0, width, height).fill(BACKGROUND_COLOR);
    this.panel
      .clear()
      .roundRect(PANEL_PADDING, PANEL_PADDING, Math.max(0, width - PANEL_PADDING * 2), Math.max(0, height - PANEL_PADDING * 2), 24)
      .fill(PANEL_COLOR)
      .stroke({ color: PANEL_EDGE_COLOR, width: 1.5 });

    this.guideLayer.clear();
    this.noteLayer.clear();

    this.headerText.position.set(PANEL_PADDING * 2, PANEL_PADDING * 2);
    this.metaText.position.set(PANEL_PADDING * 2, PANEL_PADDING * 2 + 40);
    this.footerText.position.set(PANEL_PADDING * 2, height - FOOTER_HEIGHT);
    this.footerText.text = `Space pause • Escape back • ${this.audioStatusText}`;

    this.drawMeasures(laneAreaTop, judgeY, laneAreaWidth, currentSeconds, pixelsPerSecond);
    this.drawLanes(laneAreaTop, laneAreaHeight, judgeY, laneWidth);
    this.drawNotes(laneAreaTop, judgeY, laneWidth, currentSeconds, pixelsPerSecond);
    this.updateStats(currentSeconds);

    this.overlayText.visible = this.loadingAudio || this.paused || this.finished;
    this.overlayText.anchor.set(0.5);
    this.overlayText.position.set(width / 2, height / 2);
    if (this.loadingAudio) {
      this.overlayText.text = 'Loading audio…';
    } else if (this.finished) {
      this.overlayText.text = 'Autoplay complete\nPress Escape to return';
    } else if (this.paused) {
      this.overlayText.text = 'Paused\nPress Space to resume';
    }
  }

  private drawLanes(laneAreaTop: number, laneAreaHeight: number, judgeY: number, laneWidth: number): void {
    this.laneLabelLayer.removeChildren().forEach((child) => child.destroy());
    for (let index = 0; index < this.laneChannels.length; index += 1) {
      const lane = this.laneChannels[index]!;
      const x = PANEL_PADDING * 2 + index * (laneWidth + LANE_GAP);
      const laneColor = laneBaseColor(index);
      this.guideLayer
        .roundRect(x, laneAreaTop, laneWidth, laneAreaHeight, 16)
        .fill({ color: laneColor, alpha: 0.18 })
        .stroke({ color: laneColor, alpha: 0.34, width: 1 });
      this.guideLayer.rect(x, judgeY, laneWidth, 4).fill(JUDGE_LINE_COLOR);

      const label = new Text({
        text: formatLaneLabel(lane),
        style: new TextStyle({
          fill: TEXT_MUTED_COLOR,
          fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
          fontSize: 12,
          fontWeight: '600',
        }),
      });
      label.anchor.set(0.5, 0);
      label.position.set(x + laneWidth / 2, laneAreaTop + 10);
      this.laneLabelLayer.addChild(label);
    }
  }

  private drawMeasures(
    laneAreaTop: number,
    judgeY: number,
    laneAreaWidth: number,
    currentSeconds: number,
    pixelsPerSecond: number,
  ): void {
    const laneStartX = PANEL_PADDING * 2;
    for (const measureSeconds of this.measureTimes) {
      const y = resolveNoteY(measureSeconds, currentSeconds, judgeY, pixelsPerSecond);
      if (y < laneAreaTop || y > judgeY + 8) {
        continue;
      }
      this.guideLayer.rect(laneStartX, y, laneAreaWidth, 1).fill({ color: TEXT_MUTED_COLOR, alpha: 0.3 });
    }
  }

  private drawNotes(
    laneAreaTop: number,
    judgeY: number,
    laneWidth: number,
    currentSeconds: number,
    pixelsPerSecond: number,
  ): void {
    let judgedCount = 0;
    let combo = 0;

    for (const note of this.playableNotes) {
      if (note.seconds <= currentSeconds) {
        judgedCount += 1;
        combo += 1;
      }
      const laneIndex = this.laneChannels.indexOf(note.channel);
      if (laneIndex < 0) {
        continue;
      }
      const laneX = PANEL_PADDING * 2 + laneIndex * (laneWidth + LANE_GAP);
      const y = resolveNoteY(note.seconds, currentSeconds, judgeY, pixelsPerSecond);
      const laneColor = laneBaseColor(laneIndex);
      if (typeof note.endSeconds === 'number' && note.endSeconds > note.seconds) {
        const endY = resolveNoteY(note.endSeconds, currentSeconds, judgeY, pixelsPerSecond);
        const topY = Math.min(y, endY);
        const bottomY = Math.max(y, endY);
        if (bottomY >= laneAreaTop && topY <= judgeY + 20) {
          this.noteLayer
            .roundRect(laneX + laneWidth * 0.22, topY, laneWidth * 0.56, Math.max(8, bottomY - topY), 12)
            .fill({ color: LONG_NOTE_COLOR, alpha: 0.8 });
        }
      }
      if (y >= laneAreaTop - 16 && y <= judgeY + 20) {
        this.noteLayer
          .roundRect(laneX + 6, y - 10, laneWidth - 12, 20, 10)
          .fill({ color: laneColor, alpha: 0.96 });
      }
    }

    for (const note of this.landmineNotes) {
      if (note.seconds <= currentSeconds) {
        combo = 0;
      }
      const laneIndex = this.laneChannels.indexOf(note.channel);
      if (laneIndex < 0) {
        continue;
      }
      const laneX = PANEL_PADDING * 2 + laneIndex * (laneWidth + LANE_GAP);
      const y = resolveNoteY(note.seconds, currentSeconds, judgeY, pixelsPerSecond);
      if (y < laneAreaTop - 16 || y > judgeY + 20) {
        continue;
      }
      const centerX = laneX + laneWidth / 2;
      this.noteLayer
        .poly([
          centerX,
          y - 12,
          centerX + 12,
          y,
          centerX,
          y + 12,
          centerX - 12,
          y,
        ])
        .fill(LANDMINE_COLOR);
    }

    this.judgedCount = judgedCount;
    this.autoplayCombo = combo;
  }

  private updateStats(currentSeconds: number): void {
    const progress = this.durationSeconds <= 0 ? 0 : Math.min(1, currentSeconds / this.durationSeconds);
    const currentBeat = progress * this.maxBeat;
    this.currentBpm = this.timingResolver.bpmAtBeat(currentBeat);
    this.statsText.text = [
      `Autoplay`,
      `${formatTime(currentSeconds)} / ${formatTime(this.durationSeconds)}`,
      `BPM ${formatBpm(this.currentBpm)}`,
      `Combo ${this.autoplayCombo}`,
      `Notes ${this.judgedCount}/${this.playableNotes.length}`,
    ].join('  •  ');
    this.statsText.position.set(PANEL_PADDING * 2, PANEL_PADDING * 2 + 60);
  }

  private async prepareAudio(song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<number> {
    await this.audioPlayback?.dispose();
    this.audioPlayback = undefined;
    if (!source) {
      this.audioStatusText = 'Audio unavailable';
      return 0;
    }

    const audioPlayback = new BrowserAudioPlayback(song.chart, source, song.chartPath);
    this.audioPlayback = audioPlayback;

    const preparation = await audioPlayback.prepare((progress) => {
      this.handleAudioPreparationProgress(progress);
    });
    if (this.disposed) {
      await audioPlayback.dispose();
      return 0;
    }

    this.audioStatusText = formatAudioPreparationResult(preparation);
    if (preparation.status !== 'ready') {
      return 0;
    }
    return audioPlayback.start();
  }

  private handleAudioPreparationProgress(progress: BrowserAudioPreparationProgress): void {
    if (progress.totalSampleCount <= 0) {
      this.audioStatusText = 'Loading audio…';
    } else {
      this.audioStatusText = `Loading audio… ${progress.decodedSampleCount}/${progress.totalSampleCount}`;
    }
    if (!this.disposed) {
      this.render(0);
    }
  }
}

function resolveLaneChannels(
  playableNotes: ReadonlyArray<WebTimedPlayableNote>,
  landmineNotes: ReadonlyArray<WebTimedLandmineNote>,
): string[] {
  const used = new Set<string>();
  for (const note of playableNotes) {
    used.add(note.channel);
  }
  for (const note of landmineNotes) {
    used.add(note.channel);
  }
  const lanes = LANE_ORDER.filter((lane) => used.has(lane));
  return lanes.length > 0 ? [...lanes] : ['11', '12', '13', '14', '15', '16', '18', '19'];
}

function resolveNoteY(noteSeconds: number, currentSeconds: number, judgeY: number, pixelsPerSecond: number): number {
  return judgeY - (noteSeconds - currentSeconds) * pixelsPerSecond;
}

function laneBaseColor(index: number): Color {
  const palette = ['#38bdf8', '#818cf8', '#c084fc', '#fb7185', '#f59e0b', '#22c55e', '#14b8a6', '#f97316', '#a3e635'];
  return new Color(palette[index % palette.length]!);
}

function compactMeta(parts: Array<string | undefined>): string {
  return parts.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' • ');
}

function formatBpm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

function formatLaneLabel(channel: string): string {
  if (channel === '16' || channel === '26') {
    return 'SC';
  }
  return channel;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remain = safeSeconds % 60;
  return `${minutes}:${String(remain).padStart(2, '0')}`;
}

function formatAudioPreparationResult(result: BrowserAudioPreparationResult): string {
  if (result.status === 'unsupported') {
    return 'Audio unsupported';
  }
  if (result.scheduledTriggerCount === 0) {
    return 'Audio unavailable';
  }
  const details: string[] = [`Audio ${result.decodedSampleCount}/${result.totalSampleCount}`];
  if (result.missingSampleCount > 0) {
    details.push(`missing ${result.missingSampleCount}`);
  }
  if (result.failedDecodeCount > 0) {
    details.push(`failed ${result.failedDecodeCount}`);
  }
  return details.join(' • ');
}

function resolveMaxBeat(song: BrowserSongEntry['chart'], beatResolver: ReturnType<typeof createTimingResolver>['beatResolver']): number {
  let maxMeasure = 0;
  for (const event of song.events) {
    maxMeasure = Math.max(maxMeasure, event.measure);
  }
  for (const measure of song.measures) {
    maxMeasure = Math.max(maxMeasure, measure.index);
  }
  return beatResolver.measureToBeat(maxMeasure + 1, 0);
}
