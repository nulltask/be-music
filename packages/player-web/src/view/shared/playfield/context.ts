/**
 * What the shared playfield's passes (`view/shared/playfield/*`) read and write: the layers and pools they draw into,
 * the theme hooks and the view's caches, and the running play as `play` ({@link PlayfieldRuntime}: the lanes, the notes
 * and their scroll, the lane effects and bombs). `CoreGameplayView` passes itself, its own play.
 */

import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { BmsSwitchingBga, ResolvedChart } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import type { PlayerGaugeSummary } from '@be-music/player/core/ui-signal-bus';
import type { TimedLandmineNote, TimedPlayableNote } from '@be-music/player/playable-notes';
import type { JudgeKind, ScoreSummary } from '@be-music/player/ruleset';
import type { PlayState } from '@be-music/scene-model';
import type { BeMusicJudgeWindows, BeMusicLaneKind, BeMusicLongNote } from '@be-music/skin-sdk';
import type { Graphics, Text, Texture } from 'pixi.js';
import type { BrowserSongEntry } from '../../../collection/types.ts';
import type { AudioAnalyzer, AudioFeatures } from '../../../runtime/audio-analysis.ts';
import type { BgaCue, NonstopStageBgaTimeline } from '../../../scene/core/gameplay-bga.ts';
import type { ChartBpmRange } from '../../../scene/core/gameplay-bpm-range.ts';
import type { GameplayLaneRect, GameplayThemeHooks } from '../../../scene/core/gameplay-theme.ts';
import type { CoreGameplayViewOptions } from '../../../scene/core/gameplay-options.ts';
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

/**
 * What the shared playfield and the built-in chrome read of the running play (`ctx.play`): the chart and its notes and
 * scroll, the lanes laid out (`laneX`, which the lanes pass fills), the play state and the engine's scores, the lane
 * effects and bombs, the BGA's timelines and textures, the clocks, the pause and the exit fade. The play session
 * (`PlaySession`) is one; the view reads it and writes only the lanes it lays out and the BGA videos it plays.
 */
export interface PlayfieldRuntime {
  readonly song: BrowserSongEntry | undefined;
  readonly resolvedChart: BeMusicJson | undefined;
  readonly resolvedPlayChart: ResolvedChart | undefined;
  readonly laneChannels: string[];
  readonly chartPlayVariant: ChartPlayVariant;
  readonly laneX: Map<string, GameplayLaneRect>;
  readonly notes: RuntimeNote[];
  readonly mineNotes: RuntimeMineNote[];
  readonly invisibleNotes: TimedPlayableNote[];
  readonly maxLongNoteBeatSpan: number;
  readonly timingResolver: TimingResolver | undefined;
  readonly scrollMapper: ScrollDistanceMapperLike | undefined;
  readonly laneTimelineBeats: Float64Array;
  readonly scrollHiSpeed: HiSpeedTransition;
  readonly tempo: number;
  readonly playState: PlayState;
  readonly score: ScoreSummary;
  readonly gaugeState: PlayerGaugeSummary;
  readonly fastCount: number;
  readonly slowCount: number;
  readonly lastJudge: string;
  readonly lastJudgeUntil: number;
  readonly lastJudgeAt: number | undefined;
  readonly judgeSideState: Record<
    '1P' | '2P',
    { judge: JudgeKind | ''; until: number; combo: number; courseCombo?: number }
  >;
  readonly judgeWindows: BeMusicJudgeWindows | undefined;
  readonly lastImpulseAt: number | undefined;
  readonly lastImpulseKind: BeMusicLaneKind | undefined;
  readonly chartBpmRange: ChartBpmRange | undefined;
  readonly playMoments: {
    failedAtMs?: number;
    allNotesDoneAtMs?: number;
    outroAtMs?: number;
    gaugeRiseAtMs?: number;
    gaugeMaxAtMs?: number;
  };
  readonly assetsLoading: boolean;
  readonly longNotes: LongNoteTracker;
  readonly lanePressedAt: Map<string, number>;
  readonly laneReleasedAt: Map<string, number>;
  readonly pressedChannels: Set<string>;
  readonly timerStartedAt: Map<number, number>;
  readonly keyOnFadeOutStart: Map<number, number>;
  readonly bombStartedAt: Map<string, number>;
  readonly bombJudge: Map<string, BeMusicJudge>;
  readonly hasBga: boolean;
  readonly bgaTimeline: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] };
  readonly nonstopBgaTimelines: NonstopStageBgaTimeline[] | undefined;
  readonly poorBgaFallbackKey: string | undefined;
  readonly poorBgaFallbackUntilSeconds: number;
  readonly lastPoorAt: number;
  readonly switchingBgas: Map<string, BmsSwitchingBga>;
  readonly bgaTextures: Map<string, Texture>;
  readonly bgaLayerTextures: Map<string, Texture>;
  readonly bgaVideos: Map<string, { video: HTMLVideoElement; objectUrl: string }>;
  readonly bgaSubRegionOrigins: Map<string, { x: number; y: number }>;
  bgaActiveVideos: { base?: { key: string; cueSeconds: number }; layer?: { key: string; cueSeconds: number } };
  readonly audioAnalyzer: AudioAnalyzer | undefined;
  readonly audioContextStartTime: number;
  readonly paused: boolean;
  readonly disposed: boolean;
  readonly exiting: boolean;
  readonly exitFadeOutMs: number;
  readonly exitFadeStartedAt: number | undefined;
  playClock(): number;
  currentSeconds(): number;
  currentBeat(seconds: number): number;
  nowBpm(seconds: number): number | undefined;
  displayBpm(seconds: number): number | undefined;
  isIntroPlaying(): boolean;
  isAutoplayedChannel(channel: string): boolean;
  resolveKeyOnTimerId(channel: string): number | undefined;
  resolveLaneCovers(): readonly BeMusicLaneCover[];
  resolveLongNoteMode(note: RuntimeNote): BeMusicLongNote['mode'];
  resolveSongDurationSeconds(): number;
  resolveVisibleMs(
    cover: BeMusicLaneCover | undefined,
    bpm: number | undefined,
    scrollRate: number,
  ): number | undefined;
  resolveJudgeRuleset(): string;
  resolveChartMs(): number | undefined;
}

/**
 * The view's members the playfield passes use (`CoreGameplayView`'s members of these names, or the built-in play
 * view's), with the running play as `play`.
 */
export interface PlayfieldContext extends LaneGeometryContext {
  readonly options: Readonly<
    Pick<CoreGameplayViewOptions, 'beMusicEffects' | 'showInvisibleNotes' | 'judgedNoteDisplay'>
  >;
  readonly theme: GameplayThemeHooks;
  readonly laneLayer: Graphics;
  readonly shutterLayer: Graphics;
  readonly overlay: Text;
  readonly noteLayerPool: ChildPool;
  readonly bombLayerPool: ChildPool;
  readonly textLayerPool: ChildPool;
  readonly skinBinding: BeMusicGameplayBinding | undefined;
  readonly noteOverscan: number;
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
  readonly audioFrame: AudioFeatures | undefined;
}
