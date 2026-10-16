/**
 * The select screen's browsing on the built-in and LR2 select scenes (`CoreSongSelectView`): the library and the folder
 * stack, the list shown (`currentEntries`) and the cursor in it, the play options and the LR2 option panels, the
 * search, and starting a chart or a course.
 *
 * The session reads and drives the rest of the scene through {@link SelectSessionContext}; the scene passes it.
 */

import {
  LR2_KEYS_FILTER_OPS,
  lr2CourseMatchesKeysFilter,
  resolveLr2KeyModeOp,
  resolveLr2SelectTimers,
  type Lr2TimerUpdate,
} from '@be-music/lr2-skin/state';
import { GAUGE_TYPES } from '@be-music/player/ruleset';
import {
  BGA_CYCLE,
  BGA_SIZE_CYCLE,
  browseCursor,
  browseSnapshotFromSelectNavigation,
  chartMatchesDifficultyFilter,
  clampHiSpeed,
  clampShutter,
  DEFAULT_PLAY_OPTIONS,
  DIFFICULTY_FILTER_CYCLE,
  HIDDEN_SUDDEN_CYCLE,
  HS_FIX_CYCLE,
  isListPlayOption,
  KEYS_FILTER_CYCLE,
  matchesSearchQuery,
  nextChoice,
  RANDOM_CYCLE,
  resolvePlayOptionValue,
  restoreBrowse,
  SORT_CYCLE,
  sortLibraryEntries,
} from '@be-music/scene-model';
import { groupSongsByFolder } from '../../collection/collection.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongCollection,
  BrowserSongEntry,
} from '../../collection/types.ts';
import type {
  CoreSongSelectViewOptions,
  PixiDifficultyFilter,
  PixiKeysFilter,
  PixiPlayOptions,
  PixiSelectSort,
  PixiSongSelectNavigation,
  SelectDesignSize,
} from '../../scene/core/select.ts';
import { HISPEED_STEP } from '../../scene/hi-speed.ts';
import type { BeMusicSelectBinding } from '../../skin/be-music/binding.ts';
import type { SongImageCache } from '../../skin/be-music/song-images.ts';

/** What the session reads and drives on the select scene: its fields and methods of these names. */
export interface SelectSessionContext {
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
  noteCursorChange(delta: number): void;
  playOneShotSound(name: string): Promise<void>;
  applyLr2Timers(update: Lr2TimerUpdate): void;
}

/** The select screen's browsing. See the module comment. */
export class SelectSession {
  private readonly ctx: SelectSessionContext;

  collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  /**
   * Current selection cursor into `currentEntries()`. Reset to 0 when navigating into / out of a folder so the cursor
   * lands on the first entry of the new view.
   */
  selectedIndex = 0;
  /**
   * Folder navigation stack. Empty = at root (showing folder bars). Length-1 = inside one folder (showing its songs).
   * LR2 only really uses one nesting level today, but the array makes it trivial to extend later.
   */
  browseStack: BrowserFolderNode[] = [];
  /**
   * Live play-option state, mutated by the in-scene panel buttons (LR2 `#SRC_BUTTON,type=40..58` etc.) and read by the
   * host via {@link getPlayOptions} at gameplay-launch time. Initialized from `initialPlayOptions` (overlaid on {@link
   * DEFAULT_PLAY_OPTIONS}) at construction.
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
  /**
   * Parallel stack of the parent's `selectedIndex` at the moment each folder on `browseStack` was entered. Used by
   * {@link leaveFolder} to land the cursor back on the folder bar the user just exited rather than jumping to the top
   * of the parent list. Always satisfies `parentCursorStack.length === browseStack.length`.
   */
  private parentCursorStack: number[] = [];
  /**
   * Lower-cased search query. When non-empty, `currentEntries` is filtered to bars whose title / subtitle / artist /
   * genre / file label / folder label contains the substring (case- insensitive). Empty string disables the filter —
   * hosts call {@link setSearchQuery} to seed it; the view never mutates it on its own.
   */
  searchQuery = '';
  /** The query as typed (case and spaces kept), for skins that show it. */
  searchText = '';
  /** Whether the host's text field is laid over the search box: the skin then leaves the box's text to it. */
  searchEditing = false;
  /**
   * Memoized result of {@link currentEntries}. Recomputed only when one of the captured inputs changes; otherwise the
   * cached array is returned as-is so per-frame call sites (slider value, bar renderer) hit a Map-like O(1) path
   * instead of re-walking the chart events of every song under the keymode filter. Initialized lazily on the first
   * call.
   */
  private cachedEntries: BrowserBrowseEntry[] = [];
  private cachedEntriesInputs: CurrentEntriesInputs | undefined;

  public constructor(ctx: SelectSessionContext) {
    this.ctx = ctx;
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
    // Re-render only when panel 1 (the play-options panel) is currently open — that's the only surface that visualizes
    // these values today, so a closed-panel write doesn't need a frame.
    if (this.panelStates.has(1)) {
      this.ctx.render();
    }
  }

  /**
   * Drills into `folder`: pushes onto the browse stack, resets the cursor to the top of the folder's contents, animates
   * the bar slide as a single down-step, and fires the LR2 folder-open cue (`Sound\lr2\f-open.wav`).
   *
   * Three call sites use this — keyboard Enter, skin-mode click, fallback-row click — so factoring it here keeps their
   * semantics identical.
   */
  /** Opens a folder bar, starts a song bar, or hands a course bar to the host (see `onCourseSelected`). */
  activateEntry(entry: BrowserBrowseEntry): void {
    if (entry.kind === 'folder') {
      this.enterFolder(entry.folder);
    } else if (entry.kind === 'song') {
      this.launchSong(entry.song);
    } else if (this.launchAt === undefined) {
      this.ctx.options.onCourseSelected?.(entry.course);
    }
  }

  enterFolder(folder: BrowserFolderNode): void {
    // Stash the parent's cursor BEFORE pushing so leaveFolder can land the cursor back on this folder bar.
    this.parentCursorStack = [...this.parentCursorStack, this.selectedIndex];
    this.browseStack = [...this.browseStack, folder];
    this.selectedIndex = 0;
    // Folder traversal: animate as a single "down" step regardless of how big the index jump was, so the slide stays
    // bounded.
    this.ctx.noteCursorChange(1);
    this.ctx.render();
    void this.ctx.playOneShotSound('folder-open');
  }

  /**
   * Pops one level out of the browse stack. No-op at the root (mirroring the old inline branch that bailed when
   * `browseStack.length === 0`). Fires the LR2 folder-close cue (`Sound\lr2\f-close.wav`).
   *
   * Restores the parent's `selectedIndex` from the parallel cursor stack so the user lands back on the folder bar they
   * just left. The restored index is clamped to the parent list's current length to handle the rare case where the
   * collection / search filter changed while inside the folder.
   */
  leaveFolder(): boolean {
    if (this.browseStack.length === 0) return false;
    this.browseStack = this.browseStack.slice(0, -1);
    const remembered = this.parentCursorStack[this.parentCursorStack.length - 1];
    this.parentCursorStack = this.parentCursorStack.slice(0, -1);
    if (remembered !== undefined) {
      const parentEntries = this.currentEntries();
      const upperBound = Math.max(0, parentEntries.length - 1);
      this.selectedIndex = Math.max(0, Math.min(remembered, upperBound));
    } else {
      this.selectedIndex = 0;
    }
    this.ctx.noteCursorChange(-1);
    this.ctx.render();
    void this.ctx.playOneShotSound('folder-close');
    return true;
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
  setNavigation(navigation: PixiSongSelectNavigation): void {
    if (this.restoreNavigation(navigation)) {
      this.ctx.render();
      // Cursor / folder state changed → focused chart likely changed too. Same reasoning as `setCollection` — bring the
      // preview engine back in sync with whatever bar is now under the cursor.
      this.ctx.refreshChartPreview();
    }
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
    this.browseStack = [];
    this.parentCursorStack = [];
    this.selectedIndex = 0;
    // Brand-new collection: try the constructor-time `initialNavigation` (typical: dropped a folder mid-session and
    // there's a saved snapshot in the URL or local storage). Falls back to the auto-enter-single-folder behavior when
    // no saved state exists or the saved labels no longer match.
    const restored = this.ctx.options.initialNavigation
      ? this.restoreNavigation(this.ctx.options.initialNavigation)
      : false;
    if (!restored) {
      const folders = groupSongsByFolder(collection.songs);
      if (folders.length === 1) {
        this.browseStack = [folders[0]!];
        // Keep parentCursorStack length-aligned with browseStack even on the auto-enter-single-folder fast path — a
        // mismatch would feed `leaveFolder` a stale entry from a previous session.
        this.parentCursorStack = [0];
      }
    }
    this.ctx.render();
    // Collection changed → focused song's identity / source map changed. Re-arm the preview engine so it sees the new
    // target (or no target, if we landed on a folder bar).
    this.ctx.refreshChartPreview();
  }

  /** See `CoreSongSelectView.getNavigation`. */
  getNavigation(): PixiSongSelectNavigation {
    return {
      folderPath: this.browseStack.map((folder) => folder.label),
      selectedIndex: this.selectedIndex,
    };
  }

  /**
   * Walks `folderPath` deepest-first, looking up each label in the folder list at the matching depth. Stops as soon as
   * a label doesn't match — the partial path is still a useful restore. The `selectedIndex` is clamped to the recovered
   * list's length so the cursor never lands past the end.
   */
  private restoreNavigation(navigation: PixiSongSelectNavigation): boolean {
    const resolved = resolveSelectNavigation(this.collection, navigation);
    // None of the saved labels matched: the caller falls back to the default "single-folder auto-enter" path instead of
    // leaving the cursor on an unrelated entry.
    if (resolved === undefined) return false;
    this.browseStack = resolved.stack;
    // No saved per-level cursor history yet — fill the parallel stack with zeros so its length matches `browseStack`.
    // If the user backs out without entering further, they land on the first folder bar of the parent (acceptable
    // fallback for a restored session that has no prior entry-time snapshot).
    this.parentCursorStack = resolved.stack.map(() => 0);
    this.selectedIndex = resolved.selectedIndex;
    return true;
  }

  /**
   * Returns the entries to render in the bar list at the current navigation depth. At the root we surface one bar per
   * top-level folder, except while searching: search results are flattened to matching charts so typing a title rewrites
   * the visible list immediately. Inside a folder we surface that folder's songs.
   *
   * Honors `searchQuery` (lower-cased substring match) when set — the filter applies at every depth so a user can type
   * while inside a folder and only see matching songs in that folder.
   */
  currentEntries(): BrowserBrowseEntry[] {
    // Cache the filtered + sorted list so the per-frame call sites (slider value resolver, bar renderer, …) don't
    // re-allocate every entry and re-walk the keymode filter on every frame. Inputs that affect the result are captured
    // shallowly; reference comparison is enough for the array / folder fields because the mutators always replace those
    // refs (no in-place edits).
    const top = this.browseStack[this.browseStack.length - 1];
    const songs = this.collection.songs;
    const inputs: CurrentEntriesInputs = {
      top,
      stackLength: this.browseStack.length,
      songs,
      difficulty: this.playOptions.difficultyFilter,
      keys: this.playOptions.keysFilter,
      sort: this.playOptions.sort,
      search: this.searchQuery,
    };
    if (this.cachedEntriesInputs && currentEntriesInputsEqual(this.cachedEntriesInputs, inputs)) {
      return this.cachedEntries;
    }
    const baseEntries: BrowserBrowseEntry[] = top
      ? top.courses !== undefined
        ? top.courses.map((course): BrowserBrowseEntry => ({ kind: 'course', course }))
        : top.songs.map((song): BrowserBrowseEntry => ({ kind: 'song', song }))
      : this.searchQuery.length > 0
        ? songs.map((song): BrowserBrowseEntry => ({ kind: 'song', song }))
        : [...groupSongsByFolder(songs), ...(this.collection.courseFolders ?? [])].map(
            (folder): BrowserBrowseEntry => ({ kind: 'folder', folder }),
          );
    let filtered = baseEntries;
    if (this.playOptions.difficultyFilter !== 'ALL') {
      const filter = this.playOptions.difficultyFilter;
      filtered = filtered.filter((entry) => entry.kind !== 'song' || chartMatchesDifficultyFilter(entry.song, filter));
    }
    if (this.playOptions.keysFilter !== 'ALL') {
      const targetOp = LR2_KEYS_FILTER_OPS[this.playOptions.keysFilter];
      // A course bar is listed under its key mode, as LR2 lists courses by their `line`.
      filtered = filtered.filter((entry) =>
        entry.kind === 'song'
          ? resolveLr2KeyModeOp(entry.song) === targetOp
          : entry.kind !== 'course' || lr2CourseMatchesKeysFilter(entry.course, targetOp),
      );
    }
    if (this.searchQuery.length > 0) {
      filtered = filtered.filter((entry) => matchesSearchQuery(entry, this.searchQuery));
    }
    if (this.playOptions.sort !== 'OFF') {
      filtered = sortLibraryEntries(filtered, this.playOptions.sort);
    }
    this.cachedEntries = filtered;
    this.cachedEntriesInputs = inputs;
    return filtered;
  }

  /** See `CoreSongSelectView.setSearchQuery`. */
  setSearchQuery(query: string): void {
    this.searchText = query;
    const normalized = query.trim().toLowerCase();
    if (this.searchQuery === normalized) {
      return;
    }
    this.searchQuery = normalized;
    this.selectedIndex = 0;
    this.ctx.render();
  }

  /** See `CoreSongSelectView.setSearchEditing`. */
  setSearchEditing(editing: boolean): void {
    if (this.searchEditing === editing) return;
    this.searchEditing = editing;
    this.ctx.render();
  }

  /**
   * Returns the song under the cursor, or `undefined` when the cursor is on a folder bar (in which case song-info
   * NUMBER / TEXT panels leave their slots blank).
   */
  focusedSong(): BrowserSongEntry | undefined {
    const entry = this.currentEntries()[this.selectedIndex];
    return entry?.kind === 'song' ? entry.song : undefined;
  }

  /** Returns the course under the cursor, or `undefined` when the cursor is on a folder or song bar. */
  focusedCourse(): BrowserCourseEntry | undefined {
    const entry = this.currentEntries()[this.selectedIndex];
    return entry?.kind === 'course' ? entry.course : undefined;
  }

  /**
   * Moves the cursor `steps` entries (forward when positive), one slot at a time so the bar slide animates each step,
   * wrapping at the ends like the keyboard and wheel.
   */
  moveCursorBy(steps: number): void {
    const entries = this.currentEntries();
    if (entries.length === 0) return;
    const direction = steps > 0 ? 1 : -1;
    for (let index = 0; index < Math.abs(steps); index += 1) {
      this.selectedIndex = (this.selectedIndex + direction + entries.length) % entries.length;
      this.ctx.noteCursorChange(direction);
    }
    this.ctx.render();
  }

  /**
   * Mutates `playOptions.hiSpeed` by ±0.1 (clamped to [{@link HISPEED_MIN}, {@link HISPEED_MAX}]) and notifies any
   * external observer through `onPlayOptionsChange`. Re-renders synchronously so the open panel reflects the new value
   * (the HS slider knob, the NUMBER readout, and any keyframed UI gated on op 10/11) without waiting for the idle rAF
   * tick.
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
   * through a fixed set of states on click (BGA on/off/autoplay-only, gauge type, random, etc.). Generic so adding a
   * new enum option is a one-liner.
   */
  cyclePlayOption<K extends keyof PixiPlayOptions>(key: K, cycle: readonly PixiPlayOptions[K][]): void {
    const next = nextChoice(cycle, this.playOptions[key]);
    if (next === this.playOptions[key]) return;
    this.playOptions = { ...this.playOptions, [key]: next };
    this.ctx.options.onPlayOptionsChange?.({ ...this.playOptions });
    void this.ctx.playOneShotSound('option-change');
    this.ctx.render();
  }

  /**
   * Direct-set helper for play options whose `#SRC_BUTTON` is a "set this exact value" affair (e.g. type 91..96 for the
   * difficulty filter). Skips the change notification when the value already matches so spam-clicking the same button
   * doesn't fire phantom `option-change` cues.
   */
  setPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
    if (this.playOptions[key] === value) return;
    this.playOptions = { ...this.playOptions, [key]: value };
    this.ctx.options.onPlayOptionsChange?.({ ...this.playOptions });
    void this.ctx.playOneShotSound('option-change');
    this.ctx.render();
  }

  /**
   * Resets `selectedIndex` to 0 after a song-list filter (the difficulty / keymode filter buttons) changed. Whatever
   * song the user was hovering on a moment ago is unlikely to be at the same numeric index in the new filtered list (or
   * even still present), so jumping to the top is more predictable than trying to clamp/preserve. Re-arms the chart
   * preview so the new top song's preview starts after the LR2 focus- settle delay.
   */
  snapCursorAfterFilterChange(): void {
    this.selectedIndex = 0;
    this.ctx.refreshChartPreview();
  }

  /**
   * A be-music skin's play-option change: values outside the option's choices (or range) are dropped (see {@link
   * resolvePlayOptionValue}), and a list filter / sort change moves the cursor back to the top like the LR2 buttons do.
   */
  setSkinPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
    const next = resolvePlayOptionValue(key, value);
    if (next === undefined || this.playOptions[key] === next) return;
    this.setPlayOption(key, next);
    if (isListPlayOption(key)) this.snapCursorAfterFilterChange();
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

/**
 * The browse stack and cursor a saved {@link PixiSongSelectNavigation} restores in `collection`: its folder path matched
 * by label (song folders, then course folders, at the root), the cursor clamped to the deepest list, as the browse model
 * of `@be-music/scene-model` restores it (`restoreBrowse`). `undefined` when none of the saved labels matches.
 */
export function resolveSelectNavigation(
  collection: Pick<BrowserSongCollection, 'songs' | 'courseFolders'>,
  navigation: PixiSongSelectNavigation,
): { stack: BrowserFolderNode[]; selectedIndex: number } | undefined {
  const { state, restoredDepth } = restoreBrowse(collection, browseSnapshotFromSelectNavigation(navigation));
  if (restoredDepth === 0 && navigation.folderPath.length > 0) return undefined;
  return { stack: [...state.path], selectedIndex: browseCursor(state) };
}

/**
 * Inputs captured by {@link CoreSongSelectView.currentEntries}' memoization pass. Reference-equal `top` / `songs` is
 * enough because the view never mutates either in place — every library reload / browse-stack change replaces the
 * array, so a stale cache is impossible without one of these fields changing.
 */
interface CurrentEntriesInputs {
  top: BrowserFolderNode | undefined;
  stackLength: number;
  songs: ReadonlyArray<BrowserSongEntry>;
  difficulty: PixiDifficultyFilter;
  keys: PixiKeysFilter;
  sort: PixiSelectSort;
  search: string;
}

function currentEntriesInputsEqual(a: CurrentEntriesInputs, b: CurrentEntriesInputs): boolean {
  return (
    a.top === b.top &&
    a.stackLength === b.stackLength &&
    a.songs === b.songs &&
    a.difficulty === b.difficulty &&
    a.keys === b.keys &&
    a.sort === b.sort &&
    a.search === b.search
  );
}
