/**
 * The beatoraja family's select view: a beatoraja select skin (`header.type` 5, `select.json` / `selectmain.lua`) drawn
 * by `BeatorajaPlaySkinView`, its canvas fitted into the window, with the bar list (`select/rows.ts`) drawn into the
 * skin at its `songlist` anchor and the README overlay on top. It draws the select session's frames: what the skin reads
 * of the screen comes from the scene mapping of `@be-music/beatoraja-skin/scene` (`select/skin-state.ts`: the bar ops,
 * numbers, texts and image-set values over the focused bar, the list options and the records), the focused chart's
 * images and graphs from `select/chart-images.ts`, the search prompt from `select/search.ts`, and beatoraja's scene
 * timers from the frames: the scene (0) from the entry, the bar change (11) whenever the bar under the cursor changes.
 * The list glides to the cursor, the short way round a wrap.
 *
 * A click on a bar moves the cursor onto it, or takes it when it is the focused one. The skin's buttons come back as
 * intents: PLAY / AUTO / PRACTICE, READ TEXT, the song and chart favourites, and the MODE and SORT buttons, which step
 * the key-mode filter and the sort of the browse position (Shift steps back). The LNMODE button's choice stays in the
 * view, as nothing plays it yet (the browse model leaves it out); the JUDGE TIMING button steps the skin's timing offset
 * and hands the options to the host.
 */

import {
  BEATORAJA_BUTTON,
  parseBeatorajaSongList,
  TIMER_SCENE_START,
  TIMER_SONGBAR_CHANGE,
  type BeatorajaSkinConfig,
} from '@be-music/beatoraja-skin';
import {
  BEATORAJA_KEYS_FILTERS,
  BEATORAJA_SORTS,
  beatorajaClearLampOp,
  beatorajaKeysFilterIndex,
  beatorajaLnModeIndex,
  beatorajaSortIndex,
  resolveBeatorajaSelectSliderValue,
} from '@be-music/beatoraja-skin/scene';
import type { BrowseListOptions, LibraryEntry } from '@be-music/scene-model';
import { Container } from 'pixi.js';
import { resolveSongSource } from '../../collection/collection.ts';
import type { BrowserBrowseEntry, BrowserSongCollection, BrowserSongEntry } from '../../collection/types.ts';
import type { BeatorajaKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import { BeatorajaPlaySkinView } from './skin-view.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import { loadBeatorajaChartImages, type BeatorajaChartImages } from '../../skin/beatoraja/chart-images.ts';
import { SelectReadTextOverlay } from '../built-in/select-readtext.ts';
import type { IntentSink, SelectFrame, SelectIntent, SelectView } from '../types.ts';
import { beatorajaSceneNowMs, BeatorajaSkinStage } from './scene-frame.ts';
import { BeatorajaSelectChartImages, type BeatorajaSelectChartImagesContext } from './select/chart-images.ts';
import { BeatorajaSelectRows, type BeatorajaSelectRowsContext } from './select/rows.ts';
import { BeatorajaSelectSearch, type BeatorajaSelectSearchContext } from './select/search.ts';
import { BeatorajaSelectSkinState, type BeatorajaSelectSkinStateContext } from './select/skin-state.ts';

const log = logger('beatoraja-select');

/**
 * Fraction of the gap between the list's glide and the cursor closed each 60 Hz frame: `0.25` lands inside ~150 ms,
 * responsive without looking jumpy. The glide snaps to the cursor once the gap drops below
 * {@link SCROLL_SNAP_THRESHOLD}, so it does not wander towards it forever.
 */
const SCROLL_TWEEN_RATE = 0.25;
const SCROLL_SNAP_THRESHOLD = 0.005;
/** One frame at 60 Hz, in ms: the glide's step. */
const FRAME_MS = 1000 / 60;

/** The JUDGE TIMING button's range (ms), as beatoraja's judge-offset slider. */
const JUDGE_TIMING_LIMIT_MS = 200;

/** What the view's parts read and drive on it. */
type BeatorajaSelectViewContext = BeatorajaSelectRowsContext &
  BeatorajaSelectSearchContext &
  BeatorajaSelectChartImagesContext &
  BeatorajaSelectSkinStateContext;

export interface BeatorajaSelectViewOptions {
  /** Where the skin's Lua sounds play (`main_state.audio_*`); they are silent without it. */
  readonly skinSounds?: BeatorajaSkinAudio;
  /**
   * The skin's JUDGE TIMING button (act 74) changed its options (`offset`): the host keeps them. The view draws with
   * them at once.
   */
  readonly onSkinConfigChange?: (config: BeatorajaSkinConfig) => void;
  /**
   * Decodes a chart's own images for the skin's synthetic slots; `loadBeatorajaChartImages` over the library's files
   * by default.
   */
  readonly loadChartImages?: (song: BrowserSongEntry, library: BrowserSongCollection) => Promise<BeatorajaChartImages>;
}

/** The bar's own object (its chart, folder or course), which stays the same across the lists that show it. */
function barTarget(entry: LibraryEntry | undefined): object | undefined {
  if (entry === undefined) return undefined;
  return entry.kind === 'song' ? entry.song : entry.kind === 'folder' ? entry.folder : entry.course;
}

/** The beatoraja select view. See the module comment. */
export class BeatorajaSelectView implements SelectView {
  public readonly family = 'beatoraja' as const;
  /** A beatoraja skin has no launch outro: a started chart is handed on at once. */
  public readonly launchOutroMs = 0;
  public readonly root: Container = new Container();
  private kit: BeatorajaKit;
  private readonly options: BeatorajaSelectViewOptions;
  /** The bar list, inside the skin's container at its `songlist` anchor. */
  private readonly listLayer: Container = new Container();
  private readonly readText: SelectReadTextOverlay = new SelectReadTextOverlay();
  /** This view as its parts read and drive it (see {@link createContext}). */
  private readonly context: BeatorajaSelectViewContext = BeatorajaSelectView.createContext(this);
  private readonly rows: BeatorajaSelectRows = new BeatorajaSelectRows(this.context);
  private readonly search: BeatorajaSelectSearch = new BeatorajaSelectSearch(this.context);
  private readonly chartImages: BeatorajaSelectChartImages = new BeatorajaSelectChartImages(this.context);
  private readonly skinState: BeatorajaSelectSkinState = new BeatorajaSelectSkinState(this.context);
  private stage: BeatorajaSkinStage;
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<SelectIntent> | undefined;
  private disposed = false;
  /** The frame being drawn, or the last one: what the parts, the clicks and the buttons read. */
  private frame: SelectFrame | undefined;
  /** When the scene was last entered, on the host clock: the scene timers count from it. */
  private enteredAtMs = Number.NaN;
  private lastDrawMs: number | undefined;
  /**
   * The list's glide: a fractional cursor chasing the frame's cursor, which the rows are laid out around, so a jump
   * glides instead of teleporting. Shifted by the list's length on a wrap, so the glide takes the short way round.
   */
  private scrollPosition = 0;
  /** The list the glide follows; a new one (a folder opened, a filter changed) snaps the glide to the cursor. */
  private shownEntries: readonly LibraryEntry[] | undefined;
  /** The focused bar's own object, to start the bar-change timer when it changes. */
  private focusedTarget: object | undefined;
  /** The scene timers started, on the screen's own clock (ms since the entry); a timer not in it has not started. */
  private readonly timerStartedAt = new Map<number, number>();
  /** The LNMODE button's choice over the focused chart's `#LNMODE`; nothing plays it yet. */
  private lnModeOverride: 0 | 1 | 2 | undefined;
  /**
   * The key filter and sort the MODE and SORT buttons step from: the frame's, or what the view last asked for until the
   * next frame shows the session's, so a second press before that frame steps on rather than asking for the same again.
   */
  private listAsked: Pick<BrowseListOptions, 'keysFilter' | 'sort'> | undefined;

  public constructor(kit: BeatorajaKit, options: BeatorajaSelectViewOptions = {}) {
    this.kit = kit;
    this.options = options;
    // `passive`, not `static`: Pixi hit-tests the children of an interactive container as interactive too, so the row
    // label above a row's hit sprite would take a click on the title text and hand it to this (listener-less) layer.
    // Passive leaves each child to its own mode: only the row hit sprites are hit.
    this.listLayer.eventMode = 'passive';
    // A click anywhere on the README overlay closes it, as its footer says.
    this.readText.layer.eventMode = 'static';
    this.readText.layer.on('pointertap', () => this.emit?.({ type: 'readtext' }));
    this.stage = this.buildStage();
    this.root.addChild(this.stage.root);
  }

  /**
   * Takes another kit: the player's new options for the skin, or another select skin. The skin view, the bar list and
   * the search prompt are built again for it; the place in the list, the chart images and the LNMODE choice stay.
   */
  public updateKit(kit: BeatorajaKit): void {
    // The entry as loaded before (the host hands it again on every return to the screen): nothing to build.
    if (this.disposed || kit.kit === this.kit.kit) return;
    this.kit = kit;
    this.search.destroySearchPrompt();
    this.skinState.cachedBaseOps = undefined;
    this.rows.forgetSkin();
    // The old skin view's container lets go of its children as it is destroyed: the list layer and the overlay move
    // into the new one.
    this.stage.dispose();
    this.stage = this.buildStage();
    this.root.addChild(this.stage.root);
    if (this.host !== undefined) this.stage.fitTo(this.host);
  }

  public attach(host: PixiSceneHost, emit: IntentSink<SelectIntent>): void {
    if (this.disposed) return;
    this.host = host;
    this.emit = emit;
  }

  public detach(): void {
    this.host = undefined;
    this.emit = undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.search.destroySearchPrompt();
    this.rows.destroyRowVisuals();
    this.listLayer.parent?.removeChild(this.listLayer);
    if (!this.listLayer.destroyed) this.listLayer.destroy({ children: true });
    this.readText.layer.parent?.removeChild(this.readText.layer);
    if (!this.readText.layer.destroyed) this.readText.layer.destroy({ children: true });
    this.stage.dispose();
    this.chartImages.dispose();
    this.root.parent?.removeChild(this.root);
    if (!this.root.destroyed) this.root.destroy({ children: false });
  }

  public getStageInfo(): { container: Container; width: number; height: number } {
    return this.stage.getStageInfo();
  }

  /** A beatoraja skin's search word is drawn by the skin: the host's text field is not laid over it. */
  public searchFieldRect(): undefined {
    return undefined;
  }

  public draw(frame: SelectFrame): void {
    const host = this.host;
    if (host === undefined || this.disposed) return;
    this.stage.fitTo(host);
    if (frame.clock.enteredAtMs !== this.enteredAtMs) this.startScene(frame);
    this.followList(frame);
    this.frame = frame;
    this.listAsked = undefined;
    for (const event of frame.events) {
      if (event.kind === 'readtext-scroll') this.readText.scrollBy(event.delta);
    }
    this.readText.show(frame.readText);
    const view = this.stage.view;
    this.skinState.frameInput = undefined;
    this.skinState.frameInput = this.skinState.selectInput();
    const focused = frame.entries[frame.cursor];
    this.chartImages.refreshChartImagesForFocus(focused?.kind === 'song' ? focused.song : undefined);
    this.rows.refreshRowVisuals();
    this.search.refreshSearchPrompt();
    if (this.readText.open && view.container.children.at(-1) !== this.readText.layer) {
      // On top of the skin and the search prompt.
      view.container.addChild(this.readText.layer);
    }
    this.readText.render(view.width, view.height);
    const skinSounds = this.options.skinSounds;
    view.update({
      activeOps: this.skinState.computeActiveOps(),
      // A timer that has not started reads `undefined`, which hides what is gated on it (the fade-out's black cover).
      getTimerStart: (timerId) => this.timerStartedAt.get(timerId),
      nowMs: beatorajaSceneNowMs(frame.clock),
      audioPlay: skinSounds === undefined ? undefined : (path, volume) => skinSounds.play(path, volume),
      audioLoop: skinSounds === undefined ? undefined : (path, volume) => skinSounds.loop(path, volume),
      audioStop: skinSounds === undefined ? undefined : (path) => skinSounds.stop(path),
    });
    this.skinState.frameInput = undefined;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The skin
  // ---------------------------------------------------------------------------------------------------------------------

  /** The skin view of the kit on its stage, with the bar list built for its `songlist` and the overlay on top. */
  private buildStage(): BeatorajaSkinStage {
    const { skin, textures, fonts } = this.kit.kit;
    const view = new BeatorajaPlaySkinView({
      skin,
      textures,
      // The skin options' ops pick the layout variants of a select skin's destinations (ModernChic's per-option rects).
      skinConfigOps: this.skinState.baseOps(),
      // The texts and numbers follow the focused bar, as beatoraja's select screen does.
      resolveTextContent: (ref) => this.skinState.resolveSelectionText(ref),
      resolveNumberValue: (ref) => this.skinState.resolveSelectionNumber(ref),
      // The image sets with a `ref`: the MODE, SORT and LNMODE buttons' labels, the lamp.
      resolveRefValue: (ref) => this.skinState.resolveSelectionRefValue(ref),
      resolveSliderValue: (type) => resolveBeatorajaSelectSliderValue(type),
      onButtonAction: (act, modifiers) => this.handleButtonAction(act, modifiers?.shift === true),
      resolveFontFamily: fonts !== undefined ? (id) => fonts.family(id) : undefined,
      resolveFontKind: fonts !== undefined ? (id) => fonts.kind(id) : undefined,
      // The focused chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` (-100 / -101 / -102), its BPM and notes graphs.
      chartImageProvider: (id) => this.chartImages.resolveChartImageForFocus(id),
      resolveBpmGraphData: () => this.chartImages.resolveBpmGraphDataForFocus(),
      resolveNoteDistribution: () => this.chartImages.resolveNoteDistributionForFocus(),
    });
    const stage = new BeatorajaSkinStage(view);
    // The rows lay themselves out on the stage's canvas.
    this.stage = stage;
    // At the skin's `songlist` anchor in its destinations: what the skin declares before it draws behind the bars,
    // what it declares after on top.
    view.container.addChildAt(this.listLayer, view.songListLayerInsertIndex);
    view.container.addChild(this.readText.layer);
    // Another skin can lay the bars out otherwise (another `liston[]` length): the rows are built again for it.
    this.rows.songList = parseBeatorajaSongList(skin);
    this.rows.applySongListGeometry();
    this.rows.buildRowVisuals(fonts);
    return stage;
  }

  /** The screen entered: its timers start, and the list shows the cursor at once. */
  private startScene(frame: SelectFrame): void {
    this.enteredAtMs = frame.clock.enteredAtMs;
    this.timerStartedAt.clear();
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
    this.timerStartedAt.set(TIMER_SONGBAR_CHANGE, 0);
    this.scrollPosition = frame.cursor;
    this.shownEntries = frame.entries;
    this.focusedTarget = barTarget(frame.entries[frame.cursor]);
    this.lastDrawMs = undefined;
  }

  /**
   * Follows the frame's list: a new list snaps the glide to the cursor; a cursor move keeps the list where it shows now
   * relative to the bar left, so the glide takes the move's own steps to the new bar (the short way round a wrap). The
   * bar-change timer starts whenever the bar under the cursor changes or the list moves. Then the glide closes on the
   * cursor, at the same speed whatever the frame rate.
   */
  private followList(frame: SelectFrame): void {
    let moved = false;
    if (frame.entries !== this.shownEntries) {
      this.shownEntries = frame.entries;
      this.scrollPosition = frame.cursor;
      moved = true;
    } else {
      for (const event of frame.events) {
        if (event.kind !== 'browse' || event.event.kind !== 'cursor') continue;
        const { from, to, delta } = event.event;
        this.scrollPosition += to - delta - from;
        moved = true;
      }
    }
    const target = barTarget(frame.entries[frame.cursor]);
    if (target !== this.focusedTarget) {
      this.focusedTarget = target;
      moved = true;
    }
    if (moved) this.timerStartedAt.set(TIMER_SONGBAR_CHANGE, beatorajaSceneNowMs(frame.clock));
    const steps = this.lastDrawMs === undefined ? 1 : Math.max(0, frame.clock.nowMs - this.lastDrawMs) / FRAME_MS;
    this.lastDrawMs = frame.clock.nowMs;
    const gap = frame.cursor - this.scrollPosition;
    if (Math.abs(gap) < SCROLL_SNAP_THRESHOLD) {
      this.scrollPosition = frame.cursor;
    } else {
      this.scrollPosition += gap * (1 - Math.pow(1 - SCROLL_TWEEN_RATE, steps));
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------------------------------

  /**
   * A click on visible row `rowOffset`: the bar shown there (around the glide, wrapped) is taken when it is the focused
   * one, else the cursor moves onto it by the rows between, so the list glides the way the player clicked.
   */
  private handleRowPointerTap(rowOffset: number): void {
    const frame = this.frame;
    if (frame === undefined || this.disposed) return;
    const total = frame.entries.length;
    if (total === 0) return;
    const shown = Math.round(this.scrollPosition);
    const raw = shown + (rowOffset - this.rows.centreRowIndex);
    const index = ((raw % total) + total) % total;
    if (index === frame.cursor) {
      this.emit?.({ type: 'activate' });
      return;
    }
    this.emit?.({ type: 'browse', command: { type: 'move', delta: raw - frame.cursor } });
  }

  /**
   * A click on one of the skin's buttons (`image[].act`), as an intent. The press lights the button's op for a moment
   * whatever it does. `back` is Shift held: the MODE, SORT, LNMODE and JUDGE TIMING buttons step back.
   */
  private handleButtonAction(act: number, back: boolean): void {
    if (this.disposed) return;
    this.skinState.buttonPressedAt.set(act, this.context.nowMs());
    const emit = this.emit;
    const frame = this.frame;
    if (emit === undefined || frame === undefined) return;
    const step = back ? -1 : 1;
    switch (act) {
      case BEATORAJA_BUTTON.PLAY:
      // The practice mode is not implemented: PRACTICE plays the chart.
      case BEATORAJA_BUTTON.PRACTICE:
        emit({ type: 'start', autoPlay: false });
        return;
      case BEATORAJA_BUTTON.AUTOPLAY:
        emit({ type: 'start', autoPlay: true });
        return;
      case BEATORAJA_BUTTON.READTEXT:
        emit({ type: 'readtext' });
        return;
      case BEATORAJA_BUTTON.FAVORITTE_SONG:
        emit({ type: 'browse', command: { type: 'favorite', list: 'music' } });
        return;
      case BEATORAJA_BUTTON.FAVORITTE_CHART:
        emit({ type: 'browse', command: { type: 'favorite', list: 'charts' } });
        return;
      case BEATORAJA_BUTTON.MODE: {
        const list = this.listAsked ?? frame.browse.list;
        const keysFilter =
          BEATORAJA_KEYS_FILTERS[
            stepIndex(beatorajaKeysFilterIndex(list.keysFilter), step, BEATORAJA_KEYS_FILTERS.length)
          ]!;
        this.listAsked = { keysFilter, sort: list.sort };
        emit({ type: 'browse', command: { type: 'list', options: { keysFilter } } });
        return;
      }
      case BEATORAJA_BUTTON.SORT: {
        const list = this.listAsked ?? frame.browse.list;
        const sort = BEATORAJA_SORTS[stepIndex(beatorajaSortIndex(list.sort), step, BEATORAJA_SORTS.length)]!;
        this.listAsked = { keysFilter: list.keysFilter, sort };
        emit({ type: 'browse', command: { type: 'list', options: { sort } } });
        return;
      }
      case BEATORAJA_BUTTON.LNMODE:
        this.stepLnMode(step);
        return;
      case BEATORAJA_BUTTON.JUDGE_TIMING:
        this.stepJudgeTiming(step);
        return;
      case BEATORAJA_BUTTON.OPEN_IR_WEBSITE:
        openIrWebsite();
        return;
      default:
        // The replay slots, key config, skin select and the community extensions (GdbG's volume, 900) do nothing yet.
        log.debug('button not implemented', { act });
        return;
    }
  }

  /**
   * Steps the LNMODE button's choice (LN / CN / HCN), starting from the focused chart's own `#LNMODE` the first time,
   * so the first press moves on from what the button showed.
   */
  private stepLnMode(step: number): void {
    const focused = this.frame?.entries[this.frame.cursor];
    const current =
      this.lnModeOverride ??
      beatorajaLnModeIndex(focused?.kind === 'song' ? focused.song.chart.bms?.lnMode : undefined);
    this.lnModeOverride = ((((current + step) % 3) + 3) % 3) as 0 | 1 | 2;
  }

  /**
   * Steps the skin's judge timing offset (number 12) by 1 ms within ±200 ms, and hands the options to the host to keep.
   * The view draws with them at once.
   */
  private stepJudgeTiming(step: number): void {
    const config = this.kit.kit.skinConfig;
    if (config === undefined) return;
    const current = typeof config.offset === 'number' && Number.isFinite(config.offset) ? config.offset : 0;
    const next = Math.max(-JUDGE_TIMING_LIMIT_MS, Math.min(JUDGE_TIMING_LIMIT_MS, current + step));
    if (next === current) return;
    const changed: BeatorajaSkinConfig = {
      ...config,
      offset: next,
      option: { ...config.option },
      file: { ...config.file },
    };
    this.kit = { ...this.kit, kit: { ...this.kit.kit, skinConfig: changed } };
    this.options.onSkinConfigChange?.(changed);
  }

  /** Decodes a chart's own images, over the files of the library drawn. */
  private decodeChartImages(song: BrowserSongEntry): Promise<BeatorajaChartImages> {
    const library = this.frame?.library;
    if (library === undefined) return Promise.resolve({});
    const load = this.options.loadChartImages;
    return load !== undefined ? load(song, library) : loadBeatorajaChartImages(song, resolveSongSource(library, song));
  }

  /**
   * The view as its parts read and drive it: getters over its state and the frame drawn, and arrow methods over its
   * own, so the parts reach what they need while it stays private to the view.
   */
  private static createContext(view: BeatorajaSelectView): BeatorajaSelectViewContext {
    return {
      get view(): BeatorajaPlaySkinView {
        return view.stage.view;
      },
      get options() {
        return view.kit.kit;
      },
      get listLayer(): Container {
        return view.listLayer;
      },
      get entries(): ReadonlyArray<BrowserBrowseEntry> {
        return view.frame?.entries ?? [];
      },
      get currentIndex(): number {
        return view.frame?.cursor ?? 0;
      },
      get scrollPosition(): number {
        return view.scrollPosition;
      },
      handleRowPointerTap: (rowOffset) => view.handleRowPointerTap(rowOffset),
      get searchQuery(): string {
        return view.frame?.browse.searchText ?? '';
      },
      get list() {
        return view.frame?.browse.list ?? { keysFilter: 'ALL' as const, sort: 'OFF' as const };
      },
      get lnModeOverride(): 0 | 1 | 2 | undefined {
        return view.lnModeOverride;
      },
      currentFolderLabel: () => view.frame?.browse.path.at(-1)?.label ?? '',
      lampOpOf: (entry) => {
        const records = view.frame?.records;
        if (records === undefined) return undefined;
        const record =
          entry.kind === 'song'
            ? records.chart(entry.song)
            : entry.kind === 'course'
              ? records.course(entry.course)
              : undefined;
        return record !== undefined ? beatorajaClearLampOp(record.lamp) : undefined;
      },
      nowMs: () => view.frame?.clock.nowMs ?? 0,
      get decodeChartImages() {
        return (song: BrowserSongEntry) => view.decodeChartImages(song);
      },
      get disposed(): boolean {
        return view.disposed;
      },
    };
  }
}

/** `index` stepped by `step` round `count` choices. */
function stepIndex(index: number, step: number, count: number): number {
  return (((index + step) % count) + count) % count;
}

/**
 * Opens the IR (Internet Ranking) website in a new tab (OPEN_IR_WEBSITE, act 210): the LR2IR-compatible ranking most
 * beatoraja players use. The chart's MD5 is not worked out, so it opens the site's ranking page for the player to
 * search; `noopener` keeps the site from reaching back into the player.
 */
function openIrWebsite(): void {
  if (typeof window === 'undefined') return;
  window.open('http://www.dream-pro.info/~lavalse/LR2IR/search.cgi?mode=ranking', '_blank', 'noopener,noreferrer');
}
