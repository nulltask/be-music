/**
 * What the player sees of a play on the built-in and LR2 play screens (`PlaySession`), and how it changes: the
 * hi-speed (the hotkeys, HS-FIX), the play tempo the engine follows, the lane covers, the visible time, and the play
 * log's view, recorded as it changes or shown back from a replay.
 *
 * The functions read and write the scene's state through {@link PlayViewSettingsContext}; the play session passes itself.
 */

import type { PlayerTempoChange, TempoClock } from '@be-music/player';
import type { PlayerInputSignalBus } from '@be-music/player/signals';
import {
  createPlaylogViewCoalescer,
  DEFAULT_PLAYLOG_VIEW_REPLAY,
  resolveReplayHiSpeed,
  resolveReplayView,
  type PlaylogViewCoalescer,
  type PlaylogViewState,
} from '@be-music/player/playlog';
import {
  BE_MUSIC_HI_SPEED_SCALE,
  resolveHiSpeedForWhiteNumber,
  resolveLaneCover,
  resolvePlaylogView,
  resolveWhiteNumber,
  type LaneCover,
  type LaneCoverState,
  type PlaylogViewCursor,
} from '@be-music/scene-model';
import type { NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import { setVideoPlaybackTempo } from '../../runtime/play-tempo.ts';
import type { PlaySessionOptions } from './play-options.ts';
import type { PlayTempoRange } from './tempo-range.ts';
import { PIXELS_PER_BEAT } from '../../stage/design.ts';
import type { BeMusicLaneCover } from '../../skin/be-music/types.ts';
import type { PlayPlaylogViewScale, PlaySessionTheme } from './play-session-theme.ts';
import { applyPlayEvent, type PlayStateContext } from './play-state.ts';
import type { PlayfieldLaneRect } from '../../view/types.ts';

/** The scene's members the view settings read and write: the play session's members of these names. */
export interface PlayViewSettingsContext extends PlayStateContext {
  readonly options: Readonly<Pick<PlaySessionOptions, 'onHiSpeedChange' | 'onTempoChange' | 'replayView'>>;
  readonly disposed: boolean;
  tempo: number;
  readonly tempoClock: TempoClock;
  readonly audioContext: AudioContext | undefined;
  readonly audioContextStartTime: number;
  readonly nonstopMixer: NonstopStageMixer | undefined;
  readonly bgaVideos: Map<string, { video: HTMLVideoElement; objectUrl: string }>;
  readonly laneX: Map<string, PlayfieldLaneRect>;
  readonly chartBpmRange: PlayTempoRange | undefined;
  drawnLaneCovers: { covers: readonly LaneCoverState[]; drawn: LaneCover[] } | undefined;
  playlogViewCoalescer: PlaylogViewCoalescer | undefined;
  readonly replayViewCursor: PlaylogViewCursor | undefined;
  readonly sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  readonly theme: PlaySessionTheme;
  currentSeconds(): number;
}

/**
 * The player's hi-speed keys: step the player's hi-speed by `delta` (the play state keeps it on the 1/1000 grid and in
 * range, and ignores it while a course locks the hi-speed); HS-FIX scales the drawn one, and the note scroll glides to
 * it. The host hears of the player's new hi-speed, to remember it for the next play. Returns whether it changed.
 */
export function adjustHiSpeed(ctx: PlayViewSettingsContext, delta: number): boolean {
  const previous = applyPlayEvent(ctx, { type: 'hi-speed-step', delta });
  const player = ctx.playState.view.hiSpeed.player;
  if (player === previous.view.hiSpeed.player) return false;
  ctx.options.onHiSpeedChange?.(player);
  return true;
}

/** Follows a tempo change the engine made: the view's clock, the BGA videos, the NONSTOP fades and the host. */
export function followTempoChange(ctx: PlayViewSettingsContext, change: PlayerTempoChange): void {
  if (ctx.disposed) return;
  ctx.tempo = change.tempo;
  ctx.tempoClock.setTempoAtChartSeconds(change.seconds, change.tempo);
  setVideoPlaybackTempo(
    [...ctx.bgaVideos.values()].map((handle) => handle.video),
    change.tempo,
  );
  if (ctx.audioContext && ctx.audioContextStartTime > 0) {
    const chartStart = ctx.audioContextStartTime;
    ctx.nonstopMixer?.retime(ctx.currentSeconds(), (seconds) => chartStart + ctx.tempoClock.clockMsAt(seconds) / 1000);
  }
  ctx.options.onTempoChange?.(change.tempo);
}

/**
 * The lane covers of each play side with lanes as drawn ({@link renderShutter} draws them; a skin that sets
 * `drawsLaneCover` reads them to draw its own): the play state's covers through `resolveLaneCover`, a replay's
 * included. The array is kept until the covers change.
 */
export function resolveLaneCovers(ctx: PlayViewSettingsContext): readonly BeMusicLaneCover[] {
  const covers = ctx.playState.view.covers;
  let cache = ctx.drawnLaneCovers;
  if (cache === undefined || cache.covers !== covers) {
    cache = { covers, drawn: covers.map(resolveLaneCover) };
    ctx.drawnLaneCovers = cache;
  }
  return cache.drawn;
}

/** The scale the play log reads the view's hi-speed on, and the main BPM it takes the visible time at. */
interface PlaylogScale extends PlayPlaylogViewScale {
  readonly mainBpm?: number;
}

/**
 * The scale the play log reads the view's hi-speed on: the view's own (`PlaySessionTheme.playlogView`, the beatoraja
 * view's lane of four beats), else the built-in and LR2 scale over the lanes laid out last frame. Every family takes
 * the visible time at the play's main BPM (`chartBpmRange`, the one HS-FIX reads). `undefined` until the lanes are
 * laid out.
 */
function resolvePlaylogScale(ctx: PlayViewSettingsContext): PlaylogScale | undefined {
  const scale =
    ctx.theme.playlogView?.() ??
    (ctx.laneX.size === 0 ? undefined : { scale: BE_MUSIC_HI_SPEED_SCALE, laneBeats: resolveLaneBeats(ctx) });
  if (scale === undefined) return undefined;
  const mainBpm = ctx.chartBpmRange?.mainBpm;
  return mainBpm !== undefined ? { ...scale, mainBpm } : scale;
}

/**
 * What the player sees now in the play log's units (`resolvePlaylogView`): the drawn hi-speed on this scene's scale,
 * the HS-FIX, each side's covers, and the visible time at the main BPM without `#SCROLL` — the white number over the
 * lanes laid out last frame, the LIFT left out as beatoraja leaves it out — so another scale's replay can match it.
 * Rounded to the play log's precision, so cover fractions record without float noise.
 */
function currentPlaylogView(ctx: PlayViewSettingsContext): PlaylogViewState {
  const scale = resolvePlaylogScale(ctx);
  return resolvePlaylogView(ctx.playState.view, {
    scale: scale?.scale ?? BE_MUSIC_HI_SPEED_SCALE,
    laneBeats: scale?.laneBeats ?? 0,
    ...(scale?.mainBpm !== undefined ? { mainBpm: scale.mainBpm } : {}),
  });
}

/** The view the recorded play log starts from (`play.view`); later changes go through {@link updatePlaylogView}. */
export function startPlaylogView(ctx: PlayViewSettingsContext): PlaylogViewState {
  const view = currentPlaylogView(ctx);
  ctx.playlogViewCoalescer = createPlaylogViewCoalescer(view);
  return view;
}

/**
 * Per frame, once the lanes are laid out: while recording, sends the engine what changed in the view (at most one
 * change per 100 ms, so a held key records a few); while replaying, shows the recorded view at the playhead as far as
 * {@link PlaySessionOptions.replayView} asks.
 */
export function updatePlaylogView(ctx: PlayViewSettingsContext, seconds: number): void {
  if (resolvePlaylogScale(ctx) === undefined) return;
  if (ctx.replayViewCursor !== undefined) {
    const recorded = ctx.replayViewCursor.next(Math.round(seconds * 1_000_000));
    if (recorded !== undefined) applyReplayView(ctx, recorded);
    return;
  }
  const signals = ctx.sharedEngineInputSignals;
  if (ctx.playlogViewCoalescer === undefined || signals === undefined) return;
  const change = ctx.playlogViewCoalescer.observe(currentPlaylogView(ctx), performance.now());
  if (change !== undefined) signals.pushCommand({ kind: 'view', change });
}

/** Sends the engine the view change still held back by the coalescer, as the play ends ({@link updatePlaylogView}). */
export function flushPlaylogView(ctx: PlayViewSettingsContext): void {
  const signals = ctx.sharedEngineInputSignals;
  if (ctx.replayViewCursor !== undefined || ctx.playlogViewCoalescer === undefined || signals === undefined) return;
  if (resolvePlaylogScale(ctx) === undefined) return;
  const change = ctx.playlogViewCoalescer.flush(currentPlaylogView(ctx));
  if (change !== undefined) signals.pushCommand({ kind: 'view', change });
}

/**
 * Shows a replay's recorded view over the viewer's own: the covers as recorded (SUDDEN+ and HIDDEN+, and the LIFT on a
 * view that draws one, `PlaySessionTheme.drawsLift`), and the hi-speed as recorded on this scale, or matching the
 * recorded visible time when it was played on another (`resolveReplayHiSpeed`).
 */
function applyReplayView(ctx: PlayViewSettingsContext, recorded: PlaylogViewState): void {
  const replay = ctx.options.replayView ?? DEFAULT_PLAYLOG_VIEW_REPLAY;
  const view = resolveReplayView(recorded, currentPlaylogView(ctx), replay);
  const drawsLift = ctx.theme.drawsLift?.() === true;
  if ((replay.covers || (drawsLift && replay.lift)) && view.covers !== undefined) {
    applyPlayEvent(ctx, {
      type: 'cover-set',
      covers: view.covers.map(({ side, sudden, hidden, lift }) => ({
        side,
        sudden,
        suddenOn: sudden > 0,
        // The log's HIDDEN+ is a fraction of the whole lane; the play state's is of the part above the LIFT.
        hidden: drawsLift ? resolveHiddenAboveLift(hidden, lift) : hidden,
        hiddenOn: hidden > 0,
        ...(drawsLift ? { lift } : {}),
      })),
    });
  }
  if (!replay.hiSpeed) return;
  const sudden = view.covers?.[0]?.sudden ?? 0;
  const scale = resolvePlaylogScale(ctx);
  const mainBpm = scale?.mainBpm;
  const hiSpeed = resolveReplayHiSpeed(view, scale?.scale ?? BE_MUSIC_HI_SPEED_SCALE, (visibleMs) =>
    mainBpm === undefined
      ? undefined
      : resolveHiSpeedForWhiteNumber({
          laneBeats: scale?.laneBeats ?? 0,
          sudden,
          bpm: mainBpm,
          whiteNumberMs: visibleMs,
        }),
  );
  if (hiSpeed !== undefined) applyPlayEvent(ctx, { type: 'hi-speed-drawn', value: hiSpeed });
}

/** A HIDDEN+ cover of `hidden` of the whole lane as a fraction of the part above `lift` (none over a full LIFT). */
function resolveHiddenAboveLift(hidden: number, lift: number): number {
  return lift < 1 ? Math.min(1, hidden / (1 - lift)) : 0;
}

/**
 * How long a note stays visible below `cover` (the first play side's) at the current scroll and BPM, over the lanes
 * laid out last frame: the white number (`resolveWhiteNumber`, the LIFT left out), divided by the `#SCROLL` × `#SPEED`
 * rate at the playhead (0 while the chart scrolls backwards or stands still, as beatoraja shows it). `undefined` until
 * the lanes are laid out or while the BPM is unknown.
 */
export function resolveVisibleMs(
  ctx: PlayViewSettingsContext,
  cover: BeMusicLaneCover | undefined,
  bpm: number | undefined,
  scrollRate: number,
): number | undefined {
  if (ctx.laneX.size === 0 || bpm === undefined || !(bpm > 0)) return undefined;
  return resolveWhiteNumber({
    laneBeats: resolveLaneBeats(ctx),
    hiSpeed: ctx.playState.view.hiSpeed.drawn,
    sudden: cover?.sudden ?? 0,
    bpm,
    scrollRate,
  });
}

/**
 * The lanes laid out last frame in beats at hi-speed 1: the tallest lane's height in design pixels over the scroll of
 * one beat (`PIXELS_PER_BEAT`). 0 before the lanes are laid out.
 */
function resolveLaneBeats(ctx: PlayViewSettingsContext): number {
  let laneHeight = 0;
  for (const lane of ctx.laneX.values()) {
    laneHeight = Math.max(laneHeight, lane.bottom - lane.top);
  }
  return laneHeight / PIXELS_PER_BEAT;
}
