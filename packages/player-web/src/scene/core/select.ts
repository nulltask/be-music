import { Application, Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { PerfTracker } from '../perf.ts';
import { type PixiSceneHost } from '../host.ts';
import { disposeChildren } from '../pixi-utils.ts';
import { groupSongsByFolder, loadAssetBytes, resolveSongSource } from '../../collection/collection.ts';
import { dirname } from '@be-music/utils/core';
import { ChartPreviewEngine } from '../../chart/preview.ts';
import { AudioAnalyzer } from '../../runtime/audio-analysis.ts';
import { resolveKeyModeOp, SELECT_KEYS_FILTER_TO_OP } from '../select-ops.ts';
import { logger } from '../../logger.ts';
import type {
  BrowserBrowseEntry,
  BrowserFolderNode,
  BrowserSongCollection,
  BrowserSongEntry,
} from '../../collection/types.ts';
import { CORE_TEXT_FONT } from './fonts.ts';
import type { BeMusicEffectLevel, BeMusicSkin } from '../../skin/be-music/types.ts';
import { BeMusicSelectBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { resolveSelectListWindow } from '../../skin/be-music/registry.ts';
import { phantomSkin } from '../../skins/phantom/index.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from './viewport.ts';
import { masterOutput } from '../../runtime/master-volume.ts';

const log = logger('select');
const BG = new Color('#050912');
const TEXT = new Color('#f6f2e8');
const MUTED = new Color('#a9a39a');
/**
 * Design canvas the no-skin select scene renders into. 640×480 matches the LR2 default `select.lr2skin` (no
 * `#RESOLUTION` declared, so the loader's seed at width=640 / height=480 wins).
 *
 * Aligning the fallback design with LR2's native canvas means dropping an LR2 theme mid-session doesn't change the
 * on-screen aspect ratio (4:3 either way) — without this the no-skin path letterboxed at 16:9 and the LR2-skin path
 * pillarboxed at 4:3, causing the song list to visibly shrink when a theme loaded.
 *
 * The LR2 decide / result scenes carry the same constant for the same reason.
 */
const FALLBACK_DESIGN_WIDTH = 640;
const FALLBACK_DESIGN_HEIGHT = 480;

/**
 * Pixel scroll step for the readtext modal's arrow-key nudge — roughly two lines at the body's 14px / 18px line-height.
 * Wheel input uses the browser's native `deltaY` (already in pixels) so it doesn't need this constant.
 */
const READTEXT_LINE_SCROLL = 36;
/**
 * PageUp / PageDown / Space scroll step — most of a viewport, leaving a couple of lines of overlap so the user can
 * re-find their place after the jump.
 */
const READTEXT_PAGE_SCROLL = 360;

/**
 * Minimum interval between two wheel-driven cursor moves in the bar list. Modern trackpads / high-resolution mice fire
 * `wheel` events at ~60+ Hz with tiny per-event `deltaY`s, so an unthrottled handler advances the cursor a dozen+ slots
 * per flick — far past the entry the user was aiming for, with the `cursor-move` SFX chattering on every notch and the
 * smooth-scroll offset re-seeded before the previous slide finishes. 15 ms ≈ twice the rate of macOS's fastest key-
 * repeat setting (~30 ms / repeat at the slider's max), so a sustained scroll feels noticeably snappier than holding
 * an arrow key while still resolving a deliberate trackpad flick to a bounded number of steps instead of a dozen+.
 */
const WHEEL_THROTTLE_INTERVAL_MS = 15;

/**
 * Serializable cursor / browse state. Used to round-trip the select view across `dispose()` / new-instance cycles (e.g.
 * play → return → select), so the user lands back on the same song they launched.
 *
 * Folder identity travels by **label** rather than node reference because each `setCollection()` call rebuilds the
 * folder list — the actual `BrowserFolderNode` objects from the previous instance no longer exist by the time we
 * restore.
 */
export interface PixiSongSelectNavigation {
  /** Sequence of folder labels from root to the deepest open folder. */
  folderPath: string[];
  /** Cursor position in the deepest entry list. */
  selectedIndex: number;
}

/**
 * Per-session gameplay tweaks the user picks from the select-screen "PLAY OPTIONS" overlay (toggled with Space). The
 * host reads the current snapshot via {@link CoreSongSelectView.getPlayOptions} on song-pick and feeds it into {@link
 * PixiGameplayViewOptions}.
 *
 * Kept deliberately small for now — HiSpeed and AutoPlay are the two choices that change every play session. Note
 * arrangement (RANDOM / MIRROR / S-RANDOM), gauge type, and judge rank would slot in here once the gameplay engine
 * grows the corresponding transformations.
 */
export interface PixiPlayOptions {
  /**
   * Visual scroll-speed multiplier. The chart's note-to-second mapping is unchanged; only the on-screen pixels-per-beat
   * scaling moves. Range matches gameplay's runtime adjust hotkeys (`ArrowUp` / `ArrowDown` during play).
   */
  hiSpeed: number;
  /**
   * When `true`, every note auto-judges as PERFECT at its scheduled time. Mirrors the LR2 AUTOPLAY skin button
   * (`#SRC_BUTTON type=16`); the dedicated `onSongAutoPlay` callback also forces this on for that single launch
   * regardless of what's stored here.
   */
  autoPlay: boolean;
  /**
   * BGA (background animation) display mode. Mirrors the LR2 `#SRC_BUTTON,type=72` cycle (OFF / ON / AUTOPLAY ONLY).
   * When `'AUTOPLAY_ONLY'` the BGA renders only when {@link autoPlay} (or the AUTOPLAY skin-button override) is also
   * active — matches LR2 behavior where AUTOPLAY ONLY hides BGA during regular human-played sessions.
   */
  bga: PixiBgaMode;
  /**
   * BGA frame size — `'NORMAL'` uses the skin's default `#DST_BGA` rect (op 30), `'EXTEND'` uses the larger variant
   * gated on op 31. Mirrors `#SRC_BUTTON,type=73`.
   */
  bgaSize: PixiBgaSize;
  /**
   * Score-graph (per-judge prediction line) display flag. Mirrors `#SRC_BUTTON,type=70` and ops 38 (off) / 39 (on). The
   * LR2 default skin gates its score-graph chrome on op 39 — toggling this on reveals those elements without needing a
   * dedicated renderer in the gameplay scene.
   */
  scoreGraph: boolean;
  /**
   * Difficulty filter for the song-list. `'ALL'` shows every chart; the named values restrict the bar list to charts
   * whose `#DIFFICULTY` matches the corresponding LR2 enum (1=BEGINNER.. 5=INSANE). Mirrors `#SRC_BUTTON,type=10`
   * (cycling) and types 91..96 (direct set).
   */
  difficultyFilter: PixiDifficultyFilter;
  /**
   * Keymode filter for the song-list. `'ALL'` shows every chart; the named values restrict the bar list to charts whose
   * lane usage matches the corresponding LR2 keymode op (160=7K..164=9K). Mirrors `#SRC_BUTTON,type=11` cycling.
   */
  keysFilter: PixiKeysFilter;
  /**
   * Sort order for the song-list. Mirrors `#SRC_BUTTON,type=12` cycling (off / level / title / clear). `'CLEAR'` is a
   * no-op for now — without persisted play history every chart has the same "not played" status, so the sorted order
   * matches the input order anyway.
   */
  sort: PixiSelectSort;
  /**
   * HS-FIX mode picked from `#SRC_BUTTON,type=55`. Without HS-FIX (`'OFF'`) the visual scroll rate scales with the
   * chart's BPM, so high-BPM sections fly past while low-BPM sections crawl. The other modes apply a one-time HS
   * multiplier so the user's chosen HS feels consistent across the chart:
   *
   * - `'MAXBPM'` — pegs the user's HS to the chart's MAX BPM (slower segments scroll proportionally slower).
   * - `'MINBPM'` — pegs to MIN BPM (faster segments scroll faster).
   * - `'AVERAGE'` — pegs to the time-weighted average BPM.
   * - `'CONSTANT'` — adjusts HS at every BPM change so visual scroll is exactly constant. Falls back to `'AVERAGE'`
   *   behavior for now (per-frame BPM-aware scroll requires a render-pipeline change that hasn't landed yet).
   */
  hsFix: PixiHsFix;
  /**
   * 1P-side HIDDEN / SUDDEN effect picked from `#SRC_BUTTON,type=50`. Cycles OFF → HIDDEN → SUDDEN → HID+SUD on each
   * click. Drives the opaque mask over the 1P keyboard / scratch lanes. SP charts only render this side; DP charts pair
   * it with {@link hiddenSudden2P}.
   */
  hiddenSudden1P: PixiHiddenSudden;
  /**
   * 2P-side HIDDEN / SUDDEN effect picked from `#SRC_BUTTON,type=51`. Independent from the 1P value — LR2's panel UI
   * exposes per-side cycle buttons because real players sometimes want, e.g., HIDDEN on their dominant side and OFF on
   * the other.
   */
  hiddenSudden2P: PixiHiddenSudden;
  /**
   * Shutter / LANE COVER coverage (0..1) — the fraction of the playfield the LANE COVER (and any active HIDDEN / SUDDEN
   * masks) occupies. Drives slider `type=4 / 5` on the panel-1 shutter track. Adjustable via the 1P 4-key / 6-key
   * (`KeyD` / `KeyF`) when panel 1 is open. Independent from {@link laneCover} — height is preserved across ON/OFF
   * toggles so the user doesn't have to redial it after re-enabling the cover.
   */
  shutter: number;
  /**
   * LANE COVER ON / OFF toggle. In LR2's SYSTEM OPTION panel this is the binary state shown next to the "LANE COVER"
   * label — distinct from {@link shutter} (which is the height). When OFF, the gameplay-side mask is hidden regardless
   * of `shutter`. When ON, the mask renders at the `shutter`-derived height.
   */
  laneCover: boolean;
  /**
   * 1P side auto-scratch flag picked from `#SRC_BUTTON,type=44`. When true the scratch lane (channel 16) auto-judges as
   * PERFECT at every note's scheduled time, so the player only has to play the keys.
   */
  autoScratch1P: boolean;
  /** 2P side auto-scratch (`#SRC_BUTTON,type=45`, channel 26). */
  autoScratch2P: boolean;
  /**
   * DP FLIP toggle picked from `#SRC_BUTTON,type=54`. When true, 1P and 2P lane channels are swapped at chart-prepare
   * time. Only DP charts have lanes on both sides, so SP charts are unaffected. LR2 has no dedicated op for DP FLIP —
   * it's a pure gameplay-side transformation.
   */
  dpFlip: boolean;
  /**
   * Note-arrangement mode for the 1P keyboard lanes (channels 11..15 + 18 + 19). Mirrors `#SRC_BUTTON,type=42`. Scratch
   * (channel 16) is never touched.
   *
   * - `OFF` — original chart layout
   * - `MIRROR` — reverse the lane order (1↔7, 2↔6, 3↔5)
   * - `RANDOM` — chart-wide random permutation of the lanes
   * - `S-RANDOM` — per-chord random assignment (chord shapes are NOT preserved)
   * - `SCATTER` — currently aliased to `RANDOM`; reserved for a future per-measure permutation pass
   */
  random1P: PixiRandomMode;
  /** 2P side note arrangement (channels 21..25 + 28 + 29). */
  random2P: PixiRandomMode;
  /**
   * 1P gauge variant (`#SRC_BUTTON,type=40`):
   *
   * - `GROOVE` — LR2 default cumulative gauge (start 20 %, clear 80 %)
   * - `HARD` — survival gauge (start 100 %, fail at 0 %)
   * - `DEATH` — instant-death (start 100 %, any miss = 0)
   * - `EASY` — gentler GROOVE (clear 60 %)
   */
  gauge1P: PixiGaugeType;
  /** 2P gauge variant (`#SRC_BUTTON,type=41`). */
  gauge2P: PixiGaugeType;
}

/** Allowed values for {@link PixiPlayOptions.difficultyFilter}. */
export type PixiDifficultyFilter = 'ALL' | 'BEGINNER' | 'NORMAL' | 'HYPER' | 'ANOTHER' | 'INSANE';

/** Allowed values for {@link PixiPlayOptions.keysFilter}. */
export type PixiKeysFilter = 'ALL' | 'KEYS_5' | 'KEYS_7' | 'KEYS_9' | 'KEYS_10' | 'KEYS_14';

/** Allowed values for {@link PixiPlayOptions.sort}. */
export type PixiSelectSort = 'OFF' | 'LEVEL' | 'TITLE' | 'CLEAR';

/** Allowed values for {@link PixiPlayOptions.hsFix}. */
export type PixiHsFix = 'OFF' | 'MAXBPM' | 'MINBPM' | 'AVERAGE' | 'CONSTANT';

/** Allowed values for {@link PixiPlayOptions.hiddenSudden1P} / `hiddenSudden2P`. */
export type PixiHiddenSudden = 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';

/** Allowed values for {@link PixiPlayOptions.random1P} / `random2P`. */
export type PixiRandomMode = 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER';

/** Allowed values for {@link PixiPlayOptions.gauge1P} / `gauge2P`. */
export type PixiGaugeType = 'GROOVE' | 'HARD' | 'DEATH' | 'EASY';

const SHUTTER_DEFAULT = 0.25;

/** Allowed values for {@link PixiPlayOptions.bga}. */
export type PixiBgaMode = 'OFF' | 'ON' | 'AUTOPLAY_ONLY';

/** Allowed values for {@link PixiPlayOptions.bgaSize}. */
export type PixiBgaSize = 'NORMAL' | 'EXTEND';

/**
 * Cycle order for {@link PixiPlayOptions.bga}. Matches the LR2 default-skin cell order on the `#SRC_BUTTON,type=72`
 * sprite — `divx*divy` produces 3 cells (`OFF` / `ON` / `AUTOPLAY ONLY`) and clicks advance through them in this order.
 */
export const BGA_CYCLE: readonly PixiBgaMode[] = ['OFF', 'ON', 'AUTOPLAY_ONLY'];

/**
 * Cycle order for {@link PixiPlayOptions.bgaSize}. LR2 button cell order on `#SRC_BUTTON,type=73`: cell 0 = NORMAL,
 * cell 1 = EXTEND.
 */
export const BGA_SIZE_CYCLE: readonly PixiBgaSize[] = ['NORMAL', 'EXTEND'];

/**
 * Cycle order for {@link PixiPlayOptions.difficultyFilter}. Matches the LR2 `#SRC_BUTTON,type=10` cell order (off /
 * easy / normal / hard / expert / insane). The direct-set buttons (types 91..96) map onto specific entries here via {@link
 * DIFFICULTY_FILTER_BY_DIRECT_BUTTON}.
 */
export const DIFFICULTY_FILTER_CYCLE: readonly PixiDifficultyFilter[] = [
  'ALL',
  'BEGINNER',
  'NORMAL',
  'HYPER',
  'ANOTHER',
  'INSANE',
];

/**
 * Mapping from `#SRC_BUTTON,type=91..96` to the {@link PixiDifficultyFilter} they directly select. Per LR2 spec
 * (`docs/LR2SkinHelp.md` 6171+): 91 all, 92 beginner, 93 normal, 94 hyper, 95 another, 96 insane.
 */
export const DIFFICULTY_FILTER_BY_DIRECT_BUTTON: Record<number, PixiDifficultyFilter> = {
  91: 'ALL',
  92: 'BEGINNER',
  93: 'NORMAL',
  94: 'HYPER',
  95: 'ANOTHER',
  96: 'INSANE',
};

/**
 * Cycle order for {@link PixiPlayOptions.keysFilter}. Matches the LR2 `#SRC_BUTTON,type=11` cell order (off / 5keys /
 * 7keys / 10keys / 14keys / 9keys).
 */
export const KEYS_FILTER_CYCLE: readonly PixiKeysFilter[] = ['ALL', 'KEYS_5', 'KEYS_7', 'KEYS_10', 'KEYS_14', 'KEYS_9'];

/**
 * Cycle order for {@link PixiPlayOptions.sort}. LR2 button cells 0 / 1 / 2 / 3 = off / level / title / clear.
 */
export const SORT_CYCLE: readonly PixiSelectSort[] = ['OFF', 'LEVEL', 'TITLE', 'CLEAR'];

/**
 * Cycle order for {@link PixiPlayOptions.hsFix}. LR2 button cells 0..4 on `#SRC_BUTTON,type=55`: off / maxbpm / minbpm
 * / average / constant.
 */
export const HS_FIX_CYCLE: readonly PixiHsFix[] = ['OFF', 'MAXBPM', 'MINBPM', 'AVERAGE', 'CONSTANT'];

/**
 * Cycle order for {@link PixiPlayOptions.hiddenSudden1P} / `hiddenSudden2P`. LR2 button cells 0..3 on
 * `#SRC_BUTTON,type=50` (1P) and `type=51` (2P): off / hidden / sudden / hid+sud.
 */
export const HIDDEN_SUDDEN_CYCLE: readonly PixiHiddenSudden[] = ['OFF', 'HIDDEN', 'SUDDEN', 'HID+SUD'];

/** Cycle for boolean OFF/ON LR2 buttons (e.g. autoscratch). */
export const BOOLEAN_CYCLE: readonly boolean[] = [false, true];

/**
 * Cycle order for {@link PixiPlayOptions.random1P} / `random2P`. LR2 button cells 0..4 on `#SRC_BUTTON,type=42 / 43`:
 * off / mirror / random / s-random / scatter.
 */
export const RANDOM_CYCLE: readonly PixiRandomMode[] = ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM', 'SCATTER'];

/**
 * Cycle order for {@link PixiPlayOptions.gauge1P} / `gauge2P`. LR2 button cells 0..3 on `#SRC_BUTTON,type=40 / 41`:
 * groove / survival / death / easy.
 */
export const GAUGE_CYCLE: readonly PixiGaugeType[] = ['GROOVE', 'HARD', 'DEATH', 'EASY'];

/** Default play-option values, applied at view construction time. */
export const DEFAULT_PLAY_OPTIONS: PixiPlayOptions = {
  // Seed at 2.0× rather than upstream beatoraja's `PlayConfig.java:16` default of `1.0f`.
  // 1.0 produces an extremely slow scroll on most charts (ones BPM in the 130-180 range cover
  // about a full lane in 1.8 seconds at hispeed=1) which reads as "the chart isn't moving" to
  // anyone coming from LR2 / iidx-style defaults. 2.0 is the lowest preset most contemporary
  // BMS players actually use; the Up/Down hotkeys can adjust from there.
  hiSpeed: 2.0,
  autoPlay: false,
  bga: 'ON',
  // BGA renders at LR2's `#DST_BGA,...,30` rect (NORMAL) at `'NORMAL'` — a 256×256 window squeezed in beside the lane
  // chrome. `'EXTEND'` uses the larger `op 31` rect (392×392) which fills more of the playfield and is the default LR2
  // experience players expect; flip the seed accordingly.
  bgaSize: 'EXTEND',
  // Score graph (the per-judge prediction line gated on op 39) on by default — same intent: ship with the richer LR2
  // chrome visible up-front rather than hidden behind a panel toggle.
  scoreGraph: true,
  difficultyFilter: 'ALL',
  keysFilter: 'ALL',
  sort: 'OFF',
  hsFix: 'OFF',
  hiddenSudden1P: 'OFF',
  hiddenSudden2P: 'OFF',
  shutter: SHUTTER_DEFAULT,
  laneCover: false,
  autoScratch1P: false,
  autoScratch2P: false,
  dpFlip: false,
  random1P: 'OFF',
  random2P: 'OFF',
  gauge1P: 'GROOVE',
  gauge2P: 'GROOVE',
};

/**
 * Allowed range for {@link PixiPlayOptions.hiSpeed}. Mirrors gameplay's `HISPEED_MIN` / `HISPEED_MAX` so values seeded
 * from the select scene cover the same domain the in-play adjust hotkeys (`ArrowUp` / `ArrowDown`) can produce.
 * Duplicated here rather than re-exported from `scene/gameplay-constants.ts` so the select view stays free of gameplay
 * imports.
 */
export const HISPEED_MIN = 0.1;
export const HISPEED_MAX = 6.0;
/** Per-click HS step. 0.1 matches gameplay's `HISPEED_STEP`. */
const HISPEED_STEP = 0.1;

/**
 * Snaps a hiSpeed value to the 1/1000 grid and clamps to [{@link HISPEED_MIN}, {@link HISPEED_MAX}]. The 1/1000 snap
 * absorbs float drift from repeated +0.1 / -0.1 increments — the same trick the LR2 gameplay scene's `adjustHiSpeed`
 * uses so the two paths converge on identical step values.
 */
function clampHiSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAY_OPTIONS.hiSpeed;
  const snapped = Math.round(value * 1000) / 1000;
  return Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, snapped));
}

/**
 * Clamps a shutter coverage value to [0, 1] and snaps to the 1/100 grid so repeated keyboard +0.05 nudges land on round
 * values rather than drifting through float-rounding.
 */
function clampShutter(value: number): number {
  if (!Number.isFinite(value)) return SHUTTER_DEFAULT;
  const snapped = Math.round(value * 100) / 100;
  return Math.max(0, Math.min(1, snapped));
}

/**
 * Returns the next value of `current` in `values`, wrapping back to the start past the end. Used to advance enum-style
 * play options on each `#SRC_BUTTON` click (type 40, 42, 50, 72, 73, etc.). Falls back to `values[0]` when `current`
 * isn't a member of the cycle (defensive against host-supplied junk values).
 */
function cycleNext<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current);
  if (index < 0) return values[0]!;
  return values[(index + 1) % values.length]!;
}

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
  onSongSelected?: (song: BrowserSongEntry) => void;
  /**
   * AUTOPLAY-mode launch hook. Fired when the user clicks the skin's AUTOPLAY button (#SRC_BUTTON `type = 16`) or
   * presses the AUTOPLAY hotkey. Hosts launch gameplay with autoplay forced ON. Falls through to `onSongSelected`
   * semantics-wise (the song still starts) but lets the host distinguish manual play from auto-judged play and pre-set
   * the gameplay's `autoPlay` flag.
   */
  onSongAutoPlay?: (song: BrowserSongEntry) => void;
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
   * Initial cursor / folder state. When provided, the view restores the previous `selectedIndex` and walks back into
   * `folderPath` (skipping any segment whose label no longer exists). Used by the demo to remember the focused song
   * across play sessions.
   */
  initialNavigation?: PixiSongSelectNavigation;
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
}

/** Design-canvas size a skin family's theme renders the select frame into. */
export interface SelectDesignSize {
  width: number;
  height: number;
}

/**
 * Family-neutral song-select scene. Owns everything that doesn't depend on a particular skin format: mounting on the
 * shared {@link PixiSceneHost}, collection / folder browsing / search, keyboard + pointer input, cursor movement with its
 * system sounds, select BGM, chart preview, play options, the readtext overlay, and the ticker loop.
 *
 * Without a theme the frame renders through the be-music skin (`beMusicSkin`, defaulting to the built-in Phantom skin) on
 * a 640×480 design canvas. Skin families (e.g. the LR2 scene) take over the frame by overriding the protected `theme*`
 * hooks: {@link themeDesignSize} decides whether the theme is active, and the remaining hooks prepare, render, hit-test
 * and dispose the theme's resources.
 */
export class CoreSongSelectView<TOptions extends CoreSongSelectViewOptions = CoreSongSelectViewOptions> {
  /**
   * Host owning the shared `Application`. Set in {@link mount}; the `app` accessor below throws before that. With one
   * Application shared across scenes we sidestep the Pixi v8 module-shared `batchPool` race that two-Application setups
   * hit.
   */
  private host: PixiSceneHost | undefined;
  /**
   * Top-level Container the host attaches to its `app.stage` while the select scene is active. Holds
   * `viewportBackground` + `root` so the host can mount/unmount as one operation.
   */
  private readonly sceneRoot = new Container();
  private readonly root = new Container();
  /**
   * Clip mask for the design rectangle (`skin.width × skin.height` or the no-skin fallback canvas). Sits as a child of
   * `root` so the same `position` / `scale` transform applies to it. Pixi clips against the mask's world-space bounds,
   * so any skin element that animates from off-canvas (LR2 default's `#DST_BAR_BODY_OFF` slide-ins, etc.) gets cut at
   * the design edge instead of bleeding into the pillarbox / letterbox of a screen with a different aspect ratio.
   */
  private readonly designClipMask = new Graphics();
  /**
   * Last dimensions baked into the design / viewport / mask graphics. Compared against the per-frame values so we only
   * rebuild the geometry when the canvas actually resizes (skin swap, browser resize). Pixi v8's `Graphics.clear()` +
   * `.rect()` + `.fill()` chain rebuilds the underlying GraphicsContext on every call — fine for occasional resize
   * events, but redrawing the same three rectangles every `requestAnimationFrame` tick was on the hot path of the
   * select scene's 60 fps loop.
   */
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /** Theme chrome drawn behind the song list (LR2 static images, empty-state hint, …). Cleared every render. */
  protected readonly skinLayer: Container = new Container();
  /**
   * Theme chrome drawn on top of the song list. The LR2 scene routes elements its CSV declared AFTER the bar list
   * (`#SRC_BAR_BODY`) here — the canonical use case is the song-list scroll-position slider that lives to the right of
   * the bars. Cleared every render.
   */
  protected readonly skinForegroundLayer: Container = new Container();
  /**
   * Top-most overlay used by the LR2 READTEXT button (#SRC_BUTTON type 17). Hidden until the user clicks the button on
   * a song whose folder ships a `.txt` file. The skin's own readtext UI lives on its own panel timer (15 / 16) and we
   * don't have the chrome for that yet — render a no-frills modal so the feature is at least usable.
   */
  private readonly readTextLayer = new Container();
  private readonly readTextBackdrop = new Graphics();
  private readonly readTextCard = new Graphics();
  private readonly readTextTitle = new Text({
    text: 'Readme',
    style: new TextStyle({
      fill: TEXT,
      // Match the rest of the select-scene UI chrome — same weight / family used by `title` (the empty-state header)
      // and the result-screen panel labels. No `letterSpacing` tracking — that was a leftover from the all-caps draft
      // and looks sparse with mixed-case.
      fontSize: 22,
      fontWeight: '700',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  /**
   * Scroll viewport for the readtext body. The body lives inside this container with a mask matching
   * `readTextViewportMask`, so negative-Y offsets clip to the visible card area instead of overflowing onto the
   * surrounding skin / decide layer.
   */
  private readonly readTextViewport = new Container();
  private readonly readTextViewportMask = new Graphics();
  private readonly readTextBody = new Text({
    text: '',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 14,
      // Author notes are typically pre-formatted ASCII art / tables / column-aligned changelogs; a monospace font
      // preserves that layout. CJK glyphs fall back to the browser's monospace JP face automatically.
      fontFamily: 'ui-monospace, monospace',
      wordWrap: true,
      wordWrapWidth: 600,
      lineHeight: 18,
    }),
  });
  /** Scrollbar gutter + thumb (only visible when content overflows). */
  private readonly readTextScrollbar = new Graphics();
  /**
   * Footer hint inside the modal — the close shortcut would otherwise be invisible (no native `[x]` close button on the
   * Pixi card). Mirrors the LR2 default skin's right-hand README panel which always shows the dismiss key in-frame.
   */
  private readonly readTextFooter = new Text({
    text: '↑↓ / Wheel to scroll · Enter or click to close',
    style: new TextStyle({
      fill: MUTED,
      fontSize: 12,
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  /** True while the readtext modal is open. */
  private readTextOpen = false;
  /**
   * Pixel offset of the readtext body inside its viewport. Always a non-negative integer; clamped to `[0, max(0, bodyH
   * - viewH)]` by `renderReadTextOverlay` whenever the modal re-renders.
   */
  private readTextScroll = 0;
  /**
   * Per-frame section timing tracker. Logs every second when enabled via `?perf` URL flag or
   * `globalThis.__BE_MUSIC_PERF__ = true`.
   */
  protected readonly perf: PerfTracker = new PerfTracker('select');
  /** Song-bar slots — one sprite per visible bar plus its overlay text. */
  protected readonly listLayer: Container = new Container();
  /**
   * Persistent mount points for the be-music select renderer's back / front layers (skinless path only). The renderer
   * owns what's inside; the scene only toggles visibility and keeps them around `listLayer`.
   */
  private readonly beMusicBackHolder = new Container();
  private readonly beMusicFrontHolder = new Container();
  private beMusicRenderer: BeMusicSelectBinding | undefined;
  /** Set when the last skinless render reported an unfinished transition, so the next tick renders again. */
  private beMusicNeedsFrame = false;
  /** `performance.now()` of the last cursor move — drives the skin's focus transitions. */
  private cursorChangedAt = 0;
  private readonly title = new Text({
    text: 'Drop a BMS folder or ZIP',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 28,
      fontWeight: '700',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  private readonly hint = new Text({
    text: 'Select: Arrow keys / Enter',
    style: new TextStyle({ fill: MUTED, fontSize: 14, fontFamily: CORE_TEXT_FONT }),
  });
  protected collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  /**
   * Current selection cursor into `currentEntries()`. Reset to 0 when navigating into / out of a folder so the cursor
   * lands on the first entry of the new view.
   */
  protected selectedIndex = 0;
  /**
   * Folder navigation stack. Empty = at root (showing folder bars). Length-1 = inside one folder (showing its songs).
   * LR2 only really uses one nesting level today, but the array makes it trivial to extend later.
   */
  private browseStack: BrowserFolderNode[] = [];
  /**
   * Live play-option state, mutated by the in-scene panel buttons (LR2 `#SRC_BUTTON,type=40..58` etc.) and read by the
   * host via {@link getPlayOptions} at gameplay-launch time. Initialized from `initialPlayOptions` (overlaid on {@link
   * DEFAULT_PLAY_OPTIONS}) at construction.
   */
  protected playOptions: PixiPlayOptions = { ...DEFAULT_PLAY_OPTIONS };
  /**
   * Set of currently-open LR2 panels (1..9). Drives op 1..9 in `computeSelectOps` and gates panel-scoped `#SRC_*`
   * elements via {@link isPanelOpen}. Convention: panel 1 is the play- options panel — opened with the START button
   * (Enter / Space) per LR2's select-skin spec (LR2SkinHelp line 9101).
   *
   * Multiple panels can be open simultaneously per spec (the FX panel and the play-options panel coexist on real LR2
   * setups); `togglePanel` flips one slot at a time so the user explicitly controls which panels are stacked.
   */
  protected readonly panelStates: Set<number> = new Set<number>();
  /**
   * Parallel stack of the parent's `selectedIndex` at the moment each folder on `browseStack` was entered. Used by
   * {@link leaveFolder} to land the cursor back on the folder bar the user just exited rather than jumping to the top
   * of the parent list. Always satisfies `parentCursorStack.length === browseStack.length`.
   */
  private parentCursorStack: number[] = [];
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
  /**
   * Pixel offset applied to `listLayer` during a skinned bar-list scroll transition. Right after a cursor move, the
   * entry-to-slot mapping shifts instantly; we counter that by pushing `listLayer.y` so the bars appear to stay where they
   * were, then decay the offset back to 0 over a few frames to produce a smooth slide.
   *
   * Convention: positive offset = "bars look like they're still at the previous song's positions". For a `down` press
   * (selectedIndex +1) the entries move up one slot, so we add `+slotHeight` and decay to 0 — visually this looks like
   * the bars sliding up. The built-in default select screen does not use this because its background chrome also lives in
   * `listLayer`; applying the offset there makes the whole screen move instead of just changing the highlighted row.
   */
  protected listScrollOffset = 0;
  /**
   * `performance.now()` of the previous render frame, used to compute `dt` for the scroll-offset decay so the slide
   * speed is wall-clock consistent across refresh rates.
   */
  private lastScrollUpdate = 0;
  /**
   * `performance.now()` of the most recent wheel-driven cursor move. Used by {@link handleWheel} to throttle high-rate
   * trackpad / hi-res-mouse input to one cursor step per {@link WHEEL_THROTTLE_INTERVAL_MS} so a fast flick doesn't
   * fly past the user's target. `-Infinity` lets the very first wheel tick after mount fire immediately.
   */
  private lastWheelMoveAt = Number.NEGATIVE_INFINITY;
  /**
   * Last known pointer position in **design-space** coordinates, used by `#SRC_ONMOUSE` hit-tests and
   * `#SRC_MOUSECURSOR` follow. `-1` means "no pointer over canvas yet"; both renderers skip drawing in that case.
   */
  protected mouseX = -1;
  protected mouseY = -1;
  /**
   * Whether the canvas is currently shown. Tracked separately from the DOM `display` style so the keyboard handler can
   * short-circuit when the host has hidden the view (e.g. while the gameplay view is on top — both views' keydown
   * listeners are bound at the window level so we'd otherwise compete for arrow keys).
   */
  private visible = true;
  /**
   * Lower-cased search query. When non-empty, `currentEntries` is filtered to bars whose title / subtitle / artist /
   * genre / file label / folder label contains the substring (case- insensitive). Empty string disables the filter —
   * hosts call {@link setSearchQuery} to seed it; the view never mutates it on its own.
   */
  private searchQuery = '';
  /**
   * Memoized result of {@link currentEntries}. Recomputed only when one of the captured inputs changes; otherwise the
   * cached array is returned as-is so per-frame call sites (slider value, bar renderer) hit a Map-like O(1) path
   * instead of re-walking the chart events of every song under the keymode filter. Initialized lazily on the first
   * call.
   */
  private cachedEntries: BrowserBrowseEntry[] = [];
  private cachedEntriesInputs: CurrentEntriesInputs | undefined;
  /**
   * Encoded select-screen BGM bytes (typically WAV / OGG). Set via the `selectBgm` constructor option or {@link
   * setSelectBgm}; decoded lazily on the first user gesture so we don't trip the browser's autoplay policy on mount.
   */
  private selectBgmBytes: Uint8Array | undefined;
  /**
   * Decoded BGM buffer. Populated once after a successful `decodeAudioData`; `setSelectBgm` invalidates it when new
   * bytes arrive.
   */
  private selectBgmBuffer: AudioBuffer | undefined;
  /**
   * Active source node for the looping BGM. Nullable because Web Audio `BufferSourceNode`s are one-shot — pausing means
   * stopping the current source and constructing a fresh one on resume. Holds a reference so `pauseSelectBgm` can stop
   * it cleanly without leaking residual playback into hidden state.
   */
  private selectBgmSource: AudioBufferSourceNode | undefined;
  /**
   * AudioContext owned by this view, created lazily inside `ensureSelectBgmContext` on the first user gesture. Distinct
   * from gameplay's AudioContext so the two scenes' audio lifecycles don't tangle (gameplay closes its context on
   * dispose; the select view persists across plays).
   */
  private selectBgmContext: AudioContext | undefined;
  /**
   * Master gain for the select BGM. ~0.5 keeps it audible without drowning out future preview-sample playback we might
   * add at the same time. Held as a node ref so the volume can be tweaked at runtime if the demo wires a slider later.
   */
  private selectBgmGain: GainNode | undefined;
  /**
   * `true` when a decode pass is in flight. Suppresses redundant decodes while the user mashes keys before the first
   * one resolves.
   */
  private selectBgmDecodeInFlight = false;
  /**
   * Lazily-constructed song-preview engine — fires the focused chart's `#PREVIEW` audio (or, when absent, schedules the
   * chart's keysounds in-place) after the LR2 focus-settle delay. Built once on the first cursor settle so the
   * AudioContext is shared with the select BGM, and disposed with the scene.
   */
  private chartPreviewEngine: ChartPreviewEngine | undefined;
  /**
   * Output gain for the preview engine. Routed in parallel with the BGM gain to `audioContext.destination` so the two
   * can mix-down together; the value sits at unity so the chart's encoded loudness reaches the user as authored. Held
   * as a field so we can duck the BGM (zero its gain) for the duration of any active preview playback.
   */
  private chartPreviewGain: GainNode | undefined;
  /** Analyser tapping the BGM + chart preview for audio-reactive be-music skins (not the one-shot system cues). */
  private selectAudioAnalyzer: AudioAnalyzer | undefined;
  /**
   * `selectBgmGain.gain.value` captured at the moment the preview engine reported `onPlaybackStart`. Restored when
   * playback stops so the BGM returns to whatever level the host configured (rather than overwriting it with our
   * default-knee).
   */
  private bgmGainBeforeDuck: number | undefined;
  /**
   * Master gain for one-shot system effects (`cursor-move` / `folder-open` / `folder-close` / `option-open` /
   * `option-close` / `option-change` / `decide`). Routed straight to `audioContext.destination` in parallel with
   * `selectBgmGain` and `chartPreviewGain` — that way the BGM-duck on preview-start (which zeros `selectBgmGain.gain`)
   * doesn't also silence the effect cues. Held as a field so a future master-volume slider can attenuate effects
   * independently of music.
   */
  private systemSoundGain: GainNode | undefined;
  /**
   * Encoded one-shot sound effects keyed by name. Stems include `'decide'` (select → gameplay cue) and the LR2 system
   * effects (`'cursor-move'` / `'folder-open'` / `'folder-close'` / `'option-open'` / `'option-close'` /
   * `'option-change'` — see `LR2files\Sound\lr2\*.wav` in the default theme). All one-shots share the same
   * `AudioContext` as the looping select BGM but route through the dedicated {@link systemSoundGain} so preview ducking
   * doesn't silence them. Buffers decode lazily on first use.
   */
  private readonly oneShotBytes = new Map<string, Uint8Array>();
  /** Decoded buffer cache, parallel to {@link oneShotBytes}. */
  private readonly oneShotBuffers = new Map<string, AudioBuffer>();
  /**
   * Names whose decode pass is in flight. Prevents redundant `decodeAudioData` calls when the same sound is fired
   * multiple times before the first decode resolves.
   */
  private readonly oneShotDecoding = new Set<string>();
  protected options: TOptions;

  public constructor(options: TOptions = {} as TOptions) {
    this.options = options;
    this.selectBgmBytes = options.selectBgm;
    this.setOneShotBytes('decide', options.decideBgm);
    this.setSystemSounds(options.systemSounds);
    if (options.initialPlayOptions) {
      this.playOptions = { ...this.playOptions, ...options.initialPlayOptions };
      this.playOptions.hiSpeed = clampHiSpeed(this.playOptions.hiSpeed);
    }
  }

  /**
   * Returns a shallow snapshot of the current play-option state. The host typically calls this from `onSongSelected` /
   * `onSongAutoPlay` and forwards the values onto {@link PixiGameplayViewOptions}.
   */
  public getPlayOptions(): PixiPlayOptions {
    return { ...this.playOptions };
  }

  /**
   * Merges `partial` onto the live play-option state and re-renders if the panel is open. Allows hosts to seed values
   * from external sources (e.g. a settings menu, URL flag, prior session snapshot) without bouncing through the
   * in-scene panel.
   */
  public setPlayOptions(partial: Partial<PixiPlayOptions>): void {
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
    if (!GAUGE_CYCLE.includes(next.gauge1P)) next.gauge1P = DEFAULT_PLAY_OPTIONS.gauge1P;
    if (!GAUGE_CYCLE.includes(next.gauge2P)) next.gauge2P = DEFAULT_PLAY_OPTIONS.gauge2P;
    this.playOptions = next;
    // Re-render only when panel 1 (the play-options panel) is currently open — that's the only surface that visualizes
    // these values today, so a closed-panel write doesn't need a frame.
    if (this.panelStates.has(1)) {
      this.render();
    }
  }

  /**
   * Replaces the looping select-screen BGM. Pass `undefined` to mute. Existing playback is stopped (and its decoded
   * buffer discarded) before the new bytes are queued for decode on the next user gesture.
   *
   * Hosts use this to swap BGM when the user drops a fresh theme mid-session — the constructor-time `selectBgm` option
   * only seeds the initial state.
   */
  public setSelectBgm(bytes: Uint8Array | undefined): void {
    if (this.selectBgmBytes === bytes) return;
    this.stopSelectBgm();
    this.selectBgmBytes = bytes;
    this.selectBgmBuffer = undefined;
    if (bytes && this.visible) {
      // Trigger decode + start eagerly. If autoplay policy hasn't been satisfied yet (no user gesture) the AudioContext
      // stays suspended; the next pointerdown / keydown handler resumes it via `ensureSelectBgmContext`.
      void this.startSelectBgm();
    }
  }

  /**
   * Replaces the one-shot song-decided sound (`decide.wav`). Pass `undefined` to disable. Drops any cached decoded
   * buffer — the next `playDecideSound` call will decode the new bytes.
   */
  public setDecideBgm(bytes: Uint8Array | undefined): void {
    this.setOneShotBytes('decide', bytes);
  }

  /**
   * Replaces the LR2 system sound-effect bundle. Each field is an independent bytes payload that drops + re-decodes on
   * change (next play call decodes the new bytes). Missing entries clear the previous binding so a theme without a
   * particular effect simply silences that cue.
   */
  public setSystemSounds(sounds: PixiSongSelectSystemSounds | undefined): void {
    this.setOneShotBytes('cursor-move', sounds?.cursorMove);
    this.setOneShotBytes('folder-open', sounds?.folderOpen);
    this.setOneShotBytes('folder-close', sounds?.folderClose);
    this.setOneShotBytes('option-open', sounds?.optionOpen);
    this.setOneShotBytes('option-close', sounds?.optionClose);
    this.setOneShotBytes('option-change', sounds?.optionChange);
  }

  /**
   * Plays the decide sound once. Used by hosts on the select → gameplay transition. See {@link playOneShotSound} for
   * the shared decode / autoplay-policy semantics.
   */
  public async playDecideSound(): Promise<void> {
    await this.playOneShotSound('decide');
  }

  /**
   * Stores or clears the encoded bytes for a one-shot sound. We also drop the decoded buffer so the next
   * `playOneShotSound` call decodes from scratch — without that a swap would silently keep playing the old sound until
   * the cache happened to be invalidated some other way.
   */
  private setOneShotBytes(name: string, bytes: Uint8Array | undefined): void {
    if (bytes === undefined) {
      this.oneShotBytes.delete(name);
    } else {
      this.oneShotBytes.set(name, bytes);
    }
    this.oneShotBuffers.delete(name);
  }

  /**
   * Plays the named one-shot sound (no loop). Decodes lazily on first call and caches the buffer for subsequent plays —
   * cursor-move clicks fire dozens of times per minute on a fast scroll, so the decode-once / replay-many pattern is
   * worth the cache.
   *
   * No-op when:
   *
   * - The sound's bytes are unset (the theme didn't ship that effect) — `oneShotBytes.get(name)` returns undefined.
   * - The `AudioContext` can't be created (e.g. Node test env).
   * - A decode pass for the same name is already in flight; the next caller after the decode resolves will succeed.
   * - The `AudioContext` is still suspended because no user gesture has unlocked it. In practice every trigger site
   *   (cursor / folder navigation, song decide) IS such a gesture, so the resume always lands here.
   */
  private async playOneShotSound(name: string): Promise<void> {
    if (this.disposed) return;
    const bytes = this.oneShotBytes.get(name);
    if (!bytes) return;
    const audioContext = this.ensureSelectBgmContext();
    if (!audioContext) return;
    let buffer = this.oneShotBuffers.get(name);
    if (!buffer) {
      if (this.oneShotDecoding.has(name)) return;
      this.oneShotDecoding.add(name);
      try {
        buffer = await audioContext.decodeAudioData(bytes.slice().buffer);
        if (this.disposed) return;
        this.oneShotBuffers.set(name, buffer);
      } catch (error) {
        log.warn(`one-shot "${name}" decode failed`, error);
        return;
      } finally {
        this.oneShotDecoding.delete(name);
      }
    }
    // Resume in case autoplay policy left the context suspended — the gesture that triggered this play should satisfy
    // it.
    void audioContext.resume().catch(() => undefined);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    // Route through the dedicated system-FX gain so the duck-on- preview-start (which zeros `selectBgmGain.gain`)
    // doesn't also silence the cue. Falls through to destination if the FX gain hasn't been constructed yet (shouldn't
    // happen in practice — `ensureSelectBgmContext` builds both atomically).
    source.connect(this.systemSoundGain ?? masterOutput(audioContext));
    source.start();
    // Auto-disconnect on natural end so the node is GC-eligible.
    source.onended = (): void => {
      try {
        source.disconnect();
      } catch {
        // Already disconnected (dispose path) — fine.
      }
    };
  }

  /**
   * Convenience accessor for the host's `Application`. Throws if called before {@link mount}; same contract as the
   * gameplay scene.
   */
  protected get app(): Application {
    if (!this.host) {
      throw new Error('PixiSongSelectView: app accessed before mount');
    }
    return this.host.app;
  }

  public async mount(host: PixiSceneHost): Promise<void> {
    this.host = host;
    this.mountedContainer = host.app.canvas.parentElement ?? undefined;
    // Label every top-level node so PixiJS Devtools renders the scene graph as `select > {viewport-bg, root > {bg,
    // skin, list, title, hint}}` instead of an unlabelled tower of `Container`s.
    this.sceneRoot.label = 'select/scene';
    this.root.label = 'select/root';
    this.viewportBackground.label = 'select/viewport-bg';
    this.background.label = 'select/background';
    this.skinLayer.label = 'select/skin';
    this.listLayer.label = 'select/list';
    this.skinForegroundLayer.label = 'select/skin-fg';
    this.title.label = 'select/title';
    this.hint.label = 'select/hint';
    this.sceneRoot.addChild(this.viewportBackground, this.root);
    // Stack order (back → front): background → skinLayer (chrome behind bars) → listLayer (the song bars) →
    // skinForegroundLayer (chrome that the CSV declared AFTER bars, e.g. scroll slider) → title / hint (Drop hints,
    // fallback chrome). LR2 panels (op 1..9) live inside skinLayer / skinForegroundLayer — they're regular `#SRC_*`
    // elements gated by their `panel` field, so no separate overlay layer is needed.
    this.designClipMask.label = 'select/design-clip';
    this.beMusicBackHolder.label = 'select/be-music-back';
    this.beMusicFrontHolder.label = 'select/be-music-front';
    this.beMusicBackHolder.visible = false;
    this.beMusicFrontHolder.visible = false;
    this.root.addChild(
      this.background,
      this.skinLayer,
      this.beMusicBackHolder,
      this.listLayer,
      this.beMusicFrontHolder,
      this.skinForegroundLayer,
      this.title,
      this.hint,
      this.readTextLayer,
      this.designClipMask,
    );
    this.root.mask = this.designClipMask;
    this.readTextLayer.label = 'select/read-text';
    this.readTextLayer.visible = false;
    this.readTextViewport.addChild(this.readTextBody);
    // Pixi v8 mask: the mask graphic must live in the scene graph (so its world transform is current) but stays
    // invisible visually — it's only used for clipping. Adding it as a sibling of the viewport keeps both transforms in
    // sync with any future readtext-layer translation.
    this.readTextViewport.mask = this.readTextViewportMask;
    this.readTextLayer.addChild(
      this.readTextBackdrop,
      this.readTextCard,
      this.readTextTitle,
      this.readTextViewport,
      this.readTextViewportMask,
      this.readTextScrollbar,
      this.readTextFooter,
    );
    // Attach to the host's already-initialized stage. The canvas is owned by the host and shared across scenes.
    host.app.stage.addChild(this.sceneRoot);
    // Bind keyboard handlers at the window level so the user can navigate without first clicking the canvas. The canvas
    // itself is a child of the document body and naturally won't have focus until interacted with — which would
    // otherwise eat ↑/↓/Enter/Esc. Pointer events still bind on the canvas because their offset coordinates are
    // canvas-relative.
    window.addEventListener('keydown', this.handleKeyDown);
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    host.app.canvas.addEventListener('pointermove', this.handlePointerMove);
    host.app.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    // Wheel scroll → cursor move. `passive: false` so we can call preventDefault and stop the page from scrolling under
    // the floating debug toolbar (which would otherwise compete for wheel events when the canvas is full-screen).
    host.app.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.prepareTheme();
    this.resetSceneTimers();
    this.render();
    this.startAnimationLoop();
    // Try to start the BGM eagerly. Browsers gate `AudioContext.resume()` behind a user gesture; if no gesture has
    // happened yet the start sits idle until the first pointerdown / keydown handler retries it.
    void this.startSelectBgm();
    // Arm the preview engine for the initial focus so the user hears the bar-under-cursor without having to first nudge
    // the cursor. Same gesture-gating caveat as BGM applies — the engine schedules a `setTimeout`, but the underlying
    // AudioContext stays suspended until the first user input.
    this.refreshChartPreview();
  }

  /**
   * Re-seeds every scene-mount timer to "now" plus clears any leftover scroll state. Called by both {@link mount}
   * (initial entry) and {@link setVisible}`(true)` (returning from a play session) so DST keyframe sequences anchored
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
    this.timerStartedAt.set(0, this.sceneStartedAt);
    // Fire timer 11 (song change) at scene start so the BAR_BODY slide-in animations play once on every appearance,
    // just like they do in real LR2 when the cursor lands on the initial song.
    this.timerStartedAt.set(11, this.sceneStartedAt);
    // Drop any leftover smooth-scroll state from a previous session — the cursor isn't moving on re-entry, and a stale
    // `dt` from before the play round-trip would otherwise feed the decay formula a multi-minute interval and either
    // NaN or instantly zero out a fresh offset (depending on Math.exp's behavior).
    this.listScrollOffset = 0;
    this.lastScrollUpdate = 0;
    // Reset the wheel throttle so the first wheel tick after a re-mount fires immediately rather than being eaten by
    // a stale `lastWheelMoveAt` from before the play round-trip.
    this.lastWheelMoveAt = Number.NEGATIVE_INFINITY;
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
    if (this.readTextOpen) {
      this.readTextOpen = false;
      this.readTextLayer.visible = false;
    }
    const now = performance.now();
    this.cursorChangedAt = now;
    this.timerStartedAt.set(10, now);
    this.timerStartedAt.set(11, now);
    this.timerStartedAt.set(delta < 0 ? 12 : 13, now);
    // Seed the scroll offset only for themes that slide their list layer. The be-music chrome is also mounted on
    // `listLayer`, so offsetting that layer would scroll the entire screen. In that path, cursor movement simply changes
    // the active row.
    if (this.themeDesignSize) {
      const slotHeight = this.themeListSlotHeight();
      this.listScrollOffset += delta * slotHeight;
    } else {
      this.listScrollOffset = 0;
    }
    // LR2 system effect — `Sound\lr2\scratch.wav` fires on every bar move regardless of direction. Fire-and-forget; the
    // one-shot decode caches after the first use so a fast wheel-scroll doesn't thrash the audio decoder.
    void this.playOneShotSound('cursor-move');
    // Re-arm the chart preview against the (potentially) new focused song. The engine owns the focus-settle delay, so a
    // fast scroll past dozens of bars only ever schedules one start once the cursor finally rests.
    this.refreshChartPreview();
  }

  /**
   * Drills into `folder`: pushes onto the browse stack, resets the cursor to the top of the folder's contents, animates
   * the bar slide as a single down-step, and fires the LR2 folder-open cue (`Sound\lr2\f-open.wav`).
   *
   * Three call sites use this — keyboard Enter, skin-mode click, fallback-row click — so factoring it here keeps their
   * semantics identical.
   */
  protected enterFolder(folder: BrowserFolderNode): void {
    // Stash the parent's cursor BEFORE pushing so leaveFolder can land the cursor back on this folder bar.
    this.parentCursorStack = [...this.parentCursorStack, this.selectedIndex];
    this.browseStack = [...this.browseStack, folder];
    this.selectedIndex = 0;
    // Folder traversal: animate as a single "down" step regardless of how big the index jump was, so the slide stays
    // bounded.
    this.noteCursorChange(1);
    this.render();
    void this.playOneShotSound('folder-open');
  }

  /**
   * Pops one level out of the browse stack. No-op at the root (mirroring the old inline branch that bailed when
   * `browseStack.length === 0`). Fires the LR2 folder-close cue (`Sound\lr2\f-close.wav`).
   *
   * Restores the parent's `selectedIndex` from the parallel cursor stack so the user lands back on the folder bar they
   * just left. The restored index is clamped to the parent list's current length to handle the rare case where the
   * collection / search filter changed while inside the folder.
   */
  private leaveFolder(): boolean {
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
    this.noteCursorChange(-1);
    this.render();
    void this.playOneShotSound('folder-close');
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
  protected readonly isPanelOpen = (panel: number): boolean => {
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
  protected togglePanel(which: number): void {
    if (which < 1 || which > 9) return;
    const now = performance.now();
    const openTimer = 20 + which; // panel 1 → timer 21
    const closeTimer = 30 + which; // panel 1 → timer 31
    let opening: boolean;
    if (this.panelStates.has(which)) {
      // Closing: drop the open timer (so it goes inactive next frame) and seed the close timer for the close-anim
      // keyframes that #DST elements anchored to timer 31..39 depend on.
      this.panelStates.delete(which);
      this.timerStartedAt.delete(openTimer);
      this.timerStartedAt.set(closeTimer, now);
      opening = false;
    } else {
      // Opening: only one option panel may be open at a time (LR2 mutual-exclusion convention — clicking PLAY OPTION
      // while SYSTEM OPTION is already open closes the latter first, then opens the former). Snapshot the open set
      // before we start mutating it so we don't trip on iterator-vs-mutation order. Close every other open panel via
      // the same close-timer + state-flip sequence so their close-anim keyframes still play.
      const previouslyOpen = Array.from(this.panelStates);
      for (const open of previouslyOpen) {
        if (open === which) continue;
        const otherOpenTimer = 20 + open;
        const otherCloseTimer = 30 + open;
        this.panelStates.delete(open);
        this.timerStartedAt.delete(otherOpenTimer);
        this.timerStartedAt.set(otherCloseTimer, now);
      }
      // Drop our own (potentially leftover) close timer and seed the open timer.
      this.panelStates.add(which);
      this.timerStartedAt.delete(closeTimer);
      this.timerStartedAt.set(openTimer, now);
      opening = true;
    }
    // LR2 system effects — `Sound\lr2\o-open.wav` / `o-close.wav`. Fire-and-forget; the cached buffer makes rapid
    // toggles cheap. Use the open cue for "swap to another panel" too (the previous panel's silent close is implicit;
    // firing both cues at once would just clip).
    void this.playOneShotSound(opening ? 'option-open' : 'option-close');
    this.render();
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
      return;
    }
    this.perf.beginTick();
    if (this.themeDesignSize) {
      this.perf.time('render', () => this.render());
    } else {
      const now = performance.now();
      // The skinless chrome is rebuilt only on input; keep re-rendering while a slide-in is still in flight. Driven by
      // the last render's own state (not a time window) so a long frame hitch can't strand a half-finished slide.
      if (this.beMusicNeedsFrame) {
        this.perf.time('render', () => this.render());
      }
      if (this.beMusicBackHolder.visible) {
        this.beMusicRenderer?.tick(now, this.focusedSong(), this.launchAt, this.selectAudioAnalyzer?.sample(now));
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
    if (this.launchTimer !== undefined) window.clearTimeout(this.launchTimer);
    this.beMusicRenderer?.dispose();
    this.beMusicRenderer = undefined;
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.host.app.canvas.removeEventListener('pointermove', this.handlePointerMove);
      this.host.app.canvas.removeEventListener('wheel', this.handleWheel);
      this.host.app.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    }
    // Tear down BGM + preview playback before scene-graph teardown so no `BufferSourceNode` outlives the view. The
    // preview engine MUST go first — it shares this AudioContext, and disposing it after the context is closed throws
    // inside `disconnect()`.
    this.chartPreviewEngine?.dispose();
    this.chartPreviewEngine = undefined;
    this.chartPreviewGain = undefined;
    this.bgmGainBeforeDuck = undefined;
    this.pauseSelectBgm();
    this.selectAudioAnalyzer?.dispose();
    this.selectAudioAnalyzer = undefined;
    void this.selectBgmContext?.close().catch(() => undefined);
    this.selectBgmContext = undefined;
    this.selectBgmGain = undefined;
    this.systemSoundGain = undefined;
    this.selectBgmBuffer = undefined;
    // Detach our scene-graph subtree from the host's stage. The host owns the `Application` lifetime; it (or whoever
    // else owns the host) is responsible for `app.destroy()`.
    if (this.sceneRoot.parent) {
      this.sceneRoot.parent.removeChild(this.sceneRoot);
    }
    try {
      this.disposeTheme();
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    try {
      this.sceneRoot.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('sceneRoot.destroy threw', error);
    }
    this.host = undefined;
    this.mountedContainer = undefined;
  }

  /**
   * Restores cursor / browse state externally. Same shape as the `initialNavigation` constructor option, but applied to
   * a live view (e.g. when the host swaps a saved navigation snapshot back in after a play session).
   */
  public setNavigation(navigation: PixiSongSelectNavigation): void {
    if (this.restoreNavigation(navigation)) {
      this.render();
      // Cursor / folder state changed → focused chart likely changed too. Same reasoning as `setCollection` — bring the
      // preview engine back in sync with whatever bar is now under the cursor.
      this.refreshChartPreview();
    }
  }

  /**
   * Hides / shows the select scene's subtree on the shared host stage. Toggles `sceneRoot.visible` (so we keep
   * contributing zero pixels while hidden) and pauses our rAF tick — the keyframe-driven re-render is wasted CPU when
   * nothing is being shown. Re-entering re-arms the rAF loop so DST animations resume cleanly. The host's `Application`
   * ticker keeps running either way; we no longer touch it from here because gameplay shares the same ticker.
   */
  public setVisible(visible: boolean): void {
    if (this.visible === visible) {
      return;
    }
    this.visible = visible;
    this.sceneRoot.visible = visible;
    if (visible) {
      // Re-seed scene-mount timers so DST animations anchored to timer 0 / 11 (slide-in, fade-in, bar pulses) replay on
      // re-entry from a play session — see `resetSceneTimers` for the rationale. Without this the persistent select
      // scene's `sceneStartedAt` would be minutes-stale on return.
      this.resetSceneTimers();
      this.startAnimationLoop();
      // Resume the BGM. Always safe — a no-op if no BGM is set or if a gesture hasn't unlocked the AudioContext yet.
      void this.startSelectBgm();
      // Re-arm the chart preview against the focused song. On back-from-play the engine was stopped by the prior
      // `setVisible(false)` and the cursor likely moved while hidden (folder unwind etc.); kicking it here makes the
      // preview start matching the current focus rather than the stale one we left mid-play with.
      this.refreshChartPreview();
    } else {
      // Hidden — pause BGM so it doesn't bleed into gameplay audio. Decoded buffer stays cached so the next show is an
      // instant resume (no re-decode).
      this.pauseSelectBgm();
      // Always silence the preview when leaving the scene. Otherwise a 1-second focus delay that hadn't fired would
      // have spent its `setTimeout` budget while the user was already in gameplay and start blasting keysounds through
      // the gameplay AudioContext on top of the chart.
      this.chartPreviewEngine?.stop();
      this.stopAnimationLoop();
    }
  }

  public setCollection(collection: BrowserSongCollection): void {
    // When the host re-asserts the same collection reference (e.g. returning to the select view from a play session) we
    // MUST NOT clobber the live cursor / browse stack — the host has already (or is about to) call `setNavigation` with
    // the snapshot it captured before play started, and re-resetting here would discard that. Identity comparison is
    // enough because `collectionStore.loadFromFiles` always returns a fresh collection object on a real reload.
    if (this.collection === collection) {
      this.render();
      return;
    }
    this.collection = collection;
    this.browseStack = [];
    this.parentCursorStack = [];
    this.selectedIndex = 0;
    // Brand-new collection: try the constructor-time `initialNavigation` (typical: dropped a folder mid-session and
    // there's a saved snapshot in the URL or local storage). Falls back to the auto-enter-single-folder behavior when
    // no saved state exists or the saved labels no longer match.
    const restored = this.options.initialNavigation ? this.restoreNavigation(this.options.initialNavigation) : false;
    if (!restored) {
      const folders = groupSongsByFolder(collection.songs);
      if (folders.length === 1) {
        this.browseStack = [folders[0]!];
        // Keep parentCursorStack length-aligned with browseStack even on the auto-enter-single-folder fast path — a
        // mismatch would feed `leaveFolder` a stale entry from a previous session.
        this.parentCursorStack = [0];
      }
    }
    this.render();
    // Collection changed → focused song's identity / source map changed. Re-arm the preview engine so it sees the new
    // target (or no target, if we landed on a folder bar).
    this.refreshChartPreview();
  }

  /**
   * Returns a snapshot of the current cursor / browse state suitable for round-tripping through `dispose()` (when
   * transitioning to gameplay) and `initialNavigation` (when coming back). Folder identity is captured by label so the
   * snapshot is decoupled from the live `BrowserFolderNode` references.
   */
  public getNavigation(): PixiSongSelectNavigation {
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
    const stack: BrowserFolderNode[] = [];
    let folders = groupSongsByFolder(this.collection.songs);
    for (const label of navigation.folderPath) {
      const match = folders.find((folder) => folder.label === label);
      if (!match) break;
      stack.push(match);
      // Inside a folder, the next-level "folders" are derived from the folder's own songs; today we only group at the
      // top, so a restored deeper path simply terminates here. Kept as `groupSongsByFolder(match.songs)` so a future
      // multi-level hierarchy continues to work without changes.
      folders = groupSongsByFolder(match.songs);
    }
    if (stack.length === 0 && navigation.folderPath.length > 0) {
      // None of the saved labels matched — abort the restore so the caller falls back to the default "single-folder
      // auto-enter" path instead of leaving the cursor on an unrelated entry.
      return false;
    }
    this.browseStack = stack;
    // No saved per-level cursor history yet — fill the parallel stack with zeros so its length matches `browseStack`.
    // If the user backs out without entering further, they land on the first folder bar of the parent (acceptable
    // fallback for a restored session that has no prior entry-time snapshot).
    this.parentCursorStack = stack.map(() => 0);
    const entries =
      stack.length > 0 ? stack[stack.length - 1]!.songs.length : groupSongsByFolder(this.collection.songs).length;
    this.selectedIndex = Math.max(0, Math.min(navigation.selectedIndex, Math.max(0, entries - 1)));
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
  protected currentEntries(): BrowserBrowseEntry[] {
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
      ? top.songs.map((song): BrowserBrowseEntry => ({ kind: 'song', song }))
      : this.searchQuery.length > 0
        ? songs.map((song): BrowserBrowseEntry => ({ kind: 'song', song }))
        : groupSongsByFolder(songs).map((folder): BrowserBrowseEntry => ({ kind: 'folder', folder }));
    let filtered = baseEntries;
    if (this.playOptions.difficultyFilter !== 'ALL') {
      const target = DIFFICULTY_FILTER_CYCLE.indexOf(this.playOptions.difficultyFilter);
      filtered = filtered.filter((entry) => entry.kind !== 'song' || matchesDifficultyFilter(entry.song, target));
    }
    if (this.playOptions.keysFilter !== 'ALL') {
      const targetOp = SELECT_KEYS_FILTER_TO_OP[this.playOptions.keysFilter];
      filtered = filtered.filter((entry) => entry.kind !== 'song' || resolveKeyModeOp(entry.song) === targetOp);
    }
    if (this.searchQuery.length > 0) {
      filtered = filtered.filter((entry) => matchesSearchQuery(entry, this.searchQuery));
    }
    if (this.playOptions.sort !== 'OFF') {
      filtered = sortBrowseEntries([...filtered], this.playOptions.sort);
    }
    this.cachedEntries = filtered;
    this.cachedEntriesInputs = inputs;
    return filtered;
  }

  /**
   * Sets the lower-cased search query and re-renders. The bar list filters entries by title / subtitle / artist / genre
   * / file label / folder label (case-insensitive substring). Pass `''` (empty) to clear the filter. Resets the cursor
   * to 0 so the focused entry is always one that satisfies the filter — without this, narrowing the list could leave
   * the cursor pointing past the new end and `focusedSong()` would return undefined.
   */
  public setSearchQuery(query: string): void {
    const normalized = query.trim().toLowerCase();
    if (this.searchQuery === normalized) {
      return;
    }
    this.searchQuery = normalized;
    this.selectedIndex = 0;
    this.render();
  }

  /**
   * Starts the looping select-screen BGM. Idempotent — safe to call repeatedly; only the first call after a stop
   * reaches the decode + `start()` codepath. No-op when `selectBgmBytes` is unset (host didn't supply BGM).
   *
   * Browsers gate `AudioContext.resume()` behind a user gesture; if this is called before any pointer / key event the
   * context stays suspended and playback waits silently. The first user gesture in `handlePointerDown` /
   * `handleKeyDown` calls this again so the resume actually lands inside the gesture handler.
   */
  private async startSelectBgm(): Promise<void> {
    if (this.disposed) return;
    if (!this.selectBgmBytes) return;
    if (this.selectBgmSource) return;
    const audioContext = this.ensureSelectBgmContext();
    if (!audioContext) return;
    // Decode lazily on first start. The `selectBgmDecodeInFlight` guard short-circuits parallel decode attempts when
    // several gestures land before the first decode resolves.
    if (!this.selectBgmBuffer) {
      if (this.selectBgmDecodeInFlight) return;
      this.selectBgmDecodeInFlight = true;
      try {
        // `decodeAudioData` consumes the ArrayBuffer in some browsers (detaches it). Slice a fresh copy so re-decoding
        // after `setSelectBgm(sameBytes)` still works.
        const buffer = await audioContext.decodeAudioData(this.selectBgmBytes.slice().buffer);
        if (this.disposed) return;
        this.selectBgmBuffer = buffer;
      } catch (error) {
        log.warn('BGM decode failed', error);
        return;
      } finally {
        this.selectBgmDecodeInFlight = false;
      }
    }
    if (!this.visible) return; // Hidden during decode — bail.
    // Resume in case a previous `pause` or autoplay-blocked init left the context suspended. Errors (e.g. still no user
    // gesture) are swallowed; the next gesture-driven call will retry.
    void audioContext.resume().catch(() => undefined);
    const source = audioContext.createBufferSource();
    source.buffer = this.selectBgmBuffer;
    source.loop = true;
    source.connect(this.selectBgmGain ?? masterOutput(audioContext));
    source.start();
    this.selectBgmSource = source;
  }

  /**
   * Pauses the BGM by stopping the active source. Web Audio `BufferSourceNode`s are one-shot, so resume rebuilds a
   * fresh source from the cached `selectBgmBuffer` — no re-decode.
   */
  private pauseSelectBgm(): void {
    if (!this.selectBgmSource) return;
    try {
      this.selectBgmSource.stop();
    } catch {
      // `stop()` throws when called on a node that hasn't started or has already stopped. Both states are fine for our
      // purposes; we just want the source gone.
    }
    this.selectBgmSource.disconnect();
    this.selectBgmSource = undefined;
  }

  /**
   * Hard-stops the BGM and forgets the decoded buffer. Used when the BGM bytes themselves change — the next start call
   * will decode from scratch.
   */
  private stopSelectBgm(): void {
    this.pauseSelectBgm();
    this.selectBgmBuffer = undefined;
  }

  /**
   * Constructs (lazily) the AudioContext + master gain that the BGM plays through. Returns `undefined` if
   * `AudioContext` isn't available (Node test environments etc.) so callers degrade gracefully into a "no BGM" mode.
   */
  private ensureSelectBgmContext(): AudioContext | undefined {
    if (this.selectBgmContext) return this.selectBgmContext;
    if (typeof globalThis.AudioContext === 'undefined') return undefined;
    const audioContext = new globalThis.AudioContext();
    const gain = audioContext.createGain();
    // ~-6 dB so the BGM doesn't drown out future preview-sample playback we might add at the same time. Adjustable via
    // a future runtime knob if the demo wires a slider.
    gain.gain.value = 0.5;
    gain.connect(masterOutput(audioContext));
    this.selectBgmContext = audioContext;
    this.selectBgmGain = gain;
    this.selectAudioAnalyzer = new AudioAnalyzer(audioContext);
    gain.connect(this.selectAudioAnalyzer.input);
    // System-effect bus — sibling of `selectBgmGain`, routed directly to destination so the preview-start BGM duck
    // (which zeros `selectBgmGain.gain`) doesn't also silence cursor / folder / option cues.
    const fxGain = audioContext.createGain();
    fxGain.gain.value = 1;
    fxGain.connect(masterOutput(audioContext));
    this.systemSoundGain = fxGain;
    return audioContext;
  }

  /**
   * Constructs the preview engine + its master gain on the same AudioContext as the select BGM. Returns `undefined`
   * when AudioContext isn't available (Node tests) so callers can silently skip preview wiring.
   *
   * The preview gain is a sibling of `selectBgmGain` rather than a child of it: routing both to
   * `audioContext.destination` directly keeps the BGM ducking logic (zeroing `selectBgmGain.gain.value` while preview
   * plays) from also attenuating the preview output. Unity gain on the preview side preserves the chart's encoded
   * loudness.
   */
  private ensureChartPreviewEngine(): ChartPreviewEngine | undefined {
    if (this.chartPreviewEngine) return this.chartPreviewEngine;
    if (this.disposed) return undefined;
    const audioContext = this.ensureSelectBgmContext();
    if (!audioContext) return undefined;
    const gain = audioContext.createGain();
    gain.gain.value = 1;
    gain.connect(masterOutput(audioContext));
    if (this.selectAudioAnalyzer) gain.connect(this.selectAudioAnalyzer.input);
    this.chartPreviewGain = gain;
    this.chartPreviewEngine = new ChartPreviewEngine(audioContext, gain, {
      onPlaybackStart: () => {
        // Duck the BGM to silence while a preview is audible. We capture the pre-duck level so a future host-side
        // volume tweak (e.g. a slider that updates `selectBgmGain.gain`) is restored verbatim, not overwritten with the
        // constructor default.
        if (this.selectBgmGain && this.bgmGainBeforeDuck === undefined) {
          this.bgmGainBeforeDuck = this.selectBgmGain.gain.value;
          this.selectBgmGain.gain.value = 0;
        }
      },
      onPlaybackStop: () => {
        if (this.selectBgmGain && this.bgmGainBeforeDuck !== undefined) {
          this.selectBgmGain.gain.value = this.bgmGainBeforeDuck;
          this.bgmGainBeforeDuck = undefined;
        }
      },
    });
    return this.chartPreviewEngine;
  }

  /**
   * Hands the engine the song currently under the cursor (or `undefined` when the cursor sits on a folder bar). The
   * engine swallows redundant focuses internally — calling this on every cursor move is cheap, and centralizing the
   * call here means new focus-changing call sites (`setNavigation`, `setCollection`) only have to invoke this single
   * helper.
   *
   * Skipped while the scene is hidden — there's no scenario in which we want a preview firing through a hidden select
   * view (every visibility toggle re-arms via the `setVisible(true)` branch).
   */
  protected refreshChartPreview(): void {
    if (this.disposed || !this.visible) return;
    const song = this.focusedSong();
    if (!song) {
      this.chartPreviewEngine?.focus(undefined);
      return;
    }
    const engine = this.ensureChartPreviewEngine();
    if (!engine) return;
    const source = resolveSongSource(this.collection, song);
    if (!source) {
      engine.focus(undefined);
      return;
    }
    engine.focus({ song, source });
  }

  /**
   * Returns the song under the cursor, or `undefined` when the cursor is on a folder bar (in which case song-info
   * NUMBER / TEXT panels leave their slots blank).
   */
  protected focusedSong(): BrowserSongEntry | undefined {
    const entry = this.currentEntries()[this.selectedIndex];
    return entry?.kind === 'song' ? entry.song : undefined;
  }

  /**
   * Renders a centered hint over the skin layer when no songs are loaded so the user understands the empty bar list
   * isn't a bug. Drawn straight onto `skinLayer` — same coordinate space as the static frame — so it scales with the
   * rest of the skin. Themes call this from {@link renderTheme}; the be-music path leaves the empty-library callout to
   * the host's drop overlay.
   */
  protected renderEmptyStateHint(designWidth: number, designHeight: number): void {
    const text = new Text({
      text: 'Drop a BMS folder or ZIP onto this window',
      style: new TextStyle({
        fill: TEXT,
        fontSize: 16,
        fontWeight: '700',
        fontFamily: CORE_TEXT_FONT,
      }),
    });
    text.label = 'empty-state/hint';
    text.anchor.set(0.5, 0.5);
    text.position.set(designWidth / 2, designHeight / 2);
    this.skinLayer.addChild(text);
    if (this.collection.errors.length > 0) {
      const errorText = new Text({
        text: `${this.collection.errors.length} parse error${this.collection.errors.length === 1 ? '' : 's'} — see console`,
        style: new TextStyle({
          fill: MUTED,
          fontSize: 11,
          fontFamily: CORE_TEXT_FONT,
        }),
      });
      errorText.label = 'empty-state/errors';
      errorText.anchor.set(0.5, 0);
      errorText.position.set(designWidth / 2, designHeight / 2 + 18);
      this.skinLayer.addChild(errorText);
    }
  }

  /**
   * Tracks the pointer in design-space coordinates so `#SRC_ONMOUSE` hit-tests and the `#SRC_MOUSECURSOR` follow can
   * read from a single source of truth. The math mirrors `handlePointerDown` — undo the viewport scale & offset to land
   * in skin design pixels.
   */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.visible) return;
    const { width: designWidth, height: designHeight } = this.resolveDesignSize();
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
    this.mouseX = (event.offsetX - viewport.x) / viewport.scale;
    this.mouseY = (event.offsetY - viewport.y) / viewport.scale;
  };

  private readonly handlePointerLeave = (): void => {
    this.mouseX = -1;
    this.mouseY = -1;
  };

  /**
   * Toggles the READTEXT modal for the focused song. Looks for a `.txt` file in the song's directory and shows its
   * contents in a centered Pixi card. Closes on second click / Escape / cursor move to a different song.
   */
  protected toggleReadText(song: BrowserSongEntry): void {
    if (this.readTextOpen) {
      this.closeReadText();
      return;
    }
    void (async () => {
      // Readtext lookup is async because the song bundle defers every file's bytes (lazy `File` reference) until
      // something actually needs them. Wrap in a self-invoked async IIFE because the click handler stays sync.
      const text = await findReadtextForSong(this.collection, song);
      if (this.disposed) return;
      if (!text) {
        // No `.txt` companion — give brief audible feedback so the user knows the click registered, then bail out.
        void this.playOneShotSound('option-change');
        return;
      }
      this.readTextBody.text = text;
      // Reset scroll on every open so the user always lands at the top of a freshly-loaded README, even if they had
      // scrolled through a previous one in the same session.
      this.readTextScroll = 0;
      this.readTextOpen = true;
      this.readTextLayer.visible = true;
      void this.playOneShotSound('option-open');
      this.render();
    })();
  }

  /**
   * Adjusts the readtext body's scroll offset by `delta` pixels (positive = scroll down). Clamps to the body / viewport
   * extents — overflow checks happen in {@link renderReadTextOverlay}, but we also clamp here so repeated wheel events
   * at the bottom don't keep growing the stored offset (which would cause a "rubber band" effect when the viewport size
   * later changes).
   */
  private scrollReadText(delta: number): void {
    if (!this.readTextOpen) return;
    const next = Math.max(0, this.readTextScroll + delta);
    if (next === this.readTextScroll) return;
    this.readTextScroll = next;
    this.render();
  }

  /**
   * Hides the READTEXT modal, fires the LR2 panel-close cue, and re-renders. Safe to call when already closed (no-op +
   * no cue), which lets `noteCursorChange` blindly invoke it on every bar move without churning sound effects.
   */
  private closeReadText(): void {
    if (!this.readTextOpen) return;
    this.readTextOpen = false;
    this.readTextLayer.visible = false;
    void this.playOneShotSound('option-close');
    this.render();
  }

  private renderReadTextOverlay(designWidth: number, designHeight: number): void {
    if (!this.readTextOpen) {
      this.readTextLayer.visible = false;
      return;
    }
    this.readTextLayer.visible = true;
    this.readTextBackdrop.clear().rect(0, 0, designWidth, designHeight).fill({ color: 0x000000, alpha: 0.85 });
    const cardWidth = Math.min(800, designWidth - 80);
    const cardHeight = Math.min(560, designHeight - 80);
    const cardX = Math.round((designWidth - cardWidth) / 2);
    const cardY = Math.round((designHeight - cardHeight) / 2);
    this.readTextCard
      .clear()
      .roundRect(cardX, cardY, cardWidth, cardHeight, 12)
      .fill({ color: 0x111318, alpha: 0.96 })
      .stroke({ color: 0x2a2f3a, width: 2 });
    this.readTextTitle.position.set(cardX + 24, cardY + 16);
    // Reserve a 12px gutter on the right for the scrollbar so the body never reflows on overflow. Wrap width drives
    // Pixi's word-wrap layout — drop the gutter from the card padding (24px each side).
    const gutter = 12;
    const padX = 24;
    const headerH = 56;
    // Reserve enough vertical room at the bottom for the footer hint so the body never overlaps the close-instructions
    // row.
    const footerH = 32;
    const viewportX = cardX + padX;
    const viewportY = cardY + headerH;
    const viewportW = cardWidth - padX * 2 - gutter;
    const viewportH = cardHeight - headerH - footerH;
    this.readTextFooter.position.set(cardX + padX, cardY + cardHeight - footerH + 8);
    this.readTextBody.style.wordWrapWidth = viewportW;
    // Clamp the stored scroll against the freshly-measured body height so the body can never scroll past its last line.
    // We do this AFTER setting the wrap width so `body.height` reflects the current layout.
    const bodyH = this.readTextBody.height;
    const maxScroll = Math.max(0, bodyH - viewportH);
    if (this.readTextScroll > maxScroll) this.readTextScroll = maxScroll;
    // Position the viewport at the body's top-left and offset the body itself by `-scroll` so it slides up as the user
    // scrolls down. Using the viewport as the positioning anchor (rather than nudging the body absolute) keeps the
    // mask-relative hit-testing simple if we ever wire pointer-driven scrolling.
    this.readTextViewport.position.set(viewportX, viewportY);
    this.readTextBody.position.set(0, -this.readTextScroll);
    // Mask geometry must be redrawn each frame — the card's size depends on the screen, and Pixi's mask uses the
    // graphic's current geometry verbatim.
    this.readTextViewportMask.clear().rect(viewportX, viewportY, viewportW, viewportH).fill({ color: 0xffffff });
    // Scrollbar — render only when the body overflows. The track is a faint gutter and the thumb is sized
    // proportionally to the visible fraction of the body.
    this.readTextScrollbar.clear();
    if (maxScroll > 0) {
      const trackX = cardX + cardWidth - padX;
      const trackY = viewportY;
      const trackW = 4;
      const trackH = viewportH;
      this.readTextScrollbar.rect(trackX, trackY, trackW, trackH).fill({ color: 0xffffff, alpha: 0.06 });
      const thumbH = Math.max(24, (viewportH / bodyH) * trackH);
      const thumbY = trackY + (this.readTextScroll / maxScroll) * (trackH - thumbH);
      this.readTextScrollbar.rect(trackX, thumbY, trackW, thumbH).fill({ color: 0xffffff, alpha: 0.45 });
    }
  }

  /**
   * Mutates `playOptions.hiSpeed` by ±0.1 (clamped to [{@link HISPEED_MIN}, {@link HISPEED_MAX}]) and notifies any
   * external observer through `onPlayOptionsChange`. Re-renders synchronously so the open panel reflects the new value
   * (the HS slider knob, the NUMBER readout, and any keyframed UI gated on op 10/11) without waiting for the idle rAF
   * tick.
   */
  protected adjustHiSpeed(direction: 1 | -1): void {
    const next = clampHiSpeed(this.playOptions.hiSpeed + direction * HISPEED_STEP);
    if (next === this.playOptions.hiSpeed) return; // already at clamp
    this.playOptions = { ...this.playOptions, hiSpeed: next };
    this.options.onPlayOptionsChange?.({ ...this.playOptions });
    // LR2 system effect — `Sound\lr2\o-change.wav`. Fired on any option-value change inside an open panel (HS up/down,
    // gauge toggle, random select, etc.).
    void this.playOneShotSound('option-change');
    this.render();
  }

  /**
   * Generic cycler for enum-style play options. Advances the value at `key` to the next entry in `cycle` (wrapping past
   * the end), notifies host / fires the option-change cue, and re-renders. Used for `#SRC_BUTTON` types that walk
   * through a fixed set of states on click (BGA on/off/autoplay-only, gauge type, random, etc.). Generic so adding a
   * new enum option is a one-liner.
   */
  protected cyclePlayOption<K extends keyof PixiPlayOptions>(key: K, cycle: readonly PixiPlayOptions[K][]): void {
    const next = cycleNext(cycle, this.playOptions[key]);
    if (next === this.playOptions[key]) return;
    this.playOptions = { ...this.playOptions, [key]: next };
    this.options.onPlayOptionsChange?.({ ...this.playOptions });
    void this.playOneShotSound('option-change');
    this.render();
  }

  /**
   * Direct-set helper for play options whose `#SRC_BUTTON` is a "set this exact value" affair (e.g. type 91..96 for the
   * difficulty filter). Skips the change notification when the value already matches so spam-clicking the same button
   * doesn't fire phantom `option-change` cues.
   */
  protected setPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
    if (this.playOptions[key] === value) return;
    this.playOptions = { ...this.playOptions, [key]: value };
    this.options.onPlayOptionsChange?.({ ...this.playOptions });
    void this.playOneShotSound('option-change');
    this.render();
  }

  /**
   * Resets `selectedIndex` to 0 after a song-list filter (the difficulty / keymode filter buttons) changed. Whatever
   * song the user was hovering on a moment ago is unlikely to be at the same numeric index in the new filtered list (or
   * even still present), so jumping to the top is more predictable than trying to clamp/preserve. Re-arms the chart
   * preview so the new top song's preview starts after the LR2 focus- settle delay.
   */
  protected snapCursorAfterFilterChange(): void {
    this.selectedIndex = 0;
    this.refreshChartPreview();
  }

  /**
   * Wheel-scroll → cursor move. `deltaY > 0` (wheel down) advances to the next entry; `deltaY < 0` (wheel up) rewinds.
   * Multiple notches per event (`deltaMode` lines / pages) are clamped to one cursor step so a fast trackpad flick
   * doesn't send the cursor flying past dozens of entries — `noteCursorChange` only animates one slot worth of slide
   * and large jumps would make the smooth-scroll look broken.
   *
   * Wraps at the list ends, matching the keyboard navigation. Skipped while hidden (gameplay on top) so a wheel event
   * over the canvas doesn't navigate the select view in the background.
   */
  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.visible) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    // While the readtext modal is open, the wheel scrolls the README body instead of moving the bar cursor. Otherwise
    // the user couldn't pan a long author note without first closing the overlay.
    if (this.readTextOpen) {
      this.scrollReadText(event.deltaY);
      return;
    }
    const entries = this.currentEntries();
    if (entries.length === 0) return;
    // Throttle high-rate wheel input. Modern trackpads emit a continuous stream of small `deltaY`s during a single
    // flick — without this gate one flick advances the cursor 10+ slots, the smooth-scroll keeps re-seeding before
    // the previous slide finishes, and `cursor-move` chatters on every notch. The floor is intentionally gentle:
    // sustained scrolling still progresses ~11 entries / second, but discrete flicks resolve to roughly one step.
    const now = performance.now();
    if (now - this.lastWheelMoveAt < WHEEL_THROTTLE_INTERVAL_MS) return;
    this.lastWheelMoveAt = now;
    const direction = event.deltaY > 0 ? 1 : -1;
    this.selectedIndex = (this.selectedIndex + direction + entries.length) % entries.length;
    // Use the wheel direction directly rather than the wrapped (new - old) delta. With a tiny list (e.g. 2 entries),
    // wrapping from `last` back to `first` produces a `rawDelta` of `-(N-1)` whose shortest-path interpretation is
    // "back by one", which would slide the bars in the wrong direction even though the user wheeled DOWN. Treating
    // wheel input as an "infinite rail" — every notch always slides one slot in the wheel's direction — preserves the
    // LR2 selection feel.
    this.noteCursorChange(direction);
    this.render();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.visible || this.launchAt !== undefined) return;
    // Retry BGM start on the first user gesture — browsers gate `AudioContext.resume()` behind a user-input event, so
    // the mount-time / setVisible-time start may have left the context suspended. Cheap to call repeatedly
    // (early-returns when a source is already playing).
    void this.startSelectBgm();
    // README modal owns the pointer while open. LR2 uses Enter (the decide key) for panel close, mirrored on the
    // keyboard path; on the mouse side we accept any click anywhere as a dismiss to cover users who'd reach for "click
    // outside the card" before reading the footer hint. The README content itself isn't interactive so consuming the
    // click loses no affordance.
    if (this.readTextOpen) {
      event.preventDefault();
      this.closeReadText();
      return;
    }
    // No `canvas.focus()` — we listen for `keydown` on `window`, so capturing focus here would needlessly pull it away
    // from any form input the user might already be typing into.
    const themeSize = this.themeDesignSize;
    const { width: designWidth, height: designHeight } = themeSize ?? this.beMusicDesignSize;
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
    const virtualX = (event.offsetX - viewport.x) / viewport.scale;
    const virtualY = (event.offsetY - viewport.y) / viewport.scale;

    if (themeSize) {
      this.handleThemePointerDown(virtualX, virtualY);
      return;
    }

    // Skin-less fallback: hit-test the right-column bar list. The chrome paints other interactive-looking regions
    // (search box, top tabs, score panel), but those are decorative-only in this no-skin path — clicks on them
    // shouldn't pick a song or change navigation. Bound the song-list reaction to the right-column rectangle the rows
    // actually live in.
    //
    // Geometry must mirror the `render()` layout above: rows begin at `listTop` with `rowHeight` pitch, and the visible
    // window centers on `selectedIndex` with the same `start` calculation. Anything outside the list rectangle is a
    // no-op.
    const layout = this.beMusicSkin.select.layout;
    const { listX, listTop, rowHeight } = layout;
    const listBottom = designHeight - layout.listBottomInset;
    if (virtualX < listX || virtualY < listTop || virtualY > listBottom) {
      return;
    }
    const fallbackEntries = this.currentEntries();
    if (fallbackEntries.length === 0) {
      return;
    }
    const start = resolveSelectListWindow(
      layout,
      designHeight,
      this.selectedIndex,
      fallbackEntries.length,
    ).firstVisibleIndex;
    const visibleRow = Math.floor((virtualY - listTop) / rowHeight);
    const entryIndex = start + visibleRow;
    if (entryIndex < 0 || entryIndex >= fallbackEntries.length) {
      return;
    }
    const entry = fallbackEntries[entryIndex];
    if (!entry) return;
    const previous = this.selectedIndex;
    if (entryIndex !== previous) {
      this.noteCursorChange(wrappedCursorDelta(entryIndex - previous, fallbackEntries.length));
    }
    this.selectedIndex = entryIndex;
    this.render();
    if (entry.kind === 'folder') {
      this.enterFolder(entry.folder);
    } else {
      this.launchSong(entry.song);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // A launch outro is playing — the chart is already chosen.
    if (this.launchAt !== undefined) {
      return;
    }
    // Same gesture-retry as `handlePointerDown` — most users will arrive at the select view via the keyboard rather
    // than a mouse on macOS / touchpad-only devices, so we hook here too.
    void this.startSelectBgm();
    // Don't navigate while the view is hidden — e.g. when gameplay is on top. Both views attach `keydown` to the window
    // so they can capture input without canvas focus, but only the visible one should react.
    if (!this.visible) {
      return;
    }
    // Skip when the user is typing into a form / contenteditable element so arrow keys / Enter aren't hijacked from
    // text input.
    if (isEditableTarget(event.target)) {
      return;
    }
    // Space toggles LR2 panel 1 (the play-options panel by convention — LR2SkinHelp line 9101: only the song-select skin
    // supports invoking panel 1 via the start button). We bind it to Space rather than Enter because Enter is already the song-pick /
    // folder-enter accelerator on this view.
    if (event.code === 'Space') {
      event.preventDefault();
      this.togglePanel(1);
      return;
    }
    // While the README modal is open it owns the keyboard. LR2's canonical close key is Enter (the decide / confirm
    // key); from the keyboard: - Enter / Backspace close it. Enter is the LR2-faithful shortcut hinted in the modal
    // footer; Backspace is a secondary "go back" alias. Esc is intentionally NOT bound — LR2 doesn't use it for panel
    // close, and reusing it here would diverge from the host's skin-faithful interaction model. - ↑ / ↓ / PageUp /
    // PageDown / Home / End / Space scroll the body. Falling through to the cursor-move handlers would defeat the modal
    // — the bar cursor would race past songs while the user is just trying to read the note.
    if (this.readTextOpen) {
      if (event.key === 'Backspace' || event.key === 'Enter') {
        event.preventDefault();
        this.closeReadText();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.scrollReadText(READTEXT_LINE_SCROLL);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.scrollReadText(-READTEXT_LINE_SCROLL);
        return;
      }
      if (event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        this.scrollReadText(READTEXT_PAGE_SCROLL);
        return;
      }
      if (event.key === 'PageUp') {
        event.preventDefault();
        this.scrollReadText(-READTEXT_PAGE_SCROLL);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        this.scrollReadText(-Number.MAX_SAFE_INTEGER);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        this.scrollReadText(Number.MAX_SAFE_INTEGER);
        return;
      }
      // Any other key — swallow so it doesn't leak through to the panel / cursor handlers below.
      return;
    }
    // While any panel is open, Escape closes it instead of popping a folder. Mirrors LR2: right-click on a panel (or
    // re-clicking its launcher button) closes it; here we accept Escape too so keyboard-only users have a back-out
    // shortcut.
    if (event.key === 'Escape' && this.panelStates.size > 0) {
      event.preventDefault();
      // Close panels in numeric order — picking the lowest-numbered open panel matches "Esc closes the topmost /
      // most-recent" expectation on the common case where only panel 1 is open.
      const sorted = [...this.panelStates].sort((a, b) => a - b);
      const target = sorted[0];
      if (target !== undefined) this.togglePanel(target);
      return;
    }
    // HS adjustment via the 1P 5 / 7 lane keys (LR2 convention: pressing the 5-key inside the play-options panel
    // decreases HiSpeed, the 7-key increases it). Bindings follow the common gameplay lane convention — PLAY
    // OPTIONS panel (panel 1) keyboard shortcuts. While the panel is open, each 7K lane key cycles a corresponding play
    // option — same "adjacent-key shortcuts" family LR2 hardcodes for option panels. The mapping mirrors the panel's
    // visible button layout:
    //
    // LANE 1 (KeyZ) → PLAY STYLE (`dpFlip` toggle) LANE 2 (KeyS) → RANDOM (`random1P` cycle) LANE 3 (KeyX) → BATTLE
    // (`random2P` cycle — DP-side independent random is the canonical "battle" effect) LANE 4 (KeyD) → GAUGE (`gauge1P`
    // cycle) LANE 5 (KeyC) → HI-SPD ↓ (`adjustHiSpeed(-1)`) LANE 6 (KeyF) → ASSIST (`autoScratch1P` toggle) LANE 7
    // (KeyV) → HI-SPD ↑ (`adjustHiSpeed(+1)`)
    //
    // Only fires while panel 1 is open so the keys remain free outside the play-options context.
    if (this.panelStates.has(1)) {
      if (event.code === 'KeyZ') {
        event.preventDefault();
        this.cyclePlayOption('dpFlip', BOOLEAN_CYCLE);
        return;
      }
      if (event.code === 'KeyS') {
        event.preventDefault();
        this.cyclePlayOption('random1P', RANDOM_CYCLE);
        return;
      }
      if (event.code === 'KeyX') {
        event.preventDefault();
        this.cyclePlayOption('random2P', RANDOM_CYCLE);
        return;
      }
      if (event.code === 'KeyD') {
        event.preventDefault();
        this.cyclePlayOption('gauge1P', GAUGE_CYCLE);
        return;
      }
      if (event.code === 'KeyC') {
        event.preventDefault();
        this.adjustHiSpeed(-1);
        return;
      }
      if (event.code === 'KeyF') {
        event.preventDefault();
        this.cyclePlayOption('autoScratch1P', BOOLEAN_CYCLE);
        return;
      }
      if (event.code === 'KeyV') {
        event.preventDefault();
        this.adjustHiSpeed(1);
        return;
      }
    }
    const entries = this.currentEntries();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (entries.length === 0) return;
      // Wrap past the end → first entry. Matches LR2's circular bar list (the rail keeps scrolling forever in either
      // direction). Pass `+1` directly to `noteCursorChange` rather than the `(new - old)` wrapped delta: with very
      // short lists (2 / 3 entries) the wrap brings the cursor back to a lower index, which would otherwise drive the
      // slide animation in the OPPOSITE direction of the keypress. The user pressed down, so the bars should always
      // slide as if going down — every press, regardless of whether the cursor wraps.
      this.selectedIndex = (this.selectedIndex + 1) % entries.length;
      this.noteCursorChange(1);
      this.render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (entries.length === 0) return;
      // Symmetric to ArrowDown — pass `-1` directly so the slide animation always matches the keypress direction even
      // when the cursor wraps from `0` to `entries.length - 1`.
      this.selectedIndex = (this.selectedIndex - 1 + entries.length) % entries.length;
      this.noteCursorChange(-1);
      this.render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[this.selectedIndex];
      if (!entry) return;
      if (entry.kind === 'folder') {
        this.enterFolder(entry.folder);
      } else {
        this.launchSong(entry.song);
      }
    } else if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'ArrowLeft') {
      // Pop one level up — Esc / Backspace / ← all back out of the current folder. No-op at the root so the user
      // doesn't get stuck on an "empty list" view by accident.
      if (!this.leaveFolder()) return;
      event.preventDefault();
    }
  };

  protected render(): void {
    const screenWidth = this.app.screen.width || this.mountedContainer?.clientWidth || FALLBACK_DESIGN_WIDTH;
    const screenHeight = this.app.screen.height || this.mountedContainer?.clientHeight || FALLBACK_DESIGN_HEIGHT;
    const themeSize = this.themeDesignSize;
    const useTheme = themeSize !== undefined;
    const { width: designWidth, height: designHeight } = themeSize ?? this.beMusicDesignSize;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, this.app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * this.app.renderer.resolution);
    // Only rebuild the static rect graphics when the dimensions they depend on actually change. The previous
    // unconditional `.clear().rect().fill()` chain ran on every rAF tick and was a measurable contributor to the select
    // scene's frame budget under LR2 default skin (~hundreds of skin elements already redraw per frame).
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }

    // `disposeChildren` (vs bare `removeChildren`) frees the GraphicsContext / glyph-atlas state Pixi v8 keeps
    // registered for every detached node. The select scene rebuilds its skin and song-list sprites every frame, so
    // without this we'd leak renderer-side resources for as long as the player browses the song list. See
    // `pixi-utils.ts` for the full story (the same leak caused the post-chart browser hang on the gameplay scene).
    disposeChildren(this.skinLayer);
    disposeChildren(this.listLayer);
    disposeChildren(this.skinForegroundLayer);

    // Decay the smooth-scroll offset toward 0. Exponential decay with a ~80 ms time constant gives a snappy slide
    // that's substantially complete in a quarter second; rapid cursor presses compose naturally because each new step
    // adds onto the residual offset.
    const now = performance.now();
    if (this.lastScrollUpdate === 0) {
      this.lastScrollUpdate = now;
    }
    const dt = now - this.lastScrollUpdate;
    this.lastScrollUpdate = now;
    if (useTheme && this.listScrollOffset !== 0) {
      const decay = Math.exp(-dt / 80);
      this.listScrollOffset *= decay;
      if (Math.abs(this.listScrollOffset) < 0.5) {
        this.listScrollOffset = 0;
      }
    }
    this.listLayer.y = useTheme ? this.listScrollOffset : 0;

    if (useTheme) {
      this.title.visible = false;
      this.hint.visible = false;
      this.beMusicBackHolder.visible = false;
      this.beMusicFrontHolder.visible = false;
      this.renderTheme(designWidth, designHeight);
      this.renderReadTextOverlay(designWidth, designHeight);
      return;
    }

    // Default-family chrome paints only live library / focused-chart data, so the legacy `this.title` / `this.hint`
    // overlays are hidden; the host-level drop overlay remains responsible for the empty-library callout.
    const entries = this.currentEntries();
    this.title.visible = false;
    this.hint.visible = false;
    const renderer = this.ensureBeMusicRenderer();
    const selectWindow = resolveSelectListWindow(
      this.beMusicSkin.select.layout,
      designHeight,
      this.selectedIndex,
      entries.length,
    );
    const currentFolder = this.browseStack[this.browseStack.length - 1];
    this.beMusicBackHolder.visible = true;
    this.beMusicFrontHolder.visible = true;
    renderer.render({
      designWidth,
      designHeight,
      nowMs: performance.now(),
      sceneStartedAt: this.sceneStartedAt,
      cursorChangedAt: this.cursorChangedAt,
      entries,
      selectedIndex: this.selectedIndex,
      firstVisibleIndex: selectWindow.firstVisibleIndex,
      visibleRows: selectWindow.visibleRows,
      focusedSong: this.focusedSong(),
      folderLabel: currentFolder?.label,
      searchQuery: this.searchQuery,
      totalCharts: this.collection.songs.length,
      actions: this.beMusicActions,
      effects: this.options.beMusicEffects ?? 'full',
      launchAt: this.launchAt,
    });
    // The binding draws the skin every frame in `tick`; nothing needs a re-render here.
    this.beMusicNeedsFrame = this.launchAt !== undefined;
    this.renderReadTextOverlay(designWidth, designHeight);
  }

  /** Active be-music skin for the skinless path — the built-in Phantom skin unless the host picked one. */
  private get beMusicSkin(): BeMusicSkin {
    return this.options.beMusicSkin ?? phantomSkin;
  }

  private ensureBeMusicRenderer(): BeMusicSelectBinding {
    if (!this.beMusicRenderer) {
      this.beMusicRenderer = new BeMusicSelectBinding(this.beMusicSkin);
      this.beMusicBackHolder.addChild(this.beMusicRenderer.backLayer);
      this.beMusicFrontHolder.addChild(this.beMusicRenderer.frontLayer);
    }
    return this.beMusicRenderer;
  }

  /** PLAY / AUTO PLAY / search callbacks handed to the skin's hit areas. */
  private readonly beMusicActions = {
    play: (): void => this.launchFocusedSong(false),
    autoPlay: (): void => this.launchFocusedSong(true),
    activateSearch: (): void => this.options.onSearchActivate?.(),
  };

  private launchFocusedSong(autoPlay: boolean): void {
    const focused = this.focusedSong();
    if (!focused) return;
    this.launchSong(focused, autoPlay);
  }

  /** `performance.now()` of a launch whose be-music outro is still playing, else `undefined`. */
  protected launchAt: number | undefined;
  private launchTimer: number | undefined;

  /**
   * Hands `song` to the host. On the be-music path the skin may first play an outro (`BeMusicSelectRenderer.outroMs`);
   * input is ignored until it finishes. Themes (LR2) and `effects: 'off'` launch immediately.
   */
  protected launchSong(song: BrowserSongEntry, autoPlay = false): void {
    if (this.launchAt !== undefined) return;
    const fire = (): void => {
      if (autoPlay && this.options.onSongAutoPlay) {
        this.options.onSongAutoPlay(song);
        return;
      }
      this.options.onSongSelected?.(song);
    };
    const outroMs =
      this.themeDesignSize === undefined && (this.options.beMusicEffects ?? 'full') !== 'off'
        ? (this.beMusicRenderer?.outroMs ?? 0)
        : 0;
    if (outroMs <= 0) {
      fire();
      return;
    }
    this.launchAt = performance.now();
    this.beMusicNeedsFrame = true;
    this.render();
    this.launchTimer = window.setTimeout(() => {
      this.launchTimer = undefined;
      this.launchAt = undefined;
      if (this.disposed) return;
      fire();
      // Settle the screen behind the gameplay handoff so a return to select doesn't flash the outro's last frame.
      this.render();
    }, outroMs);
  }

  /** Design canvas for the current frame: the active theme's, or the be-music skin's stage. */
  private resolveDesignSize(): SelectDesignSize {
    return this.themeDesignSize ?? this.beMusicDesignSize;
  }

  /** The be-music skin's stage (640×480 when the skin declares none). */
  private get beMusicDesignSize(): SelectDesignSize {
    const stage = resolveBeMusicSkinStage(this.beMusicSkin);
    return { width: stage.width, height: stage.height };
  }

  /**
   * Theme hook: the design canvas the skin family renders into, or `undefined` when no theme is active and the frame
   * falls back to the be-music skin. Every other `theme*` hook only runs while this returns a size.
   */
  protected get themeDesignSize(): SelectDesignSize | undefined {
    return undefined;
  }

  /** Theme hook: kicks off async asset loads (textures, fonts) at mount time. Default: nothing to load. */
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

/**
 * Maps a raw `(new - old)` cursor delta into a "shortest visible step" delta. Used so a wrap-around move (e.g. from
 * `entries[0]` ↑ to `entries[length-1]`) animates as a single "back by 1" step rather than a long slide spanning the
 * whole list.
 *
 * Examples (length = 10): delta=+1 → +1 (forward 1 step) delta=-1 → -1 (backward 1 step) delta=+9 → -1 (wrap forward =
 * visually 1 step back) delta=-9 → +1 (wrap backward = visually 1 step forward)
 *
 * Special case for tiny lists (notably `count = 2`): forward 1 and backward 1 are the same distance around a 2-element
 * ring, and the symmetric `((rawDelta + half) % count) - half` formula collapses both onto `-1`. That made pressing the
 * down arrow on a folder list of length 2 visually slide the cursor *upward* — confusing and inconsistent with the
 * keypress. We fix this by preferring the raw direction when the move already fits inside the half-window (`|rawDelta|
 * <= half`), which is exactly the "short trip, no wrap needed" case. Wrapping kicks in only for genuine long jumps that
 * should be re-interpreted as a short step in the opposite direction.
 */
export function wrappedCursorDelta(rawDelta: number, count: number): number {
  if (count <= 0) return 0;
  const half = count / 2;
  if (Math.abs(rawDelta) <= half) {
    return rawDelta;
  }
  return ((((rawDelta + half) % count) + count) % count) - half;
}

/**
 * Returns `true` when the keydown target is a text-editable element (`<input>` / `<textarea>` / `<select>` /
 * `contenteditable`). The select view's keyboard handlers use this to bail so the user can type into form fields
 * without arrow keys hijacking the bar list.
 *
 * `<input type="checkbox">` / `<input type="file">` pass through — those don't capture text input and the user expects
 * arrow keys to still drive the song list while a checkbox happens to be focused.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type.toLowerCase();
    // text-like input types we want to leave alone.
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'url' ||
      type === 'email' ||
      type === 'password' ||
      type === 'number' ||
      type === 'tel' ||
      type === ''
    );
  }
  return false;
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

/**
 * Sorts a list of browse entries in place by the chosen LR2 sort mode. Folders always sort by label (LEVEL / CLEAR
 * don't meaningfully apply to a folder bar). Songs sort by: - LEVEL: ascending `#PLAYLEVEL` (missing levels last) -
 * TITLE: case-insensitive `#TITLE` - CLEAR: no-op until per-song clear-history persistence lands; falls back to title
 * order so the result is deterministic.
 *
 * Stable for entries that compare equal — preserves the input order, which matches the original drop-folder layout.
 */
function sortBrowseEntries(entries: BrowserBrowseEntry[], sort: PixiSelectSort): BrowserBrowseEntry[] {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort((a, b) => {
    const cmp = compareEntriesForSort(a.entry, b.entry, sort);
    return cmp !== 0 ? cmp : a.index - b.index;
  });
  return indexed.map((item) => item.entry);
}

function compareEntriesForSort(a: BrowserBrowseEntry, b: BrowserBrowseEntry, sort: PixiSelectSort): number {
  // Mixed folder + song lists shouldn't happen at any single nav depth today, but keep folders ahead of songs so the
  // result is sensible if that invariant changes.
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  if (a.kind === 'folder' && b.kind === 'folder') {
    return compareStrings(a.folder.label, b.folder.label);
  }
  if (a.kind !== 'song' || b.kind !== 'song') return 0;
  const songA = a.song;
  const songB = b.song;
  switch (sort) {
    case 'LEVEL': {
      const levelA = coercePlayLevel(songA.playLevel);
      const levelB = coercePlayLevel(songB.playLevel);
      if (levelA !== levelB) return levelA - levelB;
      return compareStrings(songA.title, songB.title);
    }
    case 'TITLE':
      return compareStrings(songA.title, songB.title);
    case 'CLEAR':
      // No play-history persistence yet — fall through to a deterministic title sort so the cycle-button still reorders
      // the list visibly.
      return compareStrings(songA.title, songB.title);
    case 'OFF':
      return 0;
  }
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/**
 * Normalizes a `playLevel` value (declared as `number | string | undefined` on `BrowserSongEntry`) to a numeric sort
 * key. Missing / non-numeric levels sort to the END of an ascending list.
 */
function coercePlayLevel(value: number | string | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Returns whether `song`'s `#DIFFICULTY` field matches the target difficulty enum value. The {@link
 * DIFFICULTY_FILTER_CYCLE} index maps onto LR2's 1=BEGINNER..5=INSANE numbering directly: `target = 1` ↔ BEGINNER, ...,
 * `target = 5` ↔ INSANE. Charts with no `#DIFFICULTY` (`undefined` / 0) never match a non-ALL filter — there's no
 * defined bucket for them and showing them everywhere would defeat the filter's purpose.
 */
function matchesDifficultyFilter(song: BrowserSongEntry, target: number): boolean {
  const value = song.chart.metadata.difficulty;
  if (value === undefined || value === 0) return false;
  return value === target;
}

/**
 * Looks up a `.txt` companion file in the same directory as the focused song's chart and returns its decoded contents.
 * Used by the LR2 READTEXT button (`#SRC_BUTTON,...,17,...`) to surface per-song notes / changelogs that BMS authors
 * traditionally ship alongside the chart files.
 *
 * Resolution rules — kept deliberately tolerant so we don't need the source to follow any specific naming convention:
 *
 * - Only files **directly inside** the chart's directory are considered (no recursing into sub-folders, no walking up
 *   to the source root).
 * - The first matching file wins. The map iteration order is the source's insertion order (which mirrors the directory
 *   listing on the directory loader / the central directory order on the ZIP loader), so this is stable per source.
 * - Returns `undefined` when the song has no resolvable source or no sibling `.txt` exists, letting the caller play the
 *   "no readtext" feedback cue instead of opening an empty modal.
 */
async function findReadtextForSong(
  collection: BrowserSongCollection,
  song: BrowserSongEntry,
): Promise<string | undefined> {
  const source = resolveSongSource(collection, song);
  if (!source) return undefined;
  const dir = dirname(song.chartPath).toLowerCase();
  for (const [path, entry] of source.files) {
    if (!path.toLowerCase().endsWith('.txt')) continue;
    if (dirname(path).toLowerCase() !== dir) continue;
    // Song-bundle files are lazy `File` references — pull the bytes on demand. The .txt is small so the read is cheap;
    // the bytes go out of scope once decoded into the modal text, so they don't pin any extra memory.
    const bytes = await loadAssetBytes(entry);
    if (!bytes) continue;
    return decodeReadtextBytes(bytes);
  }
  return undefined;
}

/**
 * Decodes raw `.txt` bytes to a string. BMS author notes are historically Shift-JIS (the LR2 era's default codepage on
 * Japanese Windows installs), but modern releases sometimes ship as UTF-8 with or without a BOM. Try UTF-8 first when a
 * BOM is present (unambiguous), then probe Shift-JIS, and finally fall back to lossy UTF-8 so we always return *some*
 * string rather than failing the modal open.
 */
function decodeReadtextBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(3));
  }
  try {
    const sjis = new TextDecoder('shift-jis', { fatal: false }).decode(bytes);
    if (sjis.length > 0 && !sjis.includes('�')) return sjis;
  } catch {
    // `shift-jis` not available in this runtime — fall through.
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Returns whether `entry` matches the lower-cased search query. Folder bars match on label only (no per-song fan-out —
 * folders are coarse navigation, not searchable content). Song bars match if any of title / subtitle / artist / genre /
 * file label contain the query as a substring.
 *
 * Pure / exported for testing. Hosts shouldn't call this directly — `CoreSongSelectView.setSearchQuery` is the front
 * door.
 */
export function matchesSearchQuery(entry: BrowserBrowseEntry, lowerQuery: string): boolean {
  if (lowerQuery.length === 0) return true;
  if (entry.kind === 'folder') {
    return entry.folder.label.toLowerCase().includes(lowerQuery);
  }
  const song = entry.song;
  const haystacks: Array<string | undefined> = [song.title, song.subtitle, song.artist, song.genre, song.fileLabel];
  for (const value of haystacks) {
    if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
      return true;
    }
  }
  return false;
}
