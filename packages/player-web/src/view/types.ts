/**
 * The contract between a scene session and a family view (ADR 0001). Each frame the session hands its view a **frame**:
 * plain data over the scene models (`@be-music/scene-model`). The view draws it in its family's skin. What the player
 * does on the view (a click on a bar, a skin button, a touch lane) comes back as an **intent**. A view decides nothing
 * about how the screen behaves, never drives the engine and plays no sound; `vite.config.ts` lints `view/**` for that.
 *
 * Keys do not pass through the view: the scene (`SessionScene`) hands them to the session.
 */

import type { BeMusicJson } from '@be-music/json';
import type { BeMusicAudioFrame, BeMusicCourseRecord, BeMusicSongRecord } from '@be-music/skin-sdk';
import type {
  BrowseCommand,
  BrowseEvent,
  BrowseState,
  CourseView,
  HiSpeedCommand,
  Judge,
  LaneCoverCommand,
  Library,
  LibraryChart,
  LibraryCourse,
  LibraryEntry,
  PlayOptions,
  PlayResult,
  PlaySide,
  PlayState,
  ResultPresentation,
} from '@be-music/scene-model';
import type { Container, Sprite, Texture } from 'pixi.js';
import type { SceneFamily } from '../host/family-kit.ts';
import type { PixiSceneHost } from '../scene/host.ts';

/** Where an intent goes: the session the view belongs to. */
export type IntentSink<Intent> = (intent: Intent) => void;

/**
 * A skin family's drawing of one scene: frames in, intents out. The `SessionScene` that holds it attaches it when
 * the scene enters, draws it on every tick and detaches it when the scene leaves the stage; a detached view keeps what it
 * loaded, so the scene can enter again.
 */
export interface FamilyView<Frame, Intent> {
  /** The family the view draws in. */
  readonly family: SceneFamily;
  /** The view's scene graph; the host adds it to the stage while the scene is active. */
  readonly root: Container;
  /**
   * Gets ready to draw on `host` and starts listening for its own pointer input, sending what the player asks for to
   * `emit`. Called on every entry.
   */
  attach(host: PixiSceneHost, emit: IntentSink<Intent>): void | Promise<void>;
  /** Draws one frame. */
  draw(frame: Frame): void;
  /** Stops listening and keeps what it loaded, for the next `attach`. */
  detach(): void;
  /** Releases everything; the view is not attached again. */
  dispose(): void;
  /**
   * The skin's design-space container and authored size, for screenshots (`PixiScene.getStageInfo`); without it the
   * host captures the whole stage.
   */
  getStageInfo?(): { container: Container; width: number; height: number };
}

/** When a frame is drawn. */
export interface SceneClock {
  /** The host's clock (`performance.now()`), in ms. */
  readonly nowMs: number;
  /** When the scene was last entered, on the same clock: a skin's scene timers count from it. */
  readonly enteredAtMs: number;
}

/** A screen on its way out: where to, and since when on the clock (its skin's fade-out counts from it). */
export interface SceneLeaving<To extends string> {
  readonly to: To;
  readonly atMs: number;
}

/** When a screen takes input and how it leaves, as its skin authors it, in ms from scene start. */
export interface SceneViewTiming {
  /** Until input opens (LR2's `#STARTINPUT`, beatoraja's `input`). */
  readonly inputDelayMs: number;
  /** Until the screen moves on by itself (beatoraja's decide `scene`); without it the screen waits for input. */
  readonly autoAdvanceMs?: number;
  /** The fade-out as the screen leaves (LR2's `#FADEOUT`, beatoraja's `fadeout`). */
  readonly fadeOutMs: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------------------------------------------------

/** The player's best records, as the select screen shows them on its bars and panels. */
export interface SelectRecords {
  chart(chart: LibraryChart): BeMusicSongRecord | undefined;
  course(course: LibraryCourse): BeMusicCourseRecord | undefined;
}

/** What the select screen draws. */
export interface SelectFrame {
  readonly clock: SceneClock;
  readonly library: Library;
  readonly browse: BrowseState;
  /** The list shown (`browseEntries`) and the cursor in it (`browseCursor`). */
  readonly entries: readonly LibraryEntry[];
  readonly cursor: number;
  /** What the last browse command did and when, for the list's slide and the folder animations. */
  readonly lastBrowse?: { readonly event: BrowseEvent; readonly atMs: number };
  readonly playOptions: PlayOptions;
  /** The option panel open (LR2's panels 1-9), or none. */
  readonly panel?: number;
  /** The course bar under the cursor, as a skin shows it. */
  readonly focusedCourse?: CourseView;
  readonly records: SelectRecords;
  /** The host's text field is over the search box: the skin leaves the query to it. */
  readonly searchEditing: boolean;
  /** When the player started the bar under the cursor: a skin's launch animation counts from it. */
  readonly startedAtMs?: number;
  /** The screen's music (BGM and chart preview), analysed for audio-reactive skins. */
  readonly audio: BeMusicAudioFrame;
}

/** What the player asks of the select screen. */
export type SelectIntent =
  /** Browse the list: move, jump to a clicked bar, pick at random, open, close, search, sort or filter, favourite. */
  | { readonly type: 'browse'; readonly command: BrowseCommand }
  /** Start the bar under the cursor: play its chart or course (in AUTO with `autoPlay`), or open its folder. */
  | { readonly type: 'start'; readonly autoPlay?: boolean }
  /** Step a play option through its choices (`cyclePlayOptionValue`). */
  | { readonly type: 'play-option'; readonly key: keyof PlayOptions; readonly step: number }
  /** Open an option panel, or close the one open (`undefined`). */
  | { readonly type: 'panel'; readonly panel: number | undefined }
  /** Edit the search: the host lays its text field over the skin's search box. */
  | { readonly type: 'search' }
  /** Show the text file of the chart under the cursor. */
  | { readonly type: 'readtext' }
  /** The course maker: name the course being made, or delete the player's course under the cursor. */
  | { readonly type: 'course-maker'; readonly action: 'name' | 'delete' }
  /** Open the skin's options. */
  | { readonly type: 'skin-config' }
  /** Leave the select screen. */
  | { readonly type: 'exit' };

export type SelectView = FamilyView<SelectFrame, SelectIntent>;

// ---------------------------------------------------------------------------------------------------------------------
// Decide
// ---------------------------------------------------------------------------------------------------------------------

/** What the decide screen draws. */
export interface DecideFrame {
  readonly clock: SceneClock;
  readonly chart: LibraryChart;
  /**
   * The chart as the play will play it: its `#RANDOM` / `#SWITCH` branches drawn once for this screen, which the play
   * plays too. A skin's graphs (beatoraja's BPM graph) read it.
   */
  readonly playChart: BeMusicJson;
  /** The course and the stage about to be played, for a course stage. */
  readonly course?: CourseView;
  readonly playOptions: PlayOptions;
  /** How far the play behind the screen has loaded, 0..1; absent when nothing is loading. */
  readonly progress?: number;
  /** When input opens, on the clock. */
  readonly inputOpenAtMs: number;
  readonly leaving?: SceneLeaving<'play' | 'select'>;
}

/** What the player asks of the decide screen. */
export type DecideIntent = { readonly type: 'continue' } | { readonly type: 'cancel' };

export interface DecideView extends FamilyView<DecideFrame, DecideIntent> {
  readonly timing: SceneViewTiming;
}

// ---------------------------------------------------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------------------------------------------------

/** Where a play is: loading, the intro before the chart, the chart, paused, and the ending (lead-out and fade). */
export type PlayStage = 'loading' | 'intro' | 'playing' | 'paused' | 'ending';

/**
 * One note the playfield draws. The engine's UI frame notes have this shape, and the session passes them through
 * uncopied so their `judged` flags stay live.
 */
export interface PlayfieldNote {
  readonly channel: string;
  readonly beat: number;
  readonly endBeat?: number;
  readonly visibleUntilBeat?: number;
  readonly seconds: number;
  readonly judged: boolean;
  readonly mine?: boolean;
  readonly invisible?: boolean;
  /** A long note's mode: 1 LN, 2 CN, 3 HCN. */
  readonly longNoteMode?: 1 | 2 | 3;
}

/**
 * Something that happened in a play since the last frame, for the skin's timers and effects (the moments
 * `CoreGameplayView.onThemeEvent` received, and the engine's lane commands in the view's own words). `atMs` is on the
 * play clock.
 */
export type PlayViewEvent =
  | { readonly kind: 'scene-start' | 'load-end' | 'play-start' | 'exit-fade-out' | 'exit-close'; readonly atMs: number }
  | {
      readonly kind: 'judge';
      readonly judge: Judge;
      readonly side: PlaySide;
      readonly channel?: string;
      readonly deltaMs?: number;
      readonly atMs: number;
    }
  | { readonly kind: 'full-combo'; readonly atMs: number }
  | { readonly kind: 'gauge'; readonly previous: number; readonly next: number }
  | { readonly kind: 'bomb'; readonly channel: string; readonly atMs: number }
  | { readonly kind: 'bomb-retired'; readonly channel: string }
  /** A lane's key went down or up, or flashed (an auto lane). */
  | { readonly kind: 'lane'; readonly channel: string; readonly action: 'press' | 'release' | 'flash' }
  /** An auto lane is held until `untilBeat` (a long note played by AUTO). */
  | { readonly kind: 'lane-hold'; readonly channel: string; readonly untilBeat: number }
  | {
      readonly kind: 'long-note-start';
      readonly channel: string;
      readonly beat: number;
      readonly mode: 'ln' | 'cn' | 'hcn';
    }
  | { readonly kind: 'long-note-end'; readonly channel: string; readonly outcome: 'complete' | 'dropped' }
  /** The POOR image shows (a miss at chart time `seconds`) or clears. */
  | { readonly kind: 'poor-bga'; readonly shown: boolean; readonly seconds?: number };

/**
 * What the play screen draws. What does not change during a play (the prepared chart, its measure lines and scroll
 * timeline, the BGA) goes to the view when the scene is made, not in every frame.
 */
export interface PlayFrame {
  readonly clock: SceneClock;
  readonly chart: LibraryChart;
  /** The course and the stage being played, for a course stage. */
  readonly course?: CourseView;
  readonly playOptions: PlayOptions;
  /** The running play: gauge, score, combo, judgments, hi-speed and lane covers. */
  readonly state: PlayState;
  readonly stage: PlayStage;
  /** How far the play has loaded, 0..1, while loading. */
  readonly progress?: number;
  /** Chart time in seconds; negative during the intro. */
  readonly seconds: number;
  /** The beat the playfield scrolls from (mirrored past an LR2 negative-BPM reversal). */
  readonly beat: number;
  /** The BPM shown now. */
  readonly bpm?: number;
  readonly autoPlay: boolean;
  readonly replay: boolean;
  /** The chart's notes, mines and invisible notes as the engine judges them. */
  readonly notes: {
    readonly notes: readonly PlayfieldNote[];
    readonly mines: readonly PlayfieldNote[];
    readonly invisible: readonly PlayfieldNote[];
  };
  /** The lanes held down now, by channel. */
  readonly heldLanes: ReadonlySet<string>;
  /** What happened since the last frame, oldest first. */
  readonly events: readonly PlayViewEvent[];
  /** The play's mix, analysed for audio-reactive skins. */
  readonly audio: BeMusicAudioFrame;
}

/** What the player asks of the play screen through the view (keys go to the session directly). */
export type PlayIntent =
  /** A touch lane went down or up, at `atMs` on the host clock. */
  | { readonly type: 'lane'; readonly channel: string; readonly pressed: boolean; readonly atMs: number }
  /** Change the hi-speed (a skin button, the wheel). */
  | { readonly type: 'hi-speed'; readonly command: HiSpeedCommand }
  /** Move or switch a lane cover (beatoraja's cover buttons and wheel). */
  | { readonly type: 'cover'; readonly command: LaneCoverCommand }
  | { readonly type: 'pause' }
  /** Give the play up, as holding ESC does. */
  | { readonly type: 'quit' }
  /** Play the chart again from the start. */
  | { readonly type: 'restart' };

/**
 * The play screen's timing as its skin authors it, in ms from scene start (LR2's `#LOADSTART` + `#LOADEND`,
 * `#PLAYSTART`, `#FADEOUT`, `#CLOSE`). The session gates the chart and times the ending with it.
 */
export interface PlayViewTiming {
  /** When loading counts as finished. */
  readonly loadEndOffsetMs: number;
  /** When the chart begins; `0` uses the player's own intro length. */
  readonly playStartOffsetMs: number;
  /** The fade-out as the play ends; `0` skips it. */
  readonly fadeOutMs: number;
  /** The hold after the fade before the scene moves on; `0` skips it. */
  readonly closeMs: number;
}

export interface PlayView extends FamilyView<PlayFrame, PlayIntent> {
  readonly timing: PlayViewTiming;
}

// ---------------------------------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------------------------------

/** What the result screen draws. */
export interface ResultFrame {
  readonly clock: SceneClock;
  readonly result: PlayResult;
  /** How the run is presented: the course-result skin, the course jingles, quick retry. */
  readonly presentation: ResultPresentation;
  /** The player's best record on the chart (or the course) before this play, for the best and difference figures. */
  readonly previousBest?: BeMusicSongRecord;
  /** When input opens, on the clock. */
  readonly inputOpenAtMs: number;
  readonly leaving?: SceneLeaving<'continue' | 'retry'>;
}

/** What the player asks of the result screen. */
export type ResultIntent = { readonly type: 'continue' } | { readonly type: 'retry' };

export interface ResultView extends FamilyView<ResultFrame, ResultIntent> {
  readonly timing: SceneViewTiming;
}

// ---------------------------------------------------------------------------------------------------------------------
// Playfield skin
// ---------------------------------------------------------------------------------------------------------------------

/** The design canvas the playfield is laid out on, in design pixels. */
export interface PlayfieldStage {
  readonly width: number;
  readonly height: number;
}

/** A lane's rect on the stage. `bottom` is the judgement line a note's bottom edge lands on. */
export interface PlayfieldLaneRect {
  readonly x: number;
  readonly w: number;
  readonly top: number;
  readonly bottom: number;
}

/** The note parts a skin can draw. `invisible` is the overlay that shows invisible notes. */
export type PlayfieldNoteKind = 'note' | 'lnstart' | 'lnend' | 'lnbody' | 'mine' | 'invisible';

/**
 * One sprite cell a skin draws a part with, in design pixels. `texture` is `undefined` when the skin authors the part
 * but its image is not ready this frame: the playfield then draws nothing for a long-note body or cap, and its own
 * shape for the rest.
 */
export interface PlayfieldCell {
  readonly texture: Texture | undefined;
  readonly width: number;
  readonly height: number;
}

/** A measure line the skin draws, repeated at every measure: its cell and where it sits across the stage. */
export interface PlayfieldMeasureLine {
  readonly cell: PlayfieldCell;
  readonly x: number;
  readonly width: number;
  readonly height: number;
  /** Applies the line's alpha, tint and blend to a placed sprite. */
  applyToSprite?(sprite: Sprite): void;
}

/** A rect the chart's BGA is composited into, in design pixels. */
export interface PlayfieldBgaTarget {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Leave out the base layer (channel 04), the layer (07 / 0A) or the POOR image (06) on this rect. */
  readonly noBase: boolean;
  readonly noLayer: boolean;
  readonly noPoor: boolean;
  /** Applies the rect's alpha, tint and blend (and rotation) to the BGA sprite once it is placed and sized. */
  applyToSprite(sprite: Sprite): void;
}

/**
 * What a family's skin gives the shared playfield (`view/shared/playfield`): the stage, the lanes, the note, measure
 * line and bomb images, and the effect lengths. The playfield walks the notes and lays them out; the skin only answers
 * where and with what. A method that returns `undefined` leaves that part to the playfield's built-in drawing.
 *
 * It replaces the theme hooks `CoreGameplayView` subclasses override. Each one maps as follows:
 *
 * | `CoreGameplayView` hook | Replaced by |
 * | --- | --- |
 * | `stageSize` | {@link stage} |
 * | `themeOwnsPlayfield` | {@link ownsLanes} |
 * | `resolveThemeLaneRect(channel, w, h)` | {@link laneRect} |
 * | `resolveThemeNoteCell(kind, laneIndex)` | {@link noteCell}, by channel: the LR2 lane index stays in the LR2 view |
 * | `renderThemeMeasureLines(frame)` | {@link measureLines}: the playfield places them at every measure |
 * | `collectBgaTargets(out)` | {@link bgaTargets} |
 * | `renderBombEffects()` | {@link bombCell} |
 * | `resolveBombDurationMs(channel)` | {@link bombDurationMs} |
 * | `resolveKeyOnFadeMs(timerId)` | {@link keyOnFadeMs}, by channel: the LR2 timer id stays in the LR2 view |
 * | `themeTiming` | {@link PlayView.timing} |
 * | `onThemeEvent(event)` | {@link PlayFrame.events}, read in {@link FamilyView.draw} |
 * | `updateThemeState()` | the start of {@link FamilyView.draw} |
 * | `renderThemeLayer(w, h)`, `renderThemeText(seconds)` | {@link FamilyView.draw}: the view draws its chrome around the playfield |
 * | `attachThemeLayers()` | {@link FamilyView.attach} |
 * | `prepareTheme()` | loading the `PlayKit` before the scene is made; per-play state resets in {@link FamilyView.attach} |
 * | `disposeTheme()` | {@link FamilyView.dispose} |
 */
export interface PlayfieldSkin {
  /** The design canvas: LR2's 640x480, a be-music skin's stage, a beatoraja skin's size. */
  readonly stage: PlayfieldStage;
  /**
   * The skin draws the lane backgrounds, key beams and bombs itself; the playfield still lays out the lanes for the
   * notes, measure lines and covers.
   */
  readonly ownsLanes: boolean;
  /** `channel`'s lane on `stage`, or `undefined` for the playfield's own layout of that lane. */
  laneRect(channel: string, stage: PlayfieldStage): PlayfieldLaneRect | undefined;
  /** The cell for one part of a note on `channel` this frame, or `undefined` for the playfield's own shape. */
  noteCell(kind: PlayfieldNoteKind, channel: string): PlayfieldCell | undefined;
  /** The measure lines this frame, or `undefined` for the playfield's own line. */
  measureLines(): readonly PlayfieldMeasureLine[] | undefined;
  /** Pushes this frame's BGA rects; pushing none hides the BGA. */
  bgaTargets(out: PlayfieldBgaTarget[]): void;
  /** The cell of `channel`'s bomb `elapsedMs` after it went off, or `undefined` for the playfield's own bomb. */
  bombCell(channel: string, elapsedMs: number): PlayfieldCell | undefined;
  /** How long `channel`'s bomb lasts, in ms. */
  bombDurationMs(channel: string): number;
  /** How long `channel`'s key beam fades after the key is released, in ms. */
  keyOnFadeMs(channel: string): number;
}
