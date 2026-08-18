import { Application, Color, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type {
  Lr2BarBodyKind,
  Lr2BarBodySource,
  Lr2BarBodySlot,
  Lr2BarFlashElement,
  Lr2BarLevelKind,
  Lr2BarLevelSource,
  Lr2BarTitleElement,
  Lr2ButtonElement,
  Lr2DestinationRect,
  Lr2ImageElement,
  Lr2ImageRect,
  Lr2MouseCursorElement,
  Lr2NumberElement,
  Lr2OnMouseElement,
  Lr2Skin,
  Lr2SliderElement,
  Lr2SpecialGraphic,
  Lr2TextElement,
} from '@be-music/lr2-skin';
import {
  applyDestinationToSprite,
  containerSpriteSink,
  createCroppedTexture,
  evaluateElementDestination,
  evaluateKeyframes,
  makeLr2SliderSprite,
  makeLr2StaticImageSprite,
  normalizeRect,
  pickAnimatedCell,
  renderNumberElement,
} from '../../skin/lr2/render.ts';
import { PerfTracker } from '../perf.ts';
import { type PixiSceneHost } from '../host.ts';
import { disposeChildren } from '../pixi-utils.ts';
import { groupSongsByFolder, loadAssetBytes, resolveSongSource } from '../../collection/collection.ts';
import { dirname } from '@be-music/utils/core';
import { ChartPreviewEngine } from '../../chart/preview.ts';
import { computeSelectOps, resolveKeyModeOp, SELECT_KEYS_FILTER_TO_OP } from '../select-ops.ts';
import {
  Lr2ChartGraphicTextureStore,
  Lr2SkinTextureStore,
  collectSelectSkinTexturePaths,
  resolveSolidSpecialGraphicTexture,
} from '../../skin/lr2/scene-textures.ts';
import {
  clampFontSize,
  isDestinationVisible,
  makeLr2TextSprite,
  resolveScaledViewport,
} from '../../skin/lr2/scene-render.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import type { Lr2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import { logger } from '../../logger.ts';
import type {
  BrowserBrowseEntry,
  BrowserFolderNode,
  BrowserSongCollection,
  BrowserSongEntry,
} from '../../collection/types.ts';
import { LR2_TEXT_FALLBACK_FONT } from './fonts.ts';
import { DefaultSelectMotion } from '../default/hud-motion.ts';
import { cursorFollow } from '../default/motion.ts';
import {
  DEFAULT_SELECT_LAYOUT,
  defaultSelectEntryIndexAt,
  isInsideDefaultSelectList,
  resolveDefaultSelectVisibleWindow,
} from '../default/select-layout.ts';
import {
  attachDefaultSelectHits,
  formatDefaultSelectModeLabel,
  paintDefaultSelectCover,
  renderDefaultSelectChrome,
  renderDefaultSelectRow,
} from '../default/select-render.ts';

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
 * `scene/lr2/decide` / `scene/lr2/result` carry the same constant for the same reason.
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
 * host reads the current snapshot via {@link PixiSongSelectView.getPlayOptions} on song-pick and feeds it into {@link
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
const BGA_CYCLE: readonly PixiBgaMode[] = ['OFF', 'ON', 'AUTOPLAY_ONLY'];

/**
 * Cycle order for {@link PixiPlayOptions.bgaSize}. LR2 button cell order on `#SRC_BUTTON,type=73`: cell 0 = NORMAL,
 * cell 1 = EXTEND.
 */
const BGA_SIZE_CYCLE: readonly PixiBgaSize[] = ['NORMAL', 'EXTEND'];

/**
 * Cycle order for {@link PixiPlayOptions.difficultyFilter}. Matches the LR2 `#SRC_BUTTON,type=10` cell order (off /
 * easy / normal / hard / expert / insane). The direct-set buttons (types 91..96) map onto specific entries here via {@link
 * DIFFICULTY_FILTER_BY_DIRECT_BUTTON}.
 */
const DIFFICULTY_FILTER_CYCLE: readonly PixiDifficultyFilter[] = [
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
const DIFFICULTY_FILTER_BY_DIRECT_BUTTON: Record<number, PixiDifficultyFilter> = {
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
const KEYS_FILTER_CYCLE: readonly PixiKeysFilter[] = ['ALL', 'KEYS_5', 'KEYS_7', 'KEYS_10', 'KEYS_14', 'KEYS_9'];

/**
 * Cycle order for {@link PixiPlayOptions.sort}. LR2 button cells 0 / 1 / 2 / 3 = off / level / title / clear.
 */
const SORT_CYCLE: readonly PixiSelectSort[] = ['OFF', 'LEVEL', 'TITLE', 'CLEAR'];

/**
 * Cycle order for {@link PixiPlayOptions.hsFix}. LR2 button cells 0..4 on `#SRC_BUTTON,type=55`: off / maxbpm / minbpm
 * / average / constant.
 */
const HS_FIX_CYCLE: readonly PixiHsFix[] = ['OFF', 'MAXBPM', 'MINBPM', 'AVERAGE', 'CONSTANT'];

/**
 * Cycle order for {@link PixiPlayOptions.hiddenSudden1P} / `hiddenSudden2P`. LR2 button cells 0..3 on
 * `#SRC_BUTTON,type=50` (1P) and `type=51` (2P): off / hidden / sudden / hid+sud.
 */
const HIDDEN_SUDDEN_CYCLE: readonly PixiHiddenSudden[] = ['OFF', 'HIDDEN', 'SUDDEN', 'HID+SUD'];

/** Cycle for boolean OFF/ON LR2 buttons (e.g. autoscratch). */
const BOOLEAN_CYCLE: readonly boolean[] = [false, true];

/**
 * Cycle order for {@link PixiPlayOptions.random1P} / `random2P`. LR2 button cells 0..4 on `#SRC_BUTTON,type=42 / 43`:
 * off / mirror / random / s-random / scatter.
 */
const RANDOM_CYCLE: readonly PixiRandomMode[] = ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM', 'SCATTER'];

/**
 * Cycle order for {@link PixiPlayOptions.gauge1P} / `gauge2P`. LR2 button cells 0..3 on `#SRC_BUTTON,type=40 / 41`:
 * groove / survival / death / easy.
 */
const GAUGE_CYCLE: readonly PixiGaugeType[] = ['GROOVE', 'HARD', 'DEATH', 'EASY'];

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
const HISPEED_MIN = 0.1;
const HISPEED_MAX = 6.0;
/** Per-click HS step. 0.1 matches gameplay's `HISPEED_STEP`. */
const HISPEED_STEP = 0.1;

/**
 * Snaps a hiSpeed value to the 1/1000 grid and clamps to [{@link HISPEED_MIN}, {@link HISPEED_MAX}]. The 1/1000 snap
 * absorbs float drift from repeated +0.1 / -0.1 increments — the same trick `scene/lr2/gameplay::adjustHiSpeed` uses so the
 * two paths converge on identical step values.
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
 * Bundle of LR2 system sound-effect bytes (typically loaded from `LR2files/Sound/lr2/*.wav`). Each field is the encoded
 * audio payload (WAV / OGG / MP3 / etc.); {@link PixiSongSelectView} decodes lazily on first play through its own
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

export interface PixiSongSelectViewOptions {
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
   * focuses a DOM `<input>` overlay so the user can type. Subsequent calls to {@link PixiSongSelectView.setSearchQuery}
   * filter the visible bar list.
   */
  onSearchActivate?: () => void;
  /**
   * Looping song-select BGM bytes (typically `LR2files/Bgm/<theme>/select.wav`). When supplied, the view decodes lazily
   * on first user gesture and loops while visible. Pass `undefined` (or omit) to skip BGM entirely. Runtime swap via
   * {@link PixiSongSelectView.setSelectBgm}.
   */
  selectBgm?: Uint8Array;
  /**
   * One-shot song-decided BGM bytes (typically `LR2files/Bgm/<theme>/decide.wav`). Fired by hosts via {@link
   * PixiSongSelectView.playDecideSound} on the select → gameplay transition. Decoded lazily on first play through the
   * same `AudioContext` as the looping select BGM. Runtime swap via {@link PixiSongSelectView.setDecideBgm}.
   */
  decideBgm?: Uint8Array;
  /**
   * LR2 system sound effects (typically `LR2files/Sound/lr2/*.wav`). The view fires each effect at the appropriate
   * navigation event:
   *
   * - `cursorMove` (`scratch.wav`) — every cursor advance, both keyboard and mouse / wheel triggered.
   * - `folderOpen` (`f-open.wav`) — drilling into a folder.
   * - `folderClose` (`f-close.wav`) — backing out of a folder via Esc / Backspace / Left.
   *
   * Missing entries are silently skipped — themes that don't ship a particular effect just don't play it. Runtime swap
   * via {@link PixiSongSelectView.setSystemSounds}.
   */
  systemSounds?: PixiSongSelectSystemSounds;
  /**
   * LR2 skin to render the select screen with. When provided, static `#IMAGE` elements decorate the frame and
   * `#SRC_BAR_BODY` / `#DST_BAR_BODY_OFF` / `_ON` slots host the song list. Without a skin the view falls back to a
   * built-in pixel-art-style layout.
   */
  skin?: Lr2Skin;
  /**
   * Initial cursor / folder state. When provided, the view restores the previous `selectedIndex` and walks back into
   * `folderPath` (skipping any segment whose label no longer exists). Used by the demo to remember the focused song
   * across play sessions.
   */
  initialNavigation?: PixiSongSelectNavigation;
  /**
   * Initial play-option values. Merged onto {@link DEFAULT_PLAY_OPTIONS} — fields the host omits keep their defaults.
   * The view owns the live state from then on; hosts read it back via {@link PixiSongSelectView.getPlayOptions} when
   * launching gameplay.
   */
  initialPlayOptions?: Partial<PixiPlayOptions>;
  /**
   * Fired whenever the in-scene "PLAY OPTIONS" panel mutates the live play-option state. Hosts use this to keep
   * external surfaces (e.g. a debug toolbar checkbox, a URL flag, persisted settings) in sync with the value the panel
   * just changed.
   *
   * Not fired for {@link PixiSongSelectView.setPlayOptions} writes — those originate from the host so the host already
   * knows.
   */
  onPlayOptionsChange?: (options: PixiPlayOptions) => void;
}

/**
 * One entry in the precomputed {@link PixiSongSelectView.sortedChromeEntries} array. Tagged union over the six
 * chrome-element kinds the LR2 select view paints (`#SRC_IMAGE`, `#SRC_NUMBER`, `#SRC_TEXT`, `#SRC_BUTTON`,
 * `#SRC_ONMOUSE`, `#SRC_SLIDER`). The `order` field is the CSV-declaration order used as the inter-kind sort key —
 * matching LR2's "later declaration paints on top" rule. `layerIsForeground` caches the result of `pickChromeLayer` so
 * the per-frame switch can resolve the destination container without re-reading the skin's bar layout each time.
 */
type SortedSelectChromeEntry =
  | { kind: 'image'; order: number; layerIsForeground: boolean; element: Lr2ImageElement }
  | { kind: 'number'; order: number; layerIsForeground: boolean; element: Lr2NumberElement }
  | { kind: 'text'; order: number; layerIsForeground: boolean; element: Lr2TextElement }
  | { kind: 'button'; order: number; layerIsForeground: boolean; element: Lr2ButtonElement }
  | { kind: 'onMouse'; order: number; layerIsForeground: boolean; element: Lr2OnMouseElement }
  | { kind: 'slider'; order: number; layerIsForeground: boolean; element: Lr2SliderElement };

export class PixiSongSelectView {
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
  /**
   * Precomputed, declaration-order-sorted union of every chrome-element kind the LR2 skin defines for the select view.
   * Rebuilt only when the bound skin reference changes — the underlying skin structure (declaration order, layer
   * routing, panel masks) is static for a given skin, so building this list per render frame was pure waste in the
   * previous `work[]` + `.sort()` implementation. Per-frame visibility (ops gating, panel-open gating, DST keyframe
   * eval, pointer hit-test) still happens during the per-entry switch dispatch; only the merge/sort step is hoisted
   * out.
   */
  private sortedChromeEntries: SortedSelectChromeEntry[] = [];
  /**
   * Skin reference used to build {@link sortedChromeEntries}. Comparing identity is enough — the LR2 skin objects are
   * frozen after parse, so a structural change requires {@link setSkin} to swap in a fresh reference.
   */
  private sortedChromeSkinRef: Lr2Skin | undefined;
  /** Skin static images (gated on `SELECT_DEFAULT_OPS`). */
  private readonly skinLayer = new Container();
  /**
   * Skin elements that the LR2 CSV declared AFTER the bar list (`#SRC_BAR_BODY`). They overlay the bar list — the
   * canonical use case is the song-list scroll-position slider that lives to the right of the bars. Routing happens via
   * each element's `declarationOrder` compared to the bar layout's; `pre-bar` elements stay in `skinLayer` (drawn
   * behind bars), `post-bar` elements come here.
   */
  private readonly skinForegroundLayer = new Container();
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
      fontFamily: LR2_TEXT_FALLBACK_FONT,
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
      fontFamily: LR2_TEXT_FALLBACK_FONT,
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
  private readonly perf = new PerfTracker('select');
  /** Song-bar slots — one sprite per visible bar plus its overlay text. */
  private readonly listLayer = new Container();
  private readonly defaultSelectMotion = new DefaultSelectMotion();
  private readonly title = new Text({
    text: 'Drop a BMS folder or ZIP',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 28,
      fontWeight: '700',
      fontFamily: LR2_TEXT_FALLBACK_FONT,
    }),
  });
  private readonly hint = new Text({
    text: 'Select: Arrow keys / Enter',
    style: new TextStyle({ fill: MUTED, fontSize: 14, fontFamily: LR2_TEXT_FALLBACK_FONT }),
  });
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  /**
   * Current selection cursor into `currentEntries()`. Reset to 0 when navigating into / out of a folder so the cursor
   * lands on the first entry of the new view.
   */
  private selectedIndex = 0;
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
  private playOptions: PixiPlayOptions = { ...DEFAULT_PLAY_OPTIONS };
  /**
   * Set of currently-open LR2 panels (1..9). Drives op 1..9 in `computeSelectOps` and gates panel-scoped `#SRC_*`
   * elements via {@link isPanelOpen}. Convention: panel 1 is the play- options panel — opened with the START button
   * (Enter / Space) per LR2's select-skin spec (LR2SkinHelp line 9101).
   *
   * Multiple panels can be open simultaneously per spec (the FX panel and the play-options panel coexist on real LR2
   * setups); `togglePanel` flips one slot at a time so the user explicitly controls which panels are stacked.
   */
  private readonly panelStates = new Set<number>();
  /**
   * Parallel stack of the parent's `selectedIndex` at the moment each folder on `browseStack` was entered. Used by
   * {@link leaveFolder} to land the cursor back on the folder bar the user just exited rather than jumping to the top
   * of the parent list. Always satisfies `parentCursorStack.length === browseStack.length`.
   */
  private parentCursorStack: number[] = [];
  private mountedContainer: HTMLElement | undefined;
  /**
   * Skin asset path → decoded texture cache. Populated by `prepareSkinTextures()` after the view is mounted; rendering
   * reads straight from this map and silently skips bars whose texture is still loading (next render tick will fill
   * them in).
   */
  private readonly skinTextures = new Lr2SkinTextureStore();
  /**
   * Loaded LR2 bitmap-font payloads keyed by `#LR2FONT` declaration index. Populated asynchronously by
   * `prepareBitmapFonts`; until that finishes the renderer falls back to the system-font path inside
   * `makeLr2TextSprite`.
   */
  private bitmapFonts: Map<number, Lr2LoadedFont> = new Map();
  /**
   * Per-song chart-asset texture cache for LR2 runtime-bound graphics (`#SRC_IMAGE,gr=100/101/102` → STAGEFILE /
   * BACKBMP / BANNER). Keyed by `${song.id}:${kind}` so navigating between songs reuses already-decoded banners. Loaded
   * lazily on first reference.
   */
  private readonly chartGraphicTextures = new Lr2ChartGraphicTextureStore();
  /**
   * `performance.now()` at the moment the select scene was mounted. Drives the elapsed-time clock for LR2 timer 0
   * (scene main) so the skin's intro / loop animations on `#DST_*` keyframes play out.
   */
  private sceneStartedAt = 0;
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
  private disposed = false;
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
  private readonly timerStartedAt = new Map<number, number>();
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
  private listScrollOffset = 0;
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
  private mouseX = -1;
  private mouseY = -1;
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
   * `'option-change'` — see `LR2files/Sound/lr2/*.wav` in the default theme). All one-shots share the same
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

  public constructor(private options: PixiSongSelectViewOptions = {}) {
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
    source.connect(this.systemSoundGain ?? audioContext.destination);
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
  private get app(): Application {
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
    this.root.addChild(
      this.background,
      this.skinLayer,
      this.listLayer,
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
    // Only preload skin assets if the skin has select-screen definitions — a play-only skin would otherwise pull in the
    // STAGE FAILED graphic, gauge frame, etc. that don't belong on the select view.
    if (this.options.skin && this.options.skin.barLayout.slots.length > 0) {
      void this.prepareSkinTextures(this.options.skin);
      void this.prepareBitmapFonts(this.options.skin);
    }
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
    // know when "now=0" was. We don't seed timer 1 here; `elapsedSinceTimer` computes its fire moment from
    // `#STARTINPUT` lazily.
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
    this.defaultSelectMotion.enter();
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
  private noteCursorChange(delta: number): void {
    // Cursor moved → readtext modal's content no longer matches the focused song. Close it without an audible cue (the
    // `cursor-move` click below already conveys the bar move) so the user doesn't get a double-blip on every wheel
    // notch.
    if (this.readTextOpen) {
      this.readTextOpen = false;
      this.readTextLayer.visible = false;
    }
    const now = performance.now();
    this.timerStartedAt.set(10, now);
    this.timerStartedAt.set(11, now);
    this.timerStartedAt.set(delta < 0 ? 12 : 13, now);
    // Seed the scroll offset only for external LR2 skins. The default select chrome is also mounted on `listLayer`, so
    // offsetting that layer would scroll the entire screen. In that path, cursor movement simply changes the active row.
    if (this.options.skin && this.options.skin.barLayout.slots.length > 0) {
      const slotHeight = this.estimateSlotHeight();
      this.listScrollOffset += delta * slotHeight;
    } else {
      this.listScrollOffset = 0;
    }
    // LR2 system effect — `Sound/lr2/scratch.wav` fires on every bar move regardless of direction. Fire-and-forget; the
    // one-shot decode caches after the first use so a fast wheel-scroll doesn't thrash the audio decoder.
    void this.playOneShotSound('cursor-move');
    // Re-arm the chart preview against the (potentially) new focused song. The engine owns the focus-settle delay, so a
    // fast scroll past dozens of bars only ever schedules one start once the cursor finally rests.
    this.refreshChartPreview();
  }

  /**
   * Drills into `folder`: pushes onto the browse stack, resets the cursor to the top of the folder's contents, animates
   * the bar slide as a single down-step, and fires the LR2 folder-open cue (`Sound/lr2/f-open.wav`).
   *
   * Three call sites use this — keyboard Enter, skin-mode click, fallback-row click — so factoring it here keeps their
   * semantics identical.
   */
  private enterFolder(folder: BrowserFolderNode): void {
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
   * `browseStack.length === 0`). Fires the LR2 folder-close cue (`Sound/lr2/f-close.wav`).
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
  private readonly isPanelOpen = (panel: number): boolean => {
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
  private togglePanel(which: number): void {
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
    // LR2 system effects — `Sound/lr2/o-open.wav` / `o-close.wav`. Fire-and-forget; the cached buffer makes rapid
    // toggles cheap. Use the open cue for "swap to another panel" too (the previous panel's silent close is implicit;
    // firing both cues at once would just clip).
    void this.playOneShotSound(opening ? 'option-open' : 'option-close');
    this.render();
  }

  /**
   * Estimates the vertical pitch between adjacent bar slots — used to scale `listScrollOffset` so a 1-step cursor move
   * produces a 1-slot worth of visual slide. Picks the most-occupied y-delta between adjacent off-slot rectangles since
   * LR2 default skins tend to have one "center" slot at a different y than the uniformly-spaced off-center slots; the
   * median of pairwise deltas excludes that outlier.
   */
  private estimateSlotHeight(): number {
    const slots = this.options.skin?.barLayout.slots ?? [];
    const ys: number[] = [];
    for (const slot of slots) {
      const dst = slot.off ?? slot.on;
      if (dst) ys.push(dst.y);
    }
    ys.sort((left, right) => left - right);
    if (ys.length < 2) return 30;
    const deltas: number[] = [];
    for (let index = 1; index < ys.length; index += 1) {
      const dy = Math.abs(ys[index]! - ys[index - 1]!);
      if (dy > 0) deltas.push(dy);
    }
    if (deltas.length === 0) return 30;
    deltas.sort((left, right) => left - right);
    return deltas[Math.floor(deltas.length / 2)]!;
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
    const skin = this.options.skin;
    if (skin && skin.barLayout.slots.length > 0) {
      this.perf.time('render', () => this.render());
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
      this.skinTextures.dispose();
      this.chartGraphicTextures.dispose();
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
   * Swap the active LR2 skin without disposing the underlying `Application`. Re-runs the asset preload for the new skin
   * and re-renders. Pass `undefined` to fall back to the built-in UI.
   *
   * Hosts use this instead of disposing+re-creating the view, which historically tripped the PixiJS Devtools extension
   * on the second `Application.init` (`Cannot read properties of null (reading 'batch')`).
   */
  public setSkin(skin: Lr2Skin | undefined): void {
    this.options = { ...this.options, skin };
    // Drop the previous skin's textures — `prepareSkinTextures` will populate fresh ones for the new skin, and the
    // chart-graphic (BACKBMP / BANNER / STAGEFILE) cache stays valid since it's keyed by song id, not by skin.
    this.skinTextures.clear();
    this.bitmapFonts = new Map();
    // Invalidate the precomputed sorted chrome entry list — `ensureSortedChromeEntries` keys on reference identity, so
    // dropping the cached ref forces a rebuild against the new skin on the next render.
    this.sortedChromeSkinRef = undefined;
    this.sortedChromeEntries = [];
    if (skin && skin.barLayout.slots.length > 0) {
      void this.prepareSkinTextures(skin);
      void this.prepareBitmapFonts(skin);
    }
    this.render();
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
  private currentEntries(): BrowserBrowseEntry[] {
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
    source.connect(this.selectBgmGain ?? audioContext.destination);
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
    gain.connect(audioContext.destination);
    this.selectBgmContext = audioContext;
    this.selectBgmGain = gain;
    // System-effect bus — sibling of `selectBgmGain`, routed directly to destination so the preview-start BGM duck
    // (which zeros `selectBgmGain.gain`) doesn't also silence cursor / folder / option cues.
    const fxGain = audioContext.createGain();
    fxGain.gain.value = 1;
    fxGain.connect(audioContext.destination);
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
    gain.connect(audioContext.destination);
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
  private refreshChartPreview(): void {
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
  private focusedSong(): BrowserSongEntry | undefined {
    const entry = this.currentEntries()[this.selectedIndex];
    return entry?.kind === 'song' ? entry.song : undefined;
  }

  /**
   * Renders a centered hint over the skin layer when no songs are loaded so the user understands the empty bar list
   * isn't a bug. Drawn straight onto `skinLayer` — same coordinate space as the static frame — so it scales with the
   * rest of the skin.
   */
  private renderEmptyStateHint(): void {
    const skin = this.options.skin;
    if (!skin) return;
    const text = new Text({
      text: 'Drop a BMS folder or ZIP onto this window',
      style: new TextStyle({
        fill: TEXT,
        fontSize: 16,
        fontWeight: '700',
        fontFamily: LR2_TEXT_FALLBACK_FONT,
      }),
    });
    text.label = 'empty-state/hint';
    text.anchor.set(0.5, 0.5);
    text.position.set(skin.width / 2, skin.height / 2);
    this.skinLayer.addChild(text);
    if (this.collection.errors.length > 0) {
      const errorText = new Text({
        text: `${this.collection.errors.length} parse error${this.collection.errors.length === 1 ? '' : 's'} — see console`,
        style: new TextStyle({
          fill: MUTED,
          fontSize: 11,
          fontFamily: LR2_TEXT_FALLBACK_FONT,
        }),
      });
      errorText.label = 'empty-state/errors';
      errorText.anchor.set(0.5, 0);
      errorText.position.set(skin.width / 2, skin.height / 2 + 18);
      this.skinLayer.addChild(errorText);
    }
  }

  /**
   * Pre-loads every image referenced by the skin's `#IMAGE` table and its `#SRC_BAR_BODY` definitions. Loads happen in
   * parallel; the render pass is non-blocking and just skips bars whose texture isn't ready yet (we re-render after
   * each load resolves).
   */
  private async prepareSkinTextures(skin: Lr2Skin): Promise<void> {
    const loaded = await this.skinTextures.preload(
      skin,
      collectSelectSkinTexturePaths(skin),
      () => !this.disposed && this.options.skin === skin,
    );
    if (loaded) {
      this.render();
    }
  }

  /**
   * Loads `#LR2FONT` payloads for the supplied skin in parallel with `prepareSkinTextures`. Bails out cleanly if the
   * skin declares no fonts or if the user navigates away mid-load (`this.options.skin !== skin`). Fonts that fail to
   * decode (encrypted DXA, missing image, etc.) are simply skipped — the system-font fallback renders for those
   * indices.
   */
  private async prepareBitmapFonts(skin: Lr2Skin): Promise<void> {
    if (skin.lr2FontPaths.length === 0) return;
    const loaded = await loadSkinBitmapFonts(skin.lr2FontPaths, skin.files);
    if (this.disposed || this.options.skin !== skin) return;
    this.bitmapFonts = loaded;
    this.render();
  }

  /**
   * Tracks the pointer in design-space coordinates so `#SRC_ONMOUSE` hit-tests and the `#SRC_MOUSECURSOR` follow can
   * read from a single source of truth. The math mirrors `handlePointerDown` — undo the viewport scale & offset to land
   * in skin design pixels.
   */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.visible) return;
    const skin = this.options.skin;
    const useSkin = skin !== undefined && skin.barLayout.slots.length > 0;
    const designWidth = useSkin ? skin!.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = useSkin ? skin!.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
    this.mouseX = (event.offsetX - viewport.x) / viewport.scale;
    this.mouseY = (event.offsetY - viewport.y) / viewport.scale;
  };

  private readonly handlePointerLeave = (): void => {
    this.mouseX = -1;
    this.mouseY = -1;
  };

  /**
   * Wheel-scroll → cursor move. `deltaY > 0` (wheel down) advances to the next entry; `deltaY < 0` (wheel up) rewinds.
   * Multiple notches per event (`deltaMode` lines / pages) are clamped to one cursor step so a fast trackpad flick
   * doesn't send the cursor flying past dozens of entries — `noteCursorChange` only animates one slot worth of slide
   * and large jumps would make the smooth-scroll look broken.
   *
   * Wraps at the list ends, matching the keyboard navigation. Skipped while hidden (gameplay on top) so a wheel event
   * over the canvas doesn't navigate the select view in the background.
   */
  /**
   * Hit-tests interactive skin elements at the click point and dispatches per-element actions. Returns `true` when a
   * hit was consumed so the bar-list pointerdown branch doesn't also fire.
   *
   * Currently handles:
   *
   * - `#SRC_BUTTON` (`click = 1`) — AUTOPLAY (`type = 16`) is wired to `onSongAutoPlay` for the focused song. Other
   *   button types are recognized but currently no-op (panel / filter / sort buttons land here for future wiring).
   * - `#SRC_TEXT` (`edit = 1`, `st = 30`) — fires `onSearchActivate` so the host can focus a DOM `<input>` overlay.
   *
   * Buttons / texts are only considered when their DST passes the standard visibility / panel gate; we re-use
   * `evaluateElementDst` to honor keyframe interpolation (so a click during a slide-in animation hits the rectangle
   * the user actually sees, not a static endpoint).
   */
  private handleSkinHitTest(skin: Lr2Skin, virtualX: number, virtualY: number): boolean {
    const ops = computeSelectOps(
      this.focusedSong(),
      this.panelStates,
      this.playOptions,
      skin.customOptions,
      this.collection,
    );
    for (const button of skin.buttons) {
      if (button.click !== 1) continue;
      if (!this.isPanelOpen(button.panel)) continue;
      const dst = this.evaluateElementDst(button);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      if (!containsPoint(dst, virtualX, virtualY)) continue;
      this.dispatchButtonClick(button);
      return true;
    }
    for (const text of skin.texts) {
      if (text.st !== 30) continue; // 30 = search word
      // We deliberately DON'T require `text.edit === 1` here. The LR2 default theme paints the search box with a
      // `#SRC_TEXT st=30` chrome but routes the actual edit affordance through the skin's surrounding background sprite
      // (no `edit` flag on the text itself), so the strict `edit === 1` filter previously made the search- word area
      // look interactive without actually firing `onSearchActivate`. Loosening to "any st=30 text" catches the LR2
      // default plus every theme that authors a search box more conventionally; the host's `onSearchActivate` is
      // idempotent (it just focuses the overlay input), so a stray click on a non-editable search readout is harmless.
      if (!this.isPanelOpen(text.panel)) continue;
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      if (!containsPoint(dst, virtualX, virtualY)) continue;
      this.options.onSearchActivate?.();
      return true;
    }
    if (
      isInsideLr2DefaultSearchBox({
        width: skin.width,
        height: skin.height,
        x: virtualX,
        y: virtualY,
      })
    ) {
      this.options.onSearchActivate?.();
      return true;
    }
    return false;
  }

  /**
   * Routes a clicked `#SRC_BUTTON` to the matching action. The button-type table comes from `docs/LR2SkinHelp.md` lines
   * 5901+; we currently honor:
   *
   * - **15** — start play (treat as Enter on the focused song)
   * - **16** — start autoplay (`onSongAutoPlay`)
   * - **17** — readtext (no host hook yet; fall through to play)
   * - **19** — replay (no replay system yet; no-op)
   *
   * Other types are no-ops for now. Filter / sort / panel buttons (types 1..12) land here too once their state machines
   * exist.
   */
  private dispatchButtonClick(button: Lr2ButtonElement): void {
    const type = button.type;
    // Panel-toggle buttons (LR2 button_type 1..9). Don't require a focused song — the LR2 default skin's "OPTION"
    // launcher is always clickable, even before any chart is selected.
    if (type >= 1 && type <= 9) {
      this.togglePanel(type);
      return;
    }
    // HS-1P / HS-2P (button_type 57 / 58). Spec: "numeric-change function only". The `plusOnly` field tells us the click direction: - `1` →
    // this button raises HS by one step - `-1` → this button lowers HS by one step - `0` → ambiguous; treat left-click
    // as +step (right-click could be wired to -step in a future pass, but we don't track button affinities yet)
    if (type === 57 || type === 58) {
      const direction = button.plusOnly === -1 ? -1 : 1;
      this.adjustHiSpeed(direction);
      return;
    }
    // BGA on/off/autoplay-only (button_type 72). Cycles through {@link BGA_CYCLE} on each click.
    if (type === 72) {
      this.cyclePlayOption('bga', BGA_CYCLE);
      return;
    }
    // BGA size NORMAL/EXTEND (button_type 73).
    if (type === 73) {
      this.cyclePlayOption('bgaSize', BGA_SIZE_CYCLE);
      return;
    }
    // SCOREGRAPH on/off (button_type 70).
    if (type === 70) {
      this.cyclePlayOption('scoreGraph', BOOLEAN_CYCLE);
      return;
    }
    // Difficulty filter cycle (button_type 10).
    if (type === 10) {
      this.cyclePlayOption('difficultyFilter', DIFFICULTY_FILTER_CYCLE);
      this.snapCursorAfterFilterChange();
      return;
    }
    // Difficulty filter direct-set (button_type 91..96).
    const directDifficulty = DIFFICULTY_FILTER_BY_DIRECT_BUTTON[type];
    if (directDifficulty !== undefined) {
      this.setPlayOption('difficultyFilter', directDifficulty);
      this.snapCursorAfterFilterChange();
      return;
    }
    // Keymode filter cycle (button_type 11). Cycling re-filters the bar list; snap the cursor to the top so the user
    // lands on a visible entry immediately.
    if (type === 11) {
      this.cyclePlayOption('keysFilter', KEYS_FILTER_CYCLE);
      this.snapCursorAfterFilterChange();
      return;
    }
    // Sort cycle (button_type 12). Reorders the bar list; snap to the top so the cursor doesn't end up pointing at an
    // entry that just slid past on the rail.
    if (type === 12) {
      this.cyclePlayOption('sort', SORT_CYCLE);
      this.snapCursorAfterFilterChange();
      return;
    }
    // HS-FIX cycle (button_type 55). Pure play-option setting — the value is applied at gameplay-mount time so the
    // running select view doesn't need to react beyond updating the panel button cell.
    if (type === 55) {
      this.cyclePlayOption('hsFix', HS_FIX_CYCLE);
      return;
    }
    // HIDDEN/SUDDEN effect cycle — split per side (button_type 50 = 1P, 51 = 2P). Each side cycles independently so a
    // player can run e.g. HIDDEN on 1P + OFF on 2P, matching the LR2 panel UI which exposes a separate cell for each
    // side.
    if (type === 50) {
      this.cyclePlayOption('hiddenSudden1P', HIDDEN_SUDDEN_CYCLE);
      return;
    }
    if (type === 51) {
      this.cyclePlayOption('hiddenSudden2P', HIDDEN_SUDDEN_CYCLE);
      return;
    }
    // LANE COVER (shutter) ON / OFF toggle (button_type 46). Per LR2's `button.txt`: type 46 is "shutter" with no declared
    // cycle values — it's a binary toggle. The height (slider type 4 / 5) is preserved across toggles via
    // `playOptions.shutter`.
    if (type === 46) {
      this.cyclePlayOption('laneCover', BOOLEAN_CYCLE);
      return;
    }
    // Autoscratch 1P / 2P toggle (button_type 44 / 45). Each side stays independent — DP charts can have one side
    // auto-scratching while the other is fully manual.
    if (type === 44) {
      this.cyclePlayOption('autoScratch1P', BOOLEAN_CYCLE);
      return;
    }
    if (type === 45) {
      this.cyclePlayOption('autoScratch2P', BOOLEAN_CYCLE);
      return;
    }
    // DP FLIP toggle (button_type 54). Pure gameplay setting — the select view just tracks the value for the gameplay
    // launch hand-off.
    if (type === 54) {
      this.cyclePlayOption('dpFlip', BOOLEAN_CYCLE);
      return;
    }
    // Note arrangement RANDOM cycle (button_type 42 = 1P, 43 = 2P).
    if (type === 42) {
      this.cyclePlayOption('random1P', RANDOM_CYCLE);
      return;
    }
    if (type === 43) {
      this.cyclePlayOption('random2P', RANDOM_CYCLE);
      return;
    }
    // Gauge type cycle (button_type 40 = 1P, 41 = 2P).
    if (type === 40) {
      this.cyclePlayOption('gauge1P', GAUGE_CYCLE);
      return;
    }
    if (type === 41) {
      this.cyclePlayOption('gauge2P', GAUGE_CYCLE);
      return;
    }
    const focused = this.focusedSong();
    if (!focused) return;
    if (type === 15) {
      this.options.onSongSelected?.(focused);
    } else if (type === 17) {
      this.toggleReadText(focused);
    } else if (type === 16) {
      // AUTOPLAY: prefer the dedicated callback when supplied, otherwise fall through to the regular start path so the
      // button isn't a dead end on hosts that haven't wired it.
      if (this.options.onSongAutoPlay) {
        this.options.onSongAutoPlay(focused);
      } else {
        this.options.onSongSelected?.(focused);
      }
    }
    // Types 17 / 19 / 13 / 14 / etc. — readtext / replay / config / skin-select. Not yet implemented; intentionally
    // silent so a click doesn't trigger the wrong action.
  }

  /**
   * Mutates `playOptions.hiSpeed` by ±0.1 (clamped to [{@link HISPEED_MIN}, {@link HISPEED_MAX}]) and notifies any
   * external observer through `onPlayOptionsChange`. Re-renders synchronously so the open panel reflects the new value
   * (the HS slider knob, the NUMBER readout, and any keyframed UI gated on op 10/11) without waiting for the idle rAF
   * tick.
   */
  /**
   * Toggles the READTEXT modal for the focused song. Looks for a `.txt` file in the song's directory and shows its
   * contents in a centered Pixi card. Closes on second click / Escape / cursor move to a different song.
   */
  private toggleReadText(song: BrowserSongEntry): void {
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

  private adjustHiSpeed(direction: 1 | -1): void {
    const next = clampHiSpeed(this.playOptions.hiSpeed + direction * HISPEED_STEP);
    if (next === this.playOptions.hiSpeed) return; // already at clamp
    this.playOptions = { ...this.playOptions, hiSpeed: next };
    this.options.onPlayOptionsChange?.({ ...this.playOptions });
    // LR2 system effect — `Sound/lr2/o-change.wav`. Fired on any option-value change inside an open panel (HS up/down,
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
  private cyclePlayOption<K extends keyof PixiPlayOptions>(key: K, cycle: readonly PixiPlayOptions[K][]): void {
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
  private setPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void {
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
  private snapCursorAfterFilterChange(): void {
    this.selectedIndex = 0;
    this.refreshChartPreview();
  }

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
    if (!this.visible) return;
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
    const skin = this.options.skin;
    const useSkin = skin !== undefined && skin.barLayout.slots.length > 0;
    const designWidth = useSkin ? skin!.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = useSkin ? skin!.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
    const virtualX = (event.offsetX - viewport.x) / viewport.scale;
    const virtualY = (event.offsetY - viewport.y) / viewport.scale;

    if (useSkin && skin) {
      // Hit-test interactive skin elements first — buttons, search input — before bars, since they often overlap the
      // bar-list area on the LR2 default skin (e.g. AUTOPLAY at y=319 sits adjacent to the song-info column).
      if (this.handleSkinHitTest(skin, virtualX, virtualY)) {
        return;
      }
      // Skin layout: hit-test each available slot's BAR_BODY rect and jump the selection so the clicked slot becomes
      // the center. Any slot click both moves the cursor (if needed) AND triggers the selection action — earlier the
      // click on a non-center slot only moved the cursor and required a second click on the center slot to actually
      // pick the song. The 1-click flow is what mouse users expect; keyboard navigation still uses the 2-step "land on
      // cursor → press Enter" model.
      const center = clampSlot(skin.barLayout.center, skin.barLayout.slots.length);
      const available = skin.barLayout.available > 0 ? skin.barLayout.available : skin.barLayout.slots.length;
      const slots = skin.barLayout.slots.slice(0, available);
      const entries = this.currentEntries();
      for (const slot of slots) {
        const dst = slot.off ?? slot.on;
        if (!dst) continue;
        if (containsPoint(dst, virtualX, virtualY)) {
          const offset = slot.index - center;
          const target = wrapIndex(this.selectedIndex + offset, entries.length);
          if (target === undefined) {
            return;
          }
          if (target !== this.selectedIndex) {
            this.noteCursorChange(offset);
            this.selectedIndex = target;
            this.render();
          }
          const entry = entries[target];
          if (!entry) return;
          if (entry.kind === 'folder') {
            this.enterFolder(entry.folder);
          } else {
            this.options.onSongSelected?.(entry.song);
          }
          return;
        }
      }
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
    const fallbackEntries = this.currentEntries();
    if (fallbackEntries.length === 0) {
      return;
    }
    if (!isInsideDefaultSelectList(virtualX, virtualY, designHeight)) {
      return;
    }
    const entryIndex = defaultSelectEntryIndexAt(virtualY, this.selectedIndex, fallbackEntries.length, designHeight);
    if (entryIndex === undefined) {
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
      this.options.onSongSelected?.(entry.song);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
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
        this.options.onSongSelected?.(entry.song);
      }
    } else if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'ArrowLeft') {
      // Pop one level up — Esc / Backspace / ← all back out of the current folder. No-op at the root so the user
      // doesn't get stuck on an "empty list" view by accident.
      if (!this.leaveFolder()) return;
      event.preventDefault();
    }
  };

  private render(): void {
    const screenWidth = this.app.screen.width || this.mountedContainer?.clientWidth || FALLBACK_DESIGN_WIDTH;
    const screenHeight = this.app.screen.height || this.mountedContainer?.clientHeight || FALLBACK_DESIGN_HEIGHT;
    // We only use the LR2 skin's frame + bars when it actually carries select-screen definitions (`#SRC_BAR_BODY` /
    // `#DST_BAR_BODY_*`). A play-only skin like `play_7.lr2skin` would otherwise paint its STAGE FAILED / gauge / etc.
    // graphics here because they're stored in the same `images` array — drop back to the built-in list when that's the
    // case.
    const skin = this.options.skin;
    const useSkin = skin !== undefined && skin.barLayout.slots.length > 0;
    const designWidth = useSkin ? skin!.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = useSkin ? skin!.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
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
    if (useSkin && this.listScrollOffset !== 0) {
      const decay = Math.exp(-dt / 80);
      this.listScrollOffset *= decay;
      if (Math.abs(this.listScrollOffset) < 0.5) {
        this.listScrollOffset = 0;
      }
    }
    this.listLayer.y = useSkin ? this.listScrollOffset : 0;

    if (useSkin && skin) {
      this.title.visible = false;
      this.hint.visible = false;
      // Compute the dynamic op set ONCE per render and thread it into both renderers. Putting this here (rather than
      // inside each `isDestinationVisible` call) lets us: 1. Reflect the focused song's chart features (LN, BPM change,
      // BACKBMP presence, …) onto static frame elements that LR2 skins gate with op 70..195. 2. Avoid recomputing the
      // same `Set` per element.
      const ops = this.perf.time('computeOps', () =>
        computeSelectOps(this.focusedSong(), this.panelStates, this.playOptions, skin.customOptions, this.collection),
      );
      this.perf.time('renderSkinFrame', () => this.renderSkinFrame(skin, ops));
      this.perf.time('renderSkinBars', () => this.renderSkinBars(skin, ops));
      // Empty-state hint — shown over the skin when nothing was loaded, so the user understands they need to drop
      // content.
      if (this.collection.songs.length === 0) {
        this.renderEmptyStateHint();
      }
      this.renderReadTextOverlay(designWidth, designHeight);
      return;
    }

    // Default-family chrome paints only live library / focused-chart data, so the legacy `this.title` / `this.hint`
    // overlays are hidden; the host-level drop overlay remains responsible for the empty-library callout.
    const fallbackEntries = this.currentEntries();
    const now = performance.now();
    const sceneElapsedMs = now - this.sceneStartedAt;
    const { start, visibleRows } = resolveDefaultSelectVisibleWindow(
      this.selectedIndex,
      fallbackEntries.length,
      designHeight,
    );
    const selectedVisible = this.selectedIndex - start;
    const targetCursorY = DEFAULT_SELECT_LAYOUT.listTop + selectedVisible * DEFAULT_SELECT_LAYOUT.rowHeight;
    const cursorY = this.defaultSelectMotion.step(targetCursorY, now, cursorFollow);
    this.renderFallbackSelectChrome(designWidth, designHeight, fallbackEntries, sceneElapsedMs, now);
    this.title.visible = false;
    this.hint.visible = false;

    for (let visibleIndex = 0; visibleIndex < visibleRows; visibleIndex += 1) {
      const entryIndex = start + visibleIndex;
      const entry = fallbackEntries[entryIndex];
      if (!entry) {
        break;
      }
      renderDefaultSelectRow(
        this.listLayer,
        { entry, entryIndex, visibleIndex, active: entryIndex === this.selectedIndex },
        cursorY,
        sceneElapsedMs,
      );
    }
    paintDefaultSelectCover(this.listLayer, sceneElapsedMs, now, designWidth, designHeight);
    this.renderReadTextOverlay(designWidth, designHeight);
  }

  /**
   * Background chrome for the no-skin select scene. Unlike LR2 skin rendering, this path only displays live library and
   * focused-chart data; it does not paint fake score history or decorative buttons that are not wired in skinless mode.
   */
  private renderFallbackSelectChrome(
    designWidth: number,
    designHeight: number,
    entries: readonly BrowserBrowseEntry[],
    sceneElapsedMs: number,
    nowMs: number,
  ): void {
    const song = this.focusedSong();
    const playLevelNumber =
      song?.playLevel !== undefined ? Number.parseFloat(String(song.playLevel).replace(/^[^\d.]+/u, '')) : NaN;
    const currentFolder = this.browseStack[this.browseStack.length - 1];
    renderDefaultSelectChrome(this.listLayer, {
      designWidth,
      designHeight,
      categoryName: this.searchQuery ? `Search: ${this.searchQuery}` : (currentFolder?.label ?? 'Library'),
      songTitle: song?.title ?? 'No chart selected',
      songArtist: song?.artist || song?.subtitle || '',
      modeLabel: formatDefaultSelectModeLabel(song),
      playLevel: song?.playLevel !== undefined ? String(song.playLevel) : '-',
      playLevelNumber,
      songBpm: song?.bpm !== undefined ? String(Math.round(song.bpm)) : '-',
      fileLabel: song?.fileLabel ?? '',
      selectedPosition:
        entries.length > 0 ? `${Math.min(this.selectedIndex + 1, entries.length)} / ${entries.length}` : '0 / 0',
      searchQuery: this.searchQuery,
      shownCount: entries.length,
      libraryCount: this.collection.songs.length,
      sceneElapsedMs,
      nowMs,
      cursorY: 0,
    });
    const launchFocused = (autoPlay: boolean): void => {
      const focused = this.focusedSong();
      if (!focused) return;
      if (autoPlay) {
        if (this.options.onSongAutoPlay) this.options.onSongAutoPlay(focused);
        else this.options.onSongSelected?.(focused);
        return;
      }
      this.options.onSongSelected?.(focused);
    };
    attachDefaultSelectHits(this.listLayer, {
      onPlay: () => launchFocused(false),
      onAuto: () => launchFocused(true),
      onSearch: () => this.options.onSearchActivate?.(),
    });
  }

  /**
   * Returns the per-frame interpolated DST for an element with a keyframe sequence. For static elements (single
   * keyframe or none) this is a no-op that returns `element.destination`.
   *
   * Only timer 0 (scene main) is currently driven — other timers resolve to elapsed=0, which yields the first keyframe.
   * As we drive more timers (timer 11 = song change for focus-bar pulse, etc.), this is the single integration point.
   */
  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    return evaluateElementDestination(element, (timer) => this.elapsedSinceTimer(timer));
  }

  /**
   * Returns the elapsed milliseconds since `timer` started, or 0 when the timer isn't currently driven. Reads
   * `timerStartedAt` for any timer the host has fired (0 / 11 at mount; 10 / 11 / 12 / 13 on cursor moves). Timer 1 is
   * computed from `#STARTINPUT` lazily so we don't need a setTimeout.
   */
  private elapsedSinceTimer(timer: number): number {
    if (timer === 1) {
      const startInput = this.options.skin?.timing.startInput ?? 0;
      const fireAt = this.sceneStartedAt + startInput;
      return Math.max(0, performance.now() - fireAt);
    }
    const startedAt = this.timerStartedAt.get(timer);
    if (startedAt === undefined) {
      return 0;
    }
    return Math.max(0, performance.now() - startedAt);
  }

  /**
   * Returns whether `timer` is currently active (i.e. has fired and is producing meaningful elapsed-time output). Used
   * by `isDestinationVisible` so DST elements anchored to a not-yet-fired timer (e.g. an idle panel-open animation)
   * stay hidden.
   *
   * Defined as an arrow-property so callers can pass it through to the free `isDestinationVisible` helper without
   * losing `this`.
   */
  private readonly timerActive = (timer: number): boolean => {
    if (timer === 0) return true;
    if (timer === 1) {
      const startInput = this.options.skin?.timing.startInput ?? 0;
      return performance.now() - this.sceneStartedAt >= startInput;
    }
    // Song-list timers 10..13 — active once we've recorded a start (i.e. the cursor moved at least once or scene-mount
    // seeded timer 11). The keyframe interpolator clamps past the final frame, so leaving them "active" forever is
    // fine.
    if (timer >= 10 && timer <= 13) {
      return this.timerStartedAt.has(timer);
    }
    // Panel-open timers 21..29 — active iff that panel is currently open. LR2 spec: the timer is OFF once the panel closes, so the timer
    // implicitly stops when `togglePanel` clears the state, even if the seed timestamp is left in `timerStartedAt`.
    if (timer >= 21 && timer <= 29) {
      const which = timer - 20;
      return this.panelStates.has(which);
    }
    // Panel-close timers 31..39 — active once seeded by `togglePanel`. The close-anim keyframes clamp at their final
    // frame, so leaving it "active" past the animation is harmless; reopening the same panel re-deletes this entry to
    // prevent a stale seed from triggering the close anim again.
    if (timer >= 31 && timer <= 39) {
      return this.timerStartedAt.has(timer);
    }
    // Play timers (40+) etc. stay inactive on the select scene.
    return false;
  };

  /**
   * Renders the skin's static `#IMAGE` decorations (background, frame panels, banner area, etc.) plus the song-info
   * NUMBER / TEXT panels that depend on the currently-selected song. Op-gated against `ops` (built by
   * `computeSelectOps` so per-song flags affect the frame).
   */
  /**
   * Picks the right scene-graph layer for a chrome element based on its CSV-stream declaration order vs the bar
   * layout's. The routing rule mirrors LR2's "later declarations paint on top": elements declared after `#SRC_BAR_BODY`
   * go to `skinForegroundLayer` (drawn on top of the song-list bars); everything else stays on `skinLayer` behind the
   * bars.
   *
   * Falls back to `skinLayer` for skins without a bar list (no `barLayout.declarationOrder`) — every chrome element is
   * effectively "before bars" because there are no bars.
   */
  private pickChromeLayer(declarationOrder: number): Container {
    const barOrder = this.options.skin?.barLayout.declarationOrder;
    if (barOrder !== undefined && declarationOrder > barOrder) {
      return this.skinForegroundLayer;
    }
    return this.skinLayer;
  }

  /**
   * Returns the cached, declaration-order-sorted entry list for `skin`. Rebuilds on the first call after a skin swap
   * (detected by reference identity against {@link sortedChromeSkinRef}) — the LR2 skin shape is immutable per
   * `setSkin`, so reference equality is a sufficient invalidation key.
   *
   * The build merges every chrome-element kind into one array, records each entry's pre-resolved layer choice via
   * {@link pickChromeLayer}, and stable-sorts by `declarationOrder` so the final paint order on each Pixi container
   * matches the CSV's left-to-right declaration sequence.
   */
  private ensureSortedChromeEntries(skin: Lr2Skin): readonly SortedSelectChromeEntry[] {
    if (this.sortedChromeSkinRef === skin) {
      return this.sortedChromeEntries;
    }
    const barOrder = skin.barLayout.declarationOrder;
    const isForeground = (declarationOrder: number): boolean => barOrder !== undefined && declarationOrder > barOrder;
    const entries: SortedSelectChromeEntry[] = [];
    for (const element of skin.images) {
      entries.push({
        kind: 'image',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.numbers) {
      entries.push({
        kind: 'number',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.texts) {
      entries.push({
        kind: 'text',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.buttons) {
      entries.push({
        kind: 'button',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.onMouseElements) {
      entries.push({
        kind: 'onMouse',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.sliders) {
      entries.push({
        kind: 'slider',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    entries.sort((a, b) => a.order - b.order);
    this.sortedChromeEntries = entries;
    this.sortedChromeSkinRef = skin;
    return entries;
  }

  private renderSkinFrame(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    // Resolve the song the cursor is sitting on by going through the browse stack — `selectedIndex` indexes
    // `currentEntries()`, which is per-folder (or the folder list at root). Indexing `collection.songs` (the flat
    // global list) directly would surface metadata from a totally different folder once the cursor moved inside any
    // folder past the first, because the cursor index there refers to a position WITHIN that folder, not a global
    // offset.
    const focusedSong = this.focusedSong();

    // Walk the pre-sorted chrome entry list and dispatch by kind. The order, layer choice, and the entry list itself
    // are all static for a given skin (skin shape doesn't change between frames), so we cache the merged sorted list in
    // `ensureSortedChromeEntries` and reuse it every render. The previous implementation built a fresh `work[]` of
    // `{order, layer, paint: () => …}` closures per element per frame and then `.sort()`d it — for the LR2 default skin
    // that's ~hundreds of allocations + sort comparator calls per `requestAnimationFrame` tick.
    const entries = this.ensureSortedChromeEntries(skin);
    const skinTextures = this.skinTextures.asReadonlyMap();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      const layer = entry.layerIsForeground ? this.skinForegroundLayer : this.skinLayer;
      switch (entry.kind) {
        case 'image': {
          // Visibility uses the interpolated DST so an alpha=0 keyframe still keeps the element technically visible —
          // only the per-DST op gating (and timer activity) controls hidden vs shown.
          if (!isDestinationVisible(this.evaluateElementDst(entry.element), ops, this.timerActive)) break;
          const sprite = this.makeStaticImageSprite(entry.element);
          if (sprite) layer.addChild(sprite);
          break;
        }
        case 'number': {
          // Song-info NUMBER panels: BPM, total notes, play level. We resolve a small whitelist of LR2 number ids
          // relevant to the select view — the gameplay-only ids (score, gauge, judges, …) leave their slots blank when
          // shown here, which matches LR2's behavior off-stage.
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          const value = resolveSelectNumber(entry.element.source.num, focusedSong, this.playOptions);
          if (value === undefined) break;
          renderNumberElement(containerSpriteSink(layer), entry.element, value, skinTextures, dst);
          break;
        }
        case 'text': {
          // TEXT panels — title / artist / genre / level label / etc. The `panel` field hides labels scoped to closed
          // option panels.
          if (!this.isPanelOpen(entry.element.panel)) break;
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          const value = resolveSelectText(entry.element.st, focusedSong, this.playOptions);
          if (value === undefined || value.length === 0) break;
          layer.addChild(
            makeLr2TextSprite(value, entry.element, dst, {
              bitmapFonts: this.bitmapFonts,
              systemFontSizes: skin.systemFontSizes,
            }),
          );
          break;
        }
        case 'button': {
          // BUTTON panels — sort / filter / panel-toggle / play / replay / option buttons etc. We render the cell that
          // matches the button's current state; click handling lands separately.
          if (!this.isPanelOpen(entry.element.panel)) break;
          if (!isDestinationVisible(this.evaluateElementDst(entry.element), ops, this.timerActive)) break;
          this.renderButtonElement(entry.element, layer);
          break;
        }
        case 'onMouse': {
          // ONMOUSE — hover overlays. Drawn on top of buttons / images when the pointer is inside the SRC's hit-test
          // rect (relative to the DST top-left).
          if (!this.isPanelOpen(entry.element.panel)) break;
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          if (!this.isPointerInHitRect(dst, entry.element)) break;
          const sprite = this.makeSlicedSprite(entry.element.source, dst, 'onmouse');
          if (sprite) layer.addChild(sprite);
          break;
        }
        case 'slider': {
          // SLIDER — runtime-positioned indicator knobs.
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          const value = this.resolveSelectSliderValue(entry.element.type);
          if (value === undefined) break;
          const sprite = makeLr2SliderSprite(entry.element, dst, value, skinTextures);
          if (sprite) layer.addChild(sprite);
          break;
        }
      }
    }

    // MOUSECURSOR — replaces the system cursor with the skin's sprite. Always lands on the foreground layer regardless
    // of its CSV declaration order: a custom cursor that sat behind the bar list would defeat the point of having a
    // custom cursor in the first place.
    if (this.mouseX >= 0 && this.mouseY >= 0) {
      for (const cursor of skin.mouseCursors) {
        const dst = this.evaluateElementDst(cursor);
        if (!isDestinationVisible(dst, ops, this.timerActive)) {
          continue;
        }
        const sprite = this.makeMouseCursorSprite(cursor, dst);
        if (sprite) {
          this.skinForegroundLayer.addChild(sprite);
        }
      }
    }
  }

  /**
   * Returns a 0..1 value for an `#SRC_SLIDER` element on the select screen, or `undefined` when the type isn't
   * meaningful here (e.g. play-time hi-speed / shutter sliders that LR2 still allows in select skins as decoration).
   *
   * The only slider we currently drive is `type=1` ("song-select position") — the orange / teal scroll-position bar that lives
   * to the right of the bar list. Its value is the **visual** cursor index normalized against the visible entry count,
   * where "visual" means we lag the discrete selectedIndex by the active smooth-scroll offset so the knob slides in
   * lockstep with the bars (LR2 itself doesn't define slider easing in the skin format — `#SRC_SLIDER` / `#DST_SLIDER`
   * just specify rail geometry — so the smoothing has to come from the runtime).
   *
   * Convention: `listScrollOffset` is positive when the bars are visually still at their previous slot (e.g. right
   * after a `down` press the offset is `+slotHeight` and decays toward 0). The apparent cursor index is therefore
   * `selectedIndex - listScrollOffset / slotHeight`, which equals the previous index right at the press and converges
   * to the new index as the offset decays. A 1-entry list pins to 0.
   */
  private resolveSelectSliderValue(type: number): number | undefined {
    if (type === 1) {
      const entries = this.currentEntries();
      if (entries.length <= 1) return 0;
      const slotHeight = this.estimateSlotHeight();
      const visualIndex = slotHeight > 0 ? this.selectedIndex - this.listScrollOffset / slotHeight : this.selectedIndex;
      return Math.max(0, Math.min(1, visualIndex / (entries.length - 1)));
    }
    if (type === 2 || type === 3) {
      // HiSpeed 1P / 2P — both 1P and 2P sliders read the same global HS today (we don't model side-split HS yet). The
      // value is `(hiSpeed - HISPEED_MIN) / (HISPEED_MAX - HISPEED_MIN)` so the knob spans the rail proportionally to
      // the configured range.
      const span = HISPEED_MAX - HISPEED_MIN;
      if (span <= 0) return 0;
      const ratio = (this.playOptions.hiSpeed - HISPEED_MIN) / span;
      return Math.max(0, Math.min(1, ratio));
    }
    if (type === 4 || type === 5) {
      // Shutter 1P / 2P — both render the shared shutter coverage.
      return Math.max(0, Math.min(1, this.playOptions.shutter));
    }
    return undefined;
  }

  /**
   * Tests whether the current pointer position lies inside the `#SRC_ONMOUSE` hit-test rectangle. The hit rect is
   * anchored at the DST top-left with `(x2, y2)` as the offset, per LR2 spec.
   */
  private isPointerInHitRect(dst: Lr2DestinationRect, onMouse: Lr2OnMouseElement): boolean {
    if (this.mouseX < 0 || this.mouseY < 0) {
      return false;
    }
    const rectX = dst.x + onMouse.hitOffsetX;
    const rectY = dst.y + onMouse.hitOffsetY;
    const rectW = onMouse.hitWidth > 0 ? onMouse.hitWidth : (dst.w ?? 0);
    const rectH = onMouse.hitHeight > 0 ? onMouse.hitHeight : (dst.h ?? 0);
    return this.mouseX >= rectX && this.mouseX < rectX + rectW && this.mouseY >= rectY && this.mouseY < rectY + rectH;
  }

  /**
   * Builds a sprite from a source rect + interpolated DST. Used by ONMOUSE rendering and the BAR_FLASH overlay.
   * Animation cells (`source.cycle > 0`) are picked via `pickAnimatedCell` so spinner / pulse sprites animate
   * correctly.
   */
  private makeSlicedSprite(source: Lr2ImageRect, dst: Lr2DestinationRect, label?: string): Sprite | undefined {
    const baseTexture = this.skinTextures.get(source.imagePath);
    if (!baseTexture) {
      return undefined;
    }
    const rect = normalizeRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    const elapsed = this.elapsedSinceTimer(source.timer);
    const cell = pickAnimatedCell(source, elapsed, dst.loop, {
      width: baseTexture.width,
      height: baseTexture.height,
    });
    if (cell.w <= 0 || cell.h <= 0) return undefined;
    const cropped = createCroppedTexture(baseTexture, cell);
    if (!cropped) return undefined;
    const sprite = new Sprite(cropped);
    sprite.label = label ?? `sliced[${source.imagePath}]`;
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Renders the skin's custom cursor at the live pointer position. The DST `(x, y)` is the offset from the actual mouse
   * (typically `(0, 0)` so the cursor's top-left tracks the pointer exactly).
   */
  private makeMouseCursorSprite(cursor: Lr2MouseCursorElement, dst: Lr2DestinationRect): Sprite | undefined {
    const baseTexture = this.skinTextures.get(cursor.source.imagePath);
    if (!baseTexture) {
      return undefined;
    }
    const rect = normalizeRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    const elapsed = this.elapsedSinceTimer(cursor.source.timer);
    const cell = pickAnimatedCell(cursor.source, elapsed, dst.loop, {
      width: baseTexture.width,
      height: baseTexture.height,
    });
    if (cell.w <= 0 || cell.h <= 0) return undefined;
    const cropped = createCroppedTexture(baseTexture, cell);
    if (!cropped) return undefined;
    const sprite = new Sprite(cropped);
    sprite.label = 'mouse-cursor';
    sprite.position.set(this.mouseX + rect.x, this.mouseY + rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Renders a single `#SRC_BUTTON` element by cropping its cell sheet to the active state index. Buttons are stateful
   * in LR2 (sort direction, current filter, panel open/close, …) but we don't yet persist any of that — so the cell
   * index defaults to 0 for every button type. Switching the displayed cell is a one-line change
   * (`resolveButtonState(button.type)`) once option state is live.
   */
  private renderButtonElement(button: Lr2ButtonElement, target: Container): void {
    const baseTexture = this.skinTextures.get(button.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const dst = this.evaluateElementDst(button);
    const rect = normalizeRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return;
    }
    // LR2 "no-graphic" button — when both `w` and `h` are 0 the skin author is declaring a clickable rect with no
    // visible body (the matching #SRC_TEXT label is what paints). The button may still carry non-zero `divx` / `divy`
    // to indicate state count (LANE COVER uses `divx=1, divy=2` for ON/OFF), so we key only on the zero source-rect
    // bounds. Without this short-circuit, our `w==0` fallback would treat the source as "use the full texture" and
    // render the entire skin atlas squashed into the small button rect.
    if (button.source.w === 0 && button.source.h === 0) {
      return;
    }
    const divx = Math.max(1, button.source.divx);
    const divy = Math.max(1, button.source.divy);
    const cellWidth = button.source.w > 0 ? button.source.w / divx : baseTexture.width / divx;
    const cellHeight = button.source.h > 0 ? button.source.h / divy : baseTexture.height / divy;
    if (cellWidth <= 0 || cellHeight <= 0) {
      return;
    }
    const stateIndex = resolveButtonStateIndex(button.type, divx * divy, this.playOptions);
    const cellX = stateIndex % divx;
    const cellY = Math.floor(stateIndex / divx);
    const cellTexture =
      createCroppedTexture(baseTexture, {
        x: button.source.x + cellWidth * cellX,
        y: button.source.y + cellHeight * cellY,
        w: cellWidth,
        h: cellHeight,
      }) ?? baseTexture;
    const sprite = new Sprite(cellTexture);
    sprite.label = `button[type=${button.type},state=${stateIndex}]`;
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    target.addChild(sprite);
  }

  /**
   * Populates the skin's `#DST_BAR_BODY_OFF` / `_ON` slots with songs from the current collection, with the
   * `selectedIndex` song landing at the `BAR_CENTER` slot. Slots outside `BAR_AVAILABLE` still render (LR2 spec: they
   * decorate the scroll edges) but no song is mapped to them.
   */
  private renderSkinBars(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    const layout = skin.barLayout;
    if (layout.slots.length === 0) {
      return;
    }
    const slotCount = layout.slots.length;
    const center = clampSlot(layout.center, slotCount);
    // Choose the OFF/ON state per slot — only the center slot uses ON.
    const entries = this.currentEntries();
    for (const slot of layout.slots) {
      const offset = slot.index - center;
      // Wrap so off-edge slots show entries from the opposite end. E.g. with 3 entries and a slot below the cursor's
      // "current+3" position, the slot displays `entries[0]` again — matching LR2's circular rail rendering.
      const targetIndex = wrapIndex(this.selectedIndex + offset, entries.length);
      const entry = targetIndex !== undefined ? entries[targetIndex] : undefined;
      const isCenter = slot.index === center;
      // Interpolate the slot's keyframe chain instead of pinning to the final keyframe. The skin typically anchors
      // `#DST_BAR_BODY` animations to timer 11 (song change), which we re-stamp on every cursor move via
      // `noteCursorChange`, so the bars slide into their new positions over the keyframe duration.
      const keyframes = isCenter && slot.onKeyframes.length > 0 ? slot.onKeyframes : slot.offKeyframes;
      const fallbackDst = isCenter && slot.on ? slot.on : (slot.off ?? slot.on);
      if (!fallbackDst) continue;
      const dst =
        keyframes.length > 1 ? evaluateKeyframes(keyframes, this.elapsedSinceTimer(fallbackDst.timer)) : fallbackDst;
      if (!isDestinationVisible(dst, ops, this.timerActive)) {
        continue;
      }
      const body = pickBarBody(layout.bodies, entry);
      if (body) {
        const texture = this.skinTextures.get(body.source.imagePath);
        if (texture) {
          const label = `bar-body[slot=${slot.index},kind=${body.kind}${isCenter ? ',center' : ''}]`;
          const sprite = this.makeBarBodySprite(texture, body.source, dst, label);
          if (sprite) {
            this.listLayer.addChild(sprite);
          }
        }
      }
      if (entry) {
        // BAR_TITLE DST x/y are RELATIVE to the bar's top-left (`bar.txt`: DST coordinates are specified relative to the bar's xy origin).
        this.drawBarTitleText(entry, dst, layout.title, skin);
      }
      // BAR_LEVEL: per-bar level number for SONG entries only. Folder entries don't carry a level so they leave the
      // slot blank.
      if (entry?.kind === 'song' && layout.levels.length > 0 && layout.levelDestination) {
        this.drawBarLevel(entry.song, dst, layout.levels, layout.levelDestination);
      }
      // BAR_FLASH: focused-bar overlay. DST is relative to the bar (like BAR_TITLE), so we add the bar's xy onto the
      // flash DST before drawing.
      if (isCenter && layout.flash) {
        this.drawBarFlash(layout.flash, dst);
      }
      // BAR_LAMP / BAR_RANK: skipped for now because we don't yet persist clear-history per song. Once a score record
      // exists, pick `layout.lamps[scoreLamp]` / `layout.ranks[scoreRank]` and render via the same offset-by-bar
      // formula as BAR_TITLE.
    }
  }

  /**
   * Renders the `#SRC_BAR_FLASH` overlay on the focused bar. The DST coordinates in the flash element are **relative**
   * to the focused bar's `BAR_BODY_ON` rect, mirroring how BAR_TITLE / BAR_LEVEL place themselves. We compose the
   * absolute DST and then delegate to `makeSlicedSprite` so any animation cycle / cell cycling is honored.
   */
  private drawBarFlash(flash: Lr2BarFlashElement, bar: Lr2DestinationRect): void {
    const flashDst = this.evaluateElementDst(flash);
    const absoluteDst: Lr2DestinationRect = {
      ...flashDst,
      x: bar.x + flashDst.x,
      y: bar.y + flashDst.y,
    };
    const sprite = this.makeSlicedSprite(flash.source, absoluteDst, 'bar-flash');
    if (sprite) {
      this.listLayer.addChild(sprite);
    }
  }

  /**
   * Renders the per-bar level number sprite for `song`. Picks the `#SRC_BAR_LEVEL` entry whose kind matches the chart's
   * `#DIFFICULTY` field (1=BEGINNER..5=INSANE), falling back to the "undefined" kind when no specific entry is
   * available. The DST offset is added on top of the bar's own xy because LR2 scopes BAR_LEVEL coordinates to the bar's
   * top-left.
   */
  private drawBarLevel(
    song: BrowserSongEntry,
    bar: Lr2DestinationRect,
    levels: ReadonlyArray<Lr2BarLevelSource>,
    levelDst: Lr2DestinationRect,
  ): void {
    const playLevel =
      typeof song.playLevel === 'number' ? song.playLevel : Number.parseInt(String(song.playLevel ?? ''), 10);
    if (!Number.isFinite(playLevel)) {
      return;
    }
    const kind = mapDifficultyToBarLevelKind(song.chart.metadata.difficulty);
    const level =
      levels.find((entry) => entry.kind === kind) ?? levels.find((entry) => entry.kind === 'undefined') ?? levels[0];
    if (!level) {
      return;
    }
    // Translate the relative DST into absolute coordinates on the bar.
    const absoluteDst: Lr2DestinationRect = {
      ...levelDst,
      x: bar.x + levelDst.x,
      y: bar.y + levelDst.y,
    };
    const fakeNumberElement: Lr2NumberElement = {
      source: level.source,
      destination: absoluteDst,
      keyframes: [absoluteDst],
      // Synthetic element built per-frame for digit rendering; never enters the pre/post-bar layer routing, so a `-1`
      // sentinel is fine here. The renderer pumps it directly through `renderNumberElement` rather than the chrome
      // dispatcher.
      declarationOrder: -1,
    };
    // Suppress leading zeros — `keta` on BAR_LEVEL means "max number of digits" (slot reservation for centering math),
    // NOT "force pad to that width". Without this flag a level of 7 would render as "07" inside a 2-digit field,
    // pushing the visible "7" half a field-width to the right and leaving a stray "0" at the left edge of the bar —
    // visibly offset from where the LR2 default skin places it. Centering math still uses the full field width so
    // single-digit numbers sit at the field's middle.
    renderNumberElement(
      containerSpriteSink(this.listLayer),
      fakeNumberElement,
      playLevel,
      this.skinTextures.asReadonlyMap(),
      absoluteDst,
      { suppressLeadingZeros: true },
    );
  }

  private makeStaticImageSprite(image: Lr2ImageElement) {
    return makeLr2StaticImageSprite(image, this.evaluateElementDst(image), {
      textures: this.skinTextures.asReadonlyMap(),
      elapsedSinceTimer: (timer) => this.elapsedSinceTimer(timer),
      resolveSpecialGraphicTexture: (path) => this.resolveSpecialGraphicTexture(path),
    });
  }

  /**
   * Returns the live texture bound to one of LR2's runtime-resolved graphic slots (BACKBMP / BANNER / STAGEFILE / black
   * / white). Triggers an async load on first miss, returning `undefined` until the asset is decoded; the next
   * `render()` tick will pick up the cached texture.
   */
  private resolveSpecialGraphicTexture(path: Lr2SpecialGraphic): Texture | undefined {
    const solidTexture = resolveSolidSpecialGraphicTexture(path);
    if (solidTexture) {
      return solidTexture;
    }
    const song = this.focusedSong();
    if (!song) {
      return undefined;
    }
    return this.chartGraphicTextures.resolve(this.collection, song, path, () => this.render());
  }

  private makeBarBodySprite(
    texture: Texture,
    source: Lr2ImageRect,
    destination: Lr2DestinationRect,
    label?: string,
  ): Sprite | undefined {
    const rect = normalizeRect(destination);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    // BAR_BODY may animate (glow rotation, focus pulse) via the source's `cycle` ms over its `divx * divy` cells. We
    // resolve the active cell here so the bar sprite changes frame over time when the skin defines an animation.
    const elapsed = this.elapsedSinceTimer(source.timer);
    const cell = pickAnimatedCell(source, elapsed, destination.loop);
    const cropped = createCroppedTexture(texture, cell) ?? texture;
    const sprite = new Sprite(cropped);
    sprite.label = label ?? 'bar-body';
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, destination);
    return sprite;
  }

  /**
   * Draws the song title at the `BAR_TITLE` destination (xy relative to the bar's top-left).
   *
   * When the skin defines `#SRC_BAR_TITLE` and the matching `#LR2FONT` payload has decoded, we route through
   * `makeLr2TextSprite` so the title renders with the skin's authored bitmap font (the LR2 default's 14 px pixel-art
   * face for the bar list, glyph-tinted per `#DST_BAR_TITLE`'s RGBA). Otherwise we fall back to a system-font `Text` —
   * either while fonts are still loading, or for skins that omit `#SRC_BAR_TITLE` entirely.
   *
   * No artist sub-line: LR2's bar list shows just the title (or folder name). Per-song artist / genre live in the
   * dedicated info panel populated by the skin's `#SRC_TEXT` slots — not the bar list itself.
   */
  private drawBarTitleText(
    entry: BrowserBrowseEntry,
    bar: Lr2DestinationRect,
    titleElement: Lr2BarTitleElement | undefined,
    skin: Lr2Skin,
  ): void {
    const titleRect = titleElement?.destination ?? { x: 12, y: 8, w: bar.w - 24, h: 20 };
    const x = bar.x + titleRect.x;
    const y = bar.y + titleRect.y;
    const w = Math.max(1, titleRect.w);
    const h = Math.max(1, titleRect.h);
    const primaryText = entry.kind === 'song' ? entry.song.title : entry.folder.label;
    if (titleElement) {
      // Build a synthetic `Lr2TextElement` carrying just the fields `makeLr2TextSprite` reads — font index, alignment
      // (BAR_TITLE has no LR2-spec alignment field, so left-anchor is the conventional rendering), and the absolute
      // `destination` on the bar's coordinate frame. Going through `makeLr2TextSprite` means the bitmap-font path
      // automatically engages once `#LR2FONT` payloads finish decoding, mirroring how the chrome-text path works.
      const synthetic: Lr2TextElement = {
        font: titleElement.font,
        // 0 = freeform string. The bar list never queries `st` for text resolution since we pass the value directly,
        // and `makeLr2BitmapTextSprite` only uses it for a debug label — any non-clashing value is fine.
        st: 0,
        alignment: 'left',
        edit: 0,
        panel: 0,
        destination: { ...titleElement.destination, x, y, w, h },
        keyframes: [],
        declarationOrder: 0,
      };
      const sprite = makeLr2TextSprite(primaryText, synthetic, synthetic.destination, {
        bitmapFonts: this.bitmapFonts,
        systemFontSizes: skin.systemFontSizes,
      });
      sprite.label = `bar-title[${entry.kind}=${primaryText}]`;
      this.listLayer.addChild(sprite);
      return;
    }
    // No `#SRC_BAR_TITLE` — fall back to a basic font-backed `Text`. LR2 default skins use pixel-art fonts (typically
    // 12 px tall) for BAR_TITLE; Pixi `Text` is taller pixel-for-pixel, so cap the font size
    // at 14 px and leave 2 px breathing room below `h`.
    const titleFontSize = clampFontSize(h - 2, 8, 14);
    // No `wordWrap` — LR2 spec auto-shrinks long titles horizontally rather than wrapping (`docs/LR2SkinHelp.md` line
    // 1343). The squeeze below mirrors that.
    const titleText = new Text({
      text: primaryText,
      style: new TextStyle({
        fill: TEXT,
        fontSize: titleFontSize,
        // A regular weight reads cleaner at small sizes than the heavy title face.
        fontWeight: '500',
        fontFamily: LR2_TEXT_FALLBACK_FONT,
        // Outlined text — LR2 reference skins bake a 1–2 px black outline into their bar-title bitmaps so titles
        // read cleanly against the colored BAR_BODY artwork. Match that by stroking the fallback.
        stroke: { color: 0x000000, width: 2, alignment: 0.5, join: 'round' },
      }),
    });
    titleText.label = `bar-title[${entry.kind}=${primaryText}]`;
    titleText.position.set(x, y);
    if (w > 0 && titleText.width > w) {
      titleText.scale.x = w / titleText.width;
    }
    this.listLayer.addChild(titleText);
  }
}

function clampSlot(value: number, slotCount: number): number {
  if (slotCount <= 0) return 0;
  return Math.min(slotCount - 1, Math.max(0, Math.trunc(value)));
}

/**
 * Maps any integer (including negatives or values past the end) into `[0, count)` by modular arithmetic. Returns
 * `undefined` when the list is empty so the caller can decide what to draw (or skip).
 *
 * Used by both the cursor → slot mapping and click hit-tests so the bar list behaves like a circular rail — scrolling
 * past the end wraps to the start, and slots above / below the cursor that would normally land in negative-index
 * territory show entries from the opposite end of the list instead of being blank.
 */
function wrapIndex(target: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  return ((target % count) + count) % count;
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

export interface Lr2DefaultSearchBoxHitTestInput {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Heuristic hit-test for the LR2 default theme's search box.
 *
 * The vanilla LR2 select skin draws the SEARCH chrome as a background `#SRC_IMAGE` plus an `#SRC_TEXT st=30` whose DST
 * rectangle hugs the value text rather than the whole box. Once the text is empty, the DST collapses to roughly zero
 * horizontal room, so the spec-driven text walk misses clicks on the chrome.
 *
 * To avoid hijacking custom layouts, the fallback is gated to the canonical 1280×720 LR2-default design size.
 */
export function isInsideLr2DefaultSearchBox(input: Lr2DefaultSearchBoxHitTestInput): boolean {
  if (input.width !== 1280 || input.height !== 720) return false;
  return input.x >= 0 && input.x <= 920 && input.y >= 540 && input.y <= 582;
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

function containsPoint(rect: Lr2DestinationRect, x: number, y: number): boolean {
  const r = normalizeRect(rect);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Picks the bar-body sprite definition for a slot. Maps the entry kind (`'song'` / `'folder'`) onto the matching
 * `#SRC_BAR_BODY` art, falling back to a `'song'` body when the skin doesn't define a folder variant, and finally the
 * first available body. Slots with no entry (i.e. out-of-range when the cursor is near the start / end of the list)
 * still get a body sprite so the empty slats keep rendering — that matches LR2's behavior where the rail draws even
 * past the end of the song list.
 */
function pickBarBody(
  bodies: ReadonlyArray<Lr2BarBodySource>,
  entry: BrowserBrowseEntry | undefined,
): Lr2BarBodySource | undefined {
  if (bodies.length === 0) {
    return undefined;
  }
  const kind: Lr2BarBodyKind = entry?.kind === 'folder' ? 'folder' : 'song';
  return bodies.find((body) => body.kind === kind) ?? bodies.find((body) => body.kind === 'song') ?? bodies[0];
}

/**
 * Inputs captured by {@link PixiSongSelectView.currentEntries}' memoization pass. Reference-equal `top` / `songs` is
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
 * Resolves an LR2 `#SRC_TEXT` source-type (`st`) onto a string from the currently-focused song. Mirrors
 * `scene/lr2/gameplay.ts`'s resolver but for the static select-screen subset. Returns `undefined` for st codes outside the
 * song-info range so the caller can skip painting. Codes 10..15 / 17..18 (single-digit) and 20..28 (double-digit) are
 * treated the same — LR2 uses the second range for "subtitle / sub-artist / etc." rendering on a separate layer, but
 * practically the value resolves identically.
 */
function resolveSelectText(
  st: number,
  song: BrowserSongEntry | undefined,
  playOptions: PixiPlayOptions = DEFAULT_PLAY_OPTIONS,
): string | undefined {
  // Slots that don't depend on a focused song.
  switch (st) {
    case 1:
      // Target / rival name. LR2 displays "NO TARGET" when no rival has been selected; we ship without rival/IR support
      // so this is the permanent value.
      return 'NO TARGET';
    case 2:
      // Player name. Placeholder until a profile system exists.
      return 'PLAYER';
    case 30:
      // Search box content / jukebox name. We don't model search yet, so return an empty string to keep the panel
      // rendering.
      return '';
    case 50: // skin name
      return 'LR2 SELECT';
    case 51: // skin author
      return '';
    // Option-panel labels (60..85). LR2 default skin renders the current option-state name as readable text inside each
    // panel-1 box (mirrors what HI-SPEED's NUMBER readout does for HiSpeed). We return the matching `playOptions` enum
    // string so `makeLr2TextSprite` paints it with the system font; without these, the underlying #SRC_TEXT slot stayed
    // empty and the only thing visible was an unrelated background image.
    case 60: {
      // Playstyle / keymode label — derived from the focused chart's lane usage. Matches the "5KEYS" / "7KEYS" /
      // "10KEYS" / "14KEYS" / "9KEYS" wording the LR2 default skin paints for the panel-1 PLAYSTYLE box.
      if (!song) return 'SINGLE';
      switch (resolveKeyModeOp(song)) {
        case 161:
          return '5KEYS';
        case 160:
          return '7KEYS';
        case 163:
          return '10KEYS';
        case 162:
          return '14KEYS';
        case 164:
          return '9KEYS';
        default:
          return 'SINGLE';
      }
    }
    case 61: // sort
      return playOptions.sort;
    case 62: // difficulty filter
      return playOptions.difficultyFilter;
    case 63: // random 1P
      return playOptions.random1P;
    case 64: // random 2P
      return playOptions.random2P;
    case 65: // gauge 1P
      return playOptions.gauge1P;
    case 66: // gauge 2P
      return playOptions.gauge2P;
    case 67: // assist 1P (autoscratch)
      return playOptions.autoScratch1P ? 'AUTOSCRATCH' : 'OFF';
    case 68: // assist 2P
      return playOptions.autoScratch2P ? 'AUTOSCRATCH' : 'OFF';
    case 69: // battle
      return 'OFF';
    case 70: // flip
      return playOptions.dpFlip ? 'ON' : 'OFF';
    case 71: // scoregraph
      return playOptions.scoreGraph ? 'ON' : 'OFF';
    case 72: // ghost
      return 'OFF';
    case 73: // LANE COVER (shutter)
      // LR2's SYSTEM OPTION row labels this slot "LANE COVER" and shows the binary ON / OFF state — the height
      // percentage belongs to the slider next to the value, not the value text itself. (We previously rendered a
      // percentage here, which made the row look like a numeric option instead of a toggle.)
      return playOptions.laneCover ? 'ON' : 'OFF';
    case 74: // scroll type
      return 'OFF';
    case 75: // bga size
      return playOptions.bgaSize;
    case 76: // bga
      return playOptions.bga === 'AUTOPLAY_ONLY' ? 'AUTOPLAY' : playOptions.bga;
    case 77: // color depth
      return '32 BIT';
    case 78: // vsync
      return 'ON';
    case 79: // screen mode
      return 'FULL';
    case 80: // judge auto-adjust
      return 'OFF';
    case 81: // replay save mode
      return 'OFF';
    case 82: // trial line 1
    case 83: // trial line 2
      return '';
    case 84: // effect 1P (HIDDEN / SUDDEN)
      return playOptions.hiddenSudden1P;
    case 85: // effect 2P
      return playOptions.hiddenSudden2P;
  }

  if (!song) {
    return undefined;
  }
  const subartists = song.chart.bmson.info?.subartists?.join(' / ');
  switch (st) {
    case 10:
    case 20:
      return song.title;
    case 11:
    case 21:
      return song.subtitle ?? '';
    case 12:
    case 22:
      return [song.title, song.subtitle].filter((value): value is string => Boolean(value)).join(' ');
    case 13:
    case 23:
      return song.genre ?? '';
    case 14:
    case 24:
      return song.artist ?? '';
    case 15:
    case 25:
      return subartists ?? '';
    case 16:
    case 26:
      return song.fileLabel;
    case 17:
    case 27:
      return song.playLevel?.toString() ?? '';
    case 18:
    case 28:
      return resolveDifficultyName(song.chart.metadata.difficulty);
    case 29:
      // Insane level — same source as playLevel for now, since we don't ship a separate insane-table
      // integration.
      return song.chart.metadata.difficulty === 5 ? (song.playLevel?.toString() ?? '') : '';
    default:
      return undefined;
  }
}

/**
 * Resolves an LR2 `#SRC_NUMBER` source-num onto a numeric value pulled from the focused song's metadata or static skin
 * state. Numbers map to the canonical slots in `docs/LR2SkinHelp.md` `# num list`:
 *
 * - **10..15** — play option values (HS, JUDGE TIMING, SUD+). Mostly placeholder until preferences persist.
 * - **20..26** — fps / date / time. Only `20=fps` actively varies.
 * - **30..41** — lifetime player stats (TOTAL PLAY/CLEAR/FAIL/judges, running combo, trial level). All `0` until
 *   persistence ships.
 * - **45..49** — same-folder difficulty levels (beginner..insane). We don't model the folder concept yet.
 * - **70..91** — best-score panel for the focused chart. Most are `undefined` until score history persists; chart-side
 *   stats (totalnotes, BPM max/min) are computed from the chart on the fly.
 * - **92..94** — IR (online-only) — always `undefined`.
 * - **160** — initial BPM (matches the gameplay `bpm` field).
 *
 * Returning `undefined` makes the renderer skip the slot, leaving it blank — which matches LR2's behavior when no
 * value is bound.
 */
function resolveSelectNumber(
  num: number,
  song: BrowserSongEntry | undefined,
  playOptions: PixiPlayOptions = DEFAULT_PLAY_OPTIONS,
): number | undefined {
  // Slots that don't depend on a focused song.
  switch (num) {
    case 20:
      // FPS — `scene/lr2/select` doesn't sample its own frame rate yet, so surface 60 as a placeholder rather than leaving
      // the panel blank.
      return 60;
    case 21:
      return new Date().getFullYear();
    case 22:
      return new Date().getMonth() + 1;
    case 23:
      return new Date().getDate();
    case 24:
      return new Date().getHours();
    case 25:
      return new Date().getMinutes();
    case 26:
      return new Date().getSeconds();
    // Lifetime player stats (30..41). 0 placeholders until we add a persistence layer for play history.
    case 30: // TOTAL PLAY COUNT
    case 31: // TOTAL CLEAR COUNT
    case 32: // TOTAL FAIL COUNT
    case 33: // TOTAL PERFECT
    case 34: // TOTAL GREAT
    case 35: // TOTAL GOOD
    case 36: // TOTAL BAD
    case 37: // TOTAL POOR
    case 38: // RUNNING COMBO (now)
    case 39: // RUNNING COMBO (max)
    case 40: // TRIAL LEVEL
    case 41: // TRIAL LEVEL-1
      return 0;
    // Play-option slots (10..15). HS values come from the live `playOptions.hiSpeed` so the LR2 default skin's HS
    // readout tracks the in-scene panel buttons. Other slots are placeholders until the corresponding option lands in
    // {@link PixiPlayOptions} (judge / target rate / SUD+).
    case 10: // HS-1P (×100, e.g. 230 = 2.30×)
    case 11: // HS-2P (we drive both from the same global HS today)
      return Math.round(playOptions.hiSpeed * 100);
    case 12: // JUDGE TIMING
    case 13: // DEFAULT TARGET RATE
    case 14: // SUD+ 1P
    case 15: // SUD+ 2P
      return 0;
  }

  if (!song) {
    return undefined;
  }
  const playLevel =
    typeof song.playLevel === 'number' ? song.playLevel : Number.parseInt(String(song.playLevel ?? ''), 10);
  const playLevelOrUndef = Number.isFinite(playLevel) ? playLevel : undefined;
  const totalNotes = song.totalNotes;
  switch (num) {
    // Best-score panel (70..89). 0 placeholders for slots that need score history; chart-derived ones (72/74) compute
    // live.
    case 70: // best score
    case 71: // best exscore
      return 0;
    case 72: // exscore theoretical max (= totalnotes * 2)
      return totalNotes * 2;
    case 73: // best rate
      return 0;
    case 74: // totalnotes (the canonical LR2 slot)
      return totalNotes;
    case 75: // best maxcombo
    case 76: // best min b+p
    case 77: // playcount
    case 78: // clearcount
    case 79: // failcount
    case 80: // best perfect
    case 81: // best great
    case 82: // best good
    case 83: // best bad
    case 84: // best poor
    case 85: // best perfect %
    case 86: // best great %
    case 87: // best good %
    case 88: // best bad %
    case 89: // best poor %
      return 0;
    // BPM range (90/91). Computed by scanning channel-03 / channel-08 events; charts without BPM changes get the
    // initial BPM for both.
    case 90:
      return resolveBpmRange(song).max;
    case 91:
      return resolveBpmRange(song).min;
    // IR slots (92..94) — undefined until online support arrives.
    case 92:
    case 93:
    case 94:
      return undefined;
    // Same-folder difficulty levels (45..49). We don't model folders yet, so surface the focused chart's level under
    // whichever slot matches its difficulty and leave the others blank.
    case 45:
    case 46:
    case 47:
    case 48:
    case 49: {
      const expectedDifficulty = num - 44; // 45 → diff=1 (beginner), 49 → diff=5 (insane)
      return song.chart.metadata.difficulty === expectedDifficulty ? playLevelOrUndef : undefined;
    }
    case 160:
      // Initial BPM. The LR2 spec marks this as "live BPM"; on the select screen the chart isn't playing, so the
      // initial BPM is the right read.
      return song.bpm;
    default:
      return undefined;
  }
}

/**
 * Computes the focused chart's BPM range. Scans BPM-change events (channel 03 = inline hex BPM, channel 08 = lookup via
 * `resources.bpm`) plus the initial BPM. Cheap because it only runs when a num=90 / num=91 slot is rendered (i.e. once
 * per cursor move).
 */
function resolveBpmRange(song: BrowserSongEntry): { min: number; max: number } {
  // `BrowserSongEntry.bpm` is optional; fall back to the chart's metadata BPM (which is non-optional in the json type)
  // before scanning events so the range never starts as `undefined`.
  const initial = song.bpm ?? song.chart.metadata.bpm;
  let min = initial;
  let max = initial;
  for (const event of song.chart.events) {
    if (event.channel === '03') {
      // Inline hex (base-16) BPM. Two-digit value, 0..255.
      const value = Number.parseInt(event.value, 16);
      if (Number.isFinite(value) && value > 0) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    } else if (event.channel === '08') {
      // Lookup via `#BPMxx` table.
      const bpm = song.chart.resources.bpm[event.value];
      if (typeof bpm === 'number' && bpm > 0) {
        if (bpm < min) min = bpm;
        if (bpm > max) max = bpm;
      }
    }
  }
  return { min: Math.round(min), max: Math.round(max) };
}

/**
 * Maps the BMS `#DIFFICULTY` code to the LR2 label string. Mirrors the gameplay-side helper of the same name so the
 * select view shows the same vocabulary.
 */
function resolveDifficultyName(difficulty: number | undefined): string {
  switch (difficulty) {
    case 1:
      return 'BEGINNER';
    case 2:
      return 'NORMAL';
    case 3:
      return 'HYPER';
    case 4:
      return 'ANOTHER';
    case 5:
      return 'INSANE';
    default:
      return '';
  }
}

/**
 * Returns whether `entry` matches the lower-cased search query. Folder bars match on label only (no per-song fan-out —
 * folders are coarse navigation, not searchable content). Song bars match if any of title / subtitle / artist / genre /
 * file label contain the query as a substring.
 *
 * Pure / exported for testing. Hosts shouldn't call this directly — `PixiSongSelectView.setSearchQuery` is the front
 * door.
 */
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

/**
 * Returns the cell index a `#SRC_BUTTON` should display for the current option state. Mapped per LR2 `# button_type list`
 * (`docs/LR2SkinHelp.md` lines 5887+). Types not yet tracked by {@link PixiPlayOptions} fall back to cell 0 ("OFF" /
 * "ALL" / "GROOVE" / etc.). The `cellCount = divx * divy` cap prevents an out-of-range index from sampling outside the
 * source rect.
 */
function resolveButtonStateIndex(type: number, cellCount: number, playOptions: PixiPlayOptions): number {
  let stateIndex = 0;
  if (type === 72) {
    // BGA: cell 0 = OFF, cell 1 = ON, cell 2 = AUTOPLAY ONLY.
    stateIndex = BGA_CYCLE.indexOf(playOptions.bga);
  } else if (type === 73) {
    // BGA size: cell 0 = NORMAL, cell 1 = EXTEND.
    stateIndex = BGA_SIZE_CYCLE.indexOf(playOptions.bgaSize);
  } else if (type === 70) {
    // Score graph: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.scoreGraph ? 1 : 0;
  } else if (type === 10) {
    // Difficulty filter cycle button — cell index follows the {@link DIFFICULTY_FILTER_CYCLE} order.
    stateIndex = DIFFICULTY_FILTER_CYCLE.indexOf(playOptions.difficultyFilter);
  } else if (type === 11) {
    // Keymode filter cycle button — cell index follows the {@link KEYS_FILTER_CYCLE} order (off / 5K / 7K / 10K / 14K /
    // 9K).
    stateIndex = KEYS_FILTER_CYCLE.indexOf(playOptions.keysFilter);
  } else if (type === 12) {
    // Sort cycle button — cell index follows the {@link SORT_CYCLE} order (off / level / title / clear).
    stateIndex = SORT_CYCLE.indexOf(playOptions.sort);
  } else if (type === 55) {
    // HS-FIX cycle button — cell index follows the {@link HS_FIX_CYCLE} order (off / maxbpm / minbpm / average /
    // constant).
    stateIndex = HS_FIX_CYCLE.indexOf(playOptions.hsFix);
  } else if (type === 50) {
    // HIDDEN/SUDDEN 1P — cell index follows the {@link HIDDEN_SUDDEN_CYCLE} order (off/hidden/sudden/hid+sud).
    stateIndex = HIDDEN_SUDDEN_CYCLE.indexOf(playOptions.hiddenSudden1P);
  } else if (type === 51) {
    // HIDDEN/SUDDEN 2P — independent cycle from the 1P button.
    stateIndex = HIDDEN_SUDDEN_CYCLE.indexOf(playOptions.hiddenSudden2P);
  } else if (type === 46) {
    // LANE COVER (shutter): cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.laneCover ? 1 : 0;
  } else if (type === 44) {
    // Autoscratch 1P: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.autoScratch1P ? 1 : 0;
  } else if (type === 45) {
    // Autoscratch 2P: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.autoScratch2P ? 1 : 0;
  } else if (type === 54) {
    // DP FLIP: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.dpFlip ? 1 : 0;
  } else if (type === 42) {
    // RANDOM 1P: cells follow {@link RANDOM_CYCLE} order.
    stateIndex = RANDOM_CYCLE.indexOf(playOptions.random1P);
  } else if (type === 43) {
    // RANDOM 2P.
    stateIndex = RANDOM_CYCLE.indexOf(playOptions.random2P);
  } else if (type === 40) {
    // Gauge 1P: cells follow {@link GAUGE_CYCLE} order.
    stateIndex = GAUGE_CYCLE.indexOf(playOptions.gauge1P);
  } else if (type === 41) {
    // Gauge 2P.
    stateIndex = GAUGE_CYCLE.indexOf(playOptions.gauge2P);
  } else if (type >= 91 && type <= 96) {
    // Difficulty filter direct-set buttons — cell 0 / 1 = inactive / active depending on whether this button's specific
    // difficulty matches the live filter. Skins typically use these as separate "lit when selected" plates.
    const target = DIFFICULTY_FILTER_BY_DIRECT_BUTTON[type];
    stateIndex = target !== undefined && playOptions.difficultyFilter === target ? 1 : 0;
  }
  return Math.max(0, Math.min(cellCount - 1, stateIndex));
}

/**
 * Maps the BMS `#DIFFICULTY` field (1=BEGINNER..5=INSANE, 0/missing = undefined) to the LR2 `#SRC_BAR_LEVEL` kind enum.
 * The "irRanking" kind isn't a chart attribute — it shows up only in IR mode, which we don't simulate yet, so we never
 * select it from this mapping.
 */
function mapDifficultyToBarLevelKind(difficulty: number | undefined): Lr2BarLevelKind {
  switch (difficulty) {
    case 1:
      return 'beginner';
    case 2:
      return 'normal';
    case 3:
      return 'hyper';
    case 4:
      return 'another';
    case 5:
      return 'insane';
    default:
      return 'undefined';
  }
}

// Re-export the slot type so consumers (tests, future helpers) can reach it without dipping into the parser module
// directly.
export type { Lr2BarBodySlot };
