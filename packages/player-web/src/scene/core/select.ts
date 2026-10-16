import { Application, Container } from 'pixi.js';
import { PerfTracker } from '../perf.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import type { SceneIdentity } from '../../host/family-kit.ts';
import {
  BGA_CYCLE,
  BGA_SIZE_CYCLE,
  BOOLEAN_CYCLE,
  clampHiSpeed,
  cyclePlayOptionValue,
  DEFAULT_PLAY_OPTIONS,
  DIFFICULTY_FILTER_CYCLE,
  HIDDEN_SUDDEN_CYCLE,
  HS_FIX_CYCLE,
  KEYS_FILTER_CYCLE,
  matchesSearchQuery,
  RANDOM_CYCLE,
  resolvePlayOptionValue,
  SORT_CYCLE,
  wrappedCursorDelta,
  type BrowseSnapshot,
  type SystemSoundSet,
} from '@be-music/scene-model';
import { resolveLr2SelectTimers, type Lr2TimerUpdate } from '@be-music/lr2-skin/state';
import { logger } from '../../logger.ts';
import { HISPEED_MAX, HISPEED_MIN } from '../hi-speed.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongCollection,
  BrowserSongEntry,
} from '../../collection/types.ts';
import type { CourseDefinition } from '@be-music/player/course';
import type { CourseMaker } from '../../collection/course-maker.ts';
import type {
  BeMusicBgaMode,
  BeMusicBgaSize,
  BeMusicDifficultyFilter,
  BeMusicEffectLevel,
  BeMusicHiddenSudden,
  BeMusicHsFix,
  BeMusicKeysFilter,
  BeMusicPlayOptions,
  BeMusicRandomMode,
  BeMusicSelectSort,
  BeMusicSkin,
  BeMusicSongRecord,
  BeMusicCourseRecord,
} from '../../skin/be-music/types.ts';
import type { BeMusicSelectBinding } from '../../skin/be-music/binding.ts';
import type { SongImageCache } from '../../skin/be-music/song-images.ts';
import { designRectToCanvas } from './viewport.ts';
import type { BeMusicSelectLayout } from '@be-music/skin-sdk';
import type { SelectReadTextContext } from './select-legacy/readtext.ts';
import { renderEmptyStateHint, type SelectEmptyHintContext } from '../../view/built-in/select-empty-hint.ts';
import { LegacySelectView, type LegacySelectViewContext } from './select-legacy/view.ts';
import { SelectPointer, type SelectPointerContext } from '../../view/shared/select-pointer.ts';
import { LegacySelectSession, type LegacySelectSessionContext } from './select-legacy/session.ts';
import { SelectAudio, type SelectAudioContext } from './select-legacy/audio.ts';
import { SelectKeys, type SelectKeysContext } from './select-legacy/keys.ts';

const log = logger('select');

/**
 * Per-session gameplay tweaks the user picks on the select screen. The shape lives in `@be-music/skin-sdk` as
 * `BeMusicPlayOptions` so be-music skins can read and change it; these names are kept for existing importers.
 */
export type PixiPlayOptions = BeMusicPlayOptions;
/** Allowed values for {@link PixiPlayOptions.difficultyFilter}. */
export type PixiDifficultyFilter = BeMusicDifficultyFilter;
/** Allowed values for {@link PixiPlayOptions.keysFilter}. */
export type PixiKeysFilter = BeMusicKeysFilter;
/** Allowed values for {@link PixiPlayOptions.sort}. */
export type PixiSelectSort = BeMusicSelectSort;
/** Allowed values for {@link PixiPlayOptions.hsFix}. */
export type PixiHsFix = BeMusicHsFix;
/** Allowed values for {@link PixiPlayOptions.hiddenSudden1P} / `hiddenSudden2P`. */
export type PixiHiddenSudden = BeMusicHiddenSudden;
/** Allowed values for {@link PixiPlayOptions.random1P} / `random2P`. */
export type PixiRandomMode = BeMusicRandomMode;
/** Allowed values for {@link PixiPlayOptions.bga}. */
export type PixiBgaMode = BeMusicBgaMode;
/** Allowed values for {@link PixiPlayOptions.bgaSize}. */
export type PixiBgaSize = BeMusicBgaSize;

// The play options model — the defaults, each option's choices in LR2 button order, and the validation of values set
// from a skin — lives in `@be-music/scene-model`; it is re-exported here under the names this module has always used.
export {
  BGA_CYCLE,
  BGA_SIZE_CYCLE,
  BOOLEAN_CYCLE,
  DEFAULT_PLAY_OPTIONS,
  DIFFICULTY_FILTER_CYCLE,
  HIDDEN_SUDDEN_CYCLE,
  HS_FIX_CYCLE,
  KEYS_FILTER_CYCLE,
  RANDOM_CYCLE,
  SORT_CYCLE,
  cyclePlayOptionValue as cycleSkinPlayOptionValue,
  resolvePlayOptionValue as resolveSkinPlayOptionValue,
};

/**
 * Allowed range for {@link PixiPlayOptions.hiSpeed} — the shared hi-speed range (`scene/hi-speed.ts`), so values seeded
 * from the select scene cover the same domain the in-play adjust hotkeys (`ArrowUp` / `ArrowDown`) can produce.
 */
export { HISPEED_MAX, HISPEED_MIN };

/**
 * Bundle of LR2 system sound-effect bytes (typically loaded from `LR2files\Sound\lr2\*.wav`). Each field is the encoded
 * audio payload (WAV / OGG / MP3 / etc.); {@link CoreSongSelectView} decodes lazily on first play through its own
 * `AudioContext`.
 */
export interface PixiSongSelectSystemSounds {
  /** Bar / cursor-move click. The default LR2 theme calls this `scratch.wav`. */
  cursorMove?: Uint8Array;
  /** Folder-enter cue (`f-open.wav`). */
  folderOpen?: Uint8Array;
  /** Folder-back cue (`f-close.wav`). */
  folderClose?: Uint8Array;
  /** Option-panel open cue (`o-open.wav`). Fired when any LR2 panel (1..9) opens. */
  optionOpen?: Uint8Array;
  /** Option-panel close cue (`o-close.wav`). Fired when an open panel is dismissed. */
  optionClose?: Uint8Array;
  /** Option-value change cue (`o-change.wav`). Fired on HS up/down, gauge toggle, etc. */
  optionChange?: Uint8Array;
}

/**
 * Constructor options shared by every song-select scene built on {@link CoreSongSelectView}. Skin-family scenes extend
 * this with their own fields (e.g. the LR2 scene's `skin`).
 */
export interface CoreSongSelectViewOptions {
  /** be-music skin for the skinless path (no LR2 select skin). Defaults to the built-in Phantom skin. */
  beMusicSkin?: BeMusicSkin;
  /** Showmanship level for the be-music skin (entrance, outro, ambient motion). Defaults to `'full'`. */
  beMusicEffects?: BeMusicEffectLevel;
  /**
   * The player's stored values for the be-music skin's `settings`, keyed by setting id. They are checked against the
   * skin's schema (`resolveBeMusicSkinSettings`: unknown ids dropped, invalid values replaced by the default, numbers
   * clamped) and handed to the skin as `frame.settings`. Omit it to draw with the skin's defaults; change it live with
   * `setBeMusicSkinSettings`.
   */
  beMusicSkinSettings?: Readonly<Record<string, unknown>>;
  onSongSelected?: (song: BrowserSongEntry) => void;
  /**
   * AUTOPLAY-mode launch hook. Fired when the user clicks the skin's AUTOPLAY button (#SRC_BUTTON `type = 16`) or
   * presses the AUTOPLAY hotkey. Hosts launch gameplay with autoplay forced ON. Falls through to `onSongSelected`
   * semantics-wise (the song still starts) but lets the host distinguish manual play from auto-judged play and pre-set
   * the gameplay's `autoPlay` flag.
   */
  onSongAutoPlay?: (song: BrowserSongEntry) => void;
  /**
   * The player started a course bar (or a NEW COURSE bar). A course with a stage missing from the collection
   * (`playable: false`) is handed over too, so the host can say why it does not start.
   */
  onCourseSelected?: (course: BrowserCourseEntry) => void;
  /** The player started a course with AUTO: every stage plays itself. Falls back to `onCourseSelected` when unset. */
  onCourseAutoPlay?: (course: BrowserCourseEntry) => void;
  /**
   * The player's own courses and the course being made. An LR2 skin reads its course-maker ops, texts and buttons
   * from it (ops 571 / 572 / 580-599, texts 150-170 / 198, buttons 230 / 231 / 233 / 240-248 / 268).
   */
  courseMaker?: CourseMaker;
  /** Fired when the player clicks an LR2 skin's course name (text 170) while making a course or on their own course. */
  onCourseNameActivate?: () => void;
  /** Fired when the player asks to delete one of their own courses (an LR2 skin's button 233); the host confirms. */
  onCourseDeleteRequest?: (course: CourseDefinition) => void;
  /**
   * Fired when the user clicks the skin's search-input region (#SRC_TEXT `st = 30, edit = 1`). The host typically
   * focuses a DOM `<input>` overlay so the user can type. Subsequent calls to {@link CoreSongSelectView.setSearchQuery}
   * filter the visible bar list.
   */
  onSearchActivate?: () => void;
  /**
   * Looping song-select BGM bytes (typically `LR2files/Bgm/<theme>/select.wav`). When supplied, the view decodes lazily
   * on first user gesture and loops while visible. Pass `undefined` (or omit) to skip BGM entirely. Runtime swap via
   * {@link CoreSongSelectView.setSelectBgm}.
   */
  selectBgm?: Uint8Array;
  /**
   * One-shot song-decided BGM bytes (typically `LR2files/Bgm/<theme>/decide.wav`). Fired by hosts via {@link
   * CoreSongSelectView.playDecideSound} on the select → gameplay transition. Decoded lazily on first play through the
   * same `AudioContext` as the looping select BGM. Runtime swap via {@link CoreSongSelectView.setDecideBgm}.
   */
  decideBgm?: Uint8Array;
  /**
   * LR2 system sound effects (typically `LR2files\Sound\lr2\*.wav`). The view fires each effect at the appropriate
   * navigation event:
   *
   * - `cursorMove` (`scratch.wav`) — every cursor advance, both keyboard and mouse / wheel triggered.
   * - `folderOpen` (`f-open.wav`) — drilling into a folder.
   * - `folderClose` (`f-close.wav`) — backing out of a folder via Esc / Backspace / Left.
   *
   * Missing entries are silently skipped — themes that don't ship a particular effect just don't play it. Runtime swap
   * via {@link CoreSongSelectView.setSystemSounds}.
   */
  systemSounds?: PixiSongSelectSystemSounds;
  /**
   * The browse position to open the library on (`@be-music/scene-model`'s `BrowseSnapshot`, as `getNavigation`
   * returns it): when the library is set, the view walks back into its folders and puts the cursor back. Used by the
   * demo to keep the player's place across a skin change. Without one, a library of one chart folder opens it.
   */
  initialNavigation?: BrowseSnapshot;
  /**
   * Initial play-option values. Merged onto {@link DEFAULT_PLAY_OPTIONS} — fields the host omits keep their defaults.
   * The view owns the live state from then on; hosts read it back via {@link CoreSongSelectView.getPlayOptions} when
   * launching gameplay.
   */
  initialPlayOptions?: Partial<PixiPlayOptions>;
  /**
   * Fired whenever the in-scene "PLAY OPTIONS" panel mutates the live play-option state. Hosts use this to keep
   * external surfaces (e.g. a debug toolbar checkbox, a URL flag, persisted settings) in sync with the value the panel
   * just changed.
   *
   * Not fired for {@link CoreSongSelectView.setPlayOptions} writes — those originate from the host so the host already
   * knows.
   */
  onPlayOptionsChange?: (options: PixiPlayOptions) => void;
  /**
   * Looks up the player's best record on a chart, for a be-music skin's `frame.songRecord(song)` (its lamp, best
   * scores, play count). Return `undefined` for a chart that has no record. Called while the skin draws, possibly
   * for every visible row on every frame, so it should be a cheap lookup. Omit it when the host keeps no records: every
   * song then reads as never played.
   */
  resolveSongRecord?: (song: BrowserSongEntry) => BeMusicSongRecord | undefined;
  /**
   * Looks up the player's best record on a course bar, for a be-music skin's `frame.courseRecord(course)` and an LR2
   * skin's course-bar lamp. Return `undefined` for a course never played (and for a random course or a NEW COURSE bar).
   * Called while the skin draws, so it should be a cheap lookup.
   */
  resolveCourseRecord?: (course: BrowserCourseEntry) => BeMusicCourseRecord | undefined;
}

/** Design-canvas size a skin family's theme renders the select frame into. */
export interface SelectDesignSize {
  width: number;
  height: number;
}

const IDENTITY: SceneIdentity = { kind: 'select', family: 'built-in' };

/** What the parts of the select scene read and drive on it. */
type SelectSceneContext = SelectReadTextContext &
  SelectEmptyHintContext &
  SelectPointerContext &
  LegacySelectSessionContext &
  SelectKeysContext &
  SelectAudioContext &
  LegacySelectViewContext;

/**
 * Family-neutral song-select scene. Owns everything that doesn't depend on a particular skin format: the scene shown
 * on the shared {@link PixiSceneHost}, collection / folder browsing / search, keyboard + pointer input, cursor movement
 * with its system sounds, select BGM, chart preview, play options, the readtext overlay, and the ticker loop.
 *
 * Hosts keep it alive across the screens a play goes through: the host's `setScene` exits it for a decide, play or
 * result screen and enters it again on the way back, and it keeps its browse state, cursor and decoded BGM meanwhile.
 *
 * Without a theme the frame renders through the be-music skin (`beMusicSkin`, defaulting to the built-in Phantom skin) on
 * a 640×480 design canvas. Skin families (e.g. the LR2 scene) take over the frame by overriding the protected `theme*`
 * hooks: {@link themeDesignSize} decides whether the theme is active, and the remaining hooks prepare, render, hit-test
 * and dispose the theme's resources.
 *
 * The scene is made of parts that read and drive it through one context it builds ({@link createContext}): the browsing,
 * the keyboard, the sound and the drawing with its README overlay (`select-legacy/`), the pointer
 * (`session/select/select-pointer.ts`) and the empty-library hint (`view/built-in/select-empty-hint.ts`). What a theme
 * scene reads and calls stays here as protected members over those parts. Only the LR2 select scene is still built on
 * it: the built-in select screen is `createSelectScene`'s, a select session drawn by the built-in family view.
 */
export class CoreSongSelectView<
  TOptions extends CoreSongSelectViewOptions = CoreSongSelectViewOptions,
> implements PixiScene {
  /**
   * Host owning the shared `Application`. Set on the first {@link enter}; the `app` accessor below throws before that.
   * With one Application shared across scenes we sidestep the Pixi v8 module-shared `batchPool` race that
   * two-Application setups hit.
   */
  private host: PixiSceneHost | undefined;
  /** The scene graph the host attaches to its stage while the select is showing (`LegacySelectView.root`). */
  public get root(): Container {
    return this.view.root;
  }
  /** This scene as the parts it is made of read and drive it (see {@link createContext}). */
  private readonly context: SelectSceneContext = CoreSongSelectView.createContext(this);
  /** The drawing: the letterboxed design canvas, a theme's layers, the be-music skin and the README overlay. */
  private readonly view: LegacySelectView = new LegacySelectView(this.context);
  /** The browsing: the folder stack and the cursor, the play options and the panels, the search, the launch. */
  private readonly session: LegacySelectSession = new LegacySelectSession(this.context);
  /** The sound: the select BGM, the system cues and the chart preview. */
  private readonly audio: SelectAudio = new SelectAudio(this.context);
  /** The keyboard. */
  private readonly keys: SelectKeys = new SelectKeys(this.context);
  /**
   * Per-frame section timing tracker. Logs every second when enabled via `?perf` URL flag or
   * `globalThis.__BE_MUSIC_PERF__ = true`.
   */
  protected readonly perf: PerfTracker = new PerfTracker('select');
  private mountedContainer: HTMLElement | undefined;
  /**
   * `performance.now()` at the moment the select scene was mounted. Drives the elapsed-time clock for LR2 timer 0
   * (scene main) so the skin's intro / loop animations on `#DST_*` keyframes play out.
   */
  protected sceneStartedAt = 0;
  /**
   * Whether the keyframe-driven render loop is currently attached to {@link PixiSceneHost.app}'s ticker. The previous
   * implementation drove the loop via its own `requestAnimationFrame` callback, which ran alongside PixiJS's built-in
   * auto-render ticker — two RAFs were scheduled per frame, doubling the event-loop overhead. Now the tick handler is
   * registered on the shared `app.ticker` so it fires inline with the renderer's frame.
   */
  private tickerAttached = false;
  /**
   * Tick handler bound once at construction so {@link PixiSceneHost.app}'s ticker can register / unregister it by
   * reference. The handler runs the same per-frame render path the previous rAF callback did.
   */
  private readonly tickerHandle = (): void => this.tickFrame();
  /** Idempotency guard for {@link dispose}. */
  protected disposed = false;
  /**
   * Per-timer start timestamps (`performance.now()`). LR2 select-screen timers we drive:
   *
   * - - **0** — scene main, set at mount. - **1** — input start, fires `#STARTINPUT` ms after mount. - **10** —
   *   list-scroll active, set whenever the cursor moves. - **11** — song change, reset on every cursor move so
   *   `#DST_BAR_BODY` keyframes anchored to it replay their slide animation each time the user advances. - **12** —
   *   list-up scroll, set on `ArrowUp` / scroll-up moves. - **13** — list-down scroll, set on `ArrowDown` /
   *   scroll-down.
   *
   * A missing entry means the timer hasn't fired yet (`elapsed = 0`, `active = false`). Inserting a new timestamp for
   * an existing key is the LR2 "timer reset" operation — DST keyframes anchored to that timer will play again from
   * time=0.
   */
  protected readonly timerStartedAt: Map<number, number> = new Map<number, number>();

  /** Starts and stops the LR2 timers a moment of the screen changes (`resolveLr2SelectTimers`). */
  protected applyLr2Timers(update: Lr2TimerUpdate): void {
    for (const timer of update.stop) this.timerStartedAt.delete(timer);
    for (const [timer, at] of update.start) this.timerStartedAt.set(timer, at);
  }
  /** The pointer input: taps, swipes and their glide, and the wheel. */
  private readonly pointer: SelectPointer = new SelectPointer(this.context);
  /**
   * Last known pointer position in **design-space** coordinates, used by `#SRC_ONMOUSE` hit-tests and
   * `#SRC_MOUSECURSOR` follow. `-1` means "no pointer over canvas yet"; both renderers skip drawing in that case.
   */
  protected mouseX = -1;
  protected mouseY = -1;
  /**
   * Whether the select is the scene showing: from {@link enter} to {@link exit}. The input handlers short-circuit while
   * it is off stage (e.g. while the gameplay view is up — both views' keydown listeners are bound at the window level
   * so we'd otherwise compete for arrow keys).
   */
  private visible = true;
  protected options: TOptions;

  public constructor(options: TOptions = {} as TOptions) {
    this.options = options;
    this.view.beMusicSkinSettings = options.beMusicSkinSettings;
    this.audio.selectBgmBytes = options.selectBgm;
    this.audio.setOneShotBytes('decide', options.decideBgm);
    this.setSystemSounds(options.systemSounds);
    if (options.initialPlayOptions) {
      this.session.playOptions = { ...this.session.playOptions, ...options.initialPlayOptions };
      this.session.playOptions.hiSpeed = clampHiSpeed(this.session.playOptions.hiSpeed);
    }
  }

  /**
   * `scene` as the parts it is made of read and drive it (`LegacySelectSessionContext`, `SelectKeysContext`,
   * `SelectPointerContext`, `SelectAudioContext`, `LegacySelectViewContext`, `SelectReadTextContext`,
   * `SelectEmptyHintContext`): getters and methods over its own state and its parts, so that state keeps its access
   * modifiers.
   */
  private static createContext(scene: CoreSongSelectView): SelectSceneContext {
    return {
      get collection(): BrowserSongCollection {
        return scene.collection;
      },
      get skinLayer(): Container {
        return scene.skinLayer;
      },
      get disposed(): boolean {
        return scene.disposed;
      },
      get visible(): boolean {
        return scene.visible;
      },
      get launchAt(): number | undefined {
        return scene.launchAt;
      },
      get screen(): Application['screen'] {
        return scene.app.screen;
      },
      get app(): Application {
        return scene.app;
      },
      get host(): PixiSceneHost | undefined {
        return scene.host;
      },
      get mountedContainer(): HTMLElement | undefined {
        return scene.mountedContainer;
      },
      get options(): CoreSongSelectViewOptions {
        return scene.options;
      },
      get themeDesignSize(): SelectDesignSize | undefined {
        return scene.themeDesignSize;
      },
      get beMusicDesignSize(): SelectDesignSize {
        return scene.view.beMusicDesignSize;
      },
      get beMusicSelectLayout(): BeMusicSelectLayout {
        return scene.view.beMusicSelectLayout;
      },
      get beMusicRenderer(): BeMusicSelectBinding | undefined {
        return scene.view.beMusicRenderer;
      },
      get beMusicNeedsFrame(): boolean {
        return scene.view.beMusicNeedsFrame;
      },
      set beMusicNeedsFrame(value: boolean) {
        scene.view.beMusicNeedsFrame = value;
      },
      get songImages(): SongImageCache | undefined {
        return scene.view.songImages;
      },
      get sceneStartedAt(): number {
        return scene.sceneStartedAt;
      },
      get selectedIndex(): number {
        return scene.selectedIndex;
      },
      get browseStack(): readonly BrowserFolderNode[] {
        return scene.session.browseStack;
      },
      get playOptions(): PixiPlayOptions {
        return scene.playOptions;
      },
      get panelStates(): Set<number> {
        return scene.panelStates;
      },
      get searchQuery(): string {
        return scene.session.searchQuery;
      },
      get searchEditing(): boolean {
        return scene.searchEditing;
      },
      get mouseX(): number {
        return scene.mouseX;
      },
      set mouseX(value: number) {
        scene.mouseX = value;
      },
      get mouseY(): number {
        return scene.mouseY;
      },
      set mouseY(value: number) {
        scene.mouseY = value;
      },
      get readTextOpen(): boolean {
        return scene.view.readText.readTextOpen;
      },
      scrollReadText: (delta) => scene.view.readText.scrollReadText(delta),
      closeReadText: () => scene.view.readText.closeReadText(),
      playOneShotSound: (name) => scene.audio.playOneShotSound(name),
      startSelectBgm: () => scene.audio.startSelectBgm(),
      refreshChartPreview: () => scene.refreshChartPreview(),
      resolveDesignSize: () => scene.view.resolveDesignSize(),
      currentEntries: () => scene.currentEntries(),
      focusedSong: () => scene.focusedSong(),
      focusedCourse: () => scene.focusedCourse(),
      moveCursorBy: (steps) => scene.session.moveCursorBy(steps),
      stepCursor: (direction) => scene.session.stepCursor(direction),
      jumpCursor: (index) => scene.session.jumpCursor(index),
      noteCursorChange: (delta) => scene.noteCursorChange(delta),
      activateFocused: () => scene.activateFocused(),
      leaveFolder: () => scene.session.leaveFolder(),
      togglePanel: (which) => scene.togglePanel(which),
      adjustHiSpeed: (direction) => scene.adjustHiSpeed(direction),
      cyclePlayOption<K extends keyof PixiPlayOptions>(key: K, cycle: readonly PixiPlayOptions[K][]): void {
        scene.cyclePlayOption(key, cycle);
      },
      setSkinPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
        scene.session.setSkinPlayOption(key, value);
      },
      launchFocusedSong: (autoPlay) => scene.launchFocusedSong(autoPlay),
      toggleReadText: (song) => scene.toggleReadText(song),
      applyLr2Timers: (update) => scene.applyLr2Timers(update),
      handleThemePointerDown: (virtualX, virtualY) => scene.handleThemePointerDown(virtualX, virtualY),
      renderTheme: (designWidth, designHeight) => scene.renderTheme(designWidth, designHeight),
      render: () => scene.render(),
    };
  }

  /**
   * Returns a shallow snapshot of the current play-option state. The host typically calls this from `onSongSelected` /
   * `onSongAutoPlay` and forwards the values onto {@link PixiGameplayViewOptions}.
   */
  /**
   * Replaces the player's values for the be-music skin's `settings` (see the `beMusicSkinSettings` option); the skin
   * draws with them from the next frame. `undefined` goes back to the skin's defaults.
   */
  public setBeMusicSkinSettings(stored: Readonly<Record<string, unknown>> | undefined): void {
    this.view.beMusicSkinSettings = stored;
    this.view.beMusicRenderer?.setSettings(stored);
  }

  public getPlayOptions(): PixiPlayOptions {
    return { ...this.playOptions };
  }

  /**
   * Merges `partial` onto the live play-option state and re-renders if the panel is open. Allows hosts to seed values
   * from external sources (e.g. a settings menu, URL flag, prior session snapshot) without bouncing through the
   * in-scene panel.
   */
  public setPlayOptions(partial: Partial<PixiPlayOptions>): void {
    this.session.setPlayOptions(partial);
  }

  /**
   * Replaces the looping select-screen BGM. Pass `undefined` to mute. Existing playback is stopped (and its decoded
   * buffer discarded) before the new bytes are queued for decode on the next user gesture.
   *
   * Hosts use this to swap BGM when the user drops a fresh theme mid-session — the constructor-time `selectBgm` option
   * only seeds the initial state.
   */
  public setSelectBgm(bytes: Uint8Array | undefined): void {
    this.audio.setSelectBgm(bytes);
  }

  /**
   * Replaces the one-shot song-decided sound (`decide.wav`). Pass `undefined` to disable. Drops any cached decoded
   * buffer — the next `playDecideSound` call will decode the new bytes.
   */
  public setDecideBgm(bytes: Uint8Array | undefined): void {
    this.audio.setOneShotBytes('decide', bytes);
  }

  /**
   * Replaces the LR2 system sound-effect bundle. Each field is an independent bytes payload that drops + re-decodes on
   * change (next play call decodes the new bytes). Missing entries clear the previous binding so a theme without a
   * particular effect simply silences that cue.
   */
  public setSystemSounds(sounds: PixiSongSelectSystemSounds | undefined): void {
    this.audio.setSystemSounds(sounds);
  }

  /**
   * Plays the decide sound once. Used by hosts on the select → gameplay transition. See {@link
   * SelectAudio.playOneShotSound} for the shared decode / autoplay-policy semantics.
   */
  public async playDecideSound(): Promise<void> {
    await this.audio.playOneShotSound('decide');
  }

  public get identity(): SceneIdentity {
    return IDENTITY;
  }

  /**
   * Convenience accessor for the host's `Application`. Throws if called before {@link enter}; same contract as the
   * gameplay scene.
   */
  protected get app(): Application {
    if (!this.host) {
      throw new Error('PixiSongSelectView: app accessed before enter');
    }
    return this.host.app;
  }

  /**
   * Shows the select screen (see {@link PixiScene.enter}). The first entry builds the scene graph, wires keyboard and
   * pointer input and starts the BGM, the chart preview and the render loop. A later one — back from a decide, play or
   * result screen — re-seeds the scene timers so the skin's entrance plays again and resumes what {@link exit} paused.
   */
  public enter(host: PixiSceneHost): void {
    if (this.disposed) return;
    if (this.host === undefined) {
      this.build(host);
      return;
    }
    if (this.visible) return;
    this.visible = true;
    this.root.visible = true;
    // Re-seed scene-mount timers so DST animations anchored to timer 0 / 11 (slide-in, fade-in, bar pulses) replay on
    // re-entry from a play session — see `resetSceneTimers` for the rationale. Without this the persistent select
    // scene's `sceneStartedAt` would be minutes-stale on return.
    this.resetSceneTimers();
    this.startAnimationLoop();
    // Resume the BGM. Always safe — a no-op if no BGM is set or if a gesture hasn't unlocked the AudioContext yet.
    void this.audio.startSelectBgm();
    // Re-arm the chart preview against the focused song. On back-from-play the engine was stopped by the prior
    // `exit()` and the cursor likely moved while off stage (folder unwind etc.); kicking it here makes the preview
    // start matching the current focus rather than the stale one we left mid-play with.
    this.refreshChartPreview();
  }

  /**
   * Leaves the stage (see {@link PixiScene.exit}): pauses the BGM so it doesn't bleed into gameplay audio, silences the
   * chart preview and stops the render loop. The decoded BGM stays cached so the next {@link enter} is an instant
   * resume. The keyboard and pointer listeners stay attached and ignore input until then (`visible`), as both scenes'
   * keydown listeners sit on the window.
   */
  public exit(): void {
    if (this.disposed || !this.visible) return;
    this.visible = false;
    this.root.visible = false;
    this.audio.pauseSelectBgm();
    // Always silence the preview when leaving the scene. Otherwise a 1-second focus delay that hadn't fired would have
    // spent its `setTimeout` budget while the user was already in gameplay and start blasting keysounds through the
    // gameplay AudioContext on top of the chart.
    this.audio.chartPreviewEngine?.stop();
    this.stopAnimationLoop();
  }

  /** The first {@link enter}: builds the scene graph under {@link root}, wires input and starts the screen. */
  private build(host: PixiSceneHost): void {
    this.host = host;
    this.mountedContainer = host.app.canvas.parentElement ?? undefined;
    this.view.build();
    // Bind keyboard handlers at the window level so the user can navigate without first clicking the canvas. The canvas
    // itself is a child of the document body and naturally won't have focus until interacted with — which would
    // otherwise eat ↑/↓/Enter/Esc. Pointer events still bind on the canvas because their offset coordinates are
    // canvas-relative.
    window.addEventListener('keydown', this.keys.handleKeyDown);
    host.app.canvas.addEventListener('pointerdown', this.pointer.handlePointerDown);
    host.app.canvas.addEventListener('pointermove', this.pointer.handlePointerMove);
    host.app.canvas.addEventListener('pointerleave', this.pointer.handlePointerLeave);
    host.app.canvas.addEventListener('pointerup', this.pointer.handlePointerUp);
    host.app.canvas.addEventListener('pointercancel', this.pointer.handlePointerCancel);
    // Wheel scroll → cursor move. `passive: false` so we can call preventDefault and stop the page from scrolling under
    // the floating debug toolbar (which would otherwise compete for wheel events when the canvas is full-screen).
    host.app.canvas.addEventListener('wheel', this.pointer.handleWheel, { passive: false });
    this.prepareTheme();
    this.resetSceneTimers();
    this.render();
    this.startAnimationLoop();
    // Try to start the BGM eagerly. Browsers gate `AudioContext.resume()` behind a user gesture; if no gesture has
    // happened yet the start sits idle until the first pointerdown / keydown handler retries it.
    void this.audio.startSelectBgm();
    // Arm the preview engine for the initial focus so the user hears the bar-under-cursor without having to first nudge
    // the cursor. Same gesture-gating caveat as BGM applies — the engine schedules a `setTimeout`, but the underlying
    // AudioContext stays suspended until the first user input.
    this.refreshChartPreview();
  }

  /**
   * Re-seeds every scene-mount timer to "now" plus clears any leftover scroll state. Called on every {@link enter}
   * (the initial one and the return from a play session) so DST keyframe sequences anchored
   * to timer 0 re-fire on every entry — matching what real LR2 does, where each `select` scene transition restarts the
   * slide-in / fade- in animations from `time = 0`.
   *
   * Without this on the round-trip path, the persistent select scene would keep its mount-time `sceneStartedAt` across
   * the play session: by the time the player returns, the elapsed time is well past every keyframe window in the LR2
   * default skin (150–450 ms per slot), so bars appear pinned at their final positions with no animation.
   */
  private resetSceneTimers(): void {
    this.sceneStartedAt = performance.now();
    // Seed timer 0 (scene main) — every static skin element is anchored to it, so the keyframe interpolator needs to
    // know when "now=0" was. We don't seed timer 1 here; themes (the LR2 scene's `elapsedSinceTimer`) compute its fire
    // moment from `#STARTINPUT` lazily.
    this.timerStartedAt.clear();
    // Timer 11 (song change) fires too, so the BAR_BODY slide-in animations play once on every appearance, as in LR2
    // when the cursor lands on the first song.
    this.applyLr2Timers(resolveLr2SelectTimers({ kind: 'scene-start', at: this.sceneStartedAt }));
    // Drop any leftover smooth-scroll state from a previous session — the cursor isn't moving on re-entry, and a stale
    // `dt` from before the play round-trip would otherwise feed the decay formula a multi-minute interval and either
    // NaN or instantly zero out a fresh offset (depending on Math.exp's behavior).
    this.view.listScrollOffset = 0;
    this.view.lastScrollUpdate = 0;
    // Reset the wheel throttle so the first wheel tick after a re-mount fires immediately rather than being eaten by
    // a stale `lastWheelMoveAt` from before the play round-trip.
    this.pointer.lastWheelMoveAt = Number.NEGATIVE_INFINITY;
  }

  /**
   * Re-stamps the song-list timers (10, 11, 12 / 13) so DST keyframes anchored to them replay from the new "time = 0",
   * and seeds the smooth-scroll offset so the bars visually slide between their old and new slot positions. Called
   * whenever the cursor moves — by keyboard, click, or folder navigation.
   *
   * `delta` is the **wrapped** offset applied to `selectedIndex` (always within `(-length/2, length/2]`) — wrap-around
   * moves (e.g. last → first via ↓) animate as a single step in the visual direction rather than a long slide across
   * the whole list.
   *
   * Direction-specific timers (12=up, 13=down) follow the LR2 spec (`docs/LR2SkinHelp.md` lines 5097+); the canonical
   * "song change" slide is anchored to timer 11 in the LR2 default play-side and select-side skins, so we always
   * restart that one regardless of direction.
   */
  protected noteCursorChange(delta: number): void {
    // Cursor moved → readtext modal's content no longer matches the focused song. Close it without an audible cue (the
    // `cursor-move` click below already conveys the bar move) so the user doesn't get a double-blip on every wheel
    // notch.
    if (this.view.readText.readTextOpen) {
      this.view.readText.readTextOpen = false;
      this.view.readText.readTextLayer.visible = false;
    }
    const now = performance.now();
    this.view.cursorChangedAt = now;
    this.applyLr2Timers(resolveLr2SelectTimers({ kind: 'cursor', delta, at: now }));
    // Seed the scroll offset only for themes that slide their list layer. The be-music chrome is also mounted on
    // `listLayer`, so offsetting that layer would scroll the entire screen. In that path, cursor movement simply changes
    // the active row.
    if (this.themeDesignSize) {
      const slotHeight = this.themeListSlotHeight();
      this.view.listScrollOffset += delta * slotHeight;
    } else {
      this.view.listScrollOffset = 0;
    }
    // LR2 system effect — `Sound\lr2\scratch.wav` fires on every bar move regardless of direction. Fire-and-forget; the
    // one-shot decode caches after the first use so a fast wheel-scroll doesn't thrash the audio decoder.
    void this.audio.playOneShotSound('cursor-move');
    // Re-arm the chart preview against the (potentially) new focused song. The engine owns the focus-settle delay, so a
    // fast scroll past dozens of bars only ever schedules one start once the cursor finally rests.
    this.refreshChartPreview();
  }

  /**
   * Attaches the keyframe-driven re-render handler to the host's shared `app.ticker` so DST keyframe sequences (intro
   * slide-in, loop animations, focused-bar pulse, etc.) play out. The handler is bound once at construction
   * ({@link tickerHandle}); this method just registers it. The previous implementation kicked its own
   * `requestAnimationFrame` chain, which ran alongside PixiJS's auto-render ticker — fixing the double-RAF doubles the
   * frame budget available to the select scene.
   */
  private startAnimationLoop(): void {
    if (this.tickerAttached || !this.host) {
      return;
    }
    this.host.app.ticker.add(this.tickerHandle);
    this.tickerAttached = true;
  }

  private stopAnimationLoop(): void {
    if (!this.tickerAttached) {
      return;
    }
    this.host?.app.ticker.remove(this.tickerHandle);
    this.tickerAttached = false;
  }

  /**
   * One tick of the keyframe-driven re-render loop. Mirrors the body of the previous rAF callback verbatim — the only
   * change is the scheduling layer (shared ticker now drives the cadence). Skips when hidden (host swapped to
   * gameplay) so we don't burn CPU on a `display:none` canvas; the ticker stays registered so DST animations resume
   * cleanly the moment the scene becomes visible again.
   */
  private tickFrame(): void {
    if (!this.visible) {
      this.pointer.fling = undefined;
      return;
    }
    this.perf.beginTick();
    const tickNow = performance.now();
    this.pointer.advanceFling(tickNow);
    this.pointer.settleListPull(tickNow);
    if (this.themeDesignSize) {
      this.perf.time('render', () => this.render());
    } else {
      const now = performance.now();
      // The skinless chrome is rebuilt only on input; keep re-rendering while a slide-in is still in flight. Driven by
      // the last render's own state (not a time window) so a long frame hitch can't strand a half-finished slide.
      // Also re-render when the screen was resized: a rotation can switch the skin to its other stage.
      const screen = this.app.screen;
      if (
        this.view.beMusicNeedsFrame ||
        screen.width !== this.view.cachedScreenWidth ||
        screen.height !== this.view.cachedScreenHeight
      ) {
        this.perf.time('render', () => this.render());
      }
      if (this.view.beMusicBackHolder.visible && this.view.beMusicRenderer) {
        const { width, height } = this.view.beMusicDesignSize;
        const onStage = this.mouseX >= 0 && this.mouseY >= 0 && this.mouseX < width && this.mouseY < height;
        this.view.beMusicRenderer.setPointer(onStage ? this.mouseX : undefined, onStage ? this.mouseY : undefined);
        this.view.beMusicRenderer.setListScroll(this.pointer.shownListPull());
        this.view.beMusicRenderer.tick(
          now,
          this.focusedSong(),
          this.launchAt,
          this.audio.selectAudioAnalyzer?.sample(now),
        );
      }
    }
    const report = this.perf.endFrame(() => ({
      skin: this.skinLayer.children.length,
      list: this.listLayer.children.length,
      songs: this.collection.songs.length,
    }));
    if (report) {
      // High-volume (~every sampled frame) — keep on the verbose-only `debug` level so it doesn't drown out the
      // host's Info console.
      log.debug('perf', report);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopAnimationLoop();
    if (this.session.launchTimer !== undefined) window.clearTimeout(this.session.launchTimer);
    this.view.beMusicRenderer?.dispose();
    this.view.beMusicRenderer = undefined;
    this.view.songImages?.dispose();
    this.view.songImages = undefined;
    window.removeEventListener('keydown', this.keys.handleKeyDown);
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.pointer.handlePointerDown);
      this.host.app.canvas.removeEventListener('pointermove', this.pointer.handlePointerMove);
      this.host.app.canvas.removeEventListener('wheel', this.pointer.handleWheel);
      this.host.app.canvas.removeEventListener('pointerleave', this.pointer.handlePointerLeave);
      this.host.app.canvas.removeEventListener('pointerup', this.pointer.handlePointerUp);
      this.host.app.canvas.removeEventListener('pointercancel', this.pointer.handlePointerCancel);
    }
    this.audio.dispose();
    // Detach our scene-graph subtree from the host's stage. The host owns the `Application` lifetime; it (or whoever
    // else owns the host) is responsible for `app.destroy()`.
    if (this.root.parent) {
      this.root.parent.removeChild(this.root);
    }
    try {
      this.disposeTheme();
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    try {
      this.root.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('root.destroy threw', error);
    }
    this.host = undefined;
    this.mountedContainer = undefined;
  }

  /**
   * Restores a browse position (`BrowseSnapshot`, as {@link getNavigation} returns it) on the live view, over the
   * library it has now: e.g. when the host puts back the position it saved before a play.
   */
  public setNavigation(snapshot: BrowseSnapshot): void {
    this.session.setNavigation(snapshot);
  }

  /** Whether the select screen is showing: entered, and not exited for a decide / play / result screen since. */
  public isVisible(): boolean {
    return this.visible;
  }

  // The select scene's host API under `createSelectScene`'s names (`SelectScene`), so a host drives this scene and the
  // built-in one alike until the LR2 select screen moves onto `createSelectScene` too.

  /** {@link isVisible}, under `SessionScene`'s name. */
  public get entered(): boolean {
    return this.host !== undefined && this.visible && !this.disposed;
  }

  /** {@link getNavigation}, under `SelectScene`'s name. */
  public snapshot(): BrowseSnapshot {
    return this.getNavigation();
  }

  /** {@link getFocusedEntry}, under `SelectScene`'s name. */
  public focused(): BrowserBrowseEntry | undefined {
    return this.getFocusedEntry();
  }

  /** {@link setCollection}, under `SelectScene`'s name. */
  public setLibrary(collection: BrowserSongCollection): void {
    this.setCollection(collection);
  }

  /** {@link setNavigation}, under `SelectScene`'s name. */
  public restore(snapshot: BrowseSnapshot): void {
    this.setNavigation(snapshot);
  }

  /** {@link setSearchQuery}, under `SelectScene`'s name. */
  public setSearch(text: string): void {
    this.setSearchQuery(text);
  }

  /** {@link getSearchFieldRect}, under `SelectScene`'s name. */
  public searchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    return this.getSearchFieldRect();
  }

  /** Redraws the bars and panels with the records as they are now, as `SelectScene.refreshRecords` does. */
  public refreshRecords(): void {
    if (this.host !== undefined && !this.disposed) this.render();
  }

  /**
   * Takes a theme's sounds as a `SystemSoundSet` (by bytes): its select BGM, its decide jingle and its cues, for
   * {@link setSelectBgm}, {@link setDecideBgm} and {@link setSystemSounds}.
   */
  public setSounds(sounds: SystemSoundSet): void {
    this.setSelectBgm(sounds.selectBgm?.bytes);
    this.setDecideBgm(sounds.decideBgm?.bytes);
    this.setSystemSounds({
      cursorMove: sounds.cursor?.bytes,
      folderOpen: sounds.folderOpen?.bytes,
      folderClose: sounds.folderClose?.bytes,
      optionOpen: sounds.optionOpen?.bytes,
      optionClose: sounds.optionClose?.bytes,
      optionChange: sounds.optionChange?.bytes,
    });
  }

  public setCollection(collection: BrowserSongCollection): void {
    this.session.setCollection(collection);
  }

  /**
   * The browse position as plain data (`captureBrowse` of `@be-music/scene-model`), to hand back to {@link
   * setNavigation} or `initialNavigation` later: the open folders by label, the cursor at every depth, the bar under the
   * cursor by its key, the search and the list options. The library's folders are rebuilt on every `setCollection`, so
   * nothing in it refers to them.
   */
  public getNavigation(): BrowseSnapshot {
    return this.session.getNavigation();
  }

  /** The bar under the cursor (a folder, song or course), or `undefined` when the list is empty. */
  public getFocusedEntry(): BrowserBrowseEntry | undefined {
    return this.session.focusedEntry();
  }

  /**
   * Sets the search and re-renders. The bar list filters entries by title / subtitle / artist / genre / file label /
   * folder label / course name, by the query trimmed and lower-cased. Pass `''` (empty) to clear the filter. A changed
   * query puts the cursor on the top of the new list (`reduceBrowse`'s `search`).
   */
  public setSearchQuery(query: string): void {
    this.session.setSearchQuery(query);
  }
  /**
   * Tells the scene the host's text field sits over the search box (`true`) or has left it (`false`). While it does,
   * skins leave the box's text to the field, so the query is not drawn twice.
   */
  public setSearchEditing(editing: boolean): void {
    this.session.setSearchEditing(editing);
  }

  /**
   * Where the skin's search box is on the canvas, in CSS pixels from the canvas's top-left corner, or `undefined` when
   * the skin has none (or nothing has been drawn yet). Hosts lay their text field over it to edit the query in place.
   */
  public getSearchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    const rect = this.designSearchFieldRect();
    const viewport = this.view.lastViewport;
    if (rect === undefined || viewport === undefined) return undefined;
    return designRectToCanvas(rect, viewport);
  }

  /** The search box in design pixels: the be-music skin's search hit area. Theme scenes override it. */
  protected designSearchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    return this.themeDesignSize === undefined ? this.view.beMusicRenderer?.searchFieldRect : undefined;
  }

  /** Draws the empty-library hint into `skinLayer`; themes call it from {@link renderTheme}. */
  protected renderEmptyStateHint(designWidth: number, designHeight: number): void {
    renderEmptyStateHint(this.context, designWidth, designHeight);
  }

  /** Toggles the README overlay for `song` (`SelectReadTextOverlay.toggleReadText`). */
  protected toggleReadText(song: BrowserSongEntry): void {
    this.view.readText.toggleReadText(song);
  }

  // The scene's state and operations as theme scenes (the LR2 select) read and call them, kept over the parts that now
  // hold them.

  /** Theme chrome drawn behind the song list (`LegacySelectView.skinLayer`). */
  protected get skinLayer(): Container {
    return this.view.skinLayer;
  }

  /** Theme chrome drawn on top of the song list (`LegacySelectView.skinForegroundLayer`). */
  protected get skinForegroundLayer(): Container {
    return this.view.skinForegroundLayer;
  }

  /** The song bars (`LegacySelectView.listLayer`). */
  protected get listLayer(): Container {
    return this.view.listLayer;
  }

  /** The list's slide offset after a cursor move (`LegacySelectView.listScrollOffset`). */
  protected get listScrollOffset(): number {
    return this.view.listScrollOffset;
  }

  /** The library (`LegacySelectSession.collection`). */
  protected get collection(): BrowserSongCollection {
    return this.session.collection;
  }

  /** The cursor into {@link currentEntries} (`LegacySelectSession.selectedIndex`). */
  protected get selectedIndex(): number {
    return this.session.selectedIndex;
  }

  /** The live play options (`LegacySelectSession.playOptions`). */
  protected get playOptions(): PixiPlayOptions {
    return this.session.playOptions;
  }

  /** The LR2 option panels open (`LegacySelectSession.panelStates`). */
  protected get panelStates(): Set<number> {
    return this.session.panelStates;
  }

  /** The search query as typed (`LegacySelectSession.searchText`). */
  protected get searchText(): string {
    return this.session.searchText;
  }

  /** Whether the host's text field is over the search box (`LegacySelectSession.searchEditing`). */
  protected get searchEditing(): boolean {
    return this.session.searchEditing;
  }

  /** When a launch whose be-music outro is still playing started (`LegacySelectSession.launchAt`). */
  protected get launchAt(): number | undefined {
    return this.session.launchAt;
  }

  /** Whether an element gated on `panel` draws (`LegacySelectSession.isPanelOpen`); an arrow, so it can be passed on. */
  protected readonly isPanelOpen = (panel: number): boolean => this.session.isPanelOpen(panel);

  /** The bars listed (`LegacySelectSession.currentEntries`). */
  protected currentEntries(): readonly BrowserBrowseEntry[] {
    return this.session.currentEntries();
  }

  /** The song under the cursor (`LegacySelectSession.focusedSong`). */
  protected focusedSong(): BrowserSongEntry | undefined {
    return this.session.focusedSong();
  }

  /** The course under the cursor (`LegacySelectSession.focusedCourse`). */
  protected focusedCourse(): BrowserCourseEntry | undefined {
    return this.session.focusedCourse();
  }

  /** Opens the folder bar, starts the song bar or hands the course bar under the cursor to the host. */
  protected activateFocused(): void {
    this.session.activateFocused();
  }

  /** Moves the cursor `delta` bars in one move, wrapping past either end (`LegacySelectSession.moveCursor`). */
  protected moveCursor(delta: number): void {
    this.session.moveCursor(delta);
  }

  /** Opens or closes LR2 panel `which` (`LegacySelectSession.togglePanel`). */
  protected togglePanel(which: number): void {
    this.session.togglePanel(which);
  }

  /** Steps the hi-speed (`LegacySelectSession.adjustHiSpeed`). */
  protected adjustHiSpeed(direction: 1 | -1): void {
    this.session.adjustHiSpeed(direction);
  }

  /** Steps an enum play option through `cycle` (`LegacySelectSession.cyclePlayOption`). */
  protected cyclePlayOption<K extends keyof PixiPlayOptions>(key: K, cycle: readonly PixiPlayOptions[K][]): void {
    this.session.cyclePlayOption(key, cycle);
  }

  /** Sets a play option (`LegacySelectSession.setPlayOption`). */
  protected setPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
    this.session.setPlayOption(key, value);
  }

  /** PLAY / AUTO on the bar under the cursor (`LegacySelectSession.launchFocusedSong`). */
  protected launchFocusedSong(autoPlay: boolean): void {
    this.session.launchFocusedSong(autoPlay);
  }

  /** Hands `song` to the host (`LegacySelectSession.launchSong`). */
  protected launchSong(song: BrowserSongEntry, autoPlay = false): void {
    this.session.launchSong(song, autoPlay);
  }

  /** Points the chart preview at the bar under the cursor (`SelectAudio.refreshChartPreview`). */
  protected refreshChartPreview(): void {
    this.audio.refreshChartPreview();
  }

  /** Draws one frame (`LegacySelectView.render`). */
  protected render(): void {
    this.view.render();
  }

  /**
   * Theme hook: the design canvas the skin family renders into, or `undefined` when no theme is active and the frame
   * falls back to the be-music skin. Every other `theme*` hook only runs while this returns a size.
   */
  protected get themeDesignSize(): SelectDesignSize | undefined {
    return undefined;
  }

  /** Theme hook: kicks off async asset loads (textures, fonts) on the first entry. Default: nothing to load. */
  protected prepareTheme(): void {}

  /**
   * Theme hook: paints one frame into `skinLayer` / `listLayer` / `skinForegroundLayer` (already cleared, with
   * `listLayer.y` set to the smooth-scroll offset). The core draws the readtext overlay on top afterwards.
   */
  protected renderTheme(_designWidth: number, _designHeight: number): void {}

  /**
   * Theme hook: vertical pitch between adjacent list rows, used to seed the smooth-scroll offset so a one-step cursor
   * move slides the list by one row.
   */
  protected themeListSlotHeight(): number {
    return 0;
  }

  /** Theme hook: handles a canvas click at design-space `(virtualX, virtualY)` (the readtext modal is closed). */
  protected handleThemePointerDown(_virtualX: number, _virtualY: number): void {}

  /** Theme hook: releases theme-owned GPU resources on {@link dispose}. Exceptions are caught and logged. */
  protected disposeTheme(): void {}
}

// The search and cursor rules of the browse model in `@be-music/scene-model`, re-exported under the names this module
// has always used.
export { matchesSearchQuery, wrappedCursorDelta };
