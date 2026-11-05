import {
  firesBeforeTempoReversal,
  isInvisibleNoteChannel,
  resolveBmsWAVResources,
  resolveChart,
  usesMonophonicWAVPlayback,
  volWAVToLinearGain,
  type TimedSampleTrigger,
} from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { loadAssetBytes, resolveChartAudioAsset } from '../collection/collection.ts';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { BrowserAssetEntry, BrowserAssetSource } from '../collection/types.ts';
import { MIXER_HEADROOM_GAIN_LINEAR } from '../runtime/audio-bus.ts';

/**
 * Sample-amplitude threshold below which we treat audio as silent for the leading-silence trim. Mirrors
 * `PREVIEW_SILENCE_THRESHOLD` in `packages/player-engine`'s CLI preview module — the rendered float waveform there uses the
 * same cut-off — so the web and CLI behave identically when given the same source file.
 */
const PREVIEW_SILENCE_THRESHOLD = 0.0001;

/**
 * Focus → preview-start delay, in milliseconds. Mirrors LR2's default song-select wait — the player has to leave the
 * cursor on a bar for ~1 second before the preview kicks in, which keeps a fast scroll through the list quiet rather
 * than machine-gunning every chart's intro for 50 ms each.
 *
 * Exported as a constant rather than baked into the engine so tests / hosts can reach for the "official" value without
 * hard-coding a magic number themselves.
 */
export const LR2_PREVIEW_FOCUS_DELAY_MS = 1000;

/**
 * Hard cap on the in-place chart-playback fallback (the "no `#PREVIEW` declared" branch). LR2 itself doesn't ship this
 * fallback — it just stays silent for charts without a preview audio file — but we want the user to hear *something* so
 * they can audition the chart. 30 s gives the typical chart intro + first verse without scheduling thousands of sample
 * triggers up-front.
 */
export const DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS = 30;

/**
 * Short fade used when the focused song changes or the select scene hides. Long enough to avoid an audible hard cut,
 * short enough that rapid cursor movement still feels responsive.
 */
export const CHART_PREVIEW_STOP_FADE_OUT_SECONDS: number = 0.25;

/**
 * How long the in-place fallback (no `#PREVIEW`) fades out at the end of its window, so the preview closes like a
 * preview file instead of the chart stopping mid-phrase while its long samples ring on.
 */
export const CHART_PREVIEW_FALLBACK_FADE_OUT_SECONDS: number = 3;

/**
 * How long a window preview ({@link ChartPreviewEngine.playWindow}) rings on past its end while it fades out, so a bar
 * closes without a click but the next bar's first hit stays out.
 */
export const CHART_PREVIEW_WINDOW_FADE_OUT_SECONDS: number = 0.12;

/** A stretch of a chart to sound, in chart seconds: `[startSeconds, endSeconds)`. */
export interface ChartPreviewWindow {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface ChartPreviewTarget {
  chart: LibraryChart;
  source: BrowserAssetSource;
}

interface PreviewSourceHandle {
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** The source's resting level ({@link resolveChartPreviewLevel}), which the window-end fade starts from. */
  level: number;
  stopping: boolean;
}

export interface ChartPreviewEngineOptions {
  /**
   * Override for the focus-to-start delay. Defaults to {@link LR2_PREVIEW_FOCUS_DELAY_MS}. Lower values are useful for
   * tests / debugging; production hosts should leave this at the default to match LR2.
   */
  focusDelayMs?: number;
  /**
   * Maximum duration of the in-place chart-playback fallback used when the chart has no `#PREVIEW`. Defaults to {@link
   * DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS}.
   */
  fallbackDurationSeconds?: number;
  /**
   * Whether the `#PREVIEW`-file playback should loop. Defaults to `true` so a 5-second preview wav doesn't go silent
   * after the first pass — LR2 also loops these.
   */
  loopPreviewFile?: boolean;
  /**
   * Optional callback fired when the engine actually begins audible playback for a target (after the focus delay AND
   * the asset decode). Hosts can use this to duck the select-screen BGM, log telemetry, etc. Receives the target
   * identity that started.
   */
  onPlaybackStart?: (target: ChartPreviewTarget) => void;
  /**
   * Optional callback fired when active preview playback stops — either because the engine was asked to stop, the
   * target changed, or the looped buffer was last-source-replaced. Symmetric with {@link onPlaybackStart}.
   */
  onPlaybackStop?: () => void;
}

/**
 * Returns the chart-relative path to the preview audio that should play on song-select focus, or `undefined` when the
 * chart didn't declare one.
 *
 * Resolution priority:
 *
 * 1. `#PREVIEW <path>` (BMS) — stored in `chart.bms.preview` by the parser.
 * 2. `info.preview_music` (bmson) — stored in `chart.bmson.info.previewMusic`.
 *
 * Both are chart-relative paths handed to `resolveChartAudioAsset` unchanged; the audio loader walks the codec-fallback
 * chain (`.opus` / `.ogg` / `.mp3` / `.wav`) and case-insensitive lookup so a chart that says `preview.wav` still
 * resolves to a shipped `preview.ogg`.
 */
export function resolveChartPreviewPath(chart: BeMusicJSON): string | undefined {
  const bms = chart.bms?.preview;
  if (typeof bms === 'string' && bms.length > 0) return bms;
  const bmson = chart.bmson?.info?.previewMusic;
  if (typeof bmson === 'string' && bmson.length > 0) return bmson;
  return undefined;
}

/**
 * Drives the song-select preview audio: a single AudioContext client that schedules playback shortly after the user's
 * cursor settles on a song, and tears it back down when the cursor moves on or the scene goes away.
 *
 * Two playback modes (mirrors the user-facing requirement):
 *
 * 1. **`#PREVIEW` present** — the chart shipped a preview audio file. We resolve it through {@link
 *    resolveChartAudioAsset} (case-insensitive + codec fallback), decode once, and play it on a looped `BufferSource`.
 *
 * 2. **`#PREVIEW` absent** — fall back to playing the chart "in place": collect every AUTO PLAY-audible
 *    `TimedSampleTrigger` whose `seconds` fall inside the fallback duration window, decode just those WAVs (a small
 *    subset of the chart's full `#WAVxx` table), and schedule each as a one-shot at `audioContext.currentTime +
 *    trigger.seconds`. Stops scheduling further triggers once the user moves cursor.
 *
 * Lifecycle:
 *
 * - `focus(target)` cancels any pending / active playback, then schedules the next start on a `setTimeout` so a fast
 *   scroll past dozens of bars doesn't actually start anything.
 * - `focus(undefined)` is the explicit "stop and forget".
 * - `dispose()` is permanent; further `focus()` calls no-op.
 *
 * Race-safety is handled via a monotonic `activeSequence`: every `focus()` increments it, and every async callback
 * re-checks before mutating state. A WAV decode that returns AFTER the user moved cursor never schedules its source.
 */
export class ChartPreviewEngine {
  private readonly audioContext: AudioContext;
  private readonly output: AudioNode;
  private readonly focusDelayMs: number;
  private readonly fallbackDurationSeconds: number;
  private readonly loopPreviewFile: boolean;
  private readonly onPlaybackStart: ((target: ChartPreviewTarget) => void) | undefined;
  private readonly onPlaybackStop: (() => void) | undefined;
  private currentTarget: ChartPreviewTarget | undefined;
  /**
   * Increments on every `focus` (including `focus(undefined)` and `stop`). Async work captures the value at the moment
   * it was scheduled and bails if the field has moved on by the time it can act — that's how we keep stale decodes from
   * silently scheduling sources after the user has moved on.
   */
  private activeSequence = 0;
  private pendingFocusTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Live preview sources, including short fade-out tails from the previous focus. Tracked so a subsequent `stop()` can
   * disconnect them all in one pass — necessary because the in-place fallback typically schedules many sources at once
   * and the loopable preview-file branch keeps a single source alive across the entire focus.
   */
  private activeSources = new Set<PreviewSourceHandle>();
  /**
   * `true` once the engine has emitted `onPlaybackStart` for the current sequence and not yet emitted the matching
   * `onPlaybackStop`. Keeps the start / stop callbacks paired even when the in-place fallback's first audible sample is
   * delayed by a slow decode.
   */
  private playbackActive = false;
  private disposed = false;
  /** A window preview ({@link playWindow}) was started since the last focus, so even no focus has something to stop. */
  private windowStarted = false;
  /** The chart a window preview last sounded, with its triggers and decodes, kept for the next window of it. */
  private windowCache:
    | {
        readonly target: ChartPreviewTarget;
        readonly triggers: readonly TimedSampleTrigger[];
        readonly buffers: Map<string, Promise<AudioBuffer | undefined>>;
      }
    | undefined;

  public constructor(audioContext: AudioContext, output: AudioNode, options: ChartPreviewEngineOptions = {}) {
    this.audioContext = audioContext;
    this.output = output;
    this.focusDelayMs = Math.max(0, options.focusDelayMs ?? LR2_PREVIEW_FOCUS_DELAY_MS);
    this.fallbackDurationSeconds = Math.max(
      0,
      options.fallbackDurationSeconds ?? DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS,
    );
    this.loopPreviewFile = options.loopPreviewFile ?? true;
    this.onPlaybackStart = options.onPlaybackStart;
    this.onPlaybackStop = options.onPlaybackStop;
  }

  /**
   * Sets the focused song (or clears it). The actual audio playback won't start until the focus-settle delay elapses; a
   * fast scroll past the song therefore doesn't trigger any decode work. Pass `undefined` to stop without re-arming.
   *
   * Idempotent: focusing the same target twice in a row only arms one timer.
   */
  public focus(target: ChartPreviewTarget | undefined): void {
    if (this.disposed) return;
    if (sameTarget(this.currentTarget, target) && !this.windowStarted) {
      return;
    }
    this.windowStarted = false;
    const sequence = ++this.activeSequence;
    this.cancelPending();
    this.stopAllSources({ fade: true });
    this.emitPlaybackStop();
    this.currentTarget = target;
    if (!target) {
      return;
    }
    if (this.focusDelayMs <= 0) {
      void this.startPreview(target, sequence);
      return;
    }
    this.pendingFocusTimer = setTimeout(() => {
      this.pendingFocusTimer = undefined;
      void this.startPreview(target, sequence);
    }, this.focusDelayMs);
  }

  /**
   * Sounds `window` of `target`'s chart at once, as AUTO PLAY would play it there (a PRACTICE bar's audition): every
   * sample that starts inside the window, from the window's start, fading out just past its end. Whatever was playing
   * (the focus preview, or the previous window) fades out first, and the focus is forgotten, so focusing the chart
   * again re-arms its preview. The chart's triggers and decoded samples are kept for the next window of the same chart.
   */
  public playWindow(target: ChartPreviewTarget, window: ChartPreviewWindow): void {
    if (this.disposed) return;
    const sequence = ++this.activeSequence;
    this.cancelPending();
    this.stopAllSources({ fade: true });
    this.emitPlaybackStop();
    this.currentTarget = undefined;
    this.windowStarted = true;
    void this.playWindowNow(target, window, sequence);
  }

  /**
   * Force-stops any pending / active preview without changing the focused-target field. Use this when the host wants
   * the preview to go silent (scene hidden, song picked, etc.) but is about to call `focus(...)` again with new state.
   */
  public stop(): void {
    if (this.disposed) return;
    // Bump first so async loads/decodes already in flight cannot schedule new sources while we fade the old ones out.
    this.activeSequence += 1;
    this.cancelPending();
    this.stopAllSources({ fade: true });
    this.emitPlaybackStop();
  }

  /**
   * Permanent teardown. Stops everything, drops references, and makes subsequent `focus` / `stop` calls no-ops. Doesn't
   * close the AudioContext — the host owns that.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Bump the sequence just like `stop()` so async loads/decodes already in flight cannot resurrect playback after
    // permanent teardown.
    this.activeSequence += 1;
    this.cancelPending();
    this.stopAllSources({ fade: false });
    this.emitPlaybackStop();
    this.currentTarget = undefined;
  }

  private cancelPending(): void {
    if (this.pendingFocusTimer !== undefined) {
      clearTimeout(this.pendingFocusTimer);
      this.pendingFocusTimer = undefined;
    }
  }

  private stopAllSources(options: { fade: boolean }): void {
    const now = this.audioContext.currentTime;
    for (const handle of Array.from(this.activeSources)) {
      if (options.fade) {
        this.fadeOutSource(handle, now);
      } else {
        this.stopSourceImmediately(handle);
      }
    }
  }

  private attachSource(source: AudioBufferSourceNode, level: number): PreviewSourceHandle | undefined {
    let gain: GainNode;
    try {
      gain = this.audioContext.createGain();
      gain.gain.value = level;
      source.connect(gain);
      gain.connect(this.output);
    } catch {
      try {
        source.disconnect();
      } catch {
        // Disconnect is best-effort — failure just means there is nothing useful to tear down.
      }
      return undefined;
    }
    const handle: PreviewSourceHandle = { source, gain, level, stopping: false };
    this.activeSources.add(handle);
    return handle;
  }

  private fadeOutSource(handle: PreviewSourceHandle, now: number): void {
    if (handle.stopping) return;
    handle.stopping = true;
    const fadeEnd = now + CHART_PREVIEW_STOP_FADE_OUT_SECONDS;
    try {
      const gain = handle.gain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, fadeEnd);
      handle.source.stop(fadeEnd);
    } catch {
      this.finishSource(handle);
      return;
    }
    setTimeout(
      () => {
        if (handle.stopping) {
          this.finishSource(handle);
        }
      },
      CHART_PREVIEW_STOP_FADE_OUT_SECONDS * 1000 + 50,
    );
  }

  /** Fades `handle` out over the fallback window's last seconds and stops it at the window's end. */
  private fadeOutAtWindowEnd(handle: PreviewSourceHandle, fadeStartAt: number, endAt: number): void {
    try {
      const gain = handle.gain.gain;
      gain.setValueAtTime(handle.level, fadeStartAt);
      gain.linearRampToValueAtTime(0, endAt);
      handle.source.stop(endAt);
    } catch {
      // A context that refuses the automation keeps the source as it was: it ends with its sample.
    }
  }

  private stopSourceImmediately(handle: PreviewSourceHandle): void {
    handle.stopping = true;
    try {
      handle.source.stop();
    } catch {
      // `stop()` throws when the source hasn't started yet (a future-scheduled trigger we never reached) or has already
      // ended. Both are fine — we just want it gone.
    }
    this.finishSource(handle);
  }

  private stopSourceAt(handle: PreviewSourceHandle, stopAt: number): void {
    const scheduledStopAt = Number.isFinite(stopAt) ? Math.max(this.audioContext.currentTime, stopAt) : undefined;
    try {
      if (scheduledStopAt !== undefined) {
        handle.source.stop(scheduledStopAt);
      } else {
        handle.source.stop();
      }
    } catch {
      // Already stopped, never started, or context closed.
    }
    if (scheduledStopAt === undefined || scheduledStopAt <= this.audioContext.currentTime + 1e-6) {
      this.finishSource(handle);
    }
  }

  private finishSource(handle: PreviewSourceHandle): void {
    const wasActive = this.activeSources.delete(handle);
    try {
      handle.source.disconnect();
    } catch {
      // Disconnect is idempotent + safe to silence.
    }
    try {
      handle.gain.disconnect();
    } catch {
      // Same.
    }
    if (wasActive && this.activeSources.size === 0) {
      this.emitPlaybackStop();
    }
  }

  private emitPlaybackStart(target: ChartPreviewTarget): void {
    if (this.playbackActive) return;
    this.playbackActive = true;
    this.onPlaybackStart?.(target);
  }

  private emitPlaybackStop(): void {
    if (!this.playbackActive) return;
    this.playbackActive = false;
    this.onPlaybackStop?.();
  }

  private isStale(sequence: number): boolean {
    return this.disposed || sequence !== this.activeSequence;
  }

  private async startPreview(target: ChartPreviewTarget, sequence: number): Promise<void> {
    if (this.isStale(sequence)) return;
    const previewPath = resolveChartPreviewPath(target.chart.chart);
    if (previewPath !== undefined) {
      await this.playPreviewFile(target, previewPath, sequence);
      return;
    }
    await this.playInPlace(target, sequence);
  }

  private async decodeChartAudio(
    target: ChartPreviewTarget,
    path: string,
    sequence: number,
  ): Promise<AudioBuffer | undefined> {
    const attempted = new Set<BrowserAssetEntry>();
    while (!this.isStale(sequence)) {
      const entry = resolveChartAudioAsset(target.source, target.chart.chartPath, path, {
        pathPrefix: target.chart.chart.bms.pathWAV,
        ...(attempted.size ? { excludedEntries: attempted } : {}),
      });
      if (entry === undefined || attempted.has(entry)) return undefined;
      attempted.add(entry);
      try {
        const bytes = await loadAssetBytes(entry);
        if (this.isStale(sequence)) return undefined;
        if (!bytes) continue;
        const buffer = await this.audioContext.decodeAudioData(bytes.slice().buffer);
        return this.isStale(sequence) ? undefined : buffer;
      } catch {
        // A missing or unsupported candidate may still have a playable alternate codec.
      }
    }
    return undefined;
  }

  private async playPreviewFile(target: ChartPreviewTarget, previewPath: string, sequence: number): Promise<void> {
    const buffer = await this.decodeChartAudio(target, previewPath, sequence);
    if (!buffer) return;
    // LR2 / packages/player-engine both trim leading silence from the preview rendering so the user hears the first audible
    // sample the moment the focus delay elapses, not several hundred milliseconds of "did anything happen?" silence
    // baked into the source file. Web Audio's `start(when, offset)` is exactly the right tool: skip past the silent
    // prefix on first play, and pin the loop boundary to the same offset so every subsequent loop iteration also starts
    // at the first audible sample.
    const audibleOffsetSeconds = findFirstAudibleOffsetSeconds(buffer);
    let source: AudioBufferSourceNode;
    try {
      source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.loop = this.loopPreviewFile;
      if (this.loopPreviewFile && audibleOffsetSeconds > 0) {
        source.loopStart = audibleOffsetSeconds;
        // `loopEnd = 0` means "end of buffer", which is what we want.
      }
    } catch {
      return;
    }
    const handle = this.attachSource(source, resolveChartPreviewLevel(target.chart.chart));
    if (!handle) return;
    source.onended = (): void => {
      this.finishSource(handle);
    };
    try {
      source.start(0, audibleOffsetSeconds);
    } catch {
      this.finishSource(handle);
      return;
    }
    this.emitPlaybackStart(target);
  }

  private windowCacheFor(target: ChartPreviewTarget): NonNullable<ChartPreviewEngine['windowCache']> {
    const cached = this.windowCache;
    if (cached !== undefined && sameTarget(cached.target, target) && cached.target.chart.chart === target.chart.chart)
      return cached;
    const fresh = {
      target,
      triggers: collectChartPreviewTriggers(target.chart.chart, Number.MAX_VALUE),
      buffers: new Map<string, Promise<AudioBuffer | undefined>>(),
    };
    this.windowCache = fresh;
    return fresh;
  }

  /** Decodes a sample once per chart for the window previews; a failed decode is kept as `undefined`. */
  private decodeWindowSample(
    cache: NonNullable<ChartPreviewEngine['windowCache']>,
    path: string,
  ): Promise<AudioBuffer | undefined> {
    let decoded = cache.buffers.get(path);
    if (decoded === undefined) {
      // The decode outlives the window that asked for it: the next window of the chart reuses it.
      decoded = this.decodeChartAudioUnsequenced(cache.target, path);
      cache.buffers.set(path, decoded);
    }
    return decoded;
  }

  private async decodeChartAudioUnsequenced(
    target: ChartPreviewTarget,
    path: string,
  ): Promise<AudioBuffer | undefined> {
    if (this.disposed) return undefined;
    const attempted = new Set<BrowserAssetEntry>();
    for (;;) {
      const entry = resolveChartAudioAsset(target.source, target.chart.chartPath, path, {
        pathPrefix: target.chart.chart.bms.pathWAV,
        ...(attempted.size ? { excludedEntries: attempted } : {}),
      });
      if (entry === undefined || attempted.has(entry)) return undefined;
      attempted.add(entry);
      try {
        const bytes = await loadAssetBytes(entry);
        if (!bytes) continue;
        return await this.audioContext.decodeAudioData(bytes.slice().buffer);
      } catch {
        // A missing or unsupported candidate may still have a playable alternate codec.
      }
    }
  }

  private async playWindowNow(target: ChartPreviewTarget, window: ChartPreviewWindow, sequence: number): Promise<void> {
    const chart = target.chart.chart;
    const cache = this.windowCacheFor(target);
    const triggers = selectChartWindowTriggers(cache.triggers, window);
    if (triggers.length === 0) return;
    const wavResources = resolveBmsWAVResources(chart);
    const buffers = new Map<string, AudioBuffer>();
    await Promise.all(
      [...new Set(triggers.map((trigger) => trigger.sampleKey))].map(async (key) => {
        const path = wavResources[key];
        if (typeof path !== 'string') return;
        const buffer = await this.decodeWindowSample(cache, path);
        if (buffer) buffers.set(key, buffer);
      }),
    );
    if (this.isStale(sequence)) return;
    const startAt = this.audioContext.currentTime + 0.02;
    const span = Math.max(0, window.endSeconds - window.startSeconds);
    const { fadeStartAt, endAt } = resolvePreviewFallbackFade(
      startAt,
      span + CHART_PREVIEW_WINDOW_FADE_OUT_SECONDS,
      CHART_PREVIEW_WINDOW_FADE_OUT_SECONDS,
    );
    const level = resolveChartPreviewLevel(chart);
    let scheduledCount = 0;
    const activeBySlot = new Map<string, PreviewSourceHandle>();
    for (const trigger of triggers) {
      const activeSameSlot = activeBySlot.get(trigger.sampleKey);
      if (chart.sourceFormat === 'bmson' && trigger.event.bmson?.c === true && activeSameSlot) continue;
      const buffer = buffers.get(trigger.sampleKey);
      if (!buffer) continue;
      let source: AudioBufferSourceNode;
      try {
        source = this.audioContext.createBufferSource();
        source.buffer = buffer;
      } catch {
        continue;
      }
      const handle = this.attachSource(source, level);
      if (!handle) continue;
      const when = startAt + Math.max(0, trigger.seconds - window.startSeconds);
      source.onended = (): void => {
        if (activeBySlot.get(trigger.sampleKey) === handle) activeBySlot.delete(trigger.sampleKey);
        this.finishSource(handle);
      };
      try {
        if (usesMonophonicWAVPlayback(chart) && activeSameSlot) this.stopSourceAt(activeSameSlot, when);
        if (typeof trigger.sampleDurationSeconds === 'number')
          source.start(when, trigger.sampleOffsetSeconds ?? 0, trigger.sampleDurationSeconds);
        else source.start(when, trigger.sampleOffsetSeconds ?? 0);
        this.fadeOutAtWindowEnd(handle, fadeStartAt, endAt);
        scheduledCount += 1;
        activeBySlot.set(trigger.sampleKey, handle);
      } catch {
        this.finishSource(handle);
      }
    }
    if (scheduledCount > 0) this.emitPlaybackStart(target);
  }

  private async playInPlace(target: ChartPreviewTarget, sequence: number): Promise<void> {
    const chart = target.chart.chart;
    const triggers = collectChartPreviewTriggers(chart, this.fallbackDurationSeconds);
    if (triggers.length === 0) return;
    // Unique #WAVxx slots referenced inside the preview window — the only WAVs we need to bother decoding for this
    // preview.
    // EXWAV can declare a slot's file without #WAVxx.
    const wavResources = resolveBmsWAVResources(chart);
    const sampleKeys = new Set<string>();
    for (const trigger of triggers) {
      if (typeof wavResources[trigger.sampleKey] === 'string') {
        sampleKeys.add(trigger.sampleKey);
      }
    }
    const buffers = new Map<string, AudioBuffer>();
    await Promise.all(
      [...sampleKeys].map(async (key) => {
        if (this.isStale(sequence)) return;
        const path = wavResources[key];
        if (typeof path !== 'string') return;
        const buffer = await this.decodeChartAudio(target, path, sequence);
        if (buffer) buffers.set(key, buffer);
      }),
    );
    if (this.isStale(sequence)) return;
    // Charts often have a few seconds of silent intro (no events until measure 1+). Pinning the first DECODABLE trigger
    // to `t=0` removes that lead-in so the user hears the first hit as soon as the focus delay elapses, matching how
    // `packages/player-engine`'s CLI preview trims its rendered waveform. We pick the earliest trigger whose WAV actually
    // decoded — a missing-buffer trigger contributes no audio, so leaving its `seconds` as the anchor would just
    // re-introduce the silence we're trying to remove.
    let leadOffsetSeconds = 0;
    for (const trigger of triggers) {
      if (buffers.has(trigger.sampleKey)) {
        leadOffsetSeconds = trigger.seconds;
        break;
      }
    }
    const startAt = this.audioContext.currentTime;
    const { fadeStartAt, endAt } = resolvePreviewFallbackFade(
      startAt,
      this.fallbackDurationSeconds - leadOffsetSeconds,
      CHART_PREVIEW_FALLBACK_FADE_OUT_SECONDS,
    );
    const level = resolveChartPreviewLevel(chart);
    let scheduledCount = 0;
    const activeBySlot = new Map<string, PreviewSourceHandle>();
    for (const trigger of triggers) {
      if (this.isStale(sequence)) return;
      const activeSameSlot = activeBySlot.get(trigger.sampleKey);
      // bmson `c = true` mirrors AUTO PLAY: the event continues the previous instance of this sample slot instead of
      // retriggering a fresh attack.
      if (chart.sourceFormat === 'bmson' && trigger.event.bmson?.c === true && activeSameSlot) {
        continue;
      }
      const buffer = buffers.get(trigger.sampleKey);
      if (!buffer) continue;
      let source: AudioBufferSourceNode;
      try {
        source = this.audioContext.createBufferSource();
        source.buffer = buffer;
      } catch {
        continue;
      }
      const handle = this.attachSource(source, level);
      if (!handle) continue;
      const offset = trigger.sampleOffsetSeconds ?? 0;
      const when = startAt + Math.max(0, trigger.seconds - leadOffsetSeconds);
      source.onended = (): void => {
        if (activeBySlot.get(trigger.sampleKey) === handle) {
          activeBySlot.delete(trigger.sampleKey);
        }
        this.finishSource(handle);
      };
      try {
        if (usesMonophonicWAVPlayback(chart) && activeSameSlot) {
          this.stopSourceAt(activeSameSlot, when);
        }
        if (typeof trigger.sampleDurationSeconds === 'number') {
          source.start(when, offset, trigger.sampleDurationSeconds);
        } else {
          source.start(when, offset);
        }
        this.fadeOutAtWindowEnd(handle, fadeStartAt, endAt);
        scheduledCount += 1;
        activeBySlot.set(trigger.sampleKey, handle);
      } catch {
        // `start` rejects on negative offsets / out-of-range values that can sneak in for malformed bmson slice
        // metadata. Keep going — one bad trigger shouldn't mute the rest of the preview.
        this.finishSource(handle);
      }
    }
    if (scheduledCount > 0) {
      this.emitPlaybackStart(target);
    }
  }
}

/**
 * Pure helper: pulls every AUTO PLAY-audible sample-trigger event out of `chart` whose chart-time falls inside the
 * preview window. Invisible objects update lane keysound state during gameplay, but AUTO PLAY does not directly sound
 * them, so the fallback preview skips them too. Exported for tests so the windowing math has direct coverage;
 * production callers reach this through {@link ChartPreviewEngine}.
 *
 * `cutoffSeconds <= 0` returns an empty array — the engine skips the in-place fallback entirely in that case.
 */
export function collectChartPreviewTriggers(chart: BeMusicJSON, cutoffSeconds: number): TimedSampleTrigger[] {
  if (!Number.isFinite(cutoffSeconds) || cutoffSeconds <= 0) return [];
  const resolved = resolveChart(chart, { inferBmsLNTypeWhenMissing: true });
  // LR2 negative-BPM reversal: the gameplay engine's event pump freezes at the reversal — nothing past it ever
  // sounds, and on the reversal tick only the BGM LR2 orders before the negative BPM does — so the select-scene
  // preview drops the same triggers.
  const { reversal } = resolved;
  return resolved.sampleTriggers
    .filter(
      (trigger) =>
        !isInvisibleNoteChannel(trigger.channel) &&
        trigger.seconds < cutoffSeconds &&
        firesBeforeTempoReversal(reversal, trigger.seconds, trigger.channel),
    )
    .sort((left, right) => left.seconds - right.seconds);
}

/**
 * Pure helper: the triggers of `triggers` (sorted by time, as {@link collectChartPreviewTriggers} returns them) that start
 * inside `window`, `[startSeconds, endSeconds)`. A sample started before the window is left out: a window preview
 * sounds what the bar itself plays.
 */
export function selectChartWindowTriggers(
  triggers: readonly TimedSampleTrigger[],
  window: ChartPreviewWindow,
): TimedSampleTrigger[] {
  if (!(window.endSeconds > window.startSeconds)) return [];
  const startSeconds = window.startSeconds - 1e-6;
  const endSeconds = window.endSeconds - 1e-6;
  return triggers.filter((trigger) => trigger.seconds >= startSeconds && trigger.seconds < endSeconds);
}

/**
 * Pure helper: the level a preview plays at, so it sounds as loud as the play. A play sums its samples into mixers at
 * {@link MIXER_HEADROOM_GAIN_LINEAR} (about −6 dB) and applies the chart's `#VOLWAV`; the preview takes both, where it
 * used to sum at unity and sound louder than the chart itself.
 */
export function resolveChartPreviewLevel(chart: Pick<BeMusicJSON, 'bms'>): number {
  return MIXER_HEADROOM_GAIN_LINEAR * volWAVToLinearGain(chart.bms.volWAV);
}

/**
 * Pure helper: when the in-place fallback starts fading and when it ends, in context time. The window is
 * `windowSeconds` long from `startAt` (the cutoff less the trimmed lead-in); the fade takes its last `fadeSeconds`, or
 * the whole window when that is shorter.
 */
export function resolvePreviewFallbackFade(
  startAt: number,
  windowSeconds: number,
  fadeSeconds: number,
): { fadeStartAt: number; endAt: number } {
  const span = Number.isFinite(windowSeconds) ? Math.max(0, windowSeconds) : 0;
  const fade = Number.isFinite(fadeSeconds) ? Math.min(Math.max(0, fadeSeconds), span) : 0;
  const endAt = startAt + span;
  return { fadeStartAt: endAt - fade, endAt };
}

function sameTarget(a: ChartPreviewTarget | undefined, b: ChartPreviewTarget | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.chart.id === b.chart.id && a.source.id === b.source.id;
}

/**
 * Minimal contract for the parts of `AudioBuffer` the leading- silence scan reads. Defined separately so unit tests can
 * feed in a duck-typed object without summoning a real Web Audio AudioBuffer (which doesn't exist in node test envs),
 * and so the helper isn't gratuitously coupled to the DOM type's `Float32Array<ArrayBuffer>` parameterization.
 */
export interface AudibleOffsetBuffer {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Returns the time of the first audible sample in `buffer`, or `0` if the whole buffer is below {@link
 * PREVIEW_SILENCE_THRESHOLD} (in which case there's nothing to skip — sit at the start).
 *
 * Walks every channel in lock-step so a stereo file with silence on the left channel but tone on the right doesn't get
 * incorrectly trimmed. Threshold matches `trimPreviewLeadingSilence` in `packages/player-engine`'s CLI preview module — the
 * two implementations should produce identical "first audible point" answers for the same source file so the web and
 * CLI players stay in lockstep.
 *
 * Linear scan with a fast inner loop; even a 5-second 44.1 kHz stereo buffer (~440 k samples) finishes in well under 1
 * ms, dwarfed by the surrounding `decodeAudioData` cost.
 */
export function findFirstAudibleOffsetSeconds(
  buffer: AudibleOffsetBuffer,
  threshold: number = PREVIEW_SILENCE_THRESHOLD,
): number {
  const channelCount = buffer.numberOfChannels;
  if (channelCount === 0) return 0;
  const length = buffer.length;
  if (length === 0) return 0;
  // Cache `getChannelData` calls — repeated calls allocate a fresh `Float32Array` view in some implementations and
  // would dominate the inner loop's runtime.
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  for (let frame = 0; frame < length; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      if (Math.abs(channels[channel]![frame]!) > threshold) {
        return frame / buffer.sampleRate;
      }
    }
  }
  return 0;
}
