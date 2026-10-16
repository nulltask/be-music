/**
 * The select screen's browsing on the built-in and LR2 select scenes (`CoreSongSelectView`): the library and where the
 * player is in it, as the browse model of `@be-music/scene-model` keeps it (`BrowseState`, changed by `reduceBrowse`,
 * the list shown derived by `browseEntries`), the play options and the LR2 option panels, the search, and starting a
 * chart or a course. What the browse model leaves to the screen (a back-out at the root, a library of one folder, where
 * the sort and the filters live) comes from the family's select policy (`select-policy.ts`).
 *
 * The session reads and drives the rest of the scene through {@link LegacySelectSessionContext}; the scene passes it.
 */

import { resolveLr2SelectTimers, type Lr2TimerUpdate } from '@be-music/lr2-skin/state';
import { GAUGE_TYPES } from '@be-music/player/ruleset';
import {
  BGA_CYCLE,
  BGA_SIZE_CYCLE,
  browseCursor,
  browseEntries,
  browseSystemSound,
  captureBrowse,
  clampHiSpeed,
  clampShutter,
  createBrowseState,
  DEFAULT_PLAY_OPTIONS,
  DIFFICULTY_FILTER_CYCLE,
  focusedChart,
  focusedCourse,
  focusedEntry,
  HIDDEN_SUDDEN_CYCLE,
  HS_FIX_CYCLE,
  isListPlayOption,
  KEYS_FILTER_CYCLE,
  nextChoice,
  normalizeSearchQuery,
  RANDOM_CYCLE,
  reduceBrowse,
  resolvePlayOptionValue,
  sameBrowseListOptions,
  SORT_CYCLE,
  type BrowseCommand,
  type BrowseEvent,
  type BrowseListOptions,
  type BrowseSnapshot,
  type BrowseState,
  type SystemSoundSlot,
} from '@be-music/scene-model';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongCollection,
  BrowserSongEntry,
} from '../../../collection/types.ts';
import type { CoreSongSelectViewOptions, PixiPlayOptions, SelectDesignSize } from '../select.ts';
import { HISPEED_STEP } from '../../hi-speed.ts';
import type { BeMusicSelectBinding } from '../../../skin/be-music/binding.ts';
import type { SongImageCache } from '../../../skin/be-music/song-images.ts';
import {
  openLibrary,
  restoreSelectBrowse,
  SELECT_POLICIES,
  type SelectPolicy,
} from '../../../session/select/select-policy.ts';

/** What the session reads and drives on the select scene: its fields and methods of these names. */
export interface LegacySelectSessionContext {
  readonly options: Readonly<
    Pick<
      CoreSongSelectViewOptions,
      | 'initialNavigation'
      | 'onSongSelected'
      | 'onSongAutoPlay'
      | 'onCourseSelected'
      | 'onCourseAutoPlay'
      | 'onPlayOptionsChange'
      | 'beMusicEffects'
    >
  >;
  readonly disposed: boolean;
  readonly themeDesignSize: SelectDesignSize | undefined;
  /** The be-music skin's binding, for the length of its launch outro. */
  readonly beMusicRenderer: BeMusicSelectBinding | undefined;
  /** Whether the be-music skin needs another frame: set while a launch outro plays. */
  beMusicNeedsFrame: boolean;
  /** The be-music skin's song images, dropped when the library changes. */
  readonly songImages: SongImageCache | undefined;
  render(): void;
  refreshChartPreview(): void;
  /** The cursor moved `delta` bars (a folder opened: `1`, closed: `-1`): slide the list, restart its timers, cue it. */
  noteCursorChange(delta: number): void;
  playOneShotSound(name: string): Promise<void>;
  applyLr2Timers(update: Lr2TimerUpdate): void;
}

/**
 * The scene's one-shot sound for each system sound slot a browse command plays (`browseSystemSound`). The cursor cue
 * plays with the list's slide (`noteCursorChange`), so it is not listed here.
 */
const ONE_SHOT_OF_SLOT: { readonly [S in SystemSoundSlot]?: string } = {
  folderOpen: 'folder-open',
  folderClose: 'folder-close',
  optionChange: 'option-change',
};

const EMPTY_COLLECTION: BrowserSongCollection = { sources: [], songs: [], errors: [] };

/** The list options the play options hold. */
function listOptionsOf(options: PixiPlayOptions): BrowseListOptions {
  return { sort: options.sort, keysFilter: options.keysFilter, difficultyFilter: options.difficultyFilter };
}

/** The select screen's browsing. See the module comment. */
export class LegacySelectSession {
  private readonly ctx: LegacySelectSessionContext;
  /** What the browse model leaves to the screen: the built-in and LR2 screens share LR2's. */
  private readonly policy: SelectPolicy = SELECT_POLICIES.lr2;

  collection: BrowserSongCollection = EMPTY_COLLECTION;
  /**
   * Where the player is in the library and how the list is shaped: the open folders, the cursor at each depth, the
   * search and the list options (`@be-music/scene-model`). Its list options are the play options' sort and filters.
   */
  browse: BrowseState = createBrowseState();
  /**
   * Live play-option state, mutated by the in-scene panel buttons (LR2 `#SRC_BUTTON,type=40..58` etc.) and read by the
   * host via `getPlayOptions` at gameplay-launch time. Initialized from `initialPlayOptions` (overlaid on {@link
   * DEFAULT_PLAY_OPTIONS}) at construction. Its sort and filters shape the list ({@link browse}).
   */
  playOptions: PixiPlayOptions = { ...DEFAULT_PLAY_OPTIONS };
  /**
   * Set of currently-open LR2 panels (1..9). Feeds the panel ops of `resolveLr2SelectState` and gates panel-scoped `#SRC_*`
   * elements via {@link isPanelOpen}. Convention: panel 1 is the play- options panel — opened with the START button
   * (Enter / Space) per LR2's select-skin spec (LR2SkinHelp line 9101).
   *
   * Multiple panels can be open simultaneously per spec (the FX panel and the play-options panel coexist on real LR2
   * setups); `togglePanel` flips one slot at a time so the user explicitly controls which panels are stacked.
   */
  readonly panelStates: Set<number> = new Set<number>();
  /** Whether the host's text field is laid over the search box: the skin then leaves the box's text to it. */
  searchEditing = false;

  public constructor(ctx: LegacySelectSessionContext) {
    this.ctx = ctx;
  }

  /** The cursor in the list shown. */
  get selectedIndex(): number {
    return browseCursor(this.browse);
  }

  /** The open folders, root first; empty at the root. */
  get browseStack(): readonly BrowserFolderNode[] {
    return this.browse.path;
  }

  /** The query as typed (case and spaces kept), for skins that show it. */
  get searchText(): string {
    return this.browse.searchText;
  }

  /** The search the list is filtered by: trimmed and lower-cased; empty for none. */
  get searchQuery(): string {
    return normalizeSearchQuery(this.browse.searchText);
  }

  /** See `CoreSongSelectView.setPlayOptions`. */
  setPlayOptions(partial: Partial<PixiPlayOptions>): void {
    const next = { ...this.playOptions, ...partial };
    next.hiSpeed = clampHiSpeed(next.hiSpeed);
    if (!BGA_CYCLE.includes(next.bga)) next.bga = DEFAULT_PLAY_OPTIONS.bga;
    if (!BGA_SIZE_CYCLE.includes(next.bgaSize)) next.bgaSize = DEFAULT_PLAY_OPTIONS.bgaSize;
    if (typeof next.scoreGraph !== 'boolean') next.scoreGraph = DEFAULT_PLAY_OPTIONS.scoreGraph;
    if (!DIFFICULTY_FILTER_CYCLE.includes(next.difficultyFilter)) {
      next.difficultyFilter = DEFAULT_PLAY_OPTIONS.difficultyFilter;
    }
    if (!KEYS_FILTER_CYCLE.includes(next.keysFilter)) {
      next.keysFilter = DEFAULT_PLAY_OPTIONS.keysFilter;
    }
    if (!SORT_CYCLE.includes(next.sort)) {
      next.sort = DEFAULT_PLAY_OPTIONS.sort;
    }
    if (!HS_FIX_CYCLE.includes(next.hsFix)) {
      next.hsFix = DEFAULT_PLAY_OPTIONS.hsFix;
    }
    if (!HIDDEN_SUDDEN_CYCLE.includes(next.hiddenSudden1P)) {
      next.hiddenSudden1P = DEFAULT_PLAY_OPTIONS.hiddenSudden1P;
    }
    if (!HIDDEN_SUDDEN_CYCLE.includes(next.hiddenSudden2P)) {
      next.hiddenSudden2P = DEFAULT_PLAY_OPTIONS.hiddenSudden2P;
    }
    next.shutter = clampShutter(next.shutter);
    if (typeof next.autoScratch1P !== 'boolean') next.autoScratch1P = DEFAULT_PLAY_OPTIONS.autoScratch1P;
    if (typeof next.autoScratch2P !== 'boolean') next.autoScratch2P = DEFAULT_PLAY_OPTIONS.autoScratch2P;
    if (typeof next.dpFlip !== 'boolean') next.dpFlip = DEFAULT_PLAY_OPTIONS.dpFlip;
    if (!RANDOM_CYCLE.includes(next.random1P)) next.random1P = DEFAULT_PLAY_OPTIONS.random1P;
    if (!RANDOM_CYCLE.includes(next.random2P)) next.random2P = DEFAULT_PLAY_OPTIONS.random2P;
    if (!GAUGE_TYPES.includes(next.gauge1P)) next.gauge1P = DEFAULT_PLAY_OPTIONS.gauge1P;
    if (!GAUGE_TYPES.includes(next.gauge2P)) next.gauge2P = DEFAULT_PLAY_OPTIONS.gauge2P;
    this.playOptions = next;
    const listChanged = this.syncListOptions();
    // Re-render when the list changed, or when panel 1 (the play-options panel) is open — the only surface that shows
    // the other values today, so a closed-panel write doesn't need a frame.
    if (listChanged || this.panelStates.has(1)) {
      this.ctx.render();
    }
  }

  /**
   * Applies a browse command to {@link browse} (`reduceBrowse`), then slides the list, plays the cue and redraws for
   * what it did. A move, a jump, a folder opened or closed slide the list (`noteCursorChange`, which also plays the
   * cursor cue); the folders and a list change play their cues (`browseSystemSound`). Returns what the command did.
   */
  private applyBrowse(command: BrowseCommand, options: { readonly render?: boolean } = {}): BrowseEvent {
    const { state, event } = reduceBrowse(this.collection, this.browse, command);
    // Nothing to back out of: the built-in and LR2 screens stay, silently.
    if (event.kind === 'at-root' && this.policy.atRoot === 'stay') return event;
    this.browse = state;
    if (event.kind === 'cursor') this.ctx.noteCursorChange(event.delta);
    // A folder opened or closed slides the list one bar, down into the folder or back up out of it.
    else if (event.kind === 'folder-opened') this.ctx.noteCursorChange(1);
    else if (event.kind === 'folder-closed') this.ctx.noteCursorChange(-1);
    const slot = browseSystemSound(command, event);
    const cue = slot === undefined ? undefined : ONE_SHOT_OF_SLOT[slot];
    if (cue !== undefined) void this.ctx.playOneShotSound(cue);
    if (event.kind !== 'none' && options.render !== false) this.ctx.render();
    return event;
  }

  /** Starts the bar under the cursor: opens a folder bar, starts a song bar, or hands a course bar to the host. */
  activateFocused(): void {
    const entry = this.focusedEntry();
    if (entry === undefined) return;
    if (entry.kind === 'folder') {
      this.applyBrowse({ type: 'open' });
    } else if (entry.kind === 'song') {
      this.launchSong(entry.song);
    } else if (this.launchAt === undefined) {
      this.ctx.options.onCourseSelected?.(entry.course);
    }
  }

  /**
   * Backs out of the folder shown, onto the folder bar it was opened from (`close`). At the root there is nothing to
   * back out of: the built-in and LR2 screens stay. Returns whether a folder was closed.
   */
  leaveFolder(): boolean {
    return this.applyBrowse({ type: 'close' }).kind === 'folder-closed';
  }

  /**
   * Moves the cursor one bar (`direction` ±1), wrapping past either end, as the arrow keys and a wheel notch do. On a
   * list of one bar the cursor stays but the list still slides and cues, as LR2's rail scrolls.
   */
  stepCursor(direction: 1 | -1): void {
    const count = this.currentEntries().length;
    if (count === 0) return;
    if (count === 1) {
      this.ctx.noteCursorChange(direction);
      this.ctx.render();
      return;
    }
    this.applyBrowse({ type: 'move', delta: direction });
  }

  /** Moves the cursor `delta` bars in one move, wrapping past either end (a click on an LR2 bar `delta` slots away). */
  moveCursor(delta: number): void {
    this.applyBrowse({ type: 'move', delta });
  }

  /** Puts the cursor on bar `index`, clamped (a click on a bar). */
  jumpCursor(index: number): void {
    this.applyBrowse({ type: 'jump', index });
  }

  /**
   * Moves the cursor `steps` bars (forward when positive), one bar at a time so the list slides and cues each step,
   * wrapping at the ends like the keyboard and wheel: a swipe or a glide that crossed several rows.
   */
  moveCursorBy(steps: number): void {
    if (this.currentEntries().length === 0 || steps === 0) return;
    const direction = steps > 0 ? 1 : -1;
    for (let index = 0; index < Math.abs(steps); index += 1) {
      this.applyBrowse({ type: 'move', delta: direction }, { render: false });
    }
    this.ctx.render();
  }

  /**
   * Returns whether an element with the given `panel` gate should currently render. Per LR2 spec:
   *
   * - - `panel = 0` → always render (default). - `panel = -1` → only when no option panel is open. - `panel = 1..9` →
   *   only when that specific panel is open.
   *
   * Defined as an arrow-property so callers can pass `this.isPanelOpen` to free helpers that need a `(panel) =>
   * boolean` predicate without binding `this` themselves.
   */
  readonly isPanelOpen = (panel: number): boolean => {
    if (panel === 0) return true;
    if (panel === -1) return this.panelStates.size === 0;
    return this.panelStates.has(panel);
  };

  /**
   * Toggles LR2 panel `which` (1..9). Opening sets the corresponding `panelStates` flag and starts the matching open
   * timer (21..29); closing clears the flag and starts the close timer (31..39). Mirrors the LR2 spec — panel buttons
   * (`#SRC_BUTTON,type=1..9`) and the START key both route through here so keyboard / mouse paths stay in sync.
   *
   * Re-renders synchronously so panel-gated elements appear / disappear on the very next frame instead of waiting for
   * the idle rAF tick (which only fires while keyframe animations are active and would skip a few frames after a
   * static-state toggle).
   */
  togglePanel(which: number): void {
    if (which < 1 || which > 9) return;
    const now = performance.now();
    let opening: boolean;
    if (this.panelStates.has(which)) {
      // Closing: drop the open timer (so it goes inactive next frame) and seed the close timer for the close-anim
      // keyframes that #DST elements anchored to timer 31..39 depend on.
      this.panelStates.delete(which);
      this.ctx.applyLr2Timers(resolveLr2SelectTimers({ kind: 'panel', panel: which, open: false, at: now }));
      opening = false;
    } else {
      // Opening: only one option panel may be open at a time (LR2 mutual-exclusion convention — clicking PLAY OPTION
      // while SYSTEM OPTION is already open closes the latter first, then opens the former). Snapshot the open set
      // before we start mutating it so we don't trip on iterator-vs-mutation order. Close every other open panel via
      // the same close-timer + state-flip sequence so their close-anim keyframes still play.
      const previouslyOpen = Array.from(this.panelStates);
      for (const open of previouslyOpen) {
        if (open === which) continue;
        this.panelStates.delete(open);
        this.ctx.applyLr2Timers(resolveLr2SelectTimers({ kind: 'panel', panel: open, open: false, at: now }));
      }
      // Drop our own (potentially leftover) close timer and seed the open timer.
      this.panelStates.add(which);
      this.ctx.applyLr2Timers(resolveLr2SelectTimers({ kind: 'panel', panel: which, open: true, at: now }));
      opening = true;
    }
    // LR2 system effects — `Sound\lr2\o-open.wav` / `o-close.wav`. Fire-and-forget; the cached buffer makes rapid
    // toggles cheap. Use the open cue for "swap to another panel" too (the previous panel's silent close is implicit;
    // firing both cues at once would just clip).
    void this.ctx.playOneShotSound(opening ? 'option-open' : 'option-close');
    this.ctx.render();
  }

  /** See `CoreSongSelectView.setNavigation`. */
  setNavigation(snapshot: BrowseSnapshot): void {
    this.browse = this.restore(snapshot);
    this.ctx.render();
    // Cursor / folder state changed → focused chart likely changed too. Same reasoning as `setCollection` — bring the
    // preview engine back in sync with whatever bar is now under the cursor.
    this.ctx.refreshChartPreview();
  }

  /** See `CoreSongSelectView.setCollection`. */
  setCollection(collection: BrowserSongCollection): void {
    // When the host re-asserts the same collection reference (e.g. returning to the select view from a play session) we
    // MUST NOT clobber the live cursor / browse stack — the host has already (or is about to) call `setNavigation` with
    // the snapshot it captured before play started, and re-resetting here would discard that. Identity comparison is
    // enough because `collectionStore.loadFromFiles` always returns a fresh collection object on a real reload.
    if (this.collection === collection) {
      this.ctx.render();
      return;
    }
    this.collection = collection;
    // Images cached for the previous collection's songs may not match the new one's files.
    this.ctx.songImages?.clear();
    // A new library opens at the top of its root list, keeping the search and the list options. A saved position (the
    // constructor's `initialNavigation`, typically a snapshot kept across a skin change) is restored; without one, a
    // library of one chart folder opens it (the select policy).
    const kept = { searchText: this.browse.searchText, list: this.browse.list };
    this.browse = createBrowseState(kept);
    const snapshot = this.ctx.options.initialNavigation;
    this.browse = snapshot === undefined ? openLibrary(collection, this.policy, kept) : this.restore(snapshot);
    this.ctx.render();
    // Collection changed → focused song's identity / source map changed. Re-arm the preview engine so it sees the new
    // target (or no target, if we landed on a folder bar).
    this.ctx.refreshChartPreview();
  }

  /** See `CoreSongSelectView.getNavigation`: the browse position as a scene-model snapshot (`captureBrowse`). */
  getNavigation(): BrowseSnapshot {
    return captureBrowse(this.collection, this.browse);
  }

  /**
   * The browse state `snapshot` restores over the library (`restoreSelectBrowse`): its search (the one in force when it
   * names none), its folders walked by label as far as they are still found, each parent cursor on the bar of the
   * folder opened from it (so backing out lands there), and the cursor on the saved bar when it is still listed, else on
   * the cursor saved for the depth the walk reached, clamped. The sort and the filters in force are kept: they are the
   * play options'.
   */
  private restore(snapshot: BrowseSnapshot): BrowseState {
    return restoreSelectBrowse(this.collection, snapshot, this.browse, this.policy).state;
  }

  /**
   * Returns the entries to render in the bar list at the current navigation depth (`browseEntries`). At the root we
   * surface one bar per top-level folder, except while searching: search results are flattened to matching charts so
   * typing a title rewrites the visible list immediately. Inside a folder we surface that folder's songs or courses.
   * The search, the filters and the sort apply at every depth. The list is kept while nothing it is derived from
   * changes, so the per-frame call sites (slider value resolver, bar renderer, …) read it cheaply.
   */
  currentEntries(): readonly BrowserBrowseEntry[] {
    return browseEntries(this.collection, this.browse);
  }

  /** See `CoreSongSelectView.setSearchQuery`. */
  setSearchQuery(query: string): void {
    const { state, event } = reduceBrowse(this.collection, this.browse, { type: 'search', text: query });
    this.browse = state;
    if (event.kind !== 'none') this.ctx.render();
  }

  /** See `CoreSongSelectView.setSearchEditing`. */
  setSearchEditing(editing: boolean): void {
    if (this.searchEditing === editing) return;
    this.searchEditing = editing;
    this.ctx.render();
  }

  /** The bar under the cursor, or `undefined` when the list is empty. */
  focusedEntry(): BrowserBrowseEntry | undefined {
    return focusedEntry(this.collection, this.browse);
  }

  /**
   * Returns the song under the cursor, or `undefined` when the cursor is on a folder bar (in which case song-info
   * NUMBER / TEXT panels leave their slots blank).
   */
  focusedSong(): BrowserSongEntry | undefined {
    return focusedChart(this.collection, this.browse);
  }

  /** Returns the course under the cursor, or `undefined` when the cursor is on a folder or song bar. */
  focusedCourse(): BrowserCourseEntry | undefined {
    return focusedCourse(this.collection, this.browse);
  }

  /**
   * Mutates `playOptions.hiSpeed` by ±0.1 (clamped to [`HISPEED_MIN`, `HISPEED_MAX`]) and notifies any external
   * observer through `onPlayOptionsChange`. Re-renders synchronously so the open panel reflects the new value (the HS
   * slider knob, the NUMBER readout, and any keyframed UI gated on op 10/11) without waiting for the idle rAF tick.
   */
  adjustHiSpeed(direction: 1 | -1): void {
    const next = clampHiSpeed(this.playOptions.hiSpeed + direction * HISPEED_STEP);
    if (next === this.playOptions.hiSpeed) return; // already at clamp
    this.playOptions = { ...this.playOptions, hiSpeed: next };
    this.ctx.options.onPlayOptionsChange?.({ ...this.playOptions });
    // LR2 system effect — `Sound\lr2\o-change.wav`. Fired on any option-value change inside an open panel (HS up/down,
    // gauge toggle, random select, etc.).
    void this.ctx.playOneShotSound('option-change');
    this.ctx.render();
  }

  /**
   * Generic cycler for enum-style play options. Advances the value at `key` to the next entry in `cycle` (wrapping past
   * the end), notifies host / fires the option-change cue, and re-renders. Used for `#SRC_BUTTON` types that walk
   * through a fixed set of states on click (BGA on/off/autoplay-only, gauge type, random, etc.). A sort or a filter
   * reshapes the list.
   */
  cyclePlayOption<K extends keyof PixiPlayOptions>(key: K, cycle: readonly PixiPlayOptions[K][]): void {
    this.setPlayOption(key, nextChoice(cycle, this.playOptions[key]));
  }

  /**
   * Direct-set helper for play options whose `#SRC_BUTTON` is a "set this exact value" affair (e.g. type 91..96 for the
   * difficulty filter). Skips the change notification when the value already matches so spam-clicking the same button
   * doesn't fire phantom `option-change` cues. A sort or a filter reshapes the list.
   */
  setPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
    if (this.playOptions[key] === value) return;
    this.playOptions = { ...this.playOptions, [key]: value };
    this.ctx.options.onPlayOptionsChange?.({ ...this.playOptions });
    void this.ctx.playOneShotSound('option-change');
    if (isListPlayOption(key)) this.syncListOptions();
    this.ctx.render();
  }

  /**
   * A be-music skin's play-option change: values outside the option's choices (or range) are dropped (see {@link
   * resolvePlayOptionValue}).
   */
  setSkinPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
    const next = resolvePlayOptionValue(key, value);
    if (next === undefined || this.playOptions[key] === next) return;
    this.setPlayOption(key, next);
  }

  /**
   * Shapes the list by the play options' sort and filters (`list`), when they changed, whoever changed them: the
   * cursor stays on the bar it was on while that bar is still listed, else on the same row, clamped. Returns whether
   * they changed.
   */
  private syncListOptions(): boolean {
    const list = listOptionsOf(this.playOptions);
    if (sameBrowseListOptions(list, this.browse.list)) return false;
    // The play option's own cue has played; the list change plays none of its own.
    this.browse = reduceBrowse(this.collection, this.browse, { type: 'list', options: list }).state;
    // A bar the filter took out leaves the cursor on another one.
    this.ctx.refreshChartPreview();
    return true;
  }

  /**
   * PLAY / AUTO: starts the focused song, or hands the focused course to the host (which refuses a course with a
   * missing stage and says why).
   */
  launchFocusedSong(autoPlay: boolean): void {
    const course = this.focusedCourse();
    if (course !== undefined) {
      if (this.launchAt !== undefined) return;
      if (autoPlay && this.ctx.options.onCourseAutoPlay !== undefined) this.ctx.options.onCourseAutoPlay(course);
      else this.ctx.options.onCourseSelected?.(course);
      return;
    }
    const focused = this.focusedSong();
    if (!focused) return;
    this.launchSong(focused, autoPlay);
  }

  /** `performance.now()` of a launch whose be-music outro is still playing, else `undefined`. */
  launchAt: number | undefined;
  launchTimer: number | undefined;

  /**
   * Hands `song` to the host. On the be-music path the skin may first play an outro (`BeMusicSelectRenderer.outroMs`);
   * input is ignored until it finishes. Themes (LR2) and `effects: 'off'` launch immediately.
   */
  launchSong(song: BrowserSongEntry, autoPlay = false): void {
    if (this.launchAt !== undefined) return;
    const fire = (): void => {
      if (autoPlay && this.ctx.options.onSongAutoPlay) {
        this.ctx.options.onSongAutoPlay(song);
        return;
      }
      this.ctx.options.onSongSelected?.(song);
    };
    const outroMs =
      this.ctx.themeDesignSize === undefined && (this.ctx.options.beMusicEffects ?? 'full') !== 'off'
        ? (this.ctx.beMusicRenderer?.outroMs ?? 0)
        : 0;
    if (outroMs <= 0) {
      fire();
      return;
    }
    this.launchAt = performance.now();
    this.ctx.beMusicNeedsFrame = true;
    this.ctx.render();
    this.launchTimer = window.setTimeout(() => {
      this.launchTimer = undefined;
      this.launchAt = undefined;
      if (this.ctx.disposed) return;
      fire();
      // Settle the screen behind the gameplay handoff so a return to select doesn't flash the outro's last frame.
      this.ctx.render();
    }, outroMs);
  }
}
