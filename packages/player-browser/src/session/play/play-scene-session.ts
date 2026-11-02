import { resolveConstantVisibility } from '@be-music/player-scene-model';
import { diffReplayOptions, resolveReplayOptionsAt, type ReplayOptionState } from '@be-music/player-engine/replay';
import { resolvePlayOptions } from '@be-music/player-scene-model';
/**
 * The play session as a scene session (`SceneSession`, `session/session-scene.ts`): what `createPlayScene` hands its
 * `SessionScene` so the scene's ticker reads a {@link PlayFrame} off the play every frame and the view's intents reach
 * it. The play's own keys stay the play's (`play-input.ts` listens on the window), so they reach the play directly
 * rather than through the scene; the view's touch lanes reach it as `lane` intents.
 */

import type { CourseView, LibraryChart, PlayOptions, SystemSoundSet } from '@be-music/player-scene-model';
import { SILENT_AUDIO } from '@be-music/player-skin-sdk';
import type { AudioService } from '../../runtime/audio-service.ts';
import type { PlayDisposeOptions } from './play-options.ts';
import type { PlayFrame, PlayIntent, PlayStage, PlayViewEvent } from '../../view/types.ts';
import type { SceneSession, SessionKeyEvent } from '../session-scene.ts';
import { drainSharedEngineSignals } from './play-engine.ts';
import { handleTouchLaneIntent } from './play-input.ts';
import type { PlaySession } from './play-session.ts';
import type { GhostPaceScore, GhostPresentation } from './ghost/ghost.ts';
import { canSeekPlay } from './play-seek.ts';
import type { PlayMoment } from './play-session-theme.ts';
import { playViewEventFromMoment } from './play-view-events.ts';
import { changePlayView, updateReplayView } from './play-view-settings.ts';

/**
 * What a play's frames carry besides the play itself: the chart picked, its course stage and the play options; and the
 * audio service the view's own sounds play through as the session's (a beatoraja skin's Lua sounds), stopped as the
 * scene leaves the stage.
 */
export interface PlaySceneFacts {
  readonly chart: LibraryChart;
  readonly course?: CourseView;
  readonly playOptions: PlayOptions;
  readonly scoreTargets?: PlayFrame['scoreTargets'];
  readonly playerName?: string;
  readonly audio?: Pick<AudioService, 'stopOwned' | 'playCue'>;
  readonly sounds?: SystemSoundSet;
  /**
   * Whether the view drawing the play now shows the play's ghost (`PlaySession.ghost`): a built-in family view does,
   * the LR2 and beatoraja ones have no second field to draw it in. Without it the ghost is not shown.
   */
  readonly showsGhost?: () => boolean;
}

/** A play session driven by a `SessionScene`. See the module comment. */
export class PlaySceneSession implements SceneSession<PlayFrame, PlayIntent> {
  public readonly kind = 'play' as const;
  public readonly play: PlaySession;
  /** How far the play has loaded, 0..1, while it loads (`PlayScene.prepare`). */
  public loadProgress: number | undefined;
  /** How the play's audio ends when the scene is disposed. */
  public disposeOptions: PlayDisposeOptions = {};
  private readonly facts: PlaySceneFacts;
  private recordedOptions: ReplayOptionState | undefined;
  private pending: PlayViewEvent[] = [];
  private enteredAtMs = 0;
  private failureSoundPlayed = false;

  public constructor(play: PlaySession, facts: PlaySceneFacts) {
    this.play = play;
    this.facts = facts;
  }

  /** A moment the play raised for its view (the session's theme `moment`), queued for the next frame. */
  public queueEvent(event: PlayMoment): void {
    if (event.kind === 'exit-close' && !this.failureSoundPlayed) {
      this.failureSoundPlayed = true;
      const sound = this.facts.sounds?.playStop;
      if (sound !== undefined) void this.facts.audio?.playCue(sound, { owner: this });
    }
    const mapped = playViewEventFromMoment(event);
    if (mapped !== undefined) this.pending.push(mapped);
  }

  /** The play is on the stage: its own input listens (the scene gave the play its host before the view attached). */
  public enter(nowMs: number): void {
    this.enteredAtMs = nowMs;
    const host = this.play.host;
    if (host !== undefined) this.play.attachInput(host);
  }

  /**
   * The play left the stage: its input stops, and so do the sounds the view played as the session's (a beatoraja
   * skin's loops); the engine and the chart's sound run on (a play that ended keeps its tail).
   */
  public exit(): void {
    this.play.detachInput();
    this.facts.audio?.stopOwned(this);
  }

  public dispose(): void {
    this.play.dispose(this.disposeOptions);
  }

  /** Keys reach the play through its own listeners (`play-input.ts`), not through the scene. */
  public handleKey(_event: SessionKeyEvent): boolean {
    return false;
  }

  public dispatch(intent: PlayIntent): void {
    const play = this.play;
    switch (intent.type) {
      case 'hi-speed':
        changePlayView(play, intent.command);
        return;
      case 'constant-visibility': {
        const value = resolveConstantVisibility({
          durationMs: intent.durationMs ?? play.options.noteDurationMs,
          fadeMs: intent.fadeMs ?? play.options.constantFadeMs,
        });
        play.options.noteDurationMs = value.durationMs;
        play.options.constantFadeMs = value.fadeMs;
        return;
      }
      case 'cover':
        changePlayView(play, intent.command);
        return;
      case 'pause':
        play.requestTogglePause();
        return;
      case 'quit':
        play.requestExit();
        return;
      case 'restart':
        play.requestRestart();
        return;
      case 'seek':
        void play.seek(intent.seconds);
        return;
      case 'lane':
        // A touch lane the view's fingers pressed or let go: the engine takes it as the keyboard's lane keys. A
        // ghost's lane takes nothing.
        if (play.ghost !== undefined && !play.laneChannels.includes(intent.channel)) return;
        handleTouchLaneIntent(play, intent.channel, intent.pressed, intent.atMs);
        return;
    }
  }

  /**
   * Advances the play to now — the engine's UI signals drained into the play state, the replay's view recorded or
   * replayed, the score readout eased — and returns what the view draws.
   */
  public frame(nowMs: number): PlayFrame {
    const play = this.play;
    // A paused play drains too: a seek moves it while it stays paused.
    if (!play.disposed) drainSharedEngineSignals(play);
    const seconds = play.currentSeconds();
    const replay = play.options.replay;
    let playOptions = this.facts.playOptions;
    if (replay?.play.options !== undefined || replay?.play.optionChanges !== undefined) {
      const recorded = resolveReplayOptionsAt(
        replay.play.options,
        replay.play.optionChanges,
        Math.round(seconds * 1_000_000),
      );
      playOptions = resolvePlayOptions({
        ...playOptions,
        ...recorded,
      });
      if (
        playOptions.judgeTimingAutoAdjust !== 'OFF' &&
        typeof recorded.judgeTimingMs === 'number' &&
        Number.isSafeInteger(recorded.judgeTimingMs)
      ) {
        playOptions = { ...playOptions, judgeTimingMs: recorded.judgeTimingMs };
      }
    } else if (replay === undefined && play.sharedEngineInputSignals !== undefined) {
      const userHiSpeed = play.playState.view.hiSpeed.chartBase ?? play.playState.view.hiSpeed;
      const liveOptions: PlayOptions = {
        ...playOptions,
        hiSpeed: userHiSpeed.player,
        floatingHiSpeed: userHiSpeed.floating !== undefined,
        judgeTimingMs: play.options.judgeTimingMs ?? playOptions.judgeTimingMs,
        noteDurationMs: play.options.noteDurationMs ?? playOptions.noteDurationMs,
        constantFadeMs: play.options.constantFadeMs ?? playOptions.constantFadeMs,
        ...(userHiSpeed.normalLevel !== undefined ? { normalHiSpeedLevel: userHiSpeed.normalLevel } : {}),
      };
      for (const cover of play.playState.view.covers) {
        const heightKey = cover.side === '1P' ? 'lift1P' : 'lift2P';
        const onKey = cover.side === '1P' ? 'liftOn1P' : 'liftOn2P';
        liveOptions[heightKey] = cover.lift;
        liveOptions[onKey] = cover.liftOn ?? cover.lift > 0;
      }
      playOptions = liveOptions;
      const current: ReplayOptionState = { ...liveOptions };
      const change = diffReplayOptions(this.recordedOptions ?? { ...playOptions }, current);
      // Calibration is recorded synchronously by the engine; do not echo a stale rendered value back to it.
      if (change && (play.options.judgeTimingAutoAdjust ?? 'OFF') !== 'OFF') delete change.judgeTimingMs;
      if (change && Object.keys(change).length > 0)
        play.sharedEngineInputSignals.pushCommand({ kind: 'options', values: change });
      this.recordedOptions = current;
    }
    if (!play.paused && !play.disposed) updateReplayView(play, seconds);
    play.updateDisplayedScore();
    const events = this.pending;
    this.pending = [];
    const stage = resolvePlayStage(play);
    const bpm = play.displayBPM(seconds);
    // The ghost draws through the playfield the view reads, and only on a view that shows one; a ghost with no field of
    // its own (a pacemaker) keeps running on any view.
    const shows = this.facts.showsGhost?.() === true;
    const ghost = play.ghost;
    const running = ghost !== undefined && (shows || !ghost.drawsOnPlayfield) ? ghost : undefined;
    running?.update(seconds, play.playClock());
    const scoreTargets = resolveFrameScoreTargets(this.facts.scoreTargets, running, play.score);
    return {
      clock: { nowMs, enteredAtMs: this.enteredAtMs },
      chart: play.chart ?? this.facts.chart,
      ...(this.facts.course !== undefined ? { course: this.facts.course } : {}),
      playOptions,
      ...(scoreTargets !== undefined ? { scoreTargets } : {}),
      ...(this.facts.playerName !== undefined ? { playerName: this.facts.playerName } : {}),
      state: play.playState,
      ...(play.secondPlayer !== undefined ? { state2P: play.secondPlayer.playState } : {}),
      stage,
      ...(stage === 'loading' && this.loadProgress !== undefined ? { progress: this.loadProgress } : {}),
      seconds,
      chartText: play.engineFrame?.chartText,
      seekable: canSeekPlay(play),
      beat: play.currentBeat(seconds),
      ...(bpm !== undefined ? { bpm } : {}),
      autoPlay: play.options.autoPlay === true,
      replay: play.options.replay !== undefined,
      notes: { notes: play.notes, mines: play.mineNotes, invisible: play.invisibleNotes },
      heldLanes: play.pressedChannels,
      events,
      audio: play.audioAnalyzer?.sample(play.playClock()) ?? SILENT_AUDIO,
      shown: play.shown,
      playfield: running !== undefined && shows ? running.present(play) : play,
    };
  }
}

/**
 * A frame's score targets: the host's (the best record's EX score), with a running ghost's pacemaker in place of the
 * target when it shows one. The host's object comes back as it is without one.
 */
export function resolveFrameScoreTargets(
  host: PlayFrame['scoreTargets'],
  ghost: Pick<GhostPresentation, 'scoreTarget'> | undefined,
  score: GhostPaceScore,
): PlayFrame['scoreTargets'] {
  const pacemaker = ghost?.scoreTarget?.(score);
  return pacemaker === undefined ? host : { ...host, ...pacemaker };
}

/** Where a play is: paused, ending (the lead-out and fade), loading its assets, in its intro, or playing. */
export function resolvePlayStage(
  play: Pick<PlaySession, 'paused' | 'exiting' | 'chartEnded' | 'assetsLoading' | 'isIntroPlaying'>,
): PlayStage {
  if (play.paused) return 'paused';
  if (play.exiting || play.chartEnded) return 'ending';
  if (play.assetsLoading) return 'loading';
  return play.isIntroPlaying() ? 'intro' : 'playing';
}
