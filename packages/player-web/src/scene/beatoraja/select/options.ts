/**
 * The beatoraja select scene's options and the snapshot it hands its host to come back to (`PixiBeatorajaSelectScene`).
 * `scene/beatoraja/select.ts` re-exports both.
 */

import type { BeatorajaSkin, BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
import type { BeatorajaSystemSoundPaths } from '@be-music/beatoraja-skin/scene';
import type { Texture } from 'pixi.js';
import type { BrowserCourseEntry, BrowserFolderNode, BrowserSongEntry } from '../../../collection/types.ts';
import type { BeatorajaSkinAudio } from '../../../skin/beatoraja/audio.ts';
import type { BeatorajaFontCache } from '../../../skin/beatoraja/fonts.ts';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';

export interface PixiBeatorajaSelectSceneOptions {
  skin: BeatorajaSkin;
  /**
   * The host edits the search query in its own text field (with IME) and passes it in through
   * {@link PixiBeatorajaSelectScene.setSearchQuery}: the scene then leaves `/` and typed keys to that field instead of
   * running its own key-by-key search mode.
   */
  externalSearch?: boolean;
  textures: BeatorajaTextureCache;
  /** Optional skin TTF cache (`loadBeatorajaFonts`). Absent → platform sans-serif fallback. */
  fonts?: BeatorajaFontCache;
  /** Confirmed user picks for the skin's `property[]`. */
  skinConfig?: BeatorajaSkinConfig;
  /** Songs to choose from. Empty array → "no songs" placeholder. */
  songs: ReadonlyArray<BrowserSongEntry>;
  /** Course folders, listed after the song folders at the root (see `resolveCourseFolders`). */
  courseFolders?: ReadonlyArray<BrowserFolderNode>;
  /**
   * The player started a course bar. A course with a stage missing from the collection (`playable: false`) is handed
   * over too, so the host can say why it does not start. `autoPlay` is set when AUTO PLAY (act 16) started it: every
   * stage plays itself.
   */
  onCoursePicked?: (course: BrowserCourseEntry, options?: { autoPlay?: boolean }) => void;
  /** Initial highlighted index (within the song list at root). Defaults to 0. */
  initialIndex?: number;
  /**
   * Called when the user confirms a song (`Enter` on a song row, or click an already-selected
   * song). The optional `options.autoPlay` is `true` when the source was the skin's authored
   * `button_autoplay` (act=16) — the host should route to gameplay in auto mode rather than
   * the user's default. When omitted / false, the host follows whatever the user has selected
   * in their global play settings.
   */
  onSongPicked: (song: BrowserSongEntry, options?: { autoPlay?: boolean }) => void;
  /** Called when the user backs out of the root list (`Escape` at root). */
  onExit?: () => void;
  /**
   * Called when the user clicks the skin's READTEXT button (act=17) — typically `readme` /
   * `player-info` / `help` / `btn-text` etc. depending on the skin. The host is expected to
   * find and display the chart's accompanying text file (`.txt` next to the chart, or
   * `#TEXT`-resolved content). Omit to have the action fall through to a console log.
   */
  onReadtextRequest?: (song: BrowserSongEntry) => void;
  /**
   * Called when the scene mutates `skinConfig` in place — currently fires for `JUDGE_TIMING`
   * (act=74) note-offset adjustments. The host should persist the new config (e.g. write it
   * into its per-entry config cache) and refresh any external readouts (e.g. the bottom-right
   * lil-gui's "Note offset" slider). Receives a fresh shallow clone so the callback never
   * aliases the scene's mutator state.
   */
  onSkinConfigChange?: (config: BeatorajaSkinConfig) => void;
  /** Optional audio backend for `main_state.audio_play / loop / stop` Lua calls. */
  skinAudio?: BeatorajaSkinAudio;
  /**
   * Optional lookup that returns the focused song's clear-lamp op (one of
   * `BEATORAJA_OP.CLEAR_LAMP_*`). When omitted, every song reports as `CLEAR_LAMP_NOPLAY`
   * (= 100), which makes the song-list lamp icon always render the "no record" frame —
   * audit 2.18.
   *
   * Hosts that track in-session play history (the demo does, keyed by `BrowserSongEntry.id`)
   * supply the callback to light the lamp icon based on actual completed runs. The lookup is
   * called on every frame for the focused entry only — caching at the host's discretion.
   * Folder rows pass through unchanged (the lamp op is a song-bar concept).
   */
  resolveSongLampOp?: (song: BrowserSongEntry) => number | undefined;
  /**
   * The focused course bar's clear-lamp op (`BEATORAJA_OP.CLEAR_LAMP_*`), from the player's best record on the course, as
   * beatoraja lights a `GradeBar`'s lamp from its course score. Omitted (or `undefined`) reads as `CLEAR_LAMP_NOPLAY`;
   * a random course bar has no record.
   */
  resolveCourseLampOp?: (course: BrowserCourseEntry) => number | undefined;
  /**
   * Optional song collection — the same `BrowserSongCollection` the demo built `songs` from.
   * Required only for the chart-preview engine: `ChartPreviewEngine.focus()` needs to resolve
   * each song's `BrowserSongAssetSource` to load the `#PREVIEW` file (or fall back to in-place
   * chart playback). When omitted, the preview engine stays inactive — the select scene runs
   * silent on cursor moves, same as before this option existed.
   */
  collection?: import('../../../collection/types.ts').BrowserSongCollection;
  /**
   * Optional system-sound paths for navigation cues. Each value is a bundle-relative path
   * (e.g. `'sound/cursor.wav'`) that {@link skinAudio} resolves through its file map and
   * decodes lazily. The scene fires the matching path on these events:
   *
   *   - `cursor` — every cursor advance (ArrowUp / ArrowDown / PageUp / PageDown / Home / End
   *     / wheel / mouse-click on a non-focused row).
   *   - `folderOpen` — drilling into a folder bar via Enter / click.
   *   - `folderClose` — backing out via Escape / Backspace.
   *   - `decide` — confirming a song bar (Enter / click on focused / autoplay button).
   *   - `optionChange` — sort cycle (act=12) / keymode filter cycle (act=11).
   *   - `cancel` — back-navigation when not in a folder (root-level ESC).
   *
   * Missing entries are silently skipped — themes that don't ship a particular cue just don't
   * play it. Requires {@link skinAudio} to also be supplied; without an audio backend the
   * paths are unreferenced and the scene runs silent on navigation.
   *
   * Hosts should discover the paths from the theme bundle (e.g. probe `sound/cursor.wav`,
   * `sound/decide.wav` etc. against the bundle's file map) and pass whatever they found.
   * Beatoraja itself reads these paths from its `config.json` keys (`sound_cursor`,
   * `sound_select`, `sound_cancel`, `sound_folder`) — the same convention the demo follows.
   */
  systemSoundPaths?: BeatorajaSystemSoundPaths;
  /**
   * Optional bundle-relative path to a looping select-scene BGM (typically `Bgm/select.wav`).
   * When supplied, the scene starts the loop in {@link enter} and stops it in {@link exit} via
   * the {@link skinAudio} backend. Routed through the same `BeatorajaSkinAudioPlayer` the Lua
   * audio_loop / audio_play calls use so a single AudioContext serves both.
   *
   * Discovered by hosts via {@link discoverBeatorajaSelectBgmPath}; pass the result verbatim
   * (or `undefined` for a silent select). Beatoraja's reference engine stores the path in
   * `config.json` `bgm_select`; the web port uses convention-based probing instead.
   *
   * Volume is fixed at `0.7` — quieter than authored to leave headroom for chart preview
   * playback (the preview engine doesn't currently duck the BGM, so a too-loud loop drowns
   * out short preview clips). Future ducking would multiply this by an in-flight factor.
   */
  selectBgmPath?: string;
  /**
   * Optional snapshot from a previous mount — restores the user's prior cursor / folder /
   * filter / sort / favorite state when re-entering the select scene (e.g. after returning
   * from a play). Captured via {@link PixiBeatorajaSelectScene.captureSnapshot} on the
   * outgoing scene before disposal; passed verbatim into the next mount's options. Takes
   * precedence over {@link initialIndex} when both are set — snapshot already encodes the
   * cursor's full position (including which folder the user was in), and `initialIndex`
   * alone can't disambiguate between "song N of root" vs "song N of folder X".
   *
   * Folder identity is preserved by `label` (folder names are stable across mounts as long
   * as the underlying `BrowserSongCollection` hasn't been reshuffled). When the new
   * collection no longer contains a folder by that label (the user dropped a different
   * library), the restore falls back to the root list with cursor 0 — a safe default that
   * doesn't crash when stale state outlives its source.
   */
  restoreSnapshot?: PixiBeatorajaSelectSceneSnapshot;
  /**
   * Optional decoder for the focused song's chart-bitmap synthetic ids. The scene calls
   * this on every focus change; the host returns a Promise resolving to whichever bitmaps
   * the chart shipped (`#STAGEFILE` / `#BACKBMP` / `#BANNER`). Decoded textures cache
   * inside the scene by `song.id` so subsequent re-focuses skip the IO.
   *
   * Without this, destinations referencing the synthetic ids `-100` / `-101` / `-102`
   * stay hidden — default beatoraja's select.json paints `-102 BANNER` as the focused
   * song's banner inside the chart-info panel, ModernChic uses `-100 STAGEFILE` as a
   * frosted backdrop, etc.
   */
  decodeChartImages?: (song: BrowserSongEntry) => Promise<{ stageFile?: Texture; backBmp?: Texture; banner?: Texture }>;
}

/**
 * Serializable scene state captured at scene-exit for restoration on the next mount. The host
 * persists this opaquely (no field-by-field interpretation needed); the scene re-applies it on
 * the next constructor call. All references are by VALUE — ids and labels rather than object
 * pointers — so the snapshot survives `BrowserSongCollection` rebuilds (drop a new library and
 * the snapshot still applies as long as the same folder labels / song ids exist).
 */
export interface PixiBeatorajaSelectSceneSnapshot {
  /** Folder labels in nesting order. Empty = at root. */
  folderPath: ReadonlyArray<string>;
  /** Cursor index per stack depth. `[rootIdx]` at root, `[rootIdx, songIdxInFolder]` one deep. */
  cursorStack: ReadonlyArray<number>;
  /** Active keymode filter (act=11 MODE button cycle). 0 = ALL. */
  keymodeFilter: number;
  /** Active sort mode (act=12 SORT button cycle). 0 = DEFAULT. */
  sortMode: number;
  /**
   * Global LN-mode override (act=308 LNMODE button cycle). `undefined` = use the chart's
   * authored `#LNMODE`; `0..2` = user override (LN / CN / HCN).
   */
  lnModeOverride: 0 | 1 | 2 | undefined;
  /** `BrowserSongEntry.id`s the user marked as song-level favorites. */
  favoriteSongs: ReadonlyArray<string>;
  /** `BrowserSongEntry.id`s the user marked as chart-level favorites. */
  favoriteCharts: ReadonlyArray<string>;
  /**
   * Live search query. Survives PLAY → SELECT round-trips so the user lands back on the
   * same filtered list. Empty string = no filter (the typical case when the user hasn't
   * touched search). The active-input flag isn't persisted — coming back from gameplay
   * always starts in non-input mode so the user can navigate immediately.
   */
  searchQuery: string;
}
