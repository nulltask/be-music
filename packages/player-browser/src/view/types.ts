/**
 * The contract between a scene session and a family view (ADR 0001). Each frame the session hands its view a **frame**:
 * plain data over the scene models (`@be-music/player-scene-model`). The view draws it in its family's skin. What the player
 * does on the view (a click on a bar, a skin button, a touch lane) comes back as an **intent**. A view decides nothing
 * about how the screen behaves, never drives the engine and plays no sound; `vite.config.ts` lints `view/**` for that.
 *
 * Keys do not pass through the view: the scene (`SessionScene`) hands them to the session.
 */

import type { BeMusicJSON } from '@be-music/chart-source';
import type { CourseDraft, NonstopConnection } from '@be-music/player-engine/course';
import type { BeMusicAudioFrame, BeMusicCourseBestRecord, BeMusicChartBestRecord } from '@be-music/player-skin-sdk';
import type {
  BrowseCommand,
  BrowseEvent,
  BrowseState,
  CourseView,
  HiSpeedCommand,
  JudgmentKind,
  LaneCoverCommand,
  LibraryChart,
  LibraryCourse,
  LibraryEntry,
  PlayOptions,
  PlayResult,
  PlaySide,
  PlayState,
  ReplaySlotState,
  ResultPresentation,
} from '@be-music/player-scene-model';
import type { Container, Sprite, Texture } from 'pixi.js';
import type { BrowserChartCollection } from '../collection/types.ts';
import type { SceneFamily } from '../host/family-kit.ts';
import type { PixiSceneHost } from '../host/scene-host.ts';
import type { PlayfieldRuntime } from './shared/playfield/context.ts';

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
  /** `false` when every screen the view shows is DOM, so the host can take its canvas out (`PixiScene.drawsOnCanvas`). */
  readonly drawsOnCanvas?: boolean;
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
  /**
   * Escape waits for input to open too, as beatoraja's `input` holds back every key; without it Escape leaves at any
   * time, as LR2 lets it before `#STARTINPUT`.
   */
  readonly escapeWaitsForInput?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------------------------------------------------

/** The player's best records, as the select screen shows them on its bars and panels. */
export interface SelectRecords {
  chart(chart: LibraryChart): BeMusicChartBestRecord | undefined;
  course(course: LibraryCourse): BeMusicCourseBestRecord | undefined;
  /**
   * Which of a chart's or course's replay slots hold a replay (`REPLAY_SLOT_COUNT` of them), when the host keeps replay
   * slots: the screen picks one for REPLAY, and a beatoraja skin lights their ops.
   */
  replaySlots?(entry: Exclude<LibraryEntry, { kind: 'folder' }>): readonly boolean[];
}

/**
 * Something that happened on the select screen since the last frame, for the view's slides, timers and overlays. `atMs`
 * is on the host clock.
 */
export type SelectViewEvent =
  /**
   * A browse command did something (`reduceBrowse`): the cursor moved, a folder opened or closed, the list changed. A
   * one-bar step on a list of one bar reports a cursor event that stays on that bar, so the list still slides.
   */
  | { readonly kind: 'browse'; readonly event: BrowseEvent; readonly atMs: number }
  /** An option panel opened or closed (LR2's timers 21-29 and 31-39 start then). */
  | { readonly kind: 'panel'; readonly panel: number; readonly open: boolean; readonly atMs: number }
  /** The README overlay scrolls by `delta` pixels (a key); the view clamps it to the text. */
  | { readonly kind: 'readtext-scroll'; readonly delta: number };

/** The course maker as a select skin shows it: the course being made and a new NONSTOP course's connection. */
export interface SelectCourseMakerState {
  /** The course being made; absent while none is. */
  readonly draft?: CourseDraft;
  /** The connection a new NONSTOP course gets. */
  readonly defaultConnection: NonstopConnection;
}

/**
 * What the player asks of the course maker: name the course being made (or their own course under the cursor),
 * delete their course under the cursor, finish or cancel the course being made, or step a connection of their NONSTOP
 * course under the cursor (`slot`, after stage `slot + 1`) or the default one.
 */
export type SelectCourseMakerAction =
  | { readonly kind: 'name' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'finish' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'connection'; readonly slot: number; readonly step: 1 | -1 }
  | { readonly kind: 'default-connection'; readonly step: 1 | -1 };

/** What the select screen draws. */
export interface SelectFrame {
  readonly clock: SceneClock;
  /** The library, with the files of its charts (their images and text files). */
  readonly library: BrowserChartCollection;
  readonly browse: BrowseState;
  /** The list shown (`browseEntries`) and the cursor in it (`browseCursor`). */
  readonly entries: readonly LibraryEntry[];
  readonly cursor: number;
  /**
   * Bumped whenever what the frame shows changed, besides the clock and the audio: a view rebuilds what it builds once
   * per change when it changes.
   */
  readonly revision: number;
  /** What happened since the last frame, oldest first. */
  readonly events: readonly SelectViewEvent[];
  readonly playOptions: PlayOptions;
  /** The option panel open (LR2's panels 1-9), or none. */
  readonly panel?: number;
  readonly records: SelectRecords;
  /** The host's text field is over the search box: the skin leaves the query to it. */
  readonly searchEditing: boolean;
  /** When the player started the bar under the cursor: a skin's launch outro counts from it, and input waits. */
  readonly startedAtMs?: number;
  /** The README overlay: the text file shown for a chart. */
  readonly readText?: { readonly chart: LibraryChart; readonly text: string };
  /** The course maker, when the player makes courses (LR2's course-maker ops, texts and buttons). */
  readonly courseMaker?: SelectCourseMakerState;
  /**
   * The replay slots of the chart or course under the cursor, when the host keeps replay slots: which hold a replay,
   * and the one REPLAY plays (−1 for none), as beatoraja's select screen picks it.
   */
  readonly replaySlots?: { readonly exists: readonly boolean[]; readonly selected: number };
  /** The screen's music (BGM and chart preview), analysed for audio-reactive skins. */
  readonly audio: BeMusicAudioFrame;
}

/** What the player asks of the select screen. */
export type SelectIntent =
  /** Browse the list: move, jump to a clicked bar, pick at random, open, close, search, sort or filter, favourite. */
  | { readonly type: 'browse'; readonly command: BrowseCommand }
  /** Take the bar under the cursor, as Enter and a click on a bar do: open its folder, or start its chart or course. */
  | { readonly type: 'activate' }
  /** Play the chart or course under the cursor (in AUTO with `autoPlay`): a skin's PLAY and AUTO buttons. */
  | { readonly type: 'start'; readonly autoPlay?: boolean }
  /**
   * Replay the chart or course under the cursor from replay slot `slot` (a skin's replay buttons), or from the slot
   * picked when no slot is named (the REPLAY key); a slot that holds no replay starts nothing.
   */
  | { readonly type: 'replay'; readonly slot?: number }
  /** Pick the next (`step` 1) or previous (−1) replay slot holding a replay (beatoraja's NEXT / PREV_REPLAY). */
  | { readonly type: 'replay-slot'; readonly step: 1 | -1 }
  /** Step a play option through its choices (`cyclePlayOptionValue`), or the hi-speed by its step. */
  | { readonly type: 'play-option'; readonly key: keyof PlayOptions; readonly step: number }
  /** Set a play option; a value outside its choices (or range) is ignored (`resolvePlayOptionValue`). */
  | { readonly type: 'set-play-option'; readonly key: keyof PlayOptions; readonly value: unknown }
  /** Open an option panel, closing the one open, or close it when it is the one open; `undefined` closes it. */
  | { readonly type: 'panel'; readonly panel: number | undefined }
  /** Edit the search: the host lays its text field over the skin's search box. */
  | { readonly type: 'search' }
  /** Show the text file of the chart under the cursor, or close the one shown. */
  | { readonly type: 'readtext' }
  /** The course maker (LR2's buttons and course name). */
  | { readonly type: 'course-maker'; readonly action: SelectCourseMakerAction }
  /** Open the skin's options. */
  | { readonly type: 'skin-config' }
  /** Leave the select screen. */
  | { readonly type: 'exit' }
  /** The player touched the screen: a gesture the browser lets start sound with. */
  | { readonly type: 'gesture' };

/** A skin family's drawing of the select screen. */
export interface SelectView extends FamilyView<SelectFrame, SelectIntent> {
  readonly ownsSearchInput?: boolean;
  focusSearch?(): boolean;
  /** How long the skin's launch outro plays before a started chart is handed on, in ms; `0` for none. */
  readonly launchOutroMs: number;
  /**
   * Where the skin's search box is on the canvas, in CSS pixels from its top-left corner, or `undefined` when it has
   * none (or nothing is drawn yet).
   */
  searchFieldRect(): { x: number; y: number; width: number; height: number } | undefined;
}

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
  readonly playChart: BeMusicJSON;
  /** The course and the stage about to be played, for a course stage. */
  readonly course?: CourseView;
  readonly playOptions: PlayOptions;
  /**
   * How far the play behind the screen has loaded, 0..1: the host's progress, else how much of the auto advance has
   * gone by (the screen stands for the load as it moves on by itself). Absent with neither.
   */
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
 * Something that happened in a play since the last frame, for the skin's timers and effects (the play session's
 * moments, and the engine's lane commands in the view's own words). `atMs` is on the
 * play clock.
 */
export type PlayViewEvent =
  | {
      readonly kind:
        | 'scene-start'
        | 'input-start'
        | 'load-end'
        | 'play-start'
        | 'music-end'
        | 'exit-fade-out'
        | 'exit-close';
      readonly atMs: number;
    }
  | {
      readonly kind: 'judge';
      readonly judge: JudgmentKind;
      readonly side: PlaySide;
      readonly channel?: string;
      readonly deltaMs?: number;
      /** The running combo after the judgment. */
      readonly combo?: number;
      readonly atMs: number;
    }
  | { readonly kind: 'full-combo'; readonly atMs: number }
  | { readonly kind: 'gauge'; readonly previous: number; readonly next: number; readonly atMs: number }
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
  | { readonly kind: 'poor-bga'; readonly shown: boolean; readonly seconds?: number }
  /** The player's keys changed a view setting (the hi-speed, a lane cover): the frame's state has the new value. */
  | { readonly kind: 'view-setting'; readonly setting: PlayViewSetting; readonly atMs: number }
  /**
   * The play sought to chart second `seconds`, its gauge `gauge` percent there: what the view started for the judgments
   * and the lanes before (skin timers, bombs, plates) is void; the frame's state is the one at `seconds`, `judgments` are
   * the judgments before it (each at its chart second, with its timing when it has one), and the long notes held across
   * it come again as `lane-hold` / `long-note-start` events.
   */
  | {
      readonly kind: 'seek';
      readonly seconds: number;
      readonly gauge: number;
      readonly judgments: readonly { readonly judge: string; readonly seconds: number; readonly deltaMs?: number }[];
      readonly atMs: number;
    };

/**
 * A view setting the player's keys change during a play: the hi-speed, SUDDEN+ (`sudden`), the LIFT, HIDDEN+'s height
 * (`hidden`), or HIDDEN+ switched on or off (`hidden-toggle`).
 */
export type PlayViewSetting = 'hi-speed' | 'sudden' | 'lift' | 'hidden' | 'hidden-toggle';

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
  /** The 2P player of a two-player play (LR2 BATTLE): its gauge, score, combo and judgments. */
  readonly state2P?: PlayState;
  /** Optional personal best and target EX scores for skin comparison animations; missing values mean zero. */
  readonly scoreTargets?: { readonly bestEXScore?: number; readonly targetEXScore?: number };
  readonly stage: PlayStage;
  /** How far the play has loaded, 0..1, while loading. */
  readonly progress?: number;
  /** Chart time in seconds; negative during the intro. */
  readonly seconds: number;
  /** Whether a `seek` intent moves the play now: an AUTO play or replay whose chart is running (paused or not). */
  readonly seekable: boolean;
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
  /**
   * Whether the play shows yet: from the session's `start`, or from the chart's preparation when the play is on the
   * stage while it loads. A view draws nothing of the play before.
   */
  readonly shown: boolean;
  /**
   * The running play as the shared playfield reads it (`view/shared/playfield`): the lanes laid out, the notes and
   * their scroll, the lane effects, the BGA's timelines and textures and the clocks. The session passes itself; the
   * view only reads it, and writes the lanes it lays out and the BGA videos it plays.
   */
  readonly playfield: PlayfieldRuntime;
}

/** What the player asks of the play screen through the view (keys go to the session directly). */
export type PlayIntent =
  /** A touch lane went down or up, at `atMs` on the host clock. */
  | { readonly type: 'lane'; readonly channel: string; readonly pressed: boolean; readonly atMs: number }
  /** Change the hi-speed (a skin button, the wheel). */
  | { readonly type: 'hi-speed'; readonly command: HiSpeedCommand }
  /** Move or switch a lane cover (beatoraja's cover buttons and wheel). */
  | { readonly type: 'cover'; readonly command: LaneCoverCommand }
  | { readonly type: 'constant-visibility'; readonly durationMs?: number; readonly fadeMs?: number }
  | { readonly type: 'pause' }
  /** Give the play up, as holding ESC does. */
  | { readonly type: 'quit' }
  /** Play the chart again from the start. */
  | { readonly type: 'restart' }
  /** Move an AUTO play or replay to chart second `seconds` (a preview's seek bar). */
  | { readonly type: 'seek'; readonly seconds: number };

/**
 * The play screen's timing as its skin authors it, in ms from scene start (LR2's `#LOADSTART` + `#LOADEND`,
 * `#PLAYSTART`, `#FADEOUT`, `#CLOSE`). The session gates the chart and times the ending with it.
 */
export interface PlayViewTiming {
  /** When loading counts as finished. */
  readonly loadEndOffsetMs: number;
  /** When the chart begins; `0` uses the player's own intro length. */
  readonly playStartOffsetMs: number;
  /** Optional input-ready stage, in milliseconds from scene start. */
  readonly inputStartOffsetMs?: number;
  /** When present, wait this long after actual load end, including media loading; zero starts immediately. */
  readonly playStartAfterLoadEndMs?: number;
  /** The fade-out as the play ends; `0` skips it. */
  readonly fadeOutMs: number;
  /** The hold after the fade before the scene moves on; `0` skips it. */
  readonly closeMs: number;
  /** Optional chart-time delay after the last note/event before the music-end stage. */
  readonly musicEndDelayMs?: number;
  /** Wall-clock hold after music end, before fade-out. */
  readonly finishMarginMs?: number;
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
  /**
   * The chart as the play played it (its `#RANDOM` branches drawn), when the host has it: a skin's chart graphs read it
   * (beatoraja's BPM graph and note kinds, and its TOTAL readout).
   */
  readonly playChart?: BeMusicJSON;
  /** How the run is presented: the course-result skin, the course jingles, quick retry. */
  readonly presentation: ResultPresentation;
  /** The player's best record on the chart (or the course) before this play, for the best and difference figures. */
  readonly previousBest?: BeMusicChartBestRecord;
  /** When input opens, on the clock; the result's graphs start drawing then (LR2's timers 1 and 150). */
  readonly inputOpenAtMs: number;
  /**
   * When the graphs finished drawing, by themselves or because the player skipped them, on the clock (LR2's timer
   * 151): the rank and the score show from then. Absent while they draw.
   */
  readonly graphShownAtMs?: number;
  /** When the player pressed on to the record update, on the clock (LR2's timer 152). Absent until then. */
  readonly updateShownAtMs?: number;
  /**
   * Each replay slot of the chart (or the course) as this result sees it (beatoraja's ops 196-198 and 1196-1204), when
   * the host keeps replay slots.
   */
  readonly replaySlots?: readonly ReplaySlotState[];
  readonly leaving?: SceneLeaving<'continue' | 'retry'>;
}

/**
 * What the player asks of the result screen: `continue` presses on, as Enter does (skip the graphs, show the record
 * update, then leave), `retry` plays the chart again, as R does, and `saveReplay` saves the play into a replay slot, as
 * keys 1-4 and a beatoraja skin's replay buttons do.
 */
export type ResultIntent =
  | { readonly type: 'continue' }
  | { readonly type: 'retry' }
  | { readonly type: 'saveReplay'; readonly slot: number };

/** When the result screen takes input and how it leaves, as its skin authors it. */
export interface ResultViewTiming extends SceneViewTiming {
  /**
   * A press on (Enter, Space, the view's `continue`) leaves at once, as the beatoraja result screen does; without it the
   * first press skips the graphs, the next shows the record update and the one after leaves, as LR2's result does.
   */
  readonly skipsResultSteps?: boolean;
}

export interface ResultView extends FamilyView<ResultFrame, ResultIntent> {
  readonly timing: ResultViewTiming;
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
  /** Original judgement line before LIFT; preserves replay and white-number scale. */
  readonly baseBottom?: number;
  readonly scrollScale?: number;
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
  /** Authored top-edge offset from the note timing origin. Defaults to zero. */
  readonly yOffset?: number;
  /** Applies the line's alpha, tint and blend to a placed sprite. */
  applyToSprite?(sprite: Sprite): void;
}

/** A rect the chart's BGA is composited into, in design pixels. */
export interface PlayfieldBGATarget {
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
 * It replaced the theme hooks the old gameplay view's subclasses overrode; `docs/player-web.md` ("Scene sessions and
 * family views") lists which member took over each one.
 */
export interface PlayfieldSkin {
  /** The skin's authored design canvas, fitted to the host viewport as a whole. */
  readonly stage: PlayfieldStage;
  /** Design pixels per beat at hi-speed 1; defaults to the shared 640x480 baseline. */
  readonly pixelsPerBeat?: number;
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
  bgaTargets(out: PlayfieldBGATarget[]): void;
  /**
   * The cell of `channel`'s bomb `elapsedMs` after it went off, drawn centred on the lane's judgement line, or
   * `undefined` for the playfield's own bomb. Not asked when the skin {@link ownsLanes}.
   */
  bombCell(channel: string, elapsedMs: number): PlayfieldCell | undefined;
  /** How long `channel`'s bomb lasts, in ms. */
  bombDurationMs(channel: string): number;
  /** How long `channel`'s key beam fades after the key is released, in ms. */
  keyOnFadeMs(channel: string): number;
}
