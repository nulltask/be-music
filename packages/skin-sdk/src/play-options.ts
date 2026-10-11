/**
 * Per-session gameplay tweaks the player picks on the select screen: hi-speed, autoplay, note arrangement, gauge type,
 * HIDDEN / SUDDEN and the lane cover, BGA display, and the song-list filters. The host owns the live values and hands
 * them to every play it launches; be-music skins read them from `BeMusicSelectFrame.playOptions` /
 * `BeMusicDecideFrame.playOptions` and change them through `BeMusicSelectActions.setPlayOption` /
 * `cyclePlayOption`. Several fields mirror an LR2 `#SRC_BUTTON` type, noted per field.
 */
export interface BeMusicPlayOptions {
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
  bga: BeMusicBgaMode;
  /**
   * BGA frame size — `'NORMAL'` uses the skin's default `#DST_BGA` rect (op 30), `'EXTEND'` uses the larger variant
   * gated on op 31. Mirrors `#SRC_BUTTON,type=73`.
   */
  bgaSize: BeMusicBgaSize;
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
  difficultyFilter: BeMusicDifficultyFilter;
  /**
   * Keymode filter for the song-list. `'ALL'` shows every chart; the named values restrict the bar list to charts whose
   * lane usage matches the corresponding LR2 keymode op (160=7K..164=9K). Mirrors `#SRC_BUTTON,type=11` cycling.
   */
  keysFilter: BeMusicKeysFilter;
  /**
   * Sort order for the song-list. Mirrors `#SRC_BUTTON,type=12` cycling (off / level / title / clear). `'CLEAR'` is a
   * no-op for now — without persisted play history every chart has the same "not played" status, so the sorted order
   * matches the input order anyway.
   */
  sort: BeMusicSelectSort;
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
  hsFix: BeMusicHsFix;
  /**
   * 1P-side HIDDEN / SUDDEN effect picked from `#SRC_BUTTON,type=50`. Cycles OFF → HIDDEN → SUDDEN → HID+SUD on each
   * click. Drives the opaque mask over the 1P keyboard / scratch lanes. SP charts only render this side; DP charts pair
   * it with {@link hiddenSudden2P}.
   */
  hiddenSudden1P: BeMusicHiddenSudden;
  /**
   * 2P-side HIDDEN / SUDDEN effect picked from `#SRC_BUTTON,type=51`. Independent from the 1P value — LR2's panel UI
   * exposes per-side cycle buttons because real players sometimes want, e.g., HIDDEN on their dominant side and OFF on
   * the other.
   */
  hiddenSudden2P: BeMusicHiddenSudden;
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
  random1P: BeMusicRandomMode;
  /** 2P side note arrangement (channels 21..25 + 28 + 29). */
  random2P: BeMusicRandomMode;
  /**
   * 1P gauge variant (`#SRC_BUTTON,type=40`):
   *
   * - `GROOVE` — LR2 default cumulative gauge (start 20 %, clear 80 %)
   * - `HARD` — survival gauge (start 100 %, fail at 0 %)
   * - `DEATH` — instant-death (start 100 %, any miss = 0)
   * - `EASY` — gentler GROOVE (clear 60 %)
   */
  gauge1P: BeMusicGaugeType;
  /** 2P gauge variant (`#SRC_BUTTON,type=41`). */
  gauge2P: BeMusicGaugeType;
}

/** Allowed values for {@link BeMusicPlayOptions.difficultyFilter}. */
export type BeMusicDifficultyFilter = 'ALL' | 'BEGINNER' | 'NORMAL' | 'HYPER' | 'ANOTHER' | 'INSANE';

/** Allowed values for {@link BeMusicPlayOptions.keysFilter}. */
export type BeMusicKeysFilter = 'ALL' | 'KEYS_5' | 'KEYS_7' | 'KEYS_9' | 'KEYS_10' | 'KEYS_14';

/** Allowed values for {@link BeMusicPlayOptions.sort}. */
export type BeMusicSelectSort = 'OFF' | 'LEVEL' | 'TITLE' | 'CLEAR';

/** Allowed values for {@link BeMusicPlayOptions.hsFix}. */
export type BeMusicHsFix = 'OFF' | 'MAXBPM' | 'MINBPM' | 'AVERAGE' | 'CONSTANT';

/** Allowed values for {@link BeMusicPlayOptions.hiddenSudden1P} / `hiddenSudden2P`. */
export type BeMusicHiddenSudden = 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';

/** Allowed values for {@link BeMusicPlayOptions.random1P} / `random2P`. */
export type BeMusicRandomMode = 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER';

/** Allowed values for {@link BeMusicPlayOptions.gauge1P} / `gauge2P`. */
export type BeMusicGaugeType = 'GROOVE' | 'HARD' | 'DEATH' | 'EASY';

/** Allowed values for {@link BeMusicPlayOptions.bga}. */
export type BeMusicBgaMode = 'OFF' | 'ON' | 'AUTOPLAY_ONLY';

/** Allowed values for {@link BeMusicPlayOptions.bgaSize}. */
export type BeMusicBgaSize = 'NORMAL' | 'EXTEND';
