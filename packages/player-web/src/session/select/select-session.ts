/**
 * The select screen's behaviour, whatever family draws it: where the player is in the library, as the browse model of
 * `@be-music/scene-model` keeps it (`BrowseState`, changed by `reduceBrowse`, its list derived by `browseEntries`), the
 * play options and the option panels, the search, the README overlay, starting a chart or a course, and the screen's
 * sound. What the browse model leaves to the screen comes from the family's select policy (`select-policy.ts`).
 *
 * The sound goes through the audio service: the select BGM (ducked under the chart preview) and the preview of the
 * chart under the cursor belong to the session and stop when the screen leaves the stage; the cues and the decide
 * jingle have no owner and play out, so the jingle rings on through the decide screen into the play, as LR2's does.
 *
 * Keys come in as plain data (`select-keys.ts`), the view's pointer input as intents; each tick the session answers with
 * a frame, and with what happened since the last one, for the view's slides and timers.
 */

import {
  browseCursor,
  browseEntries,
  browseSystemSound,
  captureBrowse,
  clampHiSpeed,
  cyclePlayOptionValue,
  DEFAULT_PLAY_OPTIONS,
  focusedChart,
  focusedEntry,
  HISPEED_STEP,
  isListPlayOption,
  reduceBrowse,
  resolvePlayOptions,
  resolvePlayOptionValue,
  sameBrowseListOptions,
  startSystemSound,
  type BrowseCommand,
  type BrowseEvent,
  type BrowseListOptions,
  type BrowseSnapshot,
  type BrowseState,
  type LibraryChart,
  type LibraryCourse,
  type LibraryEntry,
  type PlayOptions,
  type SystemSoundSet,
  type SystemSoundSlot,
} from '@be-music/scene-model';
import { resolveSongSource } from '../../collection/collection.ts';
import type { BrowserSongCollection } from '../../collection/types.ts';
import type { AudioService } from '../../runtime/audio-service.ts';
import type { SelectFrame, SelectIntent, SelectRecords, SelectViewEvent } from '../../view/types.ts';
import type { SceneSession, SessionKeyEvent } from '../session-scene.ts';
import { resolveSelectKeyAction } from './select-keys.ts';
import { openLibrary, restoreSelectBrowse, SELECT_POLICIES, type SelectPolicy } from './select-policy.ts';
import { findReadtextForSong } from './select-readtext.ts';

/** A bar the player starts: a chart or a course. */
export type SelectStartEntry = Exclude<LibraryEntry, { kind: 'folder' }>;

/** Where the select screen leads, and what it tells the host. */
export interface SelectSessionEvents {
  /**
   * The player started a chart or a course (in AUTO with `autoPlay`). A course with a stage missing is handed over too,
   * so the host can say why it does not start. Return `false` when the entry starts no play (the course being made
   * takes the chart, the course cannot start): the screen then plays no decide sound.
   */
  start(entry: SelectStartEntry, options: { readonly autoPlay: boolean }): boolean | void;
  /** The player changed the play options on the screen; the host's own `setPlayOptions` is not reported. */
  playOptions?(options: PlayOptions): void;
  /** The player asked to type a search: the host lays its text field over the skin's search box. */
  search?(): void;
  /**
   * Shows a chart's text file in the host's own way. Without it, the screen draws its README overlay over the list.
   */
  readtext?(chart: LibraryChart): void;
  /** The course maker: name the course being made, or delete the player's own course under the cursor. */
  courseMaker?(action: 'name' | 'delete', course: LibraryCourse | undefined): void;
  /** The player asked for the skin's options. */
  skinConfig?(): void;
  /** The player left the screen (a back-out at the root, under a policy that leaves). */
  exit?(): void;
}

/** The part of the audio service the select screen uses. */
export type SelectAudio = Pick<
  AudioService,
  'playBgm' | 'stopBgm' | 'playCue' | 'playJingle' | 'stopOwned' | 'resume' | 'preview' | 'analyzer'
>;

export interface SelectSessionOptions {
  /** The library to browse, with its charts' files (the preview's samples, the text files). */
  readonly library: BrowserSongCollection;
  /** Where to open it: a saved browse position. Without one, a library of one chart folder opens it. */
  readonly browse?: BrowseSnapshot;
  /** The play options to start from, over `DEFAULT_PLAY_OPTIONS`; their sort and filters shape the list. */
  readonly playOptions?: Partial<PlayOptions>;
  /** The player's best records, for the bars and panels. */
  readonly records?: SelectRecords;
  /** The theme's sounds: the select BGM, the cues and the decide jingle (`decideBgm`). */
  readonly sounds: SystemSoundSet;
  readonly audio: SelectAudio;
  /** What the browse model leaves to the screen. Defaults to LR2's (the built-in and LR2 families). */
  readonly policy?: SelectPolicy;
  /** How long the skin's launch outro plays before a started chart is handed on (`SelectView.launchOutroMs`). */
  readonly launchOutroMs?: () => number;
  /** The clock events are stamped with when no key timestamp is at hand. Defaults to `performance.now()`. */
  readonly now?: () => number;
  readonly on: SelectSessionEvents;
}

/** The select BGM's level: about -6 dB, under the cues and the preview, as the select scenes always played it. */
const SELECT_BGM_VOLUME = 0.5;

const NO_RECORDS: SelectRecords = {
  chart: () => undefined,
  course: () => undefined,
};

/** The list options the play options hold. */
function listOptionsOf(options: PlayOptions): BrowseListOptions {
  return { sort: options.sort, keysFilter: options.keysFilter, difficultyFilter: options.difficultyFilter };
}

/** A launch waiting for the skin's outro to finish. */
interface PendingLaunch {
  readonly atMs: number;
  readonly entry: SelectStartEntry;
  readonly autoPlay: boolean;
}

/** The select screen's session. See the module comment. */
export class SelectSession implements SceneSession<SelectFrame, SelectIntent> {
  public readonly kind = 'select' as const;
  private readonly options: SelectSessionOptions;
  private readonly policy: SelectPolicy;
  private readonly now: () => number;
  private library: BrowserSongCollection;
  private browse: BrowseState;
  private playOptions: PlayOptions;
  private records: SelectRecords;
  private sounds: SystemSoundSet;
  private panel: number | undefined;
  private searchEditing = false;
  private readText: { readonly chart: LibraryChart; readonly text: string } | undefined;
  /** Bumped by each README lookup, so a lookup that lands after a newer one (or a close) is dropped. */
  private readTextLookup = 0;
  private launch: PendingLaunch | undefined;
  private entered = false;
  private disposed = false;
  private enteredAtMs = 0;
  private nowMs = 0;
  private revision = 0;
  private events: SelectViewEvent[] = [];
  /**
   * The chart (and its source) the preview was last pointed at, kept while the screen is off the stage. Coming back with
   * the cursor on the same chart does not start its preview again, as the select scene always did; moving onto another
   * chart does.
   */
  private previewKey: string | undefined;

  public constructor(options: SelectSessionOptions) {
    this.options = options;
    this.policy = options.policy ?? SELECT_POLICIES.lr2;
    this.now = options.now ?? (() => performance.now());
    this.library = options.library;
    this.records = options.records ?? NO_RECORDS;
    this.sounds = options.sounds;
    this.playOptions = resolvePlayOptions({ ...DEFAULT_PLAY_OPTIONS, ...options.playOptions });
    const list = listOptionsOf(this.playOptions);
    const base = openLibrary(this.library, this.policy, { list });
    this.browse =
      options.browse === undefined ? base : restoreSelectBrowse(this.library, options.browse, base, this.policy).state;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // What the host reads and sets
  // ---------------------------------------------------------------------------------------------------------------------

  /** The browse position as plain data (`captureBrowse`), to open the screen on again later. */
  public snapshot(): BrowseSnapshot {
    return captureBrowse(this.library, this.browse);
  }

  /** The bar under the cursor, or `undefined` when the list is empty. */
  public focused(): LibraryEntry | undefined {
    return focusedEntry(this.library, this.browse);
  }

  /** The play options in force. */
  public getPlayOptions(): PlayOptions {
    return { ...this.playOptions };
  }

  /**
   * Takes play options from the host (a settings menu): merged onto the ones in force and checked
   * (`resolvePlayOptions`). A sort or a filter reshapes the list, keeping the cursor on its bar. Not reported back
   * through `on.playOptions`, and no cue plays.
   */
  public setPlayOptions(partial: Partial<PlayOptions>): void {
    this.playOptions = resolvePlayOptions({ ...this.playOptions, ...partial });
    this.syncListOptions();
    this.changed();
  }

  /**
   * Takes a library. The same one again only redraws (the course being made, the records). A new one keeps the
   * player's place over it, restored by folder label and bar key; a first library with one chart folder opens it.
   */
  public setLibrary(library: BrowserSongCollection): void {
    if (library === this.library) {
      this.changed();
      return;
    }
    const previous = this.library;
    const place = captureBrowse(previous, this.browse);
    this.library = library;
    const empty = previous.songs.length === 0 && (previous.courseFolders?.length ?? 0) === 0;
    this.browse = empty
      ? openLibrary(library, this.policy, { searchText: this.browse.searchText, list: this.browse.list })
      : restoreSelectBrowse(library, place, this.browse, this.policy).state;
    this.readText = undefined;
    this.changed();
  }

  /** Puts the player back where a snapshot says, over the library as it is now (`restoreSelectBrowse`). */
  public restore(snapshot: BrowseSnapshot): void {
    this.browse = restoreSelectBrowse(this.library, snapshot, this.browse, this.policy).state;
    this.changed();
  }

  /** The records changed: the bars and panels draw them again. */
  public refreshRecords(records?: SelectRecords): void {
    if (records !== undefined) this.records = records;
    this.changed();
  }

  /** Searches for `text` (`reduceBrowse`'s `search`): a changed query puts the cursor on the top of the new list. */
  public setSearch(text: string): void {
    this.applyBrowse({ type: 'search', text }, this.now());
    // Kept as the select scene did: a search leaves the preview where it was until the cursor moves.
    const chart = focusedChart(this.library, this.browse);
    const source = chart === undefined ? undefined : resolveSongSource(this.library, chart);
    this.previewKey = chart === undefined || source === undefined ? undefined : `${source.id}\n${chart.id}`;
  }

  /** The host's text field is over the search box (`true`) or has left it: skins leave the box's text to it. */
  public setSearchEditing(editing: boolean): void {
    if (this.searchEditing === editing) return;
    this.searchEditing = editing;
    this.changed();
  }

  /** Takes the theme's new sounds; a BGM playing changes to the new one. */
  public setSounds(sounds: SystemSoundSet): void {
    this.sounds = sounds;
    if (this.entered) this.playBgm();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The scene session
  // ---------------------------------------------------------------------------------------------------------------------

  public enter(nowMs: number): void {
    if (this.disposed) return;
    this.entered = true;
    this.enteredAtMs = nowMs;
    this.nowMs = nowMs;
    this.events = [];
    this.changed();
    this.playBgm();
    this.refreshPreview();
  }

  /** Stops the BGM and the preview (the cues and the decide jingle play out); the state is kept for the next entry. */
  public exit(): void {
    if (!this.entered) return;
    this.entered = false;
    this.launch = undefined;
    this.options.audio.stopOwned(this);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.exit();
    this.disposed = true;
    this.readTextLookup += 1;
  }

  public handleKey(event: SessionKeyEvent): boolean {
    if (!this.entered || event.type !== 'down') return false;
    // A key is a gesture: the browser lets the BGM start once one came.
    this.options.audio.resume();
    // The chart is chosen while a launch outro plays.
    if (this.launch !== undefined) return false;
    const action = resolveSelectKeyAction(event, { panel: this.panel, readTextOpen: this.readText !== undefined });
    if (action === undefined) return false;
    const atMs = event.timeStamp;
    switch (action.type) {
      case 'step':
        this.stepCursor(action.direction, atMs);
        return true;
      case 'activate':
        this.activate(atMs);
        return true;
      case 'back':
        // Backing out of nothing leaves the key to the page.
        return this.back(atMs);
      case 'panel':
        this.togglePanel(action.panel, atMs);
        return true;
      case 'play-option':
        this.stepPlayOption(action.key, action.step);
        return true;
      case 'readtext-scroll':
        this.events.push({ kind: 'readtext-scroll', delta: action.delta });
        return true;
      case 'readtext-close':
        this.closeReadText(true);
        return true;
      case 'swallow':
        return false;
    }
  }

  public dispatch(intent: SelectIntent): void {
    if (!this.entered) return;
    this.options.audio.resume();
    if (intent.type === 'gesture') return;
    if (this.launch !== undefined) return;
    const atMs = this.now();
    switch (intent.type) {
      case 'browse':
        // A one-bar move is a step (a wheel notch, a swipe across a row): it slides even a list of one bar.
        if (intent.command.type === 'move' && Math.abs(intent.command.delta) === 1) {
          this.stepCursor(intent.command.delta > 0 ? 1 : -1, atMs);
        } else {
          this.applyBrowse(intent.command, atMs);
        }
        return;
      case 'activate':
        this.activate(atMs);
        return;
      case 'start':
        this.start(intent.autoPlay === true, atMs);
        return;
      case 'play-option':
        this.stepPlayOption(intent.key, intent.step);
        return;
      case 'set-play-option':
        this.setPlayOption(intent.key, resolvePlayOptionValue(intent.key, intent.value));
        return;
      case 'panel':
        this.togglePanel(intent.panel ?? this.panel, atMs);
        return;
      case 'search':
        this.options.on.search?.();
        return;
      case 'readtext':
        this.toggleReadText();
        return;
      case 'course-maker': {
        const entry = this.focused();
        this.options.on.courseMaker?.(intent.action, entry?.kind === 'course' ? entry.course : undefined);
        return;
      }
      case 'skin-config':
        this.options.on.skinConfig?.();
        return;
      case 'exit':
        this.options.on.exit?.();
        return;
    }
  }

  public frame(nowMs: number): SelectFrame {
    if (this.entered) {
      this.nowMs = Math.max(this.nowMs, nowMs);
      this.settleLaunch();
      this.refreshPreview();
    }
    const events = this.events;
    this.events = [];
    const entries = browseEntries(this.library, this.browse);
    return {
      clock: { nowMs, enteredAtMs: this.enteredAtMs },
      library: this.library,
      browse: this.browse,
      entries,
      cursor: browseCursor(this.browse),
      revision: this.revision,
      events,
      playOptions: this.playOptions,
      ...(this.panel !== undefined ? { panel: this.panel } : {}),
      records: this.records,
      searchEditing: this.searchEditing,
      ...(this.launch !== undefined ? { startedAtMs: this.launch.atMs } : {}),
      ...(this.readText !== undefined ? { readText: this.readText } : {}),
      audio: this.options.audio.analyzer.sample(nowMs),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Browsing
  // ---------------------------------------------------------------------------------------------------------------------

  /** Something the frame shows changed. */
  private changed(): void {
    this.revision += 1;
  }

  /**
   * Applies a browse command (`reduceBrowse`), reports what it did to the view and plays its cue (`browseSystemSound`).
   * A back-out at the root follows the policy: the built-in and LR2 screens stay, silently.
   */
  private applyBrowse(command: BrowseCommand, atMs: number): BrowseEvent {
    const { state, event } = reduceBrowse(this.library, this.browse, command);
    if (event.kind === 'at-root') {
      if (this.policy.atRoot === 'exit') {
        this.playCue('cancel');
        this.options.on.exit?.();
      }
      return event;
    }
    if (event.kind === 'none' && state === this.browse) return event;
    this.browse = state;
    this.changed();
    if (event.kind === 'none') return event;
    this.events.push({ kind: 'browse', event, atMs });
    if (event.kind === 'cursor' || event.kind === 'folder-opened' || event.kind === 'folder-closed') {
      // The README shown belongs to the bar left; it closes without a cue, as the cursor cue plays.
      this.readText = undefined;
      this.readTextLookup += 1;
      // The cursor cue plays with every slide of the list, a folder opened or closed included, as it always has.
      this.playCue('cursor');
    }
    const slot = browseSystemSound(command, event);
    if (slot !== undefined && slot !== 'cursor') this.playCue(slot);
    return event;
  }

  /**
   * Moves the cursor one bar, wrapping past either end, as the arrow keys and a wheel notch do. On a list of one bar the
   * cursor stays but the list still slides and cues, as LR2's rail scrolls.
   */
  private stepCursor(direction: 1 | -1, atMs: number): void {
    const count = browseEntries(this.library, this.browse).length;
    if (count === 0) return;
    if (count > 1) {
      this.applyBrowse({ type: 'move', delta: direction }, atMs);
      return;
    }
    const cursor = browseCursor(this.browse);
    this.events.push({ kind: 'browse', event: { kind: 'cursor', from: cursor, to: cursor, delta: direction }, atMs });
    this.readText = undefined;
    this.playCue('cursor');
    this.changed();
  }

  /** Enter: opens the folder under the cursor, or starts its chart or course. */
  private activate(atMs: number): void {
    const entry = this.focused();
    if (entry === undefined) return;
    if (entry.kind === 'folder') this.applyBrowse({ type: 'open' }, atMs);
    else this.launchEntry(entry, false, atMs);
  }

  /** PLAY / AUTO: starts the chart or course under the cursor; a folder bar does nothing. */
  private start(autoPlay: boolean, atMs: number): void {
    const entry = this.focused();
    if (entry === undefined || entry.kind === 'folder') return;
    this.launchEntry(entry, autoPlay, atMs);
  }

  /** Escape, Backspace, ←: backs out of the folder shown. Returns whether it did. */
  private back(atMs: number): boolean {
    return this.applyBrowse({ type: 'close' }, atMs).kind === 'folder-closed';
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Starting
  // ---------------------------------------------------------------------------------------------------------------------

  /**
   * Starts `entry`: a chart waits for the skin's launch outro, if any (input waits too); a course is handed on at once,
   * as it has no outro.
   */
  private launchEntry(entry: SelectStartEntry, autoPlay: boolean, atMs: number): void {
    if (this.launch !== undefined) return;
    const outroMs = entry.kind === 'song' ? (this.options.launchOutroMs?.() ?? 0) : 0;
    if (outroMs <= 0) {
      this.handOn(entry, autoPlay);
      return;
    }
    this.launch = { atMs, entry, autoPlay };
    this.changed();
  }

  /** Hands a launch whose outro has played on to the host. */
  private settleLaunch(): void {
    const launch = this.launch;
    if (launch === undefined) return;
    if (this.nowMs - launch.atMs < (this.options.launchOutroMs?.() ?? 0)) return;
    this.launch = undefined;
    this.changed();
    this.handOn(launch.entry, launch.autoPlay);
  }

  /**
   * Tells the host the entry started, then plays the start cue (`startSystemSound`): a course that cannot start plays
   * the cancel cue; one that starts a play plays the decide cue and the decide jingle. Neither has an owner, so they
   * play out while the screen leaves: the jingle rings on through the decide screen into the play.
   */
  private handOn(entry: SelectStartEntry, autoPlay: boolean): void {
    const started = this.options.on.start(entry, { autoPlay }) !== false;
    const cue = startSystemSound(entry);
    if (cue === 'cancel') {
      this.playCue('cancel');
      return;
    }
    if (!started) return;
    if (cue !== undefined) this.playCue(cue);
    const jingle = this.sounds.decideBgm;
    if (jingle !== undefined) void this.options.audio.playJingle(jingle);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Play options and panels
  // ---------------------------------------------------------------------------------------------------------------------

  /** Opens `panel` (closing the one open), or closes it when it is the one open; `undefined` changes nothing. */
  private togglePanel(panel: number | undefined, atMs: number): void {
    if (panel === undefined || panel < 1 || panel > 9) return;
    const previous = this.panel;
    if (previous !== undefined) this.events.push({ kind: 'panel', panel: previous, open: false, atMs });
    if (previous === panel) {
      this.panel = undefined;
      this.playCue('optionClose');
    } else {
      this.panel = panel;
      this.events.push({ kind: 'panel', panel, open: true, atMs });
      // Swapping to another panel plays the open cue only: the other's close is implied.
      this.playCue('optionOpen');
    }
    this.changed();
  }

  /** Steps a play option through its choices, or the hi-speed by its step. */
  private stepPlayOption(key: keyof PlayOptions, step: number): void {
    if (key === 'hiSpeed') {
      const value = clampHiSpeed(this.playOptions.hiSpeed + (step < 0 ? -1 : 1) * HISPEED_STEP);
      this.setPlayOption('hiSpeed', value);
      return;
    }
    this.setPlayOption(key, cyclePlayOptionValue(key, this.playOptions[key], step));
  }

  /** The player's change of a play option: reported to the host, with the option-change cue. */
  private setPlayOption<K extends keyof PlayOptions>(key: K, value: PlayOptions[K] | undefined): void {
    if (value === undefined || this.playOptions[key] === value) return;
    this.playOptions = { ...this.playOptions, [key]: value };
    this.options.on.playOptions?.({ ...this.playOptions });
    this.playCue('optionChange');
    if (isListPlayOption(key)) this.syncListOptions();
    this.changed();
  }

  /**
   * Shapes the list by the play options' sort and filters, when they changed: the cursor stays on the bar it was on
   * while it is still listed, else on its row, clamped.
   */
  private syncListOptions(): void {
    const list = listOptionsOf(this.playOptions);
    if (sameBrowseListOptions(list, this.browse.list)) return;
    const { state, event } = reduceBrowse(this.library, this.browse, { type: 'list', options: list });
    this.browse = state;
    if (event.kind !== 'none') this.events.push({ kind: 'browse', event, atMs: this.now() });
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The README overlay
  // ---------------------------------------------------------------------------------------------------------------------

  /** Shows the text file of the chart under the cursor, or closes the one shown. */
  private toggleReadText(): void {
    if (this.readText !== undefined) {
      this.closeReadText(true);
      return;
    }
    const chart = focusedChart(this.library, this.browse);
    if (chart === undefined) return;
    if (this.options.on.readtext !== undefined) {
      this.options.on.readtext(chart);
      return;
    }
    const lookup = ++this.readTextLookup;
    const library = this.library;
    void findReadtextForSong(library, chart).then((text) => {
      if (lookup !== this.readTextLookup || this.disposed) return;
      if (text === undefined) {
        // No text file: a short cue says the click registered.
        this.playCue('optionChange');
        return;
      }
      this.readText = { chart, text };
      this.playCue('optionOpen');
      this.changed();
    });
  }

  private closeReadText(cue: boolean): void {
    this.readTextLookup += 1;
    if (this.readText === undefined) return;
    this.readText = undefined;
    if (cue) this.playCue('optionClose');
    this.changed();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Sound
  // ---------------------------------------------------------------------------------------------------------------------

  /** Plays a cue of the theme's sounds, without an owner: it plays out when the screen leaves. */
  private playCue(slot: SystemSoundSlot): void {
    const sound = this.sounds[slot];
    if (sound !== undefined) void this.options.audio.playCue(sound);
  }

  /** Starts the theme's select BGM, as the session's own, or stops the one playing when the theme has none. */
  private playBgm(): void {
    const bgm = this.sounds.selectBgm;
    if (bgm === undefined) {
      this.options.audio.stopBgm(this);
      return;
    }
    void this.options.audio.playBgm(bgm, { owner: this, volume: SELECT_BGM_VOLUME });
  }

  /** Points the chart preview at the chart under the cursor, when that changed since it was last pointed. */
  private refreshPreview(): void {
    const chart = focusedChart(this.library, this.browse);
    const source = chart === undefined ? undefined : resolveSongSource(this.library, chart);
    const key = chart === undefined || source === undefined ? undefined : `${source.id}\n${chart.id}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    if (chart === undefined || source === undefined) this.options.audio.preview.focus(undefined);
    else this.options.audio.preview.focus({ song: chart, source }, this);
  }
}
