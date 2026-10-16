/**
 * What the beatoraja select scene's skin reads of the screen (`PixiBeatorajaSelectScene`), through
 * `@be-music/beatoraja-skin/scene`: the frame's select input (the focused bar and its chart's facts, the folder, the
 * search, the MODE / SORT / LNMODE choices, the skin, the judge timing, the bar's best lamp, the clock), the texts,
 * numbers and image-set values resolved from it, and the active ops: the skin's options, the focused bar's ops and the
 * buttons pressed a moment ago.
 *
 * The part reads the scene's state through {@link BeatorajaSelectSkinStateContext}; the select scene passes it.
 */

import { buildBaseOpSet } from '@be-music/beatoraja-skin';
import {
  BEATORAJA_KEYS_FILTERS,
  BEATORAJA_SORTS,
  beatorajaWallClockOf,
  resolveBeatorajaSelectBarOps,
  resolveBeatorajaSelectNumber,
  resolveBeatorajaSelectRefValue,
  resolveBeatorajaSelectText,
  type BeatorajaSelectInput,
} from '@be-music/beatoraja-skin/scene';
import type { BrowserBrowseEntry } from '../../../collection/types.ts';
import type { PixiBeatorajaSelectSceneOptions } from './options.ts';
import { selectChartFacts } from './chart-facts.ts';

/**
 * How long a `BUTTON_*` op stays active after a click fires (audit 2.1). 200ms is long
 * enough for the player to perceive the press-state highlight in skins that author short
 * "press feedback" tweens, short enough that subsequent clicks don't pile up if the user
 * mashes a button. Beatoraja itself gates press feedback on Java's input-frame state which
 * lasts a single frame; our 200ms window gives smooth animation under a 60fps tick.
 */
const BUTTON_PRESS_WINDOW_MS = 200;

/** What the skin state reads on the select scene: its fields and methods of these names. */
export interface BeatorajaSelectSkinStateContext {
  readonly options: Pick<
    PixiBeatorajaSelectSceneOptions,
    'skin' | 'skinConfig' | 'resolveSongLampOp' | 'resolveCourseLampOp'
  >;
  readonly entries: ReadonlyArray<BrowserBrowseEntry>;
  /** The cursor: `entries[currentIndex]` is the focused bar. */
  readonly currentIndex: number;
  readonly searchQuery: string;
  /** The MODE button's key-mode filter (an index into `BEATORAJA_KEYS_FILTERS`). */
  readonly keymodeFilter: number;
  /** The SORT button's order (an index into `BEATORAJA_SORTS`). */
  readonly sortMode: number;
  /** The LNMODE button's pick over the chart's own `#LNMODE`. */
  readonly lnModeOverride: 0 | 1 | 2 | undefined;
  currentFolderLabel(): string;
}

/** What the skin reads of the screen. See the module comment. */
export class BeatorajaSelectSkinState {
  private readonly ctx: BeatorajaSelectSkinStateContext;

  constructor(ctx: BeatorajaSelectSkinStateContext) {
    this.ctx = ctx;
  }

  /**
   * Stable per-skin op set — `skin_config.option` picks plus any always-on flags. Cached because
   * `buildBaseOpSet` walks the option map; recompute only when `replaceSkin` invalidates the
   * cache. Live per-frame ops (focused-bar kind, chart keymode) are added on top in
   * {@link computeActiveOps}.
   */
  baseOps(): ReadonlySet<number> {
    if (this.cachedBaseOps !== undefined) return this.cachedBaseOps;
    this.cachedBaseOps = buildBaseOpSet(this.ctx.options.skinConfig?.option);
    return this.cachedBaseOps;
  }
  cachedBaseOps: ReadonlySet<number> | undefined;
  /**
   * Transient BUTTON-press tracker (audit 2.1). Maps each clicked `act` code to the
   * `performance.now()` timestamp at which the press happened. `computeActiveOps` adds the
   * code to the active op set while it's still within {@link BUTTON_PRESS_WINDOW_MS}, so
   * skins gating press-state chrome on the matching op see the highlight in flight. Older
   * entries get garbage-collected lazily during op resolution; the map stays bounded since
   * the user can only click so many buttons per second.
   */
  readonly buttonPressedAt = new Map<number, number>();

  /**
   * Per-frame active op set: the stable base ops, the focused bar's ops and the buttons pressed a moment ago. Without
   * the bar's ops the info pane stays hidden: its destinations are gated on `op:[2]` (`SONGBAR`).
   */
  computeActiveOps(): ReadonlySet<number> {
    const base = this.baseOps();
    // Fast path: no active entry → just the base set (includes `skin_config.option` picks).
    const entry = this.ctx.entries[this.ctx.currentIndex];
    if (entry === undefined) return base;

    const ops = new Set(base);
    // The bar's ops: the screen's fixed state, and the folder, course or chart bar with its key mode, traits,
    // difficulty, judge rank and clear lamp (`resolveBeatorajaSelectBarOps`).
    for (const op of resolveBeatorajaSelectBarOps(this.selectInput())) ops.add(op);

    // Transient BUTTON-press feedback (audit 2.1). Each `act` code clicked within the last
    // `BUTTON_PRESS_WINDOW_MS` lights its matching op so destinations gating press-state
    // chrome on `op = {act}` show their pressed visual. GC stale entries lazily — the map's
    // size is bounded by user-click rate, which can never exceed ~10/sec.
    if (this.buttonPressedAt.size > 0) {
      const now = performance.now();
      for (const [act, pressedAtMs] of this.buttonPressedAt) {
        if (now - pressedAtMs >= BUTTON_PRESS_WINDOW_MS) {
          this.buttonPressedAt.delete(act);
          continue;
        }
        ops.add(act);
      }
    }
    return ops;
  }

  /**
   * What the skin reads of the screen (`@be-music/beatoraja-skin/scene`): the focused bar and its chart's facts, the
   * folder, the search, the MODE / SORT / LNMODE choices, the skin, the judge timing, the bar's best lamp and the clock.
   * Built once per frame in {@link tick}; read through it for every value, text and image of the frame.
   */
  selectInput(): BeatorajaSelectInput {
    if (this.frameInput !== undefined) return this.frameInput;
    const entry = this.ctx.entries[this.ctx.currentIndex];
    const offset = this.ctx.options.skinConfig?.offset;
    const lampOp =
      entry?.kind === 'song'
        ? this.ctx.options.resolveSongLampOp?.(entry.song)
        : entry?.kind === 'course' && entry.course.random === undefined
          ? this.ctx.options.resolveCourseLampOp?.(entry.course)
          : undefined;
    return {
      focused: entry,
      ...(entry?.kind === 'song' ? { chart: selectChartFacts(entry.song) } : {}),
      folderLabel: this.ctx.currentFolderLabel(),
      searchText: this.ctx.searchQuery,
      list: {
        keysFilter: BEATORAJA_KEYS_FILTERS[this.ctx.keymodeFilter] ?? 'ALL',
        sort: BEATORAJA_SORTS[this.ctx.sortMode] ?? 'OFF',
      },
      ...(this.ctx.lnModeOverride !== undefined ? { lnMode: this.ctx.lnModeOverride } : {}),
      skin: { name: this.ctx.options.skin.name, author: this.ctx.options.skin.author },
      judgeTiming: typeof offset === 'number' && Number.isFinite(offset) ? offset : 0,
      ...(lampOp !== undefined ? { lampOp } : {}),
      wallClock: beatorajaWallClockOf(new Date()),
    };
  }

  /** The frame's {@link selectInput}, while `tick` draws it. */
  frameInput: BeatorajaSelectInput | undefined;

  resolveSelectionText(refOp: number): string | undefined {
    return resolveBeatorajaSelectText(refOp, this.selectInput());
  }

  resolveSelectionNumber(refOp: number): number | undefined {
    return resolveBeatorajaSelectNumber(refOp, this.selectInput());
  }

  resolveSelectionRefValue(refOp: number): number {
    return resolveBeatorajaSelectRefValue(refOp, this.selectInput());
  }
}
