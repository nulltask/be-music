import type { DecideScene, PlayScene, ResultScene, SelectScene } from '@be-music/player-browser/host';
import type { SkinFamilyId } from '@be-music/player-browser/skin';
import type { ReplayPlaybackOptions } from '@be-music/player-engine/replay';
import type { GaugeType, RulesetId } from '@be-music/player-engine/ruleset';
import type { BrowseSort, DifficultyFilter, KeysFilter, HSFix, PlayOptions } from '@be-music/player-scene-model';
import type { PlayTempoSettings } from './play-tempo-settings.ts';

/** Every screen the player shows, each made by its `create*Scene`. */
export type PlayerScene = SelectScene | DecideScene | PlayScene | ResultScene;

/**
 * DOM handles passed into the `PlayerWebApp` constructor. The lookups happen once at boot in `main.ts`; the app
 * stores the references on `this.elements` and reads them throughout the session.
 */
export interface PlayerWebElements {
  stage: HTMLDivElement;
  shell: HTMLDivElement;
  /**
   * Hidden `<input type="file" webkitdirectory>` triggered from a Tweakpane function controller. The DOM element survives
   * across Tweakpane rebuilds (e.g. theme changes) so the underlying `change` listener stays bound through the session.
   */
  chartInput: HTMLInputElement;
  /**
   * Hidden `<input type="file" multiple>` behind the Debug Menu's "Open files" button: ZIP archives and replays, which
   * the folder picker (`chartInput`) can't select.
   */
  filesInput: HTMLInputElement;
  /**
   * Floating DOM `<input>` overlay positioned near the LR2 default skin's search-text rect. Focus is given to it when
   * the user clicks the skin's `#SRC_TEXT,st=30,edit=1` region or hits the `/` shortcut; typing into it filters the
   * song list via the select scene's `setSearch`.
   */
  searchInput: HTMLInputElement;
  /**
   * Centered overlay shown while a dropped folder / ZIP is being read + parsed. Toggled via the `.visible` class so CSS
   * controls the fade-in / fade-out, and the `aria-hidden` attribute mirrors the visibility for screen readers.
   */
  loadingOverlay: HTMLDivElement;
  loadingLabel: HTMLDivElement;
  loadingBarFill: HTMLDivElement;
  loadingCounter: HTMLDivElement;
}

/**
 * User-facing skin-family selection. Mirrors the package's {@link SkinFamilyId} plus an extra `'auto'` sentinel that
 * means "let the player pick automatically based on what's loaded". The auto branch's policy is documented on
 * `PlayerWebApp.pickActiveFamilyForScene`.
 */
export type SkinFamilyOverride = SkinFamilyId | 'auto';

/**
 * The four scene kinds the family-routing helper dispatches over. Used as the `scene` argument of
 * `PlayerWebApp.availableFamiliesForScene` / `PlayerWebApp.pickActiveFamilyForScene` — passing
 * the kind lets the helpers consult the right per-skin slots (`decideSkin` only for decide, `selectSkin` only for
 * select, etc.) without N copy-pasted callers each computing the predicate locally.
 */
export type SkinFamilySceneKind = 'select' | 'decide' | 'gameplay' | 'result';

/**
 * Plain-data state object backing the Tweakpane controllers. Each key matches a controller; reads / writes go through the
 * same `state.foo` reference so a programmatic update (e.g. `setAudioCompressor` triggered by a URL flag) can call
 * `controller.updateDisplay()` and the GUI reflects the new value. Function members are bound to the host so `this`
 * keeps its meaning when Tweakpane invokes them.
 */
export interface PlayerGUIState extends PlayTempoSettings {
  autoPlay: boolean;
  /** Id of the be-music skin the default (no-theme) family renders with. Persisted in `localStorage`. */
  builtInSkin: string;
  /** Showmanship level for the built-in skins. Persisted in `localStorage`. */
  skinEffects: 'full' | 'reduced' | 'off';
  /**
   * Render resolution (canvas pixels per CSS pixel), one of 1× up to the display's `devicePixelRatio` in 0.5 steps;
   * 1.5× until picked. Persisted in `localStorage`.
   */
  renderResolution: number;
  /** Gameplay layout pick: `'auto'` follows the device (touch layout on phones / tablets). Persisted in `localStorage`. */
  playLayout: 'auto' | 'standard' | 'touch';
  /**
   * When true, gameplay auto-pauses on tab visibility change / window blur and auto-resumes on focus. False (the
   * default) keeps the play scene running in the background — convenient for capturing recordings while another window
   * holds focus.
   */
  autoPauseOnBlur: boolean;
  /** Master volume in percent (0..100) over every sound the player makes, applied live and remembered across reloads. */
  masterVolume: number;
  /** Silence every sound while retaining the master volume setting. Persisted in localStorage. */
  muted: boolean;
  /** Keysound bus volume in percent (0..100), pushed live to gameplay and remembered across reloads. */
  keyVolume: number;
  /** BGM bus volume in percent (0..100), pushed live to gameplay and remembered across reloads. */
  bgmVolume: number;
  /**
   * Ask the platform audio session for `'playback'` so sound plays with the iPhone / iPad silent switch on (pausing other
   * apps' music). Off by default; only offered where `navigator.audioSession` exists. Remembered across reloads.
   */
  playInSilentMode: boolean;
  /**
   * When true, the next play scales every decoded sample by one gain so the loudest peak sits near −3 dBFS. Off by
   * default. Remembered with the other Debug Menu settings. Takes the next play, not the one already loaded.
   */
  peakGain: boolean;
  compressor: boolean;
  compressorKey: boolean;
  compressorBGM: boolean;
  compressorMaster: boolean;
  /**
   * Pixel cap for the longest edge of BGA videos that need the ffmpeg.wasm transcode fallback. Single-threaded libx264
   * cost is linear in pixel count, so capping the long edge is the biggest single-threaded encode-time lever — at the
   * cost of a (usually imperceptible) reduction in BGA texture sharpness.
   *
   * `0` is the special "Off" value: no resize happens and the source resolution passes through unchanged. Off by
   * default so the BMS-author resolution is preserved unless the user explicitly opts in via the GUI dropdown. Any
   * positive value activates the resize path with that pixel cap; the `Math.max` guard at the consumer side rejects
   * accidental negatives.
   */
  bgaResizeMaxEdgePx: number;
  /**
   * When true, BGA transcoding uses the browser's WebCodecs `VideoEncoder` (hardware-accelerated where supported)
   * instead of the libx264 wasm encoder. Decoding still goes through ffmpeg.wasm because WebCodecs' decoder doesn't
   * speak the legacy MPEG-1 / VC-1 codecs BMS BGA usually ships in.
   *
   * Forced to `false` and disabled in the GUI when the browser doesn't expose `VideoEncoder` (Safari < 17, older
   * Firefox builds). Ignored at runtime if the encoder rejects the configured parameters or the raw decoded frames
   * would blow the memory budget — the transcode then silently falls back to the ffmpeg encode path.
   */
  bgaUseWebCodecs: boolean;
  /**
   * Debug overlay — when true, every invisible / keysound note the chart authors on channels `3x` / `4x` paints as the
   * 9-keys POP green note (or a flat green bar fallback) in its assigned playable lane during gameplay. Useful for
   * verifying which lane each `#WAV` sample is wired to without affecting scoring or judgement. Defaults to false so
   * the regular play surface stays uncluttered.
   *
   * Live-toggleable — the gameplay view always extracts the invisible-note array and preloads the green sprite at
   * chart-prepare time, so flipping the flag mid-song flips the per-frame render branch on the very next paint.
   */
  showInvisibleNotes: boolean;
  /**
   * Single-note visibility after a judgement lands.
   *
   * - `'KEEP_SCROLLING'` (default) — a judged note stays until its own time, so one hit early keeps scrolling down to
   *   the judgement line, as in LR2 and beatoraja.
   * - `'HIDE'` — a judged note disappears the moment it is judged.
   *
   * Long notes are unaffected — they stay until their end.
   */
  judgedNoteDisplay: 'KEEP_SCROLLING' | 'HIDE';
  /**
   * When true (off by default), the replay (`*.bmplay.json` input replay — see `@be-music/player-engine/replay`) recorded
   * during gameplay is automatically downloaded the moment the result scene mounts, for both the LR2/default and
   * beatoraja result paths. Toggled from the Debug Menu's "Auto-save replays" checkbox.
   */
  autoSaveReplay: boolean;
  /**
   * In a course, go straight on to the next stage instead of showing each stage's result (the course result still
   * shows at the end). False (the default) shows every stage's result, as LR2 and beatoraja do.
   */
  courseAutoAdvance: boolean;
  /**
   * How a NONSTOP course places its stages: `'intended'` (the default) as LR2's loader means to, `'lr2'` exactly as
   * LR2's binary does, including its third-stage start offset (`planNonstopCourse`).
   */
  nonstopPlacement: 'intended' | 'lr2';
  /**
   * Which of what a replay recorded the player seeing a replay or ghost reproduces (tempo, hi-speed, SUDDEN+ /
   * HIDDEN+, LIFT), the rest staying the viewer's own: the Debug Menu's "Play options / Replay / ghost" toggles, all on
   * by default, remembered across visits and latched at song start.
   */
  replayView: ReplayPlaybackOptions;
  /** `tempoEnabled` / `tempoPercent` / `tempoPitchMode` / `tempoStretchAlgorithm`: see {@link PlayTempoSettings}. */
  /**
   * When true (off by default), every finished play is sent to the Leaderboard when the result scene mounts — signing
   * in anonymously the first time (docs/leaderboard.md). Toggled from the Debug Menu's "Submit to Leaderboard"
   * checkbox and latched at song start like the auto-save.
   */
  submitToLeaderboard: boolean;
  /**
   * The compat ruleset the shared engine judges under (`PlayerOptions.judgeRuleset`): LR2 (default) / beatoraja / That-Which-Must-Not-Be-Named.
   * It owns every judge rule: the windows, note selection, empty POOR, the long-note style, the gauge and the score.
   * Latched at song start (the Play options folder is disabled during a play) and recorded into the replay.
   */
  judgeRuleset: RulesetId;
  /**
   * Hi-speed (note scroll multiplier) the next play starts at. Two-way synced with the LR2 select panel's HS and the
   * in-game `ArrowUp` / `ArrowDown` keys, applied live to a running play when changed here, and remembered across
   * reloads.
   */
  hiSpeed: number;
  hsFix: HSFix;
  displayAreaInfo: PlayOptions['displayAreaInfo'];
  hiddenSudden1P: PlayOptions['hiddenSudden1P'];
  hiddenSudden2P: PlayOptions['hiddenSudden2P'];
  laneCover: PlayOptions['laneCover'];
  shutter: PlayOptions['shutter'];
  /** Gauge variant for the next play. Two-way synced with the LR2 select scene's PLAY OPTION panel. */
  gauge: GaugeType;
  /** 1P lane arrangement for the next play. Two-way synced with the LR2 select panel. */
  hRandomThresholdBPM: number;
  randomSeed1P: string;
  randomSeed2P: string;
  randomFixedLane1P: number;
  randomFixedLane2P: number;
  random1P: PlayOptions['random1P'];
  /** 2P lane arrangement for the next play. Two-way synced with the LR2 select panel. */
  random2P: PlayOptions['random1P'];
  /** DP FLIP for the next play. Two-way synced with the LR2 select panel. */
  dpFlip: boolean;
  /** 1P auto scratch for the next play. Two-way synced with the LR2 select panel. */
  classicHiSpeed: boolean;
  floatingHiSpeed: boolean;
  fixedDisplayArea: boolean;
  normalHiSpeedLevel: number;
  judgeTimingMs: number;
  visualConstant: boolean;
  lift1P: number;
  lift2P: number;
  liftOn1P: boolean;
  liftOn2P: boolean;
  noteDurationMs: number;
  constantFadeMs: number;
  bpmGuide: boolean;
  judgeTimingAutoAdjust: boolean;
  judgeAlgorithm: PlayOptions['judgeAlgorithm'];
  longNoteModifier: PlayOptions['longNoteModifier'];
  longNoteRate: number;
  mineModifier: PlayOptions['mineModifier'];
  gaugeAutoShift: PlayOptions['gaugeAutoShift'];
  autoScratch1P: boolean;
  /** 2P auto scratch for the next play. Two-way synced with the LR2 select panel. */
  autoScratch2P: boolean;
  /**
   * The built-in and LR2 select screens' sort, key filter and difficulty filter. Two-way synced with an LR2 select
   * skin's sort and filter buttons; the beatoraja select screen has its own MODE and SORT buttons.
   */
  sort: BrowseSort;
  keysFilter: KeysFilter;
  difficultyFilter: DifficultyFilter;
  /**
   * Explicit skin-family override picked from the Debug Menu dropdown. `'auto'` (default) keeps the legacy
   * priority — beatoraja if a beatoraja theme is loaded and covers the chart, otherwise LR2 (which itself falls
   * back to the default family per-scene when the corresponding LR2 skin isn't loaded). Any other value forces
   * that family on every scene; unavailable scenes for the chosen family fall through to the default family
   * (= built-in chrome) rather than silently using the unselected family.
   *
   * The dropdown rebuilds its option list whenever a theme load completes so `'lr2'` / `'beatoraja'` only show
   * up when the corresponding theme is present. When the user's pick becomes unavailable mid-session (e.g.
   * they had LR2 selected then dropped a beatoraja-only theme that wiped the LR2 state), `PlayerWebApp.rebuildSkinFamilyPicker`
   * silently resets to `'auto'` so the GUI never displays an unhonorable value.
   */
  skinFamilyOverride: SkinFamilyOverride;
  /**
   * Read-only status text (loading summaries, "Playing: …", recording state, etc.). Bound to a disabled string
   * controller so users can copy it out of the GUI but can't edit it. The runtime updates this via `setStatus`
   * which also pushes the new value into the controller.
   */
  status: string;
  /** Triggered by clicking the GUI's "Open folder" button. */
  openFolder: () => void;
  /** Triggered by clicking the GUI's "Open files" button (ZIP archives / replays). */
  openFiles: () => void;
  /** "Video format": the container and codec of recordings, as `mp4/avc` / `webm/vp9` (`recording-format-choice.ts`). */
  recordingFormat: string;
  /** Triggered by clicking the GUI's record toggle. */
  record: () => void;
  /** Triggered by clicking the GUI's "Screenshot" button. Captures the Pixi stage at its native size. */
  screenshot: () => void;
}
