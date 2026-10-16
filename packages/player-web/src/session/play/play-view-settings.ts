/**
 * What the player sees of a play on the built-in and LR2 gameplay scenes (`CoreGameplayView`), and how it changes: the
 * hi-speed (the hotkeys, HS-FIX), the play tempo the engine follows, the lane covers, the visible time, and the play
 * log's view, recorded as it changes or shown back from a replay.
 *
 * The functions read and write the scene's state through {@link PlayViewSettingsContext}; the scene passes itself.
 */

import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { PlayerTempoChange, TempoClock } from '@be-music/player/core/engine';
import type { PlayerInputSignalBus } from '@be-music/player/core/input-signal-bus';
import {
  createPlaylogViewCoalescer,
  DEFAULT_PLAYLOG_VIEW_REPLAY,
  resolveReplayHiSpeed,
  resolveReplayView,
  roundPlaylogView,
  type PlaylogLaneCover,
  type PlaylogViewCoalescer,
  type PlaylogViewState,
} from '@be-music/player/playlog';
import type { NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import { setVideoPlaybackTempo } from '../../runtime/play-tempo.ts';
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay-options.ts';
import type { GameplayLaneRect } from '../../scene/core/gameplay-theme.ts';
import type { ChartBpmRange } from '../../scene/core/gameplay-bpm-range.ts';
import { fillLaneCover, resolveHiSpeedForVisibleMs, resolveNoteVisibleMs } from '../../scene/core/lane-cover.ts';
import { PIXELS_PER_BEAT } from '../../scene/gameplay-constants.ts';
import { snapHiSpeed, stepPlayerHiSpeed, type HiSpeedTransition } from '../../scene/hi-speed.ts';
import { BE_MUSIC_HI_SPEED_SCALE, type PlaylogViewCursor } from '../../scene/playlog-view.ts';
import type { BeMusicLaneCover } from '../../skin/be-music/types.ts';
import { isChannelOnSide } from './play-chart.ts';

/** What {@link applyHsFix} folds the HS-FIX multiplier into: `CoreGameplayView`'s members of these names. */
export interface HsFixContext {
  readonly options: Readonly<Pick<CoreGameplayViewOptions, 'hsFix'>>;
  hsFixMultiplier: number;
  hiSpeed: number;
  readonly scrollHiSpeed: HiSpeedTransition;
}

/** The scene's members the view settings read and write: `CoreGameplayView`'s members of these names. */
export interface PlayViewSettingsContext extends HsFixContext {
  readonly options: Readonly<
    Pick<
      CoreGameplayViewOptions,
      | 'hsFix'
      | 'hiSpeedLocked'
      | 'onHiSpeedChange'
      | 'onTempoChange'
      | 'replayView'
      | 'laneCover'
      | 'shutter'
      | 'hiddenSudden1P'
      | 'hiddenSudden2P'
    >
  >;
  readonly disposed: boolean;
  playerHiSpeed: number;
  tempo: number;
  readonly tempoClock: TempoClock;
  readonly audioContext: AudioContext | undefined;
  readonly audioContextStartTime: number;
  readonly nonstopMixer: NonstopStageMixer | undefined;
  readonly bgaVideos: Map<string, { video: HTMLVideoElement; objectUrl: string }>;
  readonly laneChannels: string[];
  readonly laneX: Map<string, GameplayLaneRect>;
  readonly chartBpmRange: ChartBpmRange | undefined;
  laneCovers: { channels: readonly string[]; covers: BeMusicLaneCover[] } | undefined;
  replayCovers: readonly PlaylogLaneCover[] | undefined;
  playlogViewCoalescer: PlaylogViewCoalescer | undefined;
  readonly replayViewCursor: PlaylogViewCursor | undefined;
  readonly sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  currentSeconds(): number;
}

/**
 * Adjust the visual hi-speed and clamp to [HISPEED_MIN, HISPEED_MAX]. Snap to a 1/1000 grid so accumulated press
 * deltas don't drift off the natural 0.1 grid through float-rounding noise — `0.1` has no exact IEEE-754
 * representation, so adding it 13 times in a row would otherwise produce `1.5000000000000002` and then
 * `1.6000000000000003` etc., visibly off-by-one in the digit panel. The 1/1000 snap absorbs that without breaking
 * even finer steps if HISPEED_STEP shrinks again later.
 */
export function adjustHiSpeed(this: PlayViewSettingsContext, delta: number): void {
  if (this.options.hiSpeedLocked === true) return;
  // The step moves the player's hi-speed (on their own scale, as the readout shows it); HS-FIX scales the drawn one.
  const next = stepPlayerHiSpeed(this.playerHiSpeed, delta, this.hsFixMultiplier);
  if (next === undefined || next.player === this.playerHiSpeed) return;
  this.playerHiSpeed = next.player;
  this.hiSpeed = next.drawn;
  this.scrollHiSpeed.retarget(next.drawn, performance.now());
  this.options.onHiSpeedChange?.(next.player);
}

/**
 * Applies the HS-FIX multiplier to {@link hiSpeed} once `prepareSong` has installed the timing resolver. The player's
 * hi-speed is the one they want at `referenceBpm` (`#BASEBPM`, else the start BPM); HS-FIX rescales it so the scroll
 * at another BPM of the chart feels like that, as beatoraja's fixed hi-speed modes do (`LaneRenderer.init`):
 *
 * - `OFF` — leave HS as-is (beatoraja `OFF`; its `STARTBPM` is the same here, since the reference is the start BPM).
 * - `MAXBPM` — scale by `referenceBpm / maxBPM` (beatoraja `MAXBPM`).
 * - `MINBPM` — scale by `referenceBpm / minBPM` (beatoraja `MINBPM`).
 * - `AVERAGE` — scale by `referenceBpm / mainBPM`, the BPM the most notes sit at ({@link resolveChartMainBpm},
 *   beatoraja `MAINBPM`). A time average is skewed by the split-second BPM spikes and STOPs of BPM × N + STOP
 *   gimmicks (an average of ~810 on a 145 BPM chart), the main BPM is not.
 * - `CONSTANT` — true per-frame "constant scroll" needs a render-pipeline change that hasn't landed; falls through
 *   to the `AVERAGE` multiplier so the option still produces a sensible shift instead of doing nothing.
 *
 * Skipped when there are no tempo points (defensive — the resolver can be constructed empty during edge-case mounts)
 * or the chart has no BPM info.
 */
export function applyHsFix(
  this: HsFixContext,
  resolver: TimingResolver,
  referenceBpmCandidate: number | undefined,
  mainBpm: number | undefined,
): void {
  const mode = this.options.hsFix ?? 'OFF';
  if (mode === 'OFF') return;
  const referenceBpm =
    typeof referenceBpmCandidate === 'number' && referenceBpmCandidate > 0 ? referenceBpmCandidate : undefined;
  if (referenceBpm === undefined) return;
  const tempoPoints = resolver.tempoPoints;
  if (tempoPoints.length === 0) return;
  // |BPM| — a negative `#BPMxx` (LR2 reverse-scroll gimmick) integrates at its magnitude, so the HS-fix range
  // math uses the magnitude too. Zero / non-finite points still drop out via the `> 0` filter.
  const bpms = tempoPoints.map((point) => Math.abs(point.bpm)).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
  if (bpms.length === 0) return;
  let targetBpm: number;
  switch (mode) {
    case 'MAXBPM':
      targetBpm = Math.max(...bpms);
      break;
    case 'MINBPM':
      targetBpm = Math.min(...bpms);
      break;
    default:
      targetBpm = mainBpm ?? referenceBpm;
      break;
  }
  const multiplier = referenceBpm / targetBpm;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return;
  this.hsFixMultiplier = multiplier;
  this.hiSpeed = snapHiSpeed(this.hiSpeed * multiplier) ?? this.hiSpeed;
  // Chart setup, before the notes are on screen — no glide.
  this.scrollHiSpeed.jump(this.hiSpeed);
}

/** Follows a tempo change the engine made: the view's clock, the BGA videos, the NONSTOP fades and the host. */
export function followTempoChange(this: PlayViewSettingsContext, change: PlayerTempoChange): void {
  if (this.disposed) return;
  this.tempo = change.tempo;
  this.tempoClock.setTempoAtChartSeconds(change.seconds, change.tempo);
  setVideoPlaybackTempo(
    [...this.bgaVideos.values()].map((handle) => handle.video),
    change.tempo,
  );
  if (this.audioContext && this.audioContextStartTime > 0) {
    const chartStart = this.audioContextStartTime;
    this.nonstopMixer?.retime(
      this.currentSeconds(),
      (seconds) => chartStart + this.tempoClock.clockMsAt(seconds) / 1000,
    );
  }
  this.options.onTempoChange?.(change.tempo);
}

/**
 * The lane covers of each play side with lanes, as {@link renderShutter} draws them (whether or not it does: a skin
 * that sets `drawsLaneCover` reads them to draw its own). The array and its entries are reused across frames.
 */
export function resolveLaneCovers(this: PlayViewSettingsContext): readonly BeMusicLaneCover[] {
  let cache = this.laneCovers;
  if (!cache || cache.channels !== this.laneChannels) {
    const covers: BeMusicLaneCover[] = [];
    for (const side of ['1P', '2P'] as const) {
      if (this.laneChannels.some((channel) => isChannelOnSide(channel, side))) {
        covers.push({ side, sudden: 0, hidden: 0, lift: 0 });
      }
    }
    cache = { channels: this.laneChannels, covers };
    this.laneCovers = cache;
  }
  const { laneCover, shutter } = this.options;
  for (const cover of cache.covers) {
    const mode = (cover.side === '1P' ? this.options.hiddenSudden1P : this.options.hiddenSudden2P) ?? 'OFF';
    fillLaneCover(cover, mode, shutter, laneCover);
    // A replay's SUDDEN+ / HIDDEN+ (the scene draws no LIFT, so that stays 0).
    const replayed = this.replayCovers?.find((entry) => entry.side === cover.side);
    if (replayed !== undefined) {
      cover.sudden = replayed.sudden;
      cover.hidden = replayed.hidden;
    }
  }
  return cache.covers;
}

/** What the player sees now in the play log's units: the drawn hi-speed on this scene's scale, HS-FIX and covers. */
function resolvePlaylogView(this: PlayViewSettingsContext): PlaylogViewState {
  const covers = resolveLaneCovers.call(this).map(({ side, sudden, hidden, lift }) => ({ side, sudden, hidden, lift }));
  const view: PlaylogViewState = {
    hiSpeed: this.hiSpeed,
    hiSpeedScale: BE_MUSIC_HI_SPEED_SCALE,
    hsFix: this.options.hsFix ?? 'OFF',
    covers,
  };
  // The visible time at the main BPM without `#SCROLL`, so another scale's replay can match it.
  const visibleMs = resolveVisibleMs.call(this, covers[0], this.chartBpmRange?.mainBpm, 1);
  if (visibleMs !== undefined && visibleMs > 0) view.visibleMs = visibleMs;
  // At the play log's precision, so cover fractions record without float noise.
  return roundPlaylogView(view);
}

/** The view the recorded play log starts from (`play.view`); later changes go through {@link updatePlaylogView}. */
export function startPlaylogView(this: PlayViewSettingsContext): PlaylogViewState {
  const view = resolvePlaylogView.call(this);
  this.playlogViewCoalescer = createPlaylogViewCoalescer(view);
  return view;
}

/**
 * Per frame, once the lanes are laid out: while recording, sends the engine what changed in the view (at most one
 * change per 100 ms, so a held key records a few); while replaying, shows the recorded view at the playhead as far as
 * {@link CoreGameplayViewOptions.replayView} asks.
 */
export function updatePlaylogView(this: PlayViewSettingsContext, seconds: number): void {
  if (this.laneX.size === 0) return;
  if (this.replayViewCursor !== undefined) {
    const recorded = this.replayViewCursor.next(Math.round(seconds * 1_000_000));
    if (recorded !== undefined) applyReplayView.call(this, recorded);
    return;
  }
  const signals = this.sharedEngineInputSignals;
  if (this.playlogViewCoalescer === undefined || signals === undefined) return;
  const change = this.playlogViewCoalescer.observe(resolvePlaylogView.call(this), performance.now());
  if (change !== undefined) signals.pushCommand({ kind: 'view', change });
}

/** Sends the engine the view change still held back by the coalescer, as the play ends ({@link updatePlaylogView}). */
export function flushPlaylogView(this: PlayViewSettingsContext): void {
  const signals = this.sharedEngineInputSignals;
  if (this.replayViewCursor !== undefined || this.playlogViewCoalescer === undefined || signals === undefined) return;
  if (this.laneX.size === 0) return;
  const change = this.playlogViewCoalescer.flush(resolvePlaylogView.call(this));
  if (change !== undefined) signals.pushCommand({ kind: 'view', change });
}

/**
 * Shows a replay's recorded view over the viewer's own: the covers as recorded, and the hi-speed as recorded on this
 * scale, or matching the recorded visible time when it was played on another (`resolveReplayHiSpeed`).
 */
function applyReplayView(this: PlayViewSettingsContext, recorded: PlaylogViewState): void {
  const replay = this.options.replayView ?? DEFAULT_PLAYLOG_VIEW_REPLAY;
  this.replayCovers = undefined;
  const view = resolveReplayView(recorded, resolvePlaylogView.call(this), replay);
  if (replay.covers) this.replayCovers = view.covers;
  if (!replay.hiSpeed) return;
  const sudden = view.covers?.[0]?.sudden ?? 0;
  const mainBpm = this.chartBpmRange?.mainBpm;
  const hiSpeed = resolveReplayHiSpeed(view, BE_MUSIC_HI_SPEED_SCALE, (visibleMs) =>
    mainBpm === undefined
      ? undefined
      : resolveHiSpeedForVisibleMs(resolveLaneHeightPx.call(this), sudden, 0, PIXELS_PER_BEAT, mainBpm, visibleMs),
  );
  const next = hiSpeed === undefined ? undefined : snapHiSpeed(hiSpeed);
  if (next === undefined || next === this.hiSpeed) return;
  this.hiSpeed = next;
  this.playerHiSpeed = snapHiSpeed(next / this.hsFixMultiplier) ?? this.playerHiSpeed;
  this.scrollHiSpeed.retarget(next, performance.now());
}

/**
 * How long a note stays visible below `cover` (the first play side's) at the current scroll and BPM, over the lanes
 * laid out last frame, divided by the `#SCROLL` × `#SPEED` rate at the playhead (0 while the chart scrolls backwards or
 * stands still, as beatoraja shows it). `undefined` until the lanes are laid out or while the BPM is unknown.
 */
export function resolveVisibleMs(
  this: PlayViewSettingsContext,
  cover: BeMusicLaneCover | undefined,
  bpm: number | undefined,
  scrollRate: number,
): number | undefined {
  if (this.laneX.size === 0 || bpm === undefined || !(bpm > 0)) return undefined;
  return resolveNoteVisibleMs(
    resolveLaneHeightPx.call(this),
    cover?.sudden ?? 0,
    cover?.lift ?? 0,
    PIXELS_PER_BEAT * this.hiSpeed,
    bpm,
    scrollRate,
  );
}

/** The tallest lane laid out last frame, in design pixels (0 before the lanes are laid out). */
function resolveLaneHeightPx(this: PlayViewSettingsContext): number {
  let laneHeight = 0;
  for (const lane of this.laneX.values()) {
    laneHeight = Math.max(laneHeight, lane.bottom - lane.top);
  }
  return laneHeight;
}
