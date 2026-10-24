/**
 * What the player sees of a play on the built-in and LR2 play screens (`PlaySession`), and how it changes: the
 * hi-speed (the hotkeys, HS-FIX), the play tempo the engine follows, the lane covers, the visible time, and the play
 * replay's view, recorded as it changes or shown back from a replay.
 *
 * The functions read and write the scene's state through {@link PlayViewSettingsContext}; the play session passes itself.
 */

import type { PlayerTempoChange } from '@be-music/player-engine';
import type { PlayerInputSignalBus } from '@be-music/player-engine/signals';
import {
  createReplayViewCoalescer,
  DEFAULT_REPLAY_PLAYBACK_OPTIONS,
  resolveReplayHiSpeed,
  resolveReplayView,
  resolveReplayOptionsAt,
  type ReplayViewCoalescer,
  type ReplayViewState,
} from '@be-music/player-engine/replay';
import {
  AC32_HI_SPEED_BASE,
  BE_MUSIC_HI_SPEED_SCALE,
  resolveHiSpeedForWhiteNumber,
  resolveLaneCover,
  normalizeFloatingLaneCover,
  captureReplayView,
  resolveWhiteNumber,
  type LaneCover,
  type HiSpeedCommand,
  type LaneCoverCommand,
  type LaneCoverState,
  type ReplayViewCursor,
} from '@be-music/player-scene-model';
import { setVideoPlaybackTempo } from '../../runtime/play-tempo.ts';
import type { PlaySessionOptions } from './play-options.ts';
import type { PlayTempoRange } from './tempo-range.ts';
import { PIXELS_PER_BEAT } from '../../stage/design.ts';
import type { BeMusicLaneCover } from '../../skin/be-music/types.ts';
import type { PlayReplayViewScale, PlaySessionTheme } from './play-session-theme.ts';
import { applyPlayEvent, type PlayStateContext } from './play-state.ts';
import type { PlayfieldLaneRect } from '../../view/types.ts';

/** The scene's members the view settings read and write: the play session's members of these names. */
export interface PlayViewSettingsContext extends PlayStateContext {
  readonly options: Readonly<Pick<PlaySessionOptions, 'onHiSpeedChange' | 'onTempoChange' | 'replayView' | 'replay'>>;
  readonly timingResolver?: Pick<import('@be-music/chart-model').TimingResolver, 'bpmAtBeat'>;
  currentBeat?(seconds: number): number;
  readonly disposed: boolean;
  tempo: number;
  readonly bgaVideos: Map<string, { video: HTMLVideoElement; objectURL: string }>;
  readonly laneX: Map<string, PlayfieldLaneRect>;
  readonly chartBPMRange: PlayTempoRange | undefined;
  drawnLaneCovers: { covers: readonly LaneCoverState[]; drawn: LaneCover[] } | undefined;
  replayViewCoalescer: ReplayViewCoalescer | undefined;
  readonly replayViewCursor: ReplayViewCursor | undefined;
  readonly sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  readonly theme: PlaySessionTheme;
  currentSeconds(): number;
}

/**
 * The player's hi-speed keys: step the player's hi-speed by `delta` (the play state keeps it on the 1/1000 grid and in
 * range, and ignores it while a course locks the hi-speed); HS-FIX scales the drawn one, and the note scroll glides to
 * it. The host hears of the player's new hi-speed, to remember it for the next play. Returns whether it changed.
 */
export function adjustHiSpeed(ctx: PlayViewSettingsContext, delta: number, fine = false): boolean {
  return changePlayView(
    ctx,
    fine && ctx.playState.view.hiSpeed.floating
      ? { type: 'hi-speed-fine', direction: delta }
      : { type: 'hi-speed-step', delta },
  );
}

/** Apply an interactive setting at the current BPM; replays apply their recorded views separately. */
export function changePlayView(ctx: PlayViewSettingsContext, command: HiSpeedCommand | LaneCoverCommand): boolean {
  const bpm = ctx.timingResolver?.bpmAtBeat(ctx.currentBeat?.(ctx.currentSeconds()) ?? 0);
  const rawCover = ctx.playState.view.covers[0];
  const cover =
    rawCover && command.type === 'floating-speed-mode' && command.enabled
      ? normalizeFloatingLaneCover(rawCover)
      : rawCover;
  const visibleFraction = Math.max(
    0,
    1 - (cover?.suddenOn ? cover.sudden : 0) - ((cover?.liftOn ?? false) ? (cover?.lift ?? 0) : 0),
  );
  const event =
    command.type === 'floating-speed-mode' || command.type === 'floating-speed-recalculate'
      ? { ...command, bpm: bpm ?? command.bpm, visibleFraction }
      : command.type === 'hi-speed-step' ||
          command.type === 'hi-speed-set' ||
          command.type === 'hi-speed-fine' ||
          command.type === 'cover-adjust' ||
          command.type === 'cover-toggle'
        ? { ...command, bpm, ...(command.type === 'hi-speed-fine' ? { visibleFraction } : {}) }
        : command;
  const previous = applyPlayEvent(ctx, event);
  const next = ctx.playState.view.hiSpeed;
  if (
    next.player !== previous.view.hiSpeed.player ||
    next.normalLevel !== previous.view.hiSpeed.normalLevel ||
    (next.floating !== undefined) !== (previous.view.hiSpeed.floating !== undefined)
  ) {
    if (next.floating || previous.view.hiSpeed.floating) {
      // Preserve accepted mode switches even when several happen before the next rendered frame.
      ctx.sharedEngineInputSignals?.pushCommand({
        kind: 'options',
        values: {
          floatingHiSpeed: next.floating !== undefined,
          hiSpeed: next.player,
          normalHiSpeedLevel: next.normalLevel ?? 0,
          floatingHiSpeedProfile: 'AC32-measured',
        },
      });
      ctx.options.onHiSpeedChange?.(next.player, next.normalLevel, next.floating !== undefined);
    } else if (next.normalLevel !== undefined) ctx.options.onHiSpeedChange?.(next.player, next.normalLevel);
    else ctx.options.onHiSpeedChange?.(next.player);
  }
  return ctx.playState !== previous;
}

/**
 * Follows a tempo change the engine made: the BGA videos and the host. The chart's clock follows from the engine's next
 * frame, and the engine's audio session moves a NONSTOP chart's fades.
 */
export function followTempoChange(ctx: PlayViewSettingsContext, change: PlayerTempoChange): void {
  if (ctx.disposed) return;
  ctx.tempo = change.tempo;
  setVideoPlaybackTempo(
    [...ctx.bgaVideos.values()].map((handle) => handle.video),
    change.tempo,
  );
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

/** The scale the replay reads the view's hi-speed on, and the main BPM it takes the visible time at. */
interface ReplayScale extends PlayReplayViewScale {
  readonly mainBPM?: number;
}

/**
 * The scale the replay reads the view's hi-speed on: the view's own (`PlaySessionTheme.replayView`, the beatoraja
 * view's lane of four beats), else the built-in and LR2 scale over the lanes laid out last frame. Every family takes
 * the visible time at the play's main BPM (`chartBPMRange`, the one HS-FIX reads). `undefined` until the lanes are
 * laid out.
 */
function resolveReplayScale(ctx: PlayViewSettingsContext): ReplayScale | undefined {
  const scale =
    ctx.theme.replayView?.() ??
    (ctx.laneX.size === 0 ? undefined : { scale: BE_MUSIC_HI_SPEED_SCALE, laneBeats: resolveLaneBeats(ctx) });
  if (scale === undefined) return undefined;
  const mainBPM = ctx.chartBPMRange?.mainBPM;
  return mainBPM !== undefined ? { ...scale, mainBPM } : scale;
}

/**
 * What the player sees now in the replay's units (`resolveReplayView`): the drawn hi-speed on this scene's scale,
 * the HS-FIX, each side's covers, and the visible time at the main BPM without `#SCROLL` — the white number over the
 * lanes laid out last frame, the LIFT left out as beatoraja leaves it out — so another scale's replay can match it.
 * Rounded to the replay's precision, so cover fractions record without float noise.
 */
function currentReplayView(ctx: PlayViewSettingsContext): ReplayViewState {
  const scale = resolveReplayScale(ctx);
  return captureReplayView(ctx.playState.view, {
    scale: scale?.scale ?? BE_MUSIC_HI_SPEED_SCALE,
    laneBeats: scale?.laneBeats ?? 0,
    ...(scale?.mainBPM !== undefined ? { mainBPM: scale.mainBPM } : {}),
  });
}

/** The view the recorded replay starts from (`play.view`); later changes go through {@link updateReplayView}. */
export function startReplayView(ctx: PlayViewSettingsContext): ReplayViewState {
  syncMeasuredSourceScale(ctx);
  const view = currentReplayView(ctx);
  ctx.replayViewCoalescer = createReplayViewCoalescer(view, { minIntervalMs: 0 });
  return view;
}

/**
 * Per frame, once the lanes are laid out: while recording, sends the engine what changed in the view on every rendered frame where it changes; while replaying, shows the recorded view at the playhead as far as
 * {@link PlaySessionOptions.replayView} asks.
 */
export function updateReplayView(ctx: PlayViewSettingsContext, seconds: number, seek = false): void {
  if (resolveReplayScale(ctx) === undefined) return;
  syncMeasuredSourceScale(ctx);
  if (ctx.replayViewCursor !== undefined) {
    const timeUs = Math.round(seconds * 1_000_000);
    const replay = ctx.options.replay;
    if ((ctx.options.replayView?.hiSpeed ?? true) && replay) {
      const selected = resolveReplayOptionsAt(replay.play.options, replay.play.optionChanges, timeUs);
      if (
        typeof selected.floatingHiSpeed === 'boolean' &&
        selected.floatingHiSpeed !== (ctx.playState.view.hiSpeed.floating !== undefined)
      ) {
        const cover = ctx.playState.view.covers[0];
        applyPlayEvent(ctx, {
          type: 'floating-speed-mode',
          enabled: selected.floatingHiSpeed,
          bpm: ctx.timingResolver?.bpmAtBeat(ctx.currentBeat?.(seconds) ?? 0) ?? 120,
          visibleFraction: Math.max(0, 1 - (cover?.suddenOn ? cover.sudden : 0) - (cover?.liftOn ? cover.lift : 0)),
        });
      }
    }
    const recorded = seek ? ctx.replayViewCursor.seek(timeUs) : ctx.replayViewCursor.next(timeUs);
    if (recorded !== undefined) applyReplayView(ctx, recorded);
    return;
  }
  const signals = ctx.sharedEngineInputSignals;
  if (ctx.replayViewCoalescer === undefined || signals === undefined) return;
  const change = ctx.replayViewCoalescer.observe(currentReplayView(ctx), performance.now());
  if (change !== undefined) signals.pushCommand({ kind: 'view', change });
}

/** Sends the engine the view change still held back by the coalescer, as the play ends ({@link updateReplayView}). */
export function flushReplayView(ctx: PlayViewSettingsContext): void {
  const signals = ctx.sharedEngineInputSignals;
  if (ctx.replayViewCursor !== undefined || ctx.replayViewCoalescer === undefined || signals === undefined) return;
  if (resolveReplayScale(ctx) === undefined) return;
  const change = ctx.replayViewCoalescer.flush(currentReplayView(ctx));
  if (change !== undefined) signals.pushCommand({ kind: 'view', change });
}

/**
 * Shows a replay's recorded view over the viewer's own: the covers as recorded (SUDDEN+ and HIDDEN+, and the LIFT on a
 * view that draws one, `PlaySessionTheme.drawsLift`), and the hi-speed as recorded on this scale, or matching the
 * recorded visible time when it was played on another (`resolveReplayHiSpeed`).
 */
function applyReplayView(ctx: PlayViewSettingsContext, recorded: ReplayViewState): void {
  const replay = ctx.options.replayView ?? DEFAULT_REPLAY_PLAYBACK_OPTIONS;
  const view = resolveReplayView(recorded, currentReplayView(ctx), replay);
  const drawsLift = ctx.theme.drawsLift?.() === true;
  if ((replay.covers || (drawsLift && replay.lift)) && view.covers !== undefined) {
    applyPlayEvent(ctx, {
      type: 'cover-set',
      covers: view.covers.map(({ side, sudden, hidden, lift }) => ({
        side,
        sudden: drawsLift && !ctx.playState.view.covers[0]?.absolute ? resolveCoverAboveLift(sudden, lift) : sudden,
        suddenOn: sudden > 0,
        // The log's HIDDEN+ is a fraction of the whole lane; the play state's is of the part above the LIFT.
        hidden: drawsLift ? resolveCoverAboveLift(hidden, lift) : hidden,
        hiddenOn: hidden > 0,
        ...(drawsLift ? { lift, liftOn: lift > 0 } : {}),
      })),
    });
  }
  if (!replay.hiSpeed) return;
  const cover = view.covers?.[0];
  const sudden = ctx.playState.view.covers[0]?.absolute
    ? (cover?.sudden ?? 0) + (drawsLift ? (cover?.lift ?? 0) : 0)
    : cover
      ? resolveCoverAboveLift(cover.sudden, drawsLift ? cover.lift : 0)
      : 0;
  const scale = resolveReplayScale(ctx);
  const mainBPM = scale?.mainBPM;
  const hiSpeed = resolveReplayHiSpeed(
    view,
    ctx.playState.view.hiSpeed.floating ||
      ctx.playState.view.hiSpeed.classic ||
      ctx.playState.view.hiSpeed.normalLevel !== undefined
      ? 'ac32-measured'
      : (scale?.scale ?? BE_MUSIC_HI_SPEED_SCALE),
    (visibleMs) =>
      mainBPM === undefined
        ? undefined
        : resolveHiSpeedForWhiteNumber({
            laneBeats: scale?.laneBeats ?? 0,
            sudden,
            bpm: mainBPM,
            whiteNumberMs: visibleMs,
          }),
  );
  if (hiSpeed !== undefined) applyPlayEvent(ctx, { type: 'hi-speed-drawn', value: hiSpeed });
}

/** A HIDDEN+ cover of `hidden` of the whole lane as a fraction of the part above `lift` (none over a full LIFT). */
function resolveCoverAboveLift(hidden: number, lift: number): number {
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
    sudden: ctx.playState.view.covers[0]?.absolute
      ? (cover?.sudden ?? 0) + (cover?.lift ?? 0)
      : cover
        ? cover.lift < 1
          ? resolveCoverAboveLift(cover.sudden, cover.lift)
          : (ctx.playState.view.covers.find((state) => state.side === cover.side && state.suddenOn)?.sudden ?? 0)
        : 0,
    bpm,
    scrollRate,
  });
}

/**
 * The lanes laid out last frame in beats at hi-speed 1: the tallest lane's height in design pixels over the scroll of
 * one beat (the view's scale, or `PIXELS_PER_BEAT`). 0 before the lanes are laid out.
 */
function resolveLaneBeats(ctx: PlayViewSettingsContext): number {
  let laneHeight = 0;
  for (const lane of ctx.laneX.values()) {
    laneHeight = Math.max(laneHeight, (lane.baseBottom ?? lane.bottom) - lane.top);
  }
  return laneHeight / (ctx.theme.pixelsPerBeat?.() ?? PIXELS_PER_BEAT);
}

/** Map measured source multipliers onto the active skin's lane scale without changing the selected source value. */
function syncMeasuredSourceScale(ctx: PlayViewSettingsContext): void {
  const state = ctx.playState.view.hiSpeed;
  if (!state.floating && !state.classic && state.normalLevel === undefined) return;
  const scale = resolveReplayScale(ctx);
  if (scale === undefined || !(scale.laneBeats > 0)) return;
  applyPlayEvent(ctx, { type: 'hi-speed-scale', multiplier: (scale.laneBeats * 36000) / AC32_HI_SPEED_BASE });
}
