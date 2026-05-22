import type { SkinFamilyId, loadTextureFromBytes } from '@be-music/player-web/skin';

/**
 * DOM handles passed into the `PlayerWebDemoApp` constructor. The lookups happen once at boot in `main.ts`; the app
 * stores the references on `this.elements` and reads them throughout the session.
 */
export interface PlayerWebDemoElements {
  stage: HTMLDivElement;
  shell: HTMLDivElement;
  /**
   * Hidden `<input type="file" webkitdirectory>` triggered from a lil-gui function controller. The DOM element survives
   * across lil-gui rebuilds (e.g. theme changes) so the underlying `change` listener stays bound through the session.
   */
  songInput: HTMLInputElement;
  /**
   * Floating DOM `<input>` overlay positioned near the LR2 default skin's search-text rect. Focus is given to it when
   * the user clicks the skin's `#SRC_TEXT,st=30,edit=1` region or hits the `/` shortcut; typing into it filters the
   * song list via `PixiSongSelectView.setSearchQuery`.
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
 * means "let the demo pick automatically based on what's loaded". The auto branch's policy is documented on
 * `PlayerWebDemoApp.pickActiveFamilyForScene`.
 */
export type SkinFamilyOverride = SkinFamilyId | 'auto';

/**
 * The four scene kinds the family-routing helper dispatches over. Used as the `scene` argument of
 * `PlayerWebDemoApp.availableFamiliesForScene` / `PlayerWebDemoApp.pickActiveFamilyForScene` — passing
 * the kind lets the helpers consult the right per-skin slots (`decideSkin` only for decide, `selectSkin` only for
 * select, etc.) without N copy-pasted callers each computing the predicate locally.
 */
export type SkinFamilySceneKind = 'select' | 'decide' | 'gameplay' | 'result';

/**
 * Plain-data state object backing the lil-gui controllers. Each key matches a controller; reads / writes go through the
 * same `state.foo` reference so a programmatic update (e.g. `setAudioCompressor` triggered by a URL flag) can call
 * `controller.updateDisplay()` and the GUI reflects the new value. Function members are bound to the host so `this`
 * keeps its meaning when lil-gui invokes them.
 */
export interface DemoGuiState {
  autoPlay: boolean;
  /**
   * When true, gameplay auto-pauses on tab visibility change / window blur and auto-resumes on focus. False (the
   * default) keeps the play scene running in the background — convenient for capturing recordings while another window
   * holds focus.
   */
  autoPauseOnBlur: boolean;
  compressor: boolean;
  compressorKey: boolean;
  compressorBgm: boolean;
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
   * - `'HIDE'` (default) — judged notes disappear at the judgement instant, matching the LR2 / beatoraja default.
   * - `'KEEP_SCROLLING'` — judged notes keep scrolling past the judgement line (≈ beatoraja's `LANEEFFECT ON`).
   *
   * Long-note bodies are unaffected — they always persist until the tail crosses the line.
   */
  judgedNoteDisplay: 'KEEP_SCROLLING' | 'HIDE';
  /**
   * Explicit skin-family override picked from the Debug Menu dropdown. `'auto'` (default) keeps the legacy
   * priority — beatoraja if a beatoraja theme is loaded and covers the chart, otherwise LR2 (which itself falls
   * back to the default family per-scene when the corresponding LR2 skin isn't loaded). Any other value forces
   * that family on every scene; unavailable scenes for the chosen family fall through to the default family
   * (= built-in chrome) rather than silently using the unselected family.
   *
   * The dropdown rebuilds its option list whenever a theme load completes so `'lr2'` / `'beatoraja'` only show
   * up when the corresponding theme is present. When the user's pick becomes unavailable mid-session (e.g.
   * they had LR2 selected then dropped a beatoraja-only theme that wiped the LR2 state), `PlayerWebDemoApp.rebuildSkinFamilyPicker`
   * silently resets to `'auto'` so the GUI never displays an unhonorable value.
   */
  skinFamilyOverride: SkinFamilyOverride;
  /**
   * Read-only status text (loading summaries, "Playing: …", recording state, etc.). Bound to a disabled string
   * controller so users can copy it out of the GUI but can't edit it. The runtime updates this via `setStatus`
   * which also pushes the new value into the controller.
   */
  status: string;
  /** Triggered by clicking the GUI's "Open Folder" button. */
  openFolder: () => void;
  /** Triggered by clicking the GUI's record toggle. */
  record: () => void;
  /** Triggered by clicking the GUI's "Screenshot" button. Captures the Pixi stage at its native size. */
  screenshot: () => void;
}

/**
 * Pixi `Texture` type as exposed by player-web's re-exported `loadTextureFromBytes`. Derived
 * from the function's return type so the demo doesn't need a direct `pixi.js` dependency for
 * the chart-image plumbing. `Awaited<…>` strips the `Promise` wrapper; `NonNullable<…>` strips
 * the `| undefined` so callers can branch on presence.
 */
export type ChartImageTexture = NonNullable<Awaited<ReturnType<typeof loadTextureFromBytes>>>;
