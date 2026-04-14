import { createEmptyJson } from '../../json/src/index.ts';
import { Application, Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { createGrooveGaugeState, applyGrooveGaugeJudge, isGrooveGaugeCleared, type GrooveGaugeState } from '../../player/src/core/groove-gauge.ts';
import { resolveJudgeWindowsMs, type JudgeWindowsMs } from '../../player/src/core/judge-window.ts';
import { applyJudgeToSummary, createScoreTracker, type ScoreSummary, type ScoreTracker } from '../../player/src/core/scoring.ts';
import { BrowserAudioPlayback, type BrowserAudioPreparationProgress, type BrowserAudioPreparationResult } from './browser-audio-playback.ts';
import { createBrowserInputChannelMap, createBrowserLaneBindings, type BrowserLaneBinding } from './browser-lane-input.ts';
import {
  applyFastSlowForBrowserJudge,
  isBrowserScoreTargetChannel,
  resolveBrowserJudgeFromDeltaMs,
  resolveLandmineGaugeEffect,
  type BrowserJudgeKind,
} from './browser-manual-judge.ts';
import {
  decreaseBrowserHighSpeed,
  formatBrowserHighSpeed,
  increaseBrowserHighSpeed,
  loadPersistedBrowserHighSpeed,
  persistBrowserHighSpeed,
} from './browser-high-speed.ts';
import { resolvePixiRendererResolution, syncPixiRendererDensity } from './pixi-density.ts';
import { createPixiLaneMetrics, resolveVisualLaneChannels, type PixiLaneMetrics } from './pixi-lane-layout.ts';
import { createTimingResolver } from './timing.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from './types.ts';
import { extractWebTimedNotes, type WebTimedLandmineNote, type WebTimedPlayableNote } from './web-playable-notes.ts';

const BACKGROUND_COLOR = new Color('#040507');
const PANEL_COLOR = new Color('#0a0c10');
const PANEL_EDGE_COLOR = new Color('#252a33');
const HEADER_STRIP_COLOR = new Color('#121720');
const LANE_SHELL_COLOR = new Color('#06080c');
const WHITE_KEY_LANE_COLOR = new Color('#eef2f7');
const BLACK_KEY_LANE_COLOR = new Color('#203246');
const SCRATCH_LANE_COLOR = new Color('#81262c');
const FREE_LANE_COLOR = new Color('#38465a');
const JUDGE_LINE_COLOR = new Color('#ffd166');
const JUDGE_GLOW_COLOR = new Color('#fff1a8');
const TEXT_PRIMARY_COLOR = new Color('#f8fafc');
const TEXT_SECONDARY_COLOR = new Color('#b2bfd0');
const TEXT_ACCENT_COLOR = new Color('#ffd166');
const TEXT_MUTED_COLOR = new Color('#68778d');
const LANDMINE_COLOR = new Color('#ff6b6b');
const LONG_NOTE_COLOR = new Color('#8bd3ff');
const WHITE_NOTE_COLOR = new Color('#f8fafc');
const BLACK_NOTE_COLOR = new Color('#7dd3fc');
const SCRATCH_NOTE_COLOR = new Color('#ff8a80');
const FREE_NOTE_COLOR = new Color('#cbd5e1');
const PERFECT_COLOR = new Color('#fff1a8');
const GREAT_COLOR = new Color('#8bd3ff');
const GOOD_COLOR = new Color('#98f5a7');
const BAD_COLOR = new Color('#ff9b71');
const POOR_COLOR = new Color('#ff6b6b');
const LANE_GAP = 4;
const SIDE_SPLIT_GAP = 20;
const PANEL_PADDING = 24;
const HEADER_HEIGHT = 92;
const FOOTER_HEIGHT = 56;
const KEYBED_HEIGHT = 52;
const BASE_NOTE_WINDOW_SECONDS = 2.8;
const JUDGE_FEEDBACK_DURATION_SECONDS = 0.5;

interface RuntimePlayableNote extends WebTimedPlayableNote {
  judged: boolean;
  holding: boolean;
  displayChannel: string;
}

interface RuntimeLandmineNote extends WebTimedLandmineNote {
  judged: boolean;
  displayChannel: string;
}

interface ActiveLongNoteHold {
  note: RuntimePlayableNote;
  headJudge: BrowserJudgeKind;
  displayChannel: string;
}

interface BrowserManualSummary extends ScoreSummary {
  combo: number;
  fast: number;
  slow: number;
}

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
  private readonly judgeText = new Text({
    text: '',
    style: new TextStyle({
      align: 'center',
      fill: PERFECT_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 36,
      fontWeight: '700',
      letterSpacing: 1.5,
    }),
  });
  private readonly options: PixiGameplayViewOptions;
  private mountedContainer: HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private animationFrame: number | undefined;
  private song: BrowserSongEntry | undefined;
  private audioPlayback: BrowserAudioPlayback | undefined;
  private playableNotes: RuntimePlayableNote[] = [];
  private landmineNotes: RuntimeLandmineNote[] = [];
  private measureTimes: number[] = [];
  private laneChannels: string[] = ['16', '11', '12', '13', '14', '15', '18', '19'];
  private laneBindings: BrowserLaneBinding[] = [];
  private inputChannelMap = new Map<string, string[]>();
  private keyCodeToBindings = new Map<string, BrowserLaneBinding[]>();
  private pressedDisplayChannels = new Set<string>();
  private activeLongNotesByLane = new Map<string, ActiveLongNoteHold>();
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
  private highSpeed = 1;
  private audioStatusText = 'Audio unavailable';
  private judgeWindows: JudgeWindowsMs = resolveJudgeWindowsMs(createEmptyJson('json'));
  private summary: BrowserManualSummary = createManualSummary(0);
  private scoreTracker: ScoreTracker = createScoreTracker();
  private gaugeState: GrooveGaugeState = createGrooveGaugeState(0, undefined);
  private playableExpireCursor = 0;
  private landmineExpireCursor = 0;
  private lastJudgeKind: BrowserJudgeKind | undefined;
  private judgeFeedbackUntilSeconds = 0;

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
      resolution: resolvePixiRendererResolution(),
      autoDensity: true,
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
      this.judgeText,
      this.overlayText,
    );
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.app.canvas.addEventListener('keydown', this.handleKeyDown);
    this.app.canvas.addEventListener('keyup', this.handleKeyUp);
    this.resizeObserver = new ResizeObserver(() => {
      this.syncRendererDensity();
      this.render(this.getCurrentSeconds());
    });
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
    this.app.canvas.removeEventListener('keyup', this.handleKeyUp);
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
    this.playableNotes = timedNotes.playableNotes.map((note) => ({
      ...note,
      judged: false,
      holding: false,
      displayChannel: normalizeDisplayLaneChannel(note.channel),
    }));
    this.landmineNotes = timedNotes.landmineNotes.map((note) => ({
      ...note,
      judged: false,
      displayChannel: normalizeDisplayLaneChannel(note.channel),
    }));
    this.measureTimes = timedNotes.measureTimes;
    this.durationSeconds = timedNotes.durationSeconds;
    this.laneChannels = resolveLaneChannels(this.playableNotes, this.landmineNotes);
    this.laneBindings = createBrowserLaneBindings(
      this.laneChannels,
      this.playableNotes.map((note) => note.channel),
    );
    this.inputChannelMap = createBrowserInputChannelMap(this.laneBindings);
    this.keyCodeToBindings = createKeyCodeToBindingsMap(this.laneBindings);
    this.currentBpm = this.timingResolver.bpmAtBeat(0);
    this.maxBeat = resolveMaxBeat(song.chart, this.timingResolver.beatResolver);
    this.highSpeed = loadPersistedBrowserHighSpeed();
    this.audioStatusText = 'Audio unavailable';
    this.judgeWindows = resolveJudgeWindowsMs(song.chart);
    this.summary = createManualSummary(this.playableNotes.filter((note) => isBrowserScoreTargetChannel(note.channel)).length);
    this.scoreTracker = createScoreTracker();
    this.gaugeState = createGrooveGaugeState(this.summary.total, song.chart.metadata.total);
    this.playableExpireCursor = 0;
    this.landmineExpireCursor = 0;
    this.pressedDisplayChannels.clear();
    this.activeLongNotesByLane.clear();
    this.lastJudgeKind = undefined;
    this.judgeFeedbackUntilSeconds = 0;
    this.lastRenderedSeconds = 0;
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
    if (!this.paused) {
      this.audioPlayback?.update(currentSeconds);
      this.processLongNoteEnds(currentSeconds);
      this.expireMissedObjects(currentSeconds);
      if (!this.finished && currentSeconds >= this.durationSeconds) {
        this.finishGameplay(currentSeconds);
      }
    }
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
    if (event.code === 'BracketRight' || event.code === 'PageUp' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.highSpeed = persistBrowserHighSpeed(increaseBrowserHighSpeed(this.highSpeed));
      this.render(this.getCurrentSeconds());
      return;
    }
    if (event.code === 'BracketLeft' || event.code === 'PageDown' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.highSpeed = persistBrowserHighSpeed(decreaseBrowserHighSpeed(this.highSpeed));
      this.render(this.getCurrentSeconds());
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (this.loadingAudio) {
        return;
      }
      this.togglePause();
      return;
    }

    const bindings = this.keyCodeToBindings.get(event.code);
    if (!bindings || bindings.length === 0) {
      return;
    }
    event.preventDefault();

    if (this.loadingAudio || this.paused || this.finished || event.repeat) {
      return;
    }

    const currentSeconds = this.getCurrentSeconds();
    const candidateChannels = new Set<string>();
    for (const binding of bindings) {
      this.pressedDisplayChannels.add(binding.displayChannel);
      for (const channel of binding.triggerChannels) {
        candidateChannels.add(channel);
      }
    }
    this.handleManualInput([...candidateChannels], currentSeconds);
    this.render(currentSeconds);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const bindings = this.keyCodeToBindings.get(event.code);
    if (!bindings || bindings.length === 0) {
      return;
    }
    event.preventDefault();

    const currentSeconds = this.getCurrentSeconds();
    for (const binding of bindings) {
      this.pressedDisplayChannels.delete(binding.displayChannel);
      const activeHold = this.activeLongNotesByLane.get(binding.displayChannel);
      if (!activeHold || typeof activeHold.note.endSeconds !== 'number') {
        continue;
      }
      this.activeLongNotesByLane.delete(binding.displayChannel);
      activeHold.note.holding = false;
      if (currentSeconds + this.judgeWindows.bad / 1000 >= activeHold.note.endSeconds) {
        this.finalizeHoldJudge(activeHold, activeHold.note.endSeconds);
      } else {
        this.finalizePlayableJudge(activeHold.note, 'BAD', currentSeconds);
      }
    }
    this.render(currentSeconds);
  };

  private handleManualInput(candidateChannels: ReadonlyArray<string>, nowSeconds: number): void {
    this.expireMissedObjects(nowSeconds);
    this.processLongNoteEnds(nowSeconds);

    const noteCandidate = findBestPlayableCandidate(this.playableNotes, candidateChannels, nowSeconds, this.judgeWindows.bad / 1000);
    const landmineCandidate = findBestLandmineCandidate(this.landmineNotes, candidateChannels, nowSeconds, this.judgeWindows.bad / 1000);
    const noteDelta = noteCandidate ? Math.abs(noteCandidate.seconds - nowSeconds) : Number.POSITIVE_INFINITY;
    const landmineDelta = landmineCandidate ? Math.abs(landmineCandidate.seconds - nowSeconds) : Number.POSITIVE_INFINITY;

    if (landmineCandidate && landmineDelta <= noteDelta) {
      landmineCandidate.judged = true;
      this.audioPlayback?.triggerObjectValue('00');
      const effect = resolveLandmineGaugeEffect(landmineCandidate.event);
      applyJudgeToSummary(this.summary, 'BAD', this.scoreTracker);
      this.summary.combo = this.scoreTracker.combo;
      this.gaugeState.current = clampGauge(this.gaugeState.current + effect.gaugeDelta, this.gaugeState);
      this.publishJudgeFeedback('BAD', nowSeconds);
      return;
    }

    if (!noteCandidate) {
      return;
    }

    this.audioPlayback?.triggerEvent(noteCandidate.event);
    if (!isBrowserScoreTargetChannel(noteCandidate.channel)) {
      noteCandidate.judged = true;
      noteCandidate.holding = false;
      return;
    }

    const signedDeltaMs = (nowSeconds - noteCandidate.seconds) * 1000;
    const judge = resolveBrowserJudgeFromDeltaMs(signedDeltaMs, this.judgeWindows);
    if (typeof noteCandidate.endSeconds === 'number' && noteCandidate.endSeconds > noteCandidate.seconds && judge !== 'BAD') {
      noteCandidate.holding = true;
      this.activeLongNotesByLane.set(noteCandidate.displayChannel, {
        note: noteCandidate,
        headJudge: judge,
        displayChannel: noteCandidate.displayChannel,
      });
      return;
    }

    this.finalizePlayableJudge(noteCandidate, judge, nowSeconds, signedDeltaMs);
  }

  private finalizeHoldJudge(activeHold: ActiveLongNoteHold, judgeSeconds: number): void {
    this.finalizePlayableJudge(activeHold.note, activeHold.headJudge, judgeSeconds, 0);
  }

  private finalizePlayableJudge(
    note: RuntimePlayableNote,
    judge: BrowserJudgeKind,
    judgeSeconds: number,
    signedDeltaMs = 0,
  ): void {
    if (note.judged) {
      return;
    }
    note.judged = true;
    note.holding = false;
    this.activeLongNotesByLane.delete(note.displayChannel);
    applyJudgeToSummary(this.summary, judge, this.scoreTracker);
    applyFastSlowForBrowserJudge(this.summary, judge, signedDeltaMs);
    this.summary.combo = this.scoreTracker.combo;
    applyGrooveGaugeJudge(this.gaugeState, judge);
    this.publishJudgeFeedback(judge, judgeSeconds);
  }

  private processLongNoteEnds(currentSeconds: number): void {
    for (const [displayChannel, activeHold] of this.activeLongNotesByLane.entries()) {
      if (typeof activeHold.note.endSeconds !== 'number' || currentSeconds < activeHold.note.endSeconds) {
        continue;
      }
      this.activeLongNotesByLane.delete(displayChannel);
      activeHold.note.holding = false;
      if (this.pressedDisplayChannels.has(displayChannel)) {
        this.finalizeHoldJudge(activeHold, activeHold.note.endSeconds);
      } else {
        this.finalizePlayableJudge(activeHold.note, 'BAD', activeHold.note.endSeconds);
      }
    }
  }

  private expireMissedObjects(currentSeconds: number): void {
    const badWindowSeconds = this.judgeWindows.bad / 1000;

    while (this.landmineExpireCursor < this.landmineNotes.length) {
      const note = this.landmineNotes[this.landmineExpireCursor]!;
      if (note.judged) {
        this.landmineExpireCursor += 1;
        continue;
      }
      if (currentSeconds - note.seconds <= badWindowSeconds) {
        break;
      }
      note.judged = true;
      this.landmineExpireCursor += 1;
    }

    while (this.playableExpireCursor < this.playableNotes.length) {
      const note = this.playableNotes[this.playableExpireCursor]!;
      if (note.judged || note.holding) {
        this.playableExpireCursor += 1;
        continue;
      }
      if (currentSeconds - note.seconds <= badWindowSeconds) {
        break;
      }
      if (isBrowserScoreTargetChannel(note.channel)) {
        this.finalizePlayableJudge(note, 'POOR', currentSeconds);
      } else {
        note.judged = true;
      }
      this.playableExpireCursor += 1;
    }
  }

  private finishGameplay(currentSeconds: number): void {
    this.processLongNoteEnds(currentSeconds);
    this.expireMissedObjects(currentSeconds + this.judgeWindows.bad / 1000 + 0.001);
    for (const activeHold of this.activeLongNotesByLane.values()) {
      activeHold.note.holding = false;
      if (this.pressedDisplayChannels.has(activeHold.displayChannel) && typeof activeHold.note.endSeconds === 'number') {
        this.finalizeHoldJudge(activeHold, activeHold.note.endSeconds);
      } else {
        this.finalizePlayableJudge(activeHold.note, 'BAD', currentSeconds);
      }
    }
    this.activeLongNotesByLane.clear();
    this.finished = true;
    this.paused = true;
    this.pauseStartedMs = performance.now();
    void this.audioPlayback?.pause();
  }

  private publishJudgeFeedback(judge: BrowserJudgeKind, judgeSeconds: number): void {
    this.lastJudgeKind = judge;
    this.judgeFeedbackUntilSeconds = judgeSeconds + JUDGE_FEEDBACK_DURATION_SECONDS;
  }

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
    this.syncRendererDensity();
    this.lastRenderedSeconds = Math.min(currentSeconds, this.durationSeconds);

    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const laneAreaTop = PANEL_PADDING * 2 + HEADER_HEIGHT;
    const laneAreaBottom = height - FOOTER_HEIGHT - PANEL_PADDING * 2 - KEYBED_HEIGHT;
    const laneAreaHeight = Math.max(0, laneAreaBottom - laneAreaTop);
    const judgeY = laneAreaBottom - 14;
    const laneAreaWidth = Math.max(0, width - PANEL_PADDING * 4);
    const laneMetrics = createPixiLaneMetrics(this.laneChannels, PANEL_PADDING * 2, laneAreaWidth, LANE_GAP, SIDE_SPLIT_GAP);
    const pixelsPerSecond = Math.max(90, (judgeY - laneAreaTop - 28) / (BASE_NOTE_WINDOW_SECONDS / this.highSpeed));

    this.background.clear().rect(0, 0, width, height).fill(BACKGROUND_COLOR);
    this.panel
      .clear()
      .roundRect(PANEL_PADDING, PANEL_PADDING, Math.max(0, width - PANEL_PADDING * 2), Math.max(0, height - PANEL_PADDING * 2), 24)
      .fill(PANEL_COLOR)
      .stroke({ color: PANEL_EDGE_COLOR, width: 1.5 });
    this.panel.rect(PANEL_PADDING, PANEL_PADDING, Math.max(0, width - PANEL_PADDING * 2), HEADER_HEIGHT + 20).fill({
      color: HEADER_STRIP_COLOR,
      alpha: 0.72,
    });

    this.guideLayer.clear();
    this.noteLayer.clear();

    this.headerText.position.set(PANEL_PADDING * 2, PANEL_PADDING * 2);
    this.metaText.position.set(PANEL_PADDING * 2, PANEL_PADDING * 2 + 40);
    this.footerText.position.set(PANEL_PADDING * 2, height - FOOTER_HEIGHT);
    this.footerText.text = `Space pause • Esc back • HS x${formatBrowserHighSpeed(this.highSpeed)} • [/] or PgUp/PgDn • ${formatBindingHints(this.laneBindings)} • ${this.audioStatusText}`;

    this.drawMeasures(laneAreaTop, judgeY, laneAreaWidth, currentSeconds, pixelsPerSecond);
    this.drawLanes(laneAreaTop, laneAreaHeight, judgeY, laneMetrics, laneAreaBottom);
    this.drawNotes(laneAreaTop, judgeY, laneMetrics, currentSeconds, pixelsPerSecond);
    this.updateStats(currentSeconds);

    this.judgeText.visible = !this.loadingAudio && !this.paused && !this.finished && Boolean(this.lastJudgeKind) && currentSeconds <= this.judgeFeedbackUntilSeconds;
    this.judgeText.anchor.set(0.5);
    this.judgeText.position.set(width / 2, judgeY - 84);
    if (this.lastJudgeKind) {
      this.judgeText.text = this.lastJudgeKind;
      this.judgeText.style.fill = resolveJudgeColor(this.lastJudgeKind);
    }

    this.overlayText.visible = this.loadingAudio || this.paused || this.finished;
    this.overlayText.anchor.set(0.5);
    this.overlayText.position.set(width / 2, height / 2);
    if (this.loadingAudio) {
      this.overlayText.text = 'Loading audio…';
    } else if (this.finished) {
      this.overlayText.text = `Manual play complete\nPG ${this.summary.perfect}  GR ${this.summary.great}  GD ${this.summary.good}  BD ${this.summary.bad}  PR ${this.summary.poor}\nPress Escape to return`;
    } else if (this.paused) {
      this.overlayText.text = 'Paused\nPress Space to resume';
    }
  }

  private syncRendererDensity(): void {
    if (!this.mountedContainer) {
      return;
    }
    syncPixiRendererDensity(this.app, this.mountedContainer);
  }

  private drawLanes(
    laneAreaTop: number,
    laneAreaHeight: number,
    judgeY: number,
    laneMetrics: ReadonlyArray<PixiLaneMetrics>,
    laneAreaBottom: number,
  ): void {
    this.laneLabelLayer.removeChildren().forEach((child) => child.destroy());
    for (const [index, laneMetric] of laneMetrics.entries()) {
      const x = laneMetric.x;
      const laneFill = laneFillColor(laneMetric.role);
      const keybedFill = noteColorForRole(laneMetric.role);
      const isPressed = this.pressedDisplayChannels.has(laneMetric.channel);
      const isHolding = this.activeLongNotesByLane.has(laneMetric.channel);
      const accentAlpha = isPressed || isHolding ? 0.34 : laneMetric.role === 'white' ? 0.14 : laneMetric.role === 'scratch' ? 0.22 : 0.18;
      this.guideLayer
        .roundRect(x, laneAreaTop, laneMetric.width, laneAreaHeight, 10)
        .fill({ color: LANE_SHELL_COLOR, alpha: 0.98 })
        .stroke({ color: PANEL_EDGE_COLOR, alpha: 0.9, width: 1 });
      this.guideLayer
        .roundRect(x + 2, laneAreaTop + 2, Math.max(0, laneMetric.width - 4), Math.max(0, laneAreaHeight - 4), 8)
        .fill({
          color: laneFill,
          alpha: accentAlpha,
        });
      this.guideLayer.rect(x, judgeY - 2, laneMetric.width, 6).fill(JUDGE_LINE_COLOR);
      this.guideLayer.rect(x, judgeY - 5, laneMetric.width, 2).fill({ color: JUDGE_GLOW_COLOR, alpha: 0.82 });
      this.guideLayer
        .roundRect(x, laneAreaBottom + 8, laneMetric.width, KEYBED_HEIGHT - 8, 10)
        .fill({
          color: keybedFill,
          alpha: isPressed || isHolding ? 1 : laneMetric.role === 'white' ? 0.9 : laneMetric.role === 'scratch' ? 0.8 : 0.72,
        })
        .stroke({ color: PANEL_EDGE_COLOR, alpha: 0.9, width: 1 });

      const label = new Text({
        text: formatLaneLabel(laneMetric.channel),
        style: new TextStyle({
          fill: laneMetric.role === 'scratch' ? TEXT_ACCENT_COLOR : TEXT_MUTED_COLOR,
          fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
          fontSize: 12,
          fontWeight: '600',
        }),
      });
      label.anchor.set(0.5, 0);
      label.position.set(x + laneMetric.width / 2, laneAreaTop + 10);
      this.laneLabelLayer.addChild(label);

      if (index < laneMetrics.length - 1) {
        const separatorX = x + laneMetric.width + LANE_GAP * 0.5;
        this.guideLayer.rect(separatorX, laneAreaTop + 8, 1, laneAreaHeight - 16).fill({ color: PANEL_EDGE_COLOR, alpha: 0.55 });
      }
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
    laneMetrics: ReadonlyArray<PixiLaneMetrics>,
    currentSeconds: number,
    pixelsPerSecond: number,
  ): void {
    for (const note of this.playableNotes) {
      if (note.judged) {
        continue;
      }
      const laneMetric = laneMetrics.find((lane) => lane.channel === note.displayChannel);
      if (!laneMetric) {
        continue;
      }
      const laneX = laneMetric.x;
      const y = resolveNoteY(note.seconds, currentSeconds, judgeY, pixelsPerSecond);
      const laneColor = noteColorForRole(laneMetric.role);
      if (typeof note.endSeconds === 'number' && note.endSeconds > note.seconds) {
        const endY = resolveNoteY(note.endSeconds, currentSeconds, judgeY, pixelsPerSecond);
        const topY = Math.min(y, endY);
        const bottomY = Math.max(y, endY);
        if (bottomY >= laneAreaTop && topY <= judgeY + 20) {
          this.noteLayer
            .roundRect(laneX + laneMetric.width * 0.28, topY, laneMetric.width * 0.44, Math.max(8, bottomY - topY), 8)
            .fill({ color: laneMetric.role === 'scratch' ? SCRATCH_NOTE_COLOR : LONG_NOTE_COLOR, alpha: 0.88 });
        }
      }
      if (y >= laneAreaTop - 16 && y <= judgeY + 20) {
        this.noteLayer
          .roundRect(laneX + 4, y - 10, laneMetric.width - 8, 20, 5)
          .fill({ color: laneColor, alpha: 0.98 })
          .stroke({ color: new Color('#ffffff'), alpha: laneMetric.role === 'white' ? 0.15 : 0.08, width: 1 });
      }
    }

    for (const note of this.landmineNotes) {
      if (note.judged) {
        continue;
      }
      const laneMetric = laneMetrics.find((lane) => lane.channel === note.displayChannel);
      if (!laneMetric) {
        continue;
      }
      const laneX = laneMetric.x;
      const y = resolveNoteY(note.seconds, currentSeconds, judgeY, pixelsPerSecond);
      if (y < laneAreaTop - 16 || y > judgeY + 20) {
        continue;
      }
      const centerX = laneX + laneMetric.width / 2;
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
  }

  private updateStats(currentSeconds: number): void {
    const progress = this.durationSeconds <= 0 ? 0 : Math.min(1, currentSeconds / this.durationSeconds);
    const currentBeat = progress * this.maxBeat;
    this.currentBpm = this.timingResolver.bpmAtBeat(currentBeat);
    const judgedCount = this.summary.perfect + this.summary.great + this.summary.good + this.summary.bad + this.summary.poor;
    this.statsText.text = [
      `Manual`,
      `${formatTime(currentSeconds)} / ${formatTime(this.durationSeconds)}`,
      `BPM ${formatBpm(this.currentBpm)}`,
      `HS x${formatBrowserHighSpeed(this.highSpeed)}`,
      `Gauge ${this.gaugeState.current.toFixed(2)}${isGrooveGaugeCleared(this.gaugeState) ? ' CLEAR' : ''}`,
      `Combo ${this.summary.combo}`,
      `EX ${this.summary.exScore}/${Math.max(0, this.summary.total * 2)}`,
      `Notes ${judgedCount}/${this.summary.total}`,
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

    const audioPlayback = new BrowserAudioPlayback(song.chart, source, song.chartPath, {
      mode: 'manual',
    });
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
    const leadSeconds = audioPlayback.start();
    audioPlayback.update(0);
    return leadSeconds;
  }

  private handleAudioPreparationProgress(progress: BrowserAudioPreparationProgress): void {
    if (progress.totalSampleCount <= 0) {
      this.audioStatusText = 'Audio unavailable';
    } else {
      this.audioStatusText = `Audio ${progress.decodedSampleCount}/${progress.totalSampleCount}`;
    }
    if (!this.disposed) {
      this.render(this.getCurrentSeconds());
    }
  }
}

function resolveLaneChannels(
  playableNotes: ReadonlyArray<Pick<RuntimePlayableNote, 'displayChannel'>>,
  landmineNotes: ReadonlyArray<Pick<RuntimeLandmineNote, 'displayChannel'>>,
): string[] {
  const used = new Set<string>();
  for (const note of playableNotes) {
    used.add(note.displayChannel);
  }
  for (const note of landmineNotes) {
    used.add(note.displayChannel);
  }
  return resolveVisualLaneChannels([...used]);
}

function resolveNoteY(noteSeconds: number, currentSeconds: number, judgeY: number, pixelsPerSecond: number): number {
  return judgeY - (noteSeconds - currentSeconds) * pixelsPerSecond;
}

function normalizeDisplayLaneChannel(channel: string): string {
  if (channel === '17') {
    return '16';
  }
  if (channel === '27') {
    return '26';
  }
  return channel;
}

function createKeyCodeToBindingsMap(bindings: ReadonlyArray<BrowserLaneBinding>): Map<string, BrowserLaneBinding[]> {
  const keyCodeToBindings = new Map<string, BrowserLaneBinding[]>();
  for (const binding of bindings) {
    for (const keyCode of binding.keyCodes) {
      const existing = keyCodeToBindings.get(keyCode) ?? [];
      existing.push(binding);
      keyCodeToBindings.set(keyCode, existing);
    }
  }
  return keyCodeToBindings;
}

function laneFillColor(role: PixiLaneMetrics['role']): Color {
  switch (role) {
    case 'scratch':
      return SCRATCH_LANE_COLOR;
    case 'black':
      return BLACK_KEY_LANE_COLOR;
    case 'free':
      return FREE_LANE_COLOR;
    case 'white':
    default:
      return WHITE_KEY_LANE_COLOR;
  }
}

function noteColorForRole(role: PixiLaneMetrics['role']): Color {
  switch (role) {
    case 'scratch':
      return SCRATCH_NOTE_COLOR;
    case 'black':
      return BLACK_NOTE_COLOR;
    case 'free':
      return FREE_NOTE_COLOR;
    case 'white':
    default:
      return WHITE_NOTE_COLOR;
  }
}

function resolveJudgeColor(judge: BrowserJudgeKind): Color {
  switch (judge) {
    case 'PERFECT':
      return PERFECT_COLOR;
    case 'GREAT':
      return GREAT_COLOR;
    case 'GOOD':
      return GOOD_COLOR;
    case 'BAD':
      return BAD_COLOR;
    case 'POOR':
    default:
      return POOR_COLOR;
  }
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

function clampGauge(value: number, gaugeState: GrooveGaugeState): number {
  return Math.max(gaugeState.min, Math.min(gaugeState.max, value));
}

function createManualSummary(total: number): BrowserManualSummary {
  return {
    total,
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    exScore: 0,
    score: 0,
    combo: 0,
    fast: 0,
    slow: 0,
  };
}

function findBestPlayableCandidate(
  notes: ReadonlyArray<RuntimePlayableNote>,
  channels: ReadonlyArray<string>,
  nowSeconds: number,
  badWindowSeconds: number,
): RuntimePlayableNote | undefined {
  let best: RuntimePlayableNote | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    if (note.judged || note.holding || !channels.includes(note.channel)) {
      continue;
    }
    const delta = Math.abs(note.seconds - nowSeconds);
    if (delta > badWindowSeconds) {
      continue;
    }
    if (delta < bestDelta || (delta === bestDelta && note.seconds < (best?.seconds ?? Number.POSITIVE_INFINITY))) {
      best = note;
      bestDelta = delta;
    }
  }
  return best;
}

function findBestLandmineCandidate(
  notes: ReadonlyArray<RuntimeLandmineNote>,
  channels: ReadonlyArray<string>,
  nowSeconds: number,
  badWindowSeconds: number,
): RuntimeLandmineNote | undefined {
  let best: RuntimeLandmineNote | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    if (note.judged || !channels.includes(note.channel)) {
      continue;
    }
    const delta = Math.abs(note.seconds - nowSeconds);
    if (delta > badWindowSeconds) {
      continue;
    }
    if (delta < bestDelta || (delta === bestDelta && note.seconds < (best?.seconds ?? Number.POSITIVE_INFINITY))) {
      best = note;
      bestDelta = delta;
    }
  }
  return best;
}

function formatBindingHints(bindings: ReadonlyArray<BrowserLaneBinding>): string {
  const hints = bindings.map((binding) => `${binding.keyLabel}:${formatLaneLabel(binding.displayChannel)}`);
  return hints.join(' ');
}
