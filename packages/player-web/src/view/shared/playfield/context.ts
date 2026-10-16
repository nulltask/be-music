/**
 * What the shared playfield's passes (`view/shared/playfield/*`) read and write on the built-in and LR2 gameplay scenes
 * (`CoreGameplayView`): the lanes, the notes and their scroll, the lane effects and bombs, the layers and pools they
 * draw into, and the theme hooks. The scene passes itself.
 */

import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { ResolvedChart } from '@be-music/chart';
import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import type { ScoreTracker } from '@be-music/player/core/scoring';
import type { TimedLandmineNote, TimedPlayableNote } from '@be-music/player/playable-notes';
import type { BeMusicLongNote } from '@be-music/skin-sdk';
import type { Graphics, Text } from 'pixi.js';
import type { BrowserSongEntry } from '../../../collection/types.ts';
import type { AudioFeatures } from '../../../runtime/audio-analysis.ts';
import type { GameplayLaneRect, GameplayThemeHooks } from '../../../scene/core/gameplay-theme.ts';
import type { CoreGameplayViewOptions } from '../../../scene/core/gameplay.ts';
import type { LongNoteTracker } from '../../../scene/core/long-note-tracker.ts';
import type { GoneDrawObjects } from '../../../scene/core/note-draw-window.ts';
import type { HiSpeedTransition } from '../../../scene/hi-speed.ts';
import type { ChildPool } from '../../../scene/pixi-utils.ts';
import type { BeMusicGameplayBinding } from '../../../skin/be-music/binding.ts';
import type { BeMusicJudge, BeMusicLaneCover } from '../../../skin/be-music/types.ts';
import type { LaneGeometryContext } from '../../built-in/play-chrome.ts';
import type { SideLaneRun } from './measure-line-runs.ts';

/**
 * View-side runtime note alias. Used to keep `this.notes` typed even though the view no longer extends
 * `TimedPlayableNote` with extra renderer state — judge status is now tracked through the same `judged` flag
 * the engine mutates on the **shared** instance handed in via `engineOptions.preparedChart`. See
 * `PlayerOptions.preparedChart` for the design rationale; the alias stays in case future renderer-only state
 * needs to attach back here.
 */
export type RuntimeNote = TimedPlayableNote;

/**
 * Mine / landmine note (BMS channels D1-D9 / E1-E9 for the 1P / 2P sides). Same shared-instance treatment as
 * `RuntimeNote`: the engine mutates `judged` on the same `TimedLandmineNote` instance the renderer's
 * `this.mineNotes` array already references, so there is no separate `hit` flag for the view to keep in sync.
 *
 * The engine decides when a mine detonates (by the judge ruleset, see docs/player-spec.md#landmines): it plays the
 * explosion sample (`#WAV00`) and drains the gauge by the mine's damage, without a verdict or a combo change. The
 * playable notes are untouched, so a regular note near the mine is judged as usual.
 */
export type RuntimeMineNote = TimedLandmineNote;

/** The scene's members the playfield passes use: `CoreGameplayView`'s members of these names. */
export interface PlayfieldContext extends LaneGeometryContext {
  readonly options: Readonly<
    Pick<CoreGameplayViewOptions, 'beMusicEffects' | 'showInvisibleNotes' | 'judgedNoteDisplay'>
  >;
  readonly theme: GameplayThemeHooks;
  readonly song: BrowserSongEntry | undefined;
  readonly resolvedPlayChart: ResolvedChart | undefined;
  readonly laneX: Map<string, GameplayLaneRect>;
  readonly laneLayer: Graphics;
  readonly shutterLayer: Graphics;
  readonly overlay: Text;
  readonly noteLayerPool: ChildPool;
  readonly bombLayerPool: ChildPool;
  readonly textLayerPool: ChildPool;
  readonly skinBinding: BeMusicGameplayBinding | undefined;
  readonly noteOverscan: number;
  readonly notes: RuntimeNote[];
  readonly mineNotes: RuntimeMineNote[];
  readonly invisibleNotes: TimedPlayableNote[];
  readonly maxLongNoteBeatSpan: number;
  readonly timingResolver: TimingResolver | undefined;
  readonly scrollMapper: ScrollDistanceMapperLike | undefined;
  readonly laneTimelineBeats: Float64Array;
  readonly scrollHiSpeed: HiSpeedTransition;
  drawCursor:
    | {
        notes: readonly RuntimeNote[];
        mines: readonly TimedLandmineNote[];
        seconds: number;
        note: number;
        mine: number;
      }
    | undefined;
  readonly goneDrawObjects: GoneDrawObjects;
  measureBeatCache: { songId: string | undefined; beats: number[] };
  measureLineRuns: { signature: number; runs: SideLaneRun[] } | undefined;
  readonly tracker: ScoreTracker;
  readonly audioFrame: AudioFeatures | undefined;
  readonly longNotes: LongNoteTracker;
  readonly lanePressedAt: Map<string, number>;
  readonly laneReleasedAt: Map<string, number>;
  readonly pressedChannels: Set<string>;
  readonly timerStartedAt: Map<number, number>;
  readonly keyOnFadeOutStart: Map<number, number>;
  readonly bombStartedAt: Map<string, number>;
  readonly bombJudge: Map<string, BeMusicJudge>;
  readonly paused: boolean;
  playClock(): number;
  currentSeconds(): number;
  currentBeat(seconds: number): number;
  isIntroPlaying(): boolean;
  isAutoplayedChannel(channel: string): boolean;
  resolveKeyOnTimerId(channel: string): number | undefined;
  resolveLaneCovers(): readonly BeMusicLaneCover[];
  resolveLongNoteMode(note: RuntimeNote): BeMusicLongNote['mode'];
}
