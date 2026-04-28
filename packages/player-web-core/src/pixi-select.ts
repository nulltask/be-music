import { Application, Color, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type {
  Lr2BarBodyKind,
  Lr2BarBodySource,
  Lr2BarBodySlot,
  Lr2BarFlashElement,
  Lr2BarLevelKind,
  Lr2BarLevelSource,
  Lr2ButtonElement,
  Lr2DestinationRect,
  Lr2ImageElement,
  Lr2ImageRect,
  Lr2MouseCursorElement,
  Lr2NumberElement,
  Lr2OnMouseElement,
  Lr2Skin,
  Lr2SpecialGraphic,
  Lr2TextElement,
} from './lr2-skin.ts';
import { LR2_SPECIAL_GRAPHIC, isLr2SpecialGraphic } from './lr2-skin.ts';
import { loadSkinAssetTexture, loadTextureFromBytes } from './lr2-textures.ts';
import {
  applyDestinationToSprite,
  createCroppedTexture,
  evaluateKeyframes,
  normaliseRect,
  pickAnimatedCell,
  renderNumberElement,
} from './lr2-render.ts';
import { groupSongsByFolder, resolveChartAsset, resolveSongSource } from './library.ts';
import type { BrowserBrowseEntry, BrowserFolderNode, BrowserSongCollection, BrowserSongEntry } from './types.ts';

const BG = new Color('#08090d');
const PANEL = new Color('#151923');
const ACTIVE = new Color('#ffd166');
const TEXT = new Color('#f8fafc');
const MUTED = new Color('#9aa6b2');
const FALLBACK_DESIGN_WIDTH = 1280;
const FALLBACK_DESIGN_HEIGHT = 720;
// LR2 default skin design space — used when a skin is loaded so the
// stage scales to the skin's authoring resolution (640x480).
const LR2_DESIGN_WIDTH = 640;
const LR2_DESIGN_HEIGHT = 480;

/**
 * Globally-true ops that hold regardless of which song is focused —
 * filter / mode toggles, gauge defaults, "no rival" fallbacks, etc.
 * Per-song state (bar type, key mode, clear lamp, BACKBMP presence,
 * difficulty, …) is layered on top by `computeSelectOps`.
 *
 * The op numbers follow LR2's official `dst_option` table — see
 * `docs/LR2SkinHelp.md` lines 4099+ for the canonical list.
 */
const SELECT_BASE_OPS: ReadonlySet<number> = new Set<number>([
  32, // autoplay off
  34, // ghost off
  38, // scoregraph off
  40, // BGA off (select-screen UI doesn't run BGA)
  42, // 1P normal gauge
  44, // 2P normal gauge
  47, // difficulty filter disabled
  50, // offline (no IR connection yet)
  54, // autoscratch 1P off
  56, // autoscratch 2P off
  60, // save impossible (no persistence yet)
  62, // clear save impossible (no persistence yet)
  81, // load complete (we always render after texture preload)
  82, // replay off
  // op 160 (= 7keys) is intentionally NOT here — it's set per-song by
  // `computeSelectOps` from the focused chart's modeHint, mirroring
  // the LR2 spec where 160..164 are mutually exclusive key-mode flags.
]);

/**
 * Op slots that LR2 select skins flip per-song. The numeric values are
 * authoritative — they match `dst_option` in `docs/LR2SkinHelp.md`.
 * Earlier code shipped wrong values for several of these (op 1/2 were
 * swapped, key-mode ops sat at 70..74 which is the "level threshold"
 * range, etc.), which made gating against the LR2 default skin diverge
 * from real LR2.
 */
const SELECT_DYNAMIC_OPS = {
  // Bar / cursor type (1 of these is true at a time). Per spec:
  //   1 = フォルダ, 2 = 曲, 3 = コース, 4 = 新規コース作成,
  //   5 = 選択中バーがプレイ可能（曲・コースなら true）
  BAR_IS_FOLDER: 1,
  BAR_IS_SONG: 2,
  BAR_IS_COURSE: 3,
  BAR_IS_NEW_COURSE: 4,
  BAR_IS_PLAYABLE: 5,
  // Key mode of the focused chart. Spec: 160..164 are the "元データ"
  // (raw chart) key-mode flags. 165..169 would be the post-option
  // key mode but the spec has them commented out — not implemented.
  KEYS_7: 160,
  KEYS_5: 161,
  KEYS_14: 162,
  KEYS_10: 163,
  KEYS_9: 164,
  // Chart-feature flags. The "absent" / "present" pair is mutually
  // exclusive; we set whichever applies based on chart contents.
  BGA_ABSENT: 170,
  BGA_PRESENT: 171,
  LN_ABSENT: 172,
  LN_PRESENT: 173,
  TEXT_ABSENT: 174,
  TEXT_PRESENT: 175,
  BPM_CHANGE_ABSENT: 176,
  BPM_CHANGE_PRESENT: 177,
  RANDOM_ABSENT: 178,
  RANDOM_PRESENT: 179,
  // Judge rank (`#RANK`): 180=very hard, 181=hard, 182=normal, 183=easy.
  JUDGE_VERY_HARD: 180,
  JUDGE_HARD: 181,
  JUDGE_NORMAL: 182,
  JUDGE_EASY: 183,
  // Resource-presence flags.
  STAGEFILE_ABSENT: 190,
  STAGEFILE_PRESENT: 191,
  BANNER_ABSENT: 192,
  BANNER_PRESENT: 193,
  BACKBMP_ABSENT: 194,
  BACKBMP_PRESENT: 195,
  REPLAY_ABSENT: 196,
  REPLAY_PRESENT: 197,
  // Clear-lamp flags (for the focused chart). Until score history is
  // persisted, we always set NOT_PLAYED.
  LAMP_NOT_PLAYED: 100,
  LAMP_FAILED: 101,
  LAMP_EASY: 102,
  LAMP_NORMAL: 103,
  LAMP_HARD: 104,
  LAMP_FULL_COMBO: 105,
  // Clear-rank flags. Skipped until persistence lands (no rank op
  // active means "never cleared", which lines up with NOT_PLAYED).
  RANK_AAA: 110,
  RANK_AA: 111,
  RANK_A: 112,
  RANK_B: 113,
  RANK_C: 114,
  RANK_D: 115,
  RANK_E: 116,
  RANK_F: 117,
  // Difficulty enum (`#DIFFICULTY`). 150..155 cover undefined+1..5.
  DIFFICULTY_UNDEFINED: 150,
  DIFFICULTY_EASY: 151,
  DIFFICULTY_NORMAL: 152,
  DIFFICULTY_HYPER: 153,
  DIFFICULTY_ANOTHER: 154,
  DIFFICULTY_INSANE: 155,
} as const;

/**
 * Serialisable cursor / browse state. Used to round-trip the select
 * view across `dispose()` / new-instance cycles (e.g. play → return →
 * select), so the user lands back on the same song they launched.
 *
 * Folder identity travels by **label** rather than node reference
 * because each `setCollection()` call rebuilds the folder list — the
 * actual `BrowserFolderNode` objects from the previous instance no
 * longer exist by the time we restore.
 */
export interface PixiSongSelectNavigation {
  /** Sequence of folder labels from root to the deepest open folder. */
  folderPath: string[];
  /** Cursor position in the deepest entry list. */
  selectedIndex: number;
}

export interface PixiSongSelectViewOptions {
  onSongSelected?: (song: BrowserSongEntry) => void;
  /**
   * LR2 skin to render the select screen with. When provided, static
   * `#IMAGE` elements decorate the frame and `#SRC_BAR_BODY` /
   * `#DST_BAR_BODY_OFF` / `_ON` slots host the song list. Without a
   * skin the view falls back to a built-in pixel-art-style layout.
   */
  skin?: Lr2Skin;
  /**
   * Initial cursor / folder state. When provided, the view restores
   * the previous `selectedIndex` and walks back into `folderPath`
   * (skipping any segment whose label no longer exists). Used by the
   * demo to remember the focused song across play sessions.
   */
  initialNavigation?: PixiSongSelectNavigation;
}

export class PixiSongSelectView {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /** Skin static images (gated on `SELECT_DEFAULT_OPS`). */
  private readonly skinLayer = new Container();
  /** Song-bar slots — one sprite per visible bar plus its overlay text. */
  private readonly listLayer = new Container();
  private readonly title = new Text({
    text: 'Drop a BMS folder or ZIP',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 28,
      fontWeight: '700',
      fontFamily: 'system-ui, sans-serif',
    }),
  });
  private readonly hint = new Text({
    text: 'Select: Arrow keys / Enter',
    style: new TextStyle({ fill: MUTED, fontSize: 14, fontFamily: 'system-ui, sans-serif' }),
  });
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  /**
   * Current selection cursor into `currentEntries()`. Reset to 0 when
   * navigating into / out of a folder so the cursor lands on the
   * first entry of the new view.
   */
  private selectedIndex = 0;
  /**
   * Folder navigation stack. Empty = at root (showing folder bars).
   * Length-1 = inside one folder (showing its songs). LR2 only really
   * uses one nesting level today, but the array makes it trivial to
   * extend later.
   */
  private browseStack: BrowserFolderNode[] = [];
  private mountedContainer: HTMLElement | undefined;
  /**
   * Skin asset path → decoded texture cache. Populated by
   * `prepareSkinTextures()` after the view is mounted; rendering reads
   * straight from this map and silently skips bars whose texture is
   * still loading (next render tick will fill them in).
   */
  private readonly skinTextures = new Map<string, Texture>();
  /**
   * Per-song chart-asset texture cache for LR2 runtime-bound graphics
   * (`#SRC_IMAGE,gr=100/101/102` → STAGEFILE / BACKBMP / BANNER).
   * Keyed by `${song.id}:${kind}` so navigating between songs reuses
   * already-decoded banners. Loaded lazily on first reference.
   */
  private readonly chartGraphicTextures = new Map<string, Texture>();
  /** In-flight banner-load promises so we don't decode the same asset twice. */
  private readonly chartGraphicPending = new Set<string>();
  /**
   * `performance.now()` at the moment the select scene was mounted.
   * Drives the elapsed-time clock for LR2 timer 0 (scene main) so the
   * skin's intro / loop animations on `#DST_*` keyframes play out.
   */
  private sceneStartedAt = 0;
  /** rAF handle so dispose can cancel the keyframe-driven render loop. */
  private animationFrame = 0;
  /**
   * Per-timer start timestamps (`performance.now()`). LR2 select-screen
   * timers we drive:
   *
   *   - **0** — scene main, set at mount.
   *   - **1** — input start, fires `#STARTINPUT` ms after mount.
   *   - **10** — list-scroll active, set whenever the cursor moves.
   *   - **11** — song change, reset on every cursor move so
   *     `#DST_BAR_BODY` keyframes anchored to it replay their slide
   *     animation each time the user advances.
   *   - **12** — list-up scroll, set on `ArrowUp` / scroll-up moves.
   *   - **13** — list-down scroll, set on `ArrowDown` / scroll-down.
   *
   * A missing entry means the timer hasn't fired yet (`elapsed = 0`,
   * `active = false`). Inserting a new timestamp for an existing key
   * is the LR2 "timer reset" operation — DST keyframes anchored to
   * that timer will play again from time=0.
   */
  private readonly timerStartedAt = new Map<number, number>();
  /**
   * Pixel offset applied to `listLayer` during a scroll transition.
   * Right after a cursor move, the entry-to-slot mapping shifts
   * instantly; we counter that by pushing `listLayer.y` so the bars
   * appear to stay where they were, then decay the offset back to 0
   * over a few frames to produce a smooth slide.
   *
   * Convention: positive offset = "bars look like they're still at
   * the previous song's positions". For a `down` press (selectedIndex
   * +1) the entries move up one slot, so we add `+slotHeight` and
   * decay to 0 — visually this looks like the bars sliding up.
   */
  private listScrollOffset = 0;
  /**
   * `performance.now()` of the previous render frame, used to compute
   * `dt` for the scroll-offset decay so the slide speed is wall-clock
   * consistent across refresh rates.
   */
  private lastScrollUpdate = 0;
  /**
   * Last known pointer position in **design-space** coordinates, used
   * by `#SRC_ONMOUSE` hit-tests and `#SRC_MOUSECURSOR` follow. `-1`
   * means "no pointer over canvas yet"; both renderers skip drawing
   * in that case.
   */
  private mouseX = -1;
  private mouseY = -1;
  /**
   * Whether the canvas is currently shown. Tracked separately from
   * the DOM `display` style so the keyboard handler can short-circuit
   * when the host has hidden the view (e.g. while the gameplay view
   * is on top — both views' keydown listeners are bound at the
   * window level so we'd otherwise compete for arrow keys).
   */
  private visible = true;

  public constructor(private options: PixiSongSelectViewOptions = {}) {}

  public async mount(container: HTMLElement): Promise<void> {
    this.mountedContainer = container;
    await this.app.init({
      backgroundAlpha: 0,
      resizeTo: container,
      // Antialiasing off — see the matching note in `pixi-gameplay.ts`.
      // LR2 skins are pixel-art; combined with `roundPixels` and the
      // per-texture nearest scaleMode this renders crisply at any zoom.
      antialias: false,
      autoDensity: true,
      resolution: globalThis.devicePixelRatio || 1,
      // Match the gameplay view: snap sprites to integer device pixels
      // so LR2 skin assets render crisply without sub-pixel filtering.
      roundPixels: true,
    });
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'be-music song select');
    // Label every top-level node so PixiJS Devtools renders the scene
    // graph as `select > {viewport-bg, root > {bg, skin, list, title,
    // hint}}` instead of an unlabelled tower of `Container`s.
    this.app.stage.label = 'select/stage';
    this.root.label = 'select/root';
    this.viewportBackground.label = 'select/viewport-bg';
    this.background.label = 'select/background';
    this.skinLayer.label = 'select/skin';
    this.listLayer.label = 'select/list';
    this.title.label = 'select/title';
    this.hint.label = 'select/hint';
    this.app.stage.addChild(this.viewportBackground, this.root);
    this.root.addChild(this.background, this.skinLayer, this.listLayer, this.title, this.hint);
    container.appendChild(this.app.canvas);
    // Bind keyboard handlers at the window level so the user can
    // navigate without first clicking the canvas. The canvas itself
    // is a child of the document body and naturally won't have focus
    // until interacted with — which would otherwise eat ↑/↓/Enter/Esc.
    // Pointer events still bind on the canvas because their offset
    // coordinates are canvas-relative.
    window.addEventListener('keydown', this.handleKeyDown);
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.app.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.app.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    // Only preload skin assets if the skin has select-screen definitions —
    // a play-only skin would otherwise pull in the STAGE FAILED graphic,
    // gauge frame, etc. that don't belong on the select view.
    if (this.options.skin && this.options.skin.barLayout.slots.length > 0) {
      void this.prepareSkinTextures(this.options.skin);
    }
    this.sceneStartedAt = performance.now();
    // Seed timer 0 (scene main) — every static skin element is
    // anchored to it, so the keyframe interpolator needs to know
    // when "now=0" was. We don't seed timer 1 yet; `elapsedSinceTimer`
    // computes its fire moment from `#STARTINPUT` lazily.
    this.timerStartedAt.clear();
    this.timerStartedAt.set(0, this.sceneStartedAt);
    // Fire timer 11 (song change) at scene start so the BAR_BODY
    // slide-in animations play once on first appearance, just like
    // they do in real LR2 when the cursor lands on the initial song.
    this.timerStartedAt.set(11, this.sceneStartedAt);
    this.render();
    this.startAnimationLoop();
  }

  /**
   * Re-stamps the song-list timers (10, 11, 12 / 13) so DST keyframes
   * anchored to them replay from the new "time = 0", and seeds the
   * smooth-scroll offset so the bars visually slide between their
   * old and new slot positions. Called whenever the cursor moves —
   * by keyboard, click, or folder navigation.
   *
   * `delta` is the **wrapped** offset applied to `selectedIndex`
   * (always within `(-length/2, length/2]`) — wrap-around moves
   * (e.g. last → first via ↓) animate as a single step in the visual
   * direction rather than a long slide across the whole list.
   *
   * Direction-specific timers (12=up, 13=down) follow the LR2 spec
   * (`docs/LR2SkinHelp.md` lines 5097+); the canonical "song change"
   * slide is anchored to timer 11 in the LR2 default play-side and
   * select-side skins, so we always restart that one regardless of
   * direction.
   */
  private noteCursorChange(delta: number): void {
    const now = performance.now();
    this.timerStartedAt.set(10, now);
    this.timerStartedAt.set(11, now);
    this.timerStartedAt.set(delta < 0 ? 12 : 13, now);
    // Seed the scroll offset. Adding `delta * slotHeight` offsets the
    // listLayer to keep the bars visually pinned at their previous
    // positions; the per-frame decay slides them to the new slots.
    const slotHeight = this.estimateSlotHeight();
    this.listScrollOffset += delta * slotHeight;
  }

  /**
   * Estimates the vertical pitch between adjacent bar slots — used
   * to scale `listScrollOffset` so a 1-step cursor move produces a
   * 1-slot worth of visual slide. Picks the most-occupied y-delta
   * between adjacent off-slot rectangles since LR2 default skins
   * tend to have one "centre" slot at a different y than the
   * uniformly-spaced off-centre slots; the median of pairwise
   * deltas excludes that outlier.
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
   * Drives `requestAnimationFrame`-paced re-renders so DST keyframe
   * sequences (intro slide-in, loop animations, focused-bar pulse,
   * etc.) play out. Skips when no skin is mounted because the
   * fallback list UI is purely event-driven.
   */
  private startAnimationLoop(): void {
    const tick = (): void => {
      this.animationFrame = requestAnimationFrame(tick);
      const skin = this.options.skin;
      if (skin && skin.barLayout.slots.length > 0) {
        this.render();
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  public dispose(): void {
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    this.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.app.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.app.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    for (const texture of this.skinTextures.values()) {
      texture.destroy(true);
    }
    this.skinTextures.clear();
    for (const texture of this.chartGraphicTextures.values()) {
      texture.destroy(true);
    }
    this.chartGraphicTextures.clear();
    this.app.destroy(true, { children: true });
    this.mountedContainer = undefined;
  }

  /**
   * Swap the active LR2 skin without disposing the underlying
   * `Application`. Re-runs the asset preload for the new skin and
   * re-renders. Pass `undefined` to fall back to the built-in UI.
   *
   * Hosts use this instead of disposing+re-creating the view, which
   * historically tripped the PixiJS Devtools extension on the second
   * `Application.init` (`Cannot read properties of null (reading
   * 'batch')`).
   */
  public setSkin(skin: Lr2Skin | undefined): void {
    this.options = { ...this.options, skin };
    // Drop the previous skin's textures — `prepareSkinTextures` will
    // populate fresh ones for the new skin, and the chart-graphic
    // (BACKBMP / BANNER / STAGEFILE) cache stays valid since it's
    // keyed by song id, not by skin.
    for (const texture of this.skinTextures.values()) {
      texture.destroy(true);
    }
    this.skinTextures.clear();
    if (skin && skin.barLayout.slots.length > 0) {
      void this.prepareSkinTextures(skin);
    }
    this.render();
  }

  /**
   * Restores cursor / browse state externally. Same shape as the
   * `initialNavigation` constructor option, but applied to a live
   * view (e.g. when the host swaps a saved navigation snapshot back
   * in after a play session).
   */
  public setNavigation(navigation: PixiSongSelectNavigation): void {
    if (this.restoreNavigation(navigation)) {
      this.render();
    }
  }

  /**
   * Toggles the underlying canvas's visibility. Used by the host to
   * hide the select view while gameplay is on screen, instead of
   * disposing and re-creating it (which the PixiJS Devtools extension
   * doesn't tolerate well on a quick destroy+init cycle).
   */
  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.app.canvas.style.display = visible ? '' : 'none';
  }

  public setCollection(collection: BrowserSongCollection): void {
    this.collection = collection;
    this.browseStack = [];
    this.selectedIndex = 0;
    // Restore the user's prior navigation when the host passed an
    // `initialNavigation` (typical: returning from a play session).
    // Falls back to the auto-enter-single-folder behaviour when no
    // saved state exists or the saved labels no longer match.
    const restored = this.options.initialNavigation ? this.restoreNavigation(this.options.initialNavigation) : false;
    if (!restored) {
      const folders = groupSongsByFolder(collection.songs);
      if (folders.length === 1) {
        this.browseStack = [folders[0]!];
      }
    }
    this.render();
  }

  /**
   * Returns a snapshot of the current cursor / browse state suitable
   * for round-tripping through `dispose()` (when transitioning to
   * gameplay) and `initialNavigation` (when coming back). Folder
   * identity is captured by label so the snapshot is decoupled from
   * the live `BrowserFolderNode` references.
   */
  public getNavigation(): PixiSongSelectNavigation {
    return {
      folderPath: this.browseStack.map((folder) => folder.label),
      selectedIndex: this.selectedIndex,
    };
  }

  /**
   * Walks `folderPath` deepest-first, looking up each label in the
   * folder list at the matching depth. Stops as soon as a label
   * doesn't match — the partial path is still a useful restore. The
   * `selectedIndex` is clamped to the recovered list's length so the
   * cursor never lands past the end.
   */
  private restoreNavigation(navigation: PixiSongSelectNavigation): boolean {
    const stack: BrowserFolderNode[] = [];
    let folders = groupSongsByFolder(this.collection.songs);
    for (const label of navigation.folderPath) {
      const match = folders.find((folder) => folder.label === label);
      if (!match) break;
      stack.push(match);
      // Inside a folder, the next-level "folders" are derived from
      // the folder's own songs; today we only group at the top, so a
      // restored deeper path simply terminates here. Kept as
      // `groupSongsByFolder(match.songs)` so a future multi-level
      // hierarchy continues to work without changes.
      folders = groupSongsByFolder(match.songs);
    }
    if (stack.length === 0 && navigation.folderPath.length > 0) {
      // None of the saved labels matched — abort the restore so the
      // caller falls back to the default "single-folder auto-enter"
      // path instead of leaving the cursor on an unrelated entry.
      return false;
    }
    this.browseStack = stack;
    const entries =
      stack.length > 0 ? stack[stack.length - 1]!.songs.length : groupSongsByFolder(this.collection.songs).length;
    this.selectedIndex = Math.max(0, Math.min(navigation.selectedIndex, Math.max(0, entries - 1)));
    return true;
  }

  /**
   * Returns the entries to render in the bar list at the current
   * navigation depth. At the root we surface one bar per top-level
   * folder; inside a folder we surface the folder's songs.
   */
  private currentEntries(): BrowserBrowseEntry[] {
    const top = this.browseStack[this.browseStack.length - 1];
    if (top) {
      return top.songs.map((song): BrowserBrowseEntry => ({ kind: 'song', song }));
    }
    return groupSongsByFolder(this.collection.songs).map((folder): BrowserBrowseEntry => ({ kind: 'folder', folder }));
  }

  /**
   * Returns the song under the cursor, or `undefined` when the cursor
   * is on a folder bar (in which case song-info NUMBER / TEXT panels
   * leave their slots blank).
   */
  private focusedSong(): BrowserSongEntry | undefined {
    const entry = this.currentEntries()[this.selectedIndex];
    return entry?.kind === 'song' ? entry.song : undefined;
  }

  /**
   * Renders a centered hint over the skin layer when no songs are
   * loaded so the user understands the empty bar list isn't a bug.
   * Drawn straight onto `skinLayer` — same coordinate space as the
   * static frame — so it scales with the rest of the skin.
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
        fontFamily: 'system-ui, sans-serif',
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
          fontFamily: 'system-ui, sans-serif',
        }),
      });
      errorText.label = 'empty-state/errors';
      errorText.anchor.set(0.5, 0);
      errorText.position.set(skin.width / 2, skin.height / 2 + 18);
      this.skinLayer.addChild(errorText);
    }
  }

  /**
   * Pre-loads every image referenced by the skin's `#IMAGE` table and
   * its `#SRC_BAR_BODY` definitions. Loads happen in parallel; the
   * render pass is non-blocking and just skips bars whose texture
   * isn't ready yet (we re-render after each load resolves).
   */
  private async prepareSkinTextures(skin: Lr2Skin): Promise<void> {
    const referencedPaths = new Set<string>();
    for (const image of skin.images) {
      // Skip LR2-special graphic sentinels (BACKBMP / BANNER / STAGEFILE
      // / etc.) — those bind to per-song chart assets and are loaded
      // lazily by `resolveSpecialGraphicTexture()`.
      if (!isLr2SpecialGraphic(image.source.imagePath)) {
        referencedPaths.add(image.source.imagePath);
      }
    }
    for (const body of skin.barLayout.bodies) {
      referencedPaths.add(body.source.imagePath);
    }
    // NUMBER source images use the SAME path as `#IMAGE` references but
    // sliced into digit cells — preload them so the renderer can resolve
    // each digit cell from the cache.
    for (const number of skin.numbers) {
      referencedPaths.add(number.source.imagePath);
    }
    // BAR_LEVEL / LAMP / RANK sprites are usually their own texture
    // sheets, so add them too.
    for (const level of skin.barLayout.levels) {
      referencedPaths.add(level.source.imagePath);
    }
    for (const lamp of skin.barLayout.lamps) {
      referencedPaths.add(lamp.source.imagePath);
    }
    for (const rank of skin.barLayout.ranks) {
      referencedPaths.add(rank.source.imagePath);
    }
    // BUTTON elements: each one slices the same kind of cell sheet as
    // NUMBER, picking the cell index from the button's current state.
    for (const button of skin.buttons) {
      referencedPaths.add(button.source.imagePath);
    }
    // ONMOUSE / MOUSECURSOR sprites (hover overlays + custom cursor)
    // and the BAR_FLASH overlay drawn on the focused bar.
    for (const onMouse of skin.onMouseElements) {
      referencedPaths.add(onMouse.source.imagePath);
    }
    for (const cursor of skin.mouseCursors) {
      referencedPaths.add(cursor.source.imagePath);
    }
    if (skin.barLayout.flash) {
      referencedPaths.add(skin.barLayout.flash.source.imagePath);
    }
    await Promise.all(
      [...referencedPaths].map(async (path) => {
        const texture = await loadSkinAssetTexture(skin, path);
        if (texture) {
          this.skinTextures.set(path, texture);
        }
      }),
    );
    this.render();
  }

  /**
   * Tracks the pointer in design-space coordinates so `#SRC_ONMOUSE`
   * hit-tests and the `#SRC_MOUSECURSOR` follow can read from a
   * single source of truth. The math mirrors `handlePointerDown` —
   * undo the viewport scale & offset to land in skin design pixels.
   */
  private readonly handlePointerMove = (event: PointerEvent): void => {
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

  private readonly handlePointerDown = (event: PointerEvent): void => {
    // No `canvas.focus()` — we listen for `keydown` on `window`, so
    // capturing focus here would needlessly pull it away from any
    // form input the user might already be typing into.
    const skin = this.options.skin;
    const useSkin = skin !== undefined && skin.barLayout.slots.length > 0;
    const designWidth = useSkin ? skin!.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = useSkin ? skin!.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
    const virtualX = (event.offsetX - viewport.x) / viewport.scale;
    const virtualY = (event.offsetY - viewport.y) / viewport.scale;

    if (useSkin && skin) {
      // Skin layout: hit-test each available slot's BAR_BODY rect and
      // jump the selection so the clicked slot becomes the centre.
      const center = clampSlot(skin.barLayout.center, skin.barLayout.slots.length);
      const available = skin.barLayout.available > 0 ? skin.barLayout.available : skin.barLayout.slots.length;
      const slots = skin.barLayout.slots.slice(0, available);
      const entries = this.currentEntries();
      for (const slot of slots) {
        const dst = slot.off ?? slot.on;
        if (!dst) continue;
        if (containsPoint(dst, virtualX, virtualY)) {
          const offset = slot.index - center;
          // Wrap so clicking a slot above slot[center] when the cursor
          // is near `entries[0]` reaches `entries[length-1]` — the
          // circular-list expectation also applies to clicks.
          const target = wrapIndex(this.selectedIndex + offset, entries.length);
          if (target !== undefined && target !== this.selectedIndex) {
            // The clicked slot's offset directly tells us which way
            // the cursor is moving — pass `offset` as the cursor
            // delta so the slide spans `|offset|` slots.
            this.noteCursorChange(offset);
            this.selectedIndex = target;
            this.render();
          }
          const entry = target !== undefined ? entries[target] : undefined;
          if (slot.index === center && entry) {
            if (entry.kind === 'folder') {
              this.browseStack = [...this.browseStack, entry.folder];
              this.selectedIndex = 0;
              this.noteCursorChange(1);
              this.render();
            } else {
              this.options.onSongSelected?.(entry.song);
            }
          }
          return;
        }
      }
      return;
    }

    // Skin-less fallback: row-based hit-test (52px row height).
    const fallbackEntries = this.currentEntries();
    const row = Math.floor((virtualY - 104) / 52);
    if (row >= 0 && row < fallbackEntries.length) {
      const previous = this.selectedIndex;
      if (row !== previous) {
        this.noteCursorChange(wrappedCursorDelta(row - previous, fallbackEntries.length));
      }
      this.selectedIndex = row;
      this.render();
      const entry = fallbackEntries[row];
      if (entry?.kind === 'folder') {
        this.browseStack = [...this.browseStack, entry.folder];
        this.selectedIndex = 0;
        this.noteCursorChange(1);
        this.render();
      } else if (entry?.kind === 'song') {
        this.options.onSongSelected?.(entry.song);
      }
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // Don't navigate while the view is hidden — e.g. when gameplay is
    // on top. Both views attach `keydown` to the window so they can
    // capture input without canvas focus, but only the visible one
    // should react.
    if (!this.visible) {
      return;
    }
    // Skip when the user is typing into a form / contenteditable
    // element so arrow keys / Enter aren't hijacked from text input.
    if (isEditableTarget(event.target)) {
      return;
    }
    const entries = this.currentEntries();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (entries.length === 0) return;
      // Wrap past the end → first entry. Matches LR2's circular bar
      // list (the rail keeps scrolling forever in either direction).
      const previous = this.selectedIndex;
      this.selectedIndex = (this.selectedIndex + 1) % entries.length;
      this.noteCursorChange(wrappedCursorDelta(this.selectedIndex - previous, entries.length));
      this.render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (entries.length === 0) return;
      const previous = this.selectedIndex;
      this.selectedIndex = (this.selectedIndex - 1 + entries.length) % entries.length;
      this.noteCursorChange(wrappedCursorDelta(this.selectedIndex - previous, entries.length));
      this.render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[this.selectedIndex];
      if (!entry) return;
      if (entry.kind === 'folder') {
        // Drill into the folder. Reset the cursor so the user lands
        // on the first song of the folder rather than wherever the
        // root cursor happened to be.
        this.browseStack = [...this.browseStack, entry.folder];
        this.selectedIndex = 0;
        // Folder traversal: animate as a single "down" step regardless
        // of how big the index jump was, so the slide stays bounded.
        this.noteCursorChange(1);
        this.render();
      } else {
        this.options.onSongSelected?.(entry.song);
      }
    } else if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'ArrowLeft') {
      // Pop one level up — Esc / Backspace / ← all back out of the
      // current folder. No-op at the root so the user doesn't get
      // stuck on an "empty list" view by accident.
      if (this.browseStack.length === 0) return;
      event.preventDefault();
      this.browseStack = this.browseStack.slice(0, -1);
      this.selectedIndex = 0;
      this.noteCursorChange(-1);
      this.render();
    }
  };

  private render(): void {
    const screenWidth = this.app.screen.width || this.mountedContainer?.clientWidth || FALLBACK_DESIGN_WIDTH;
    const screenHeight = this.app.screen.height || this.mountedContainer?.clientHeight || FALLBACK_DESIGN_HEIGHT;
    // We only use the LR2 skin's frame + bars when it actually carries
    // select-screen definitions (`#SRC_BAR_BODY` / `#DST_BAR_BODY_*`).
    // A play-only skin like `play_7.lr2skin` would otherwise paint its
    // STAGE FAILED / gauge / etc. graphics here because they're stored
    // in the same `images` array — drop back to the built-in list when
    // that's the case.
    const skin = this.options.skin;
    const useSkin = skin !== undefined && skin.barLayout.slots.length > 0;
    const designWidth = useSkin ? skin!.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = useSkin ? skin!.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);

    // Just orphan old children — `child.destroy()` per child each
    // frame had measurable overhead and isn't necessary: orphaned
    // sprites are GC-eligible and their textures stay owned by the
    // view-level texture map.
    this.skinLayer.removeChildren();
    this.listLayer.removeChildren();

    // Decay the smooth-scroll offset toward 0. Exponential decay with
    // a ~80 ms time constant gives a snappy slide that's substantially
    // complete in a quarter second; rapid cursor presses compose
    // naturally because each new step adds onto the residual offset.
    const now = performance.now();
    if (this.lastScrollUpdate === 0) {
      this.lastScrollUpdate = now;
    }
    const dt = now - this.lastScrollUpdate;
    this.lastScrollUpdate = now;
    if (this.listScrollOffset !== 0) {
      const decay = Math.exp(-dt / 80);
      this.listScrollOffset *= decay;
      if (Math.abs(this.listScrollOffset) < 0.5) {
        this.listScrollOffset = 0;
      }
    }
    this.listLayer.y = this.listScrollOffset;

    if (useSkin && skin) {
      this.title.visible = false;
      this.hint.visible = false;
      // Compute the dynamic op set ONCE per render and thread it into
      // both renderers. Putting this here (rather than inside each
      // `isDestinationVisible` call) lets us:
      //   1. Reflect the focused song's chart features (LN, BPM change,
      //      BACKBMP presence, …) onto static frame elements that
      //      LR2 skins gate with op 70..195.
      //   2. Avoid recomputing the same `Set` per element.
      const ops = computeSelectOps(this.focusedSong());
      this.renderSkinFrame(skin, ops);
      this.renderSkinBars(skin, ops);
      // Empty-state hint — shown over the skin when nothing was
      // loaded, so the user understands they need to drop content.
      if (this.collection.songs.length === 0) {
        this.renderEmptyStateHint();
      }
      return;
    }

    this.title.visible = true;
    this.hint.visible = true;
    this.title.position.set(32, 28);
    this.title.text = this.collection.songs.length > 0 ? 'Song Select' : 'Drop a BMS folder or ZIP';
    this.hint.position.set(34, 66);
    this.hint.text =
      `${this.collection.songs.length} charts loaded` +
      (this.collection.errors.length > 0 ? ` / ${this.collection.errors.length} errors` : '') +
      '  |  Select: Arrow keys / Enter';

    const visibleRows = Math.max(1, Math.floor((designHeight - 120) / 52));
    const start = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(visibleRows / 2),
        Math.max(0, this.collection.songs.length - visibleRows),
      ),
    );
    for (let visibleIndex = 0; visibleIndex < visibleRows; visibleIndex += 1) {
      const songIndex = start + visibleIndex;
      const song = this.collection.songs[songIndex];
      if (!song) {
        break;
      }
      this.drawFallbackSongRow(song, songIndex, visibleIndex, designWidth);
    }
  }

  /**
   * Returns the per-frame interpolated DST for an element with a
   * keyframe sequence. For static elements (single keyframe or none)
   * this is a no-op that returns `element.destination`.
   *
   * Only timer 0 (scene main) is currently driven — other timers
   * resolve to elapsed=0, which yields the first keyframe. As we
   * drive more timers (timer 11 = song change for focus-bar pulse,
   * etc.), this is the single integration point.
   */
  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    if (element.keyframes.length > 1) {
      const elapsed = this.elapsedSinceTimer(element.destination.timer);
      return evaluateKeyframes(element.keyframes, elapsed);
    }
    return element.destination;
  }

  /**
   * Returns the elapsed milliseconds since `timer` started, or 0 when
   * the timer isn't currently driven. Reads `timerStartedAt` for any
   * timer the host has fired (0 / 11 at mount; 10 / 11 / 12 / 13 on
   * cursor moves). Timer 1 is computed from `#STARTINPUT` lazily so
   * we don't need a setTimeout.
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
   * Returns whether `timer` is currently active (i.e. has fired and
   * is producing meaningful elapsed-time output). Used by
   * `isDestinationVisible` so DST elements anchored to a not-yet-fired
   * timer (e.g. an idle panel-open animation) stay hidden.
   *
   * Defined as an arrow-property so callers can pass it through to
   * the free `isDestinationVisible` helper without losing `this`.
   */
  private readonly timerActive = (timer: number): boolean => {
    if (timer === 0) return true;
    if (timer === 1) {
      const startInput = this.options.skin?.timing.startInput ?? 0;
      return performance.now() - this.sceneStartedAt >= startInput;
    }
    // Song-list timers 10..13 — active once we've recorded a start
    // (i.e. the cursor moved at least once or scene-mount seeded
    // timer 11). The keyframe interpolator clamps past the final
    // frame, so leaving them "active" forever is fine.
    if (timer >= 10 && timer <= 13) {
      return this.timerStartedAt.has(timer);
    }
    // Panel timers (21..39), play timers (40+) etc. stay inactive.
    return false;
  };

  /**
   * Renders the skin's static `#IMAGE` decorations (background, frame
   * panels, banner area, etc.) plus the song-info NUMBER / TEXT panels
   * that depend on the currently-selected song. Op-gated against `ops`
   * (built by `computeSelectOps` so per-song flags affect the frame).
   */
  private renderSkinFrame(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    for (const image of skin.images) {
      // Visibility uses the interpolated DST so an alpha=0 keyframe
      // still keeps the element technically visible — only the per-DST
      // op gating (and timer activity) controls hidden vs shown.
      if (!isDestinationVisible(this.evaluateElementDst(image), ops, this.timerActive)) {
        continue;
      }
      const sprite = this.makeStaticImageSprite(image);
      if (sprite) {
        this.skinLayer.addChild(sprite);
      }
    }

    const focusedSong = this.collection.songs[this.selectedIndex];

    // Song-info NUMBER panels: BPM, total notes, play level. We resolve
    // a small whitelist of LR2 number ids relevant to the select view —
    // the gameplay-only ids (score, gauge, judges, …) leave their slots
    // blank when shown here, which matches LR2's behaviour off-stage.
    for (const number of skin.numbers) {
      const dst = this.evaluateElementDst(number);
      if (!isDestinationVisible(dst, ops, this.timerActive)) {
        continue;
      }
      const value = resolveSelectNumber(number.source.num, focusedSong);
      if (value === undefined) {
        continue;
      }
      renderNumberElement(this.skinLayer, number, value, this.skinTextures, dst);
    }

    // TEXT panels — title / artist / genre / level label / etc. LR2
    // would normally render these via `#LR2FONT`, which we don't yet
    // implement; fall back to a system-font Pixi `Text`. The `panel`
    // field hides labels scoped to closed option panels.
    for (const text of skin.texts) {
      if (!isPanelOpen(text.panel)) {
        continue;
      }
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) {
        continue;
      }
      const value = resolveSelectText(text.st, focusedSong);
      if (value === undefined || value.length === 0) {
        continue;
      }
      this.skinLayer.addChild(makeTextSprite(value, text, dst));
    }

    // BUTTON panels — sort / filter / panel-toggle / play / replay /
    // option buttons etc. We render the cell that matches the button's
    // current state (still 0 for most types since we don't yet have
    // per-type state bindings); click handling lands separately.
    for (const button of skin.buttons) {
      if (!isPanelOpen(button.panel)) {
        continue;
      }
      if (!isDestinationVisible(this.evaluateElementDst(button), ops, this.timerActive)) {
        continue;
      }
      this.renderButtonElement(button);
    }

    // ONMOUSE — hover overlays. Drawn on top of buttons / images
    // when the pointer is inside the SRC's hit-test rect (relative
    // to the DST top-left).
    for (const onMouse of skin.onMouseElements) {
      if (!isPanelOpen(onMouse.panel)) {
        continue;
      }
      const dst = this.evaluateElementDst(onMouse);
      if (!isDestinationVisible(dst, ops, this.timerActive)) {
        continue;
      }
      if (!this.isPointerInHitRect(dst, onMouse)) {
        continue;
      }
      const sprite = this.makeSlicedSprite(onMouse.source, dst, 'onmouse');
      if (sprite) {
        this.skinLayer.addChild(sprite);
      }
    }

    // MOUSECURSOR — replaces the system cursor with the skin's
    // sprite. Drawn last so it sits on top of everything else.
    if (this.mouseX >= 0 && this.mouseY >= 0) {
      for (const cursor of skin.mouseCursors) {
        const dst = this.evaluateElementDst(cursor);
        if (!isDestinationVisible(dst, ops, this.timerActive)) {
          continue;
        }
        const sprite = this.makeMouseCursorSprite(cursor, dst);
        if (sprite) {
          this.skinLayer.addChild(sprite);
        }
      }
    }
  }

  /**
   * Tests whether the current pointer position lies inside the
   * `#SRC_ONMOUSE` hit-test rectangle. The hit rect is anchored at
   * the DST top-left with `(x2, y2)` as the offset, per LR2 spec.
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
   * Builds a sprite from a source rect + interpolated DST. Used by
   * ONMOUSE rendering and the BAR_FLASH overlay. Animation cells
   * (`source.cycle > 0`) are picked via `pickAnimatedCell` so spinner
   * / pulse sprites animate correctly.
   */
  private makeSlicedSprite(source: Lr2ImageRect, dst: Lr2DestinationRect, label?: string): Sprite | undefined {
    const baseTexture = this.skinTextures.get(source.imagePath);
    if (!baseTexture) {
      return undefined;
    }
    const rect = normaliseRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    const elapsed = this.elapsedSinceTimer(source.timer);
    const cell = pickAnimatedCell(source, elapsed, dst.loop);
    const cropped = createCroppedTexture(baseTexture, cell) ?? baseTexture;
    const sprite = new Sprite(cropped);
    sprite.label = label ?? `sliced[${source.imagePath}]`;
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Renders the skin's custom cursor at the live pointer position.
   * The DST `(x, y)` is the offset from the actual mouse (typically
   * `(0, 0)` so the cursor's top-left tracks the pointer exactly).
   */
  private makeMouseCursorSprite(cursor: Lr2MouseCursorElement, dst: Lr2DestinationRect): Sprite | undefined {
    const baseTexture = this.skinTextures.get(cursor.source.imagePath);
    if (!baseTexture) {
      return undefined;
    }
    const rect = normaliseRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    const elapsed = this.elapsedSinceTimer(cursor.source.timer);
    const cell = pickAnimatedCell(cursor.source, elapsed, dst.loop);
    const cropped = createCroppedTexture(baseTexture, cell) ?? baseTexture;
    const sprite = new Sprite(cropped);
    sprite.label = 'mouse-cursor';
    sprite.position.set(this.mouseX + rect.x, this.mouseY + rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Renders a single `#SRC_BUTTON` element by cropping its cell sheet
   * to the active state index. Buttons are stateful in LR2 (sort
   * direction, current filter, panel open/close, …) but we don't yet
   * persist any of that — so the cell index defaults to 0 for every
   * button type. Switching the displayed cell is a one-line change
   * (`resolveButtonState(button.type)`) once option state is live.
   */
  private renderButtonElement(button: Lr2ButtonElement): void {
    const baseTexture = this.skinTextures.get(button.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const dst = this.evaluateElementDst(button);
    const rect = normaliseRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return;
    }
    const divx = Math.max(1, button.source.divx);
    const divy = Math.max(1, button.source.divy);
    const cellWidth = button.source.w > 0 ? button.source.w / divx : baseTexture.width / divx;
    const cellHeight = button.source.h > 0 ? button.source.h / divy : baseTexture.height / divy;
    if (cellWidth <= 0 || cellHeight <= 0) {
      return;
    }
    const stateIndex = resolveButtonStateIndex(button.type, divx * divy);
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
    this.skinLayer.addChild(sprite);
  }

  /**
   * Populates the skin's `#DST_BAR_BODY_OFF` / `_ON` slots with songs
   * from the current collection, with the `selectedIndex` song landing
   * at the `BAR_CENTER` slot. Slots outside `BAR_AVAILABLE` still
   * render (LR2 spec: they decorate the scroll edges) but no song is
   * mapped to them.
   */
  private renderSkinBars(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    const layout = skin.barLayout;
    if (layout.slots.length === 0) {
      return;
    }
    const slotCount = layout.slots.length;
    const center = clampSlot(layout.center, slotCount);
    // Choose the OFF/ON state per slot — only the centre slot uses ON.
    const entries = this.currentEntries();
    for (const slot of layout.slots) {
      const offset = slot.index - center;
      // Wrap so off-edge slots show entries from the opposite end.
      // E.g. with 3 entries and a slot below the cursor's "current+3"
      // position, the slot displays `entries[0]` again — matching
      // LR2's circular rail rendering.
      const targetIndex = wrapIndex(this.selectedIndex + offset, entries.length);
      const entry = targetIndex !== undefined ? entries[targetIndex] : undefined;
      const isCenter = slot.index === center;
      // Interpolate the slot's keyframe chain instead of pinning to
      // the final keyframe. The skin typically anchors `#DST_BAR_BODY`
      // animations to timer 11 (song change), which we re-stamp on
      // every cursor move via `noteCursorChange`, so the bars slide
      // into their new positions over the keyframe duration.
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
        // BAR_TITLE DST x/y are RELATIVE to the bar's top-left
        // (`bar.txt`: "DST座標はバーのxy座標からの相対位置を指定").
        const titleRect = layout.title?.destination ?? { x: 12, y: 8, w: dst.w - 24, h: 20 };
        this.drawBarTitleText(entry, dst, titleRect);
      }
      // BAR_LEVEL: per-bar level number for SONG entries only. Folder
      // entries don't carry a level so they leave the slot blank.
      if (entry?.kind === 'song' && layout.levels.length > 0 && layout.levelDestination) {
        this.drawBarLevel(entry.song, dst, layout.levels, layout.levelDestination);
      }
      // BAR_FLASH: focused-bar overlay. DST is relative to the bar
      // (like BAR_TITLE), so we add the bar's xy onto the flash DST
      // before drawing.
      if (isCenter && layout.flash) {
        this.drawBarFlash(layout.flash, dst);
      }
      // BAR_LAMP / BAR_RANK: skipped for now because we don't yet
      // persist clear-history per song. Once a score record exists,
      // pick `layout.lamps[scoreLamp]` / `layout.ranks[scoreRank]` and
      // render via the same offset-by-bar formula as BAR_TITLE.
    }
  }

  /**
   * Renders the `#SRC_BAR_FLASH` overlay on the focused bar. The
   * DST coordinates in the flash element are **relative** to the
   * focused bar's `BAR_BODY_ON` rect, mirroring how BAR_TITLE /
   * BAR_LEVEL place themselves. We compose the absolute DST and then
   * delegate to `makeSlicedSprite` so any animation cycle / cell
   * cycling is honoured.
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
   * Renders the per-bar level number sprite for `song`. Picks the
   * `#SRC_BAR_LEVEL` entry whose kind matches the chart's `#DIFFICULTY`
   * field (1=BEGINNER..5=INSANE), falling back to the "undefined" kind
   * when no specific entry is available. The DST offset is added on top
   * of the bar's own xy because LR2 scopes BAR_LEVEL coordinates to the
   * bar's top-left.
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
    };
    renderNumberElement(this.listLayer, fakeNumberElement, playLevel, this.skinTextures, absoluteDst);
  }

  private makeStaticImageSprite(image: Lr2ImageElement): Sprite | undefined {
    const path = image.source.imagePath;
    let texture = this.skinTextures.get(path);
    if (!texture && isLr2SpecialGraphic(path)) {
      texture = this.resolveSpecialGraphicTexture(path);
    }
    if (!texture) {
      return undefined;
    }
    const dst = this.evaluateElementDst(image);
    const rect = normaliseRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    // For special graphics the SRC rect's `(x, y, w, h)` indexes into a
    // 1×1 placeholder, not the real banner — sample the full live
    // texture instead so the banner uses its native dimensions.
    let cropped: Texture;
    if (isLr2SpecialGraphic(path)) {
      cropped = texture;
    } else {
      // Use `pickAnimatedCell` so `source.cycle > 0` images (spinning
      // markers, animated frame decorations, …) cycle through their
      // divx*divy cells. Static images return cell (0, 0) at native
      // size, identical to the previous `cropTexture` behaviour.
      const elapsed = this.elapsedSinceTimer(image.source.timer);
      const cell = pickAnimatedCell(image.source, elapsed, dst.loop);
      cropped = createCroppedTexture(texture, cell) ?? texture;
    }
    const sprite = new Sprite(cropped);
    sprite.label = `image[${path}]`;
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Returns the live texture bound to one of LR2's runtime-resolved
   * graphic slots (BACKBMP / BANNER / STAGEFILE / black / white).
   * Triggers an async load on first miss, returning `undefined` until
   * the asset is decoded; the next `render()` tick will pick up the
   * cached texture.
   */
  private resolveSpecialGraphicTexture(path: Lr2SpecialGraphic): Texture | undefined {
    if (path === LR2_SPECIAL_GRAPHIC.BLACK) {
      return Texture.WHITE; // tinted via DST `r/g/b=0` in `applyDestinationToSprite`
    }
    if (path === LR2_SPECIAL_GRAPHIC.WHITE) {
      return Texture.WHITE;
    }
    const song = this.collection.songs[this.selectedIndex];
    if (!song) {
      return undefined;
    }
    const cacheKey = `${song.id}:${path}`;
    const cached = this.chartGraphicTextures.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (!this.chartGraphicPending.has(cacheKey)) {
      this.chartGraphicPending.add(cacheKey);
      void this.loadChartGraphic(song, path, cacheKey);
    }
    return undefined;
  }

  private async loadChartGraphic(song: BrowserSongEntry, path: Lr2SpecialGraphic, cacheKey: string): Promise<void> {
    try {
      // Unified metadata slots now carry both BMS (`#BACKBMP` /
      // `#BANNER` / `#STAGEFILE`) and bmson-derived fields, so the
      // lookup no longer needs to branch on chart format.
      const meta = song.chart.metadata;
      const assetPath =
        path === LR2_SPECIAL_GRAPHIC.BACKBMP
          ? meta.backBmp
          : path === LR2_SPECIAL_GRAPHIC.BANNER
            ? meta.banner
            : path === LR2_SPECIAL_GRAPHIC.STAGEFILE
              ? meta.stageFile
              : undefined;
      if (!assetPath) {
        return;
      }
      const source = resolveSongSource(this.collection, song);
      if (!source) {
        return;
      }
      const bytes = resolveChartAsset(source, song.chartPath, assetPath);
      if (!bytes) {
        return;
      }
      const texture = await loadTextureFromBytes(assetPath, bytes);
      if (texture) {
        this.chartGraphicTextures.set(cacheKey, texture);
        this.render();
      }
    } finally {
      this.chartGraphicPending.delete(cacheKey);
    }
  }

  private makeBarBodySprite(
    texture: Texture,
    source: Lr2ImageRect,
    destination: Lr2DestinationRect,
    label?: string,
  ): Sprite | undefined {
    const rect = normaliseRect(destination);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    // BAR_BODY may animate (glow rotation, focus pulse) via the
    // source's `cycle` ms over its `divx * divy` cells. We resolve the
    // active cell here so the bar sprite changes frame over time when
    // the skin defines an animation.
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
   * Draws the song title (and a compact metadata strip) at the
   * `BAR_TITLE` destination (xy relative to the bar's top-left). LR2
   * font rendering isn't supported yet, so we fall back to Pixi's
   * built-in `Text` for now.
   */
  private drawBarTitleText(
    entry: BrowserBrowseEntry,
    bar: Lr2DestinationRect,
    title: { x: number; y: number; w: number; h: number },
  ): void {
    const x = bar.x + title.x;
    const y = bar.y + title.y;
    const w = Math.max(1, title.w);
    const h = Math.max(1, title.h);
    // LR2 default skins use pixel-art fonts (typically 12px tall) for
    // BAR_TITLE; Pixi `Text` with the system sans-serif is taller
    // pixel-for-pixel, so cap the font size at 14px and leave 2px
    // breathing room below `h`. The previous `h * 0.7` formula made
    // the title overflow horizontally on narrow bars.
    const titleFontSize = clampFontSize(h - 2, 8, 14);
    const primaryText = entry.kind === 'song' ? entry.song.title : entry.folder.label;
    const titleText = new Text({
      text: primaryText,
      style: new TextStyle({
        fill: TEXT,
        fontSize: titleFontSize,
        // System sans-serif looks too "thick" at small sizes vs an
        // image font. A regular weight reads cleaner — bold should
        // come back once we wire up `#LR2FONT`.
        fontWeight: '500',
        fontFamily: 'system-ui, sans-serif',
        wordWrap: true,
        wordWrapWidth: w,
      }),
    });
    titleText.label = `bar-title[${entry.kind}=${primaryText}]`;
    titleText.position.set(x, y);
    this.listLayer.addChild(titleText);
    // No artist sub-line: LR2's bar list shows just the title (or
    // folder name). Per-song artist / genre live in the dedicated
    // info panel on the left side of the screen, populated by the
    // skin's #SRC_TEXT slots — not the bar list itself.
  }

  private drawFallbackSongRow(song: BrowserSongEntry, songIndex: number, visibleIndex: number, width: number): void {
    const y = 104 + visibleIndex * 52;
    const row = new Graphics();
    const active = songIndex === this.selectedIndex;
    row.label = `fallback-row[idx=${songIndex}${active ? ',active' : ''}]`;
    row
      .roundRect(28, y, Math.max(0, width - 56), 44, 8)
      .fill({ color: active ? ACTIVE : PANEL, alpha: active ? 0.95 : 0.72 });
    this.listLayer.addChild(row);

    const title = new Text({
      text: song.title,
      style: new TextStyle({
        fill: active ? 0x111318 : TEXT,
        fontSize: 18,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
      }),
    });
    title.label = `fallback-title[idx=${songIndex}]`;
    title.position.set(44, y + 6);
    this.listLayer.addChild(title);

    const meta = new Text({
      text: [
        song.artist,
        song.playLevel !== undefined ? `Lv ${song.playLevel}` : undefined,
        song.bpm ? `BPM ${song.bpm}` : undefined,
        song.fileLabel,
      ]
        .filter(Boolean)
        .join('  /  '),
      style: new TextStyle({
        fill: active ? 0x34302a : MUTED,
        fontSize: 12,
        fontFamily: 'system-ui, sans-serif',
      }),
    });
    meta.label = `fallback-meta[idx=${songIndex}]`;
    meta.position.set(44, y + 28);
    this.listLayer.addChild(meta);
  }
}

function resolveScaledViewport(
  screenWidth: number,
  screenHeight: number,
  designWidth: number = LR2_DESIGN_WIDTH,
  designHeight: number = LR2_DESIGN_HEIGHT,
): { x: number; y: number; scale: number } {
  const scale = Math.min(screenWidth / designWidth, screenHeight / designHeight);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: (screenWidth - designWidth * safeScale) / 2,
    y: (screenHeight - designHeight * safeScale) / 2,
    scale: safeScale,
  };
}

function clampSlot(value: number, slotCount: number): number {
  if (slotCount <= 0) return 0;
  return Math.min(slotCount - 1, Math.max(0, Math.trunc(value)));
}

/**
 * Maps any integer (including negatives or values past the end) into
 * `[0, count)` by modular arithmetic. Returns `undefined` when the
 * list is empty so the caller can decide what to draw (or skip).
 *
 * Used by both the cursor → slot mapping and click hit-tests so the
 * bar list behaves like a circular rail — scrolling past the end
 * wraps to the start, and slots above / below the cursor that would
 * normally land in negative-index territory show entries from the
 * opposite end of the list instead of being blank.
 */
function wrapIndex(target: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  return ((target % count) + count) % count;
}

/**
 * Maps a raw `(new - old)` cursor delta into a wrapped delta in the
 * range `(-count/2, count/2]`. Used so a wrap-around move (e.g. from
 * `entries[0]` ↑ to `entries[length-1]`) animates as a single
 * "back by 1" step rather than a long slide spanning the whole list.
 *
 * Examples (length = 10):
 *   delta=+1 → +1  (forward 1 step)
 *   delta=-1 → -1  (backward 1 step)
 *   delta=+9 → -1  (wrap forward = visually 1 step back)
 *   delta=-9 → +1  (wrap backward = visually 1 step forward)
 */
function wrappedCursorDelta(rawDelta: number, count: number): number {
  if (count <= 0) return 0;
  const half = count / 2;
  return ((((rawDelta + half) % count) + count) % count) - half;
}

/**
 * Returns `true` when the keydown target is a text-editable element
 * (`<input>` / `<textarea>` / `<select>` / `contenteditable`). The
 * select view's keyboard handlers use this to bail so the user can
 * type into form fields without arrow keys hijacking the bar list.
 *
 * `<input type="checkbox">` / `<input type="file">` pass through —
 * those don't capture text input and the user expects arrow keys to
 * still drive the song list while a checkbox happens to be focused.
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
  const r = normaliseRect(rect);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Picks the bar-body sprite definition for a slot. Maps the entry
 * kind (`'song'` / `'folder'`) onto the matching `#SRC_BAR_BODY` art,
 * falling back to a `'song'` body when the skin doesn't define a
 * folder variant, and finally the first available body. Slots with
 * no entry (i.e. out-of-range when the cursor is near the start /
 * end of the list) still get a body sprite so the empty slats keep
 * rendering — that matches LR2's behaviour where the rail draws even
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
 * Slot DST gating: applies the same "all `op > 0` must be true,
 * negative ops mean negation" rule the parser uses, but against the
 * dynamic op set computed for the currently-focused song.
 *
 * `timerActive` is a closure over `PixiSongSelectView.isTimerActive`
 * — pulled in as a callback so this function can stay outside the
 * class while still respecting per-instance timer state (the
 * song-change timer 11 only fires while *this* view's cursor moves).
 */
function isDestinationVisible(
  destination: Lr2DestinationRect,
  ops: ReadonlySet<number>,
  timerActive: (timer: number) => boolean,
): boolean {
  if (!timerActive(destination.timer)) {
    return false;
  }
  for (const op of destination.ops) {
    if (op === 0) continue;
    if (op > 0) {
      if (!ops.has(op)) {
        return false;
      }
    } else if (ops.has(-op)) {
      return false;
    }
  }
  return true;
}

/**
 * Builds the full op set used to gate select-screen DST elements.
 * Combines the always-true `SELECT_BASE_OPS` with per-song flags
 * derived from the focused chart's metadata, resources and event log:
 *
 * - **Bar type** (op 1..4) — currently always 'song' since folder /
 *   course bars aren't modelled.
 * - **Key mode** (op 70..74) — picks the slot matching the focused
 *   chart's `modeHint` (`'7K'`, `'10K'`, …).
 * - **Chart-feature flags** (op 170..179) — long-notes presence, BPM
 *   changes, RANDOM control flow, BGA events, attached text. We expose
 *   both the `_PRESENT` and `_ABSENT` slots so skins that gate on
 *   either branch render correctly.
 * - **Resource flags** (op 190..195) — STAGEFILE / BANNER / BACKBMP
 *   presence on the focused chart.
 *
 * Without a focused song we still set the defaults so empty-list
 * frames render reasonably.
 */
function computeSelectOps(song: BrowserSongEntry | undefined): ReadonlySet<number> {
  const ops = new Set<number>(SELECT_BASE_OPS);
  if (!song) {
    // Nothing focused — set all `_ABSENT` slots and a sensible "no
    // play data" lamp so the skin's empty-list branch renders.
    ops.add(SELECT_DYNAMIC_OPS.BGA_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.LN_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.TEXT_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.BPM_CHANGE_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.RANDOM_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.STAGEFILE_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.BANNER_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.BACKBMP_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.REPLAY_ABSENT);
    ops.add(SELECT_DYNAMIC_OPS.JUDGE_NORMAL);
    ops.add(SELECT_DYNAMIC_OPS.LAMP_NOT_PLAYED);
    ops.add(SELECT_DYNAMIC_OPS.DIFFICULTY_UNDEFINED);
    ops.add(SELECT_DYNAMIC_OPS.KEYS_7);
    return ops;
  }

  // Bar type — every entry is a "song" today (folder / course bars
  // arrive when we model directory / course hierarchies). op 5 marks
  // the cursor as on a playable bar (true for both songs and courses).
  ops.add(SELECT_DYNAMIC_OPS.BAR_IS_SONG);
  ops.add(SELECT_DYNAMIC_OPS.BAR_IS_PLAYABLE);

  // Key mode (160..164). Derived from `modeHint` first, falling back
  // to `#PLAYER` (3 = DP) and finally to 7K — matches what real LR2
  // does when no explicit hint is present.
  ops.add(resolveKeyModeOp(song));

  // Chart-feature flags.
  const features = detectChartFeatures(song);
  ops.add(features.bga ? SELECT_DYNAMIC_OPS.BGA_PRESENT : SELECT_DYNAMIC_OPS.BGA_ABSENT);
  ops.add(features.longNote ? SELECT_DYNAMIC_OPS.LN_PRESENT : SELECT_DYNAMIC_OPS.LN_ABSENT);
  ops.add(features.text ? SELECT_DYNAMIC_OPS.TEXT_PRESENT : SELECT_DYNAMIC_OPS.TEXT_ABSENT);
  ops.add(features.bpmChange ? SELECT_DYNAMIC_OPS.BPM_CHANGE_PRESENT : SELECT_DYNAMIC_OPS.BPM_CHANGE_ABSENT);
  ops.add(features.random ? SELECT_DYNAMIC_OPS.RANDOM_PRESENT : SELECT_DYNAMIC_OPS.RANDOM_ABSENT);

  // Judge rank (`#RANK` 0..3 → very hard / hard / normal / easy).
  ops.add(resolveJudgeRankOp(song));

  // Difficulty (`#DIFFICULTY` 0..5 → undefined / easy / normal / hyper / another / insane).
  ops.add(resolveDifficultyOp(song));

  // Resource flags. The unified `metadata.{stageFile,backBmp,banner}`
  // slots cover both BMS-text-format `#STAGEFILE` / `#BACKBMP` /
  // `#BANNER` and the bmson-side `info.{eyecatchImage,backImage,
  // bannerImage}` fields after they're mirrored by the parser.
  ops.add(song.chart.metadata.stageFile ? SELECT_DYNAMIC_OPS.STAGEFILE_PRESENT : SELECT_DYNAMIC_OPS.STAGEFILE_ABSENT);
  ops.add(song.chart.metadata.banner ? SELECT_DYNAMIC_OPS.BANNER_PRESENT : SELECT_DYNAMIC_OPS.BANNER_ABSENT);
  ops.add(song.chart.metadata.backBmp ? SELECT_DYNAMIC_OPS.BACKBMP_PRESENT : SELECT_DYNAMIC_OPS.BACKBMP_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.REPLAY_ABSENT);

  // Clear-lamp — until score persistence lands, every chart is "NOT
  // PLAYED". When we add history, this becomes a lookup.
  ops.add(SELECT_DYNAMIC_OPS.LAMP_NOT_PLAYED);

  return ops;
}

/**
 * Picks the LR2 `#RANK`-derived op slot. BMS `#RANK` values:
 * 0=very hard, 1=hard, 2=normal, 3=easy. bmson uses `judgeRank`
 * percentage (~150% normal); we map to op 182 (normal) when unset.
 */
function resolveJudgeRankOp(song: BrowserSongEntry): number {
  const rank = song.chart.metadata.rank;
  switch (rank) {
    case 0:
      return SELECT_DYNAMIC_OPS.JUDGE_VERY_HARD;
    case 1:
      return SELECT_DYNAMIC_OPS.JUDGE_HARD;
    case 2:
      return SELECT_DYNAMIC_OPS.JUDGE_NORMAL;
    case 3:
      return SELECT_DYNAMIC_OPS.JUDGE_EASY;
    default:
      return SELECT_DYNAMIC_OPS.JUDGE_NORMAL;
  }
}

/**
 * Picks the LR2 `#DIFFICULTY` op slot from the chart. The spec lists
 * 150..155 for "undefined / easy / normal / hyper / another / insane".
 */
function resolveDifficultyOp(song: BrowserSongEntry): number {
  switch (song.chart.metadata.difficulty) {
    case 1:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_EASY;
    case 2:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_NORMAL;
    case 3:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_HYPER;
    case 4:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_ANOTHER;
    case 5:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_INSANE;
    default:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_UNDEFINED;
  }
}

/**
 * Picks the LR2 op slot (160..164) for the focused chart's key mode.
 * Always returns a value — falls back to 7K when no other hint is
 * available, since play_7.lr2skin is the standard theme.
 */
function resolveKeyModeOp(song: BrowserSongEntry): number {
  const modeHint = song.chart.bmson.info?.modeHint?.toLowerCase() ?? '';
  // Order matters — check the longer "14K" / "10K" / "9K" tokens before
  // "5K" / "7K" so e.g. "5k" doesn't accidentally match inside "75k".
  if (modeHint.includes('14k')) return SELECT_DYNAMIC_OPS.KEYS_14;
  if (modeHint.includes('10k')) return SELECT_DYNAMIC_OPS.KEYS_10;
  if (modeHint.includes('9k')) return SELECT_DYNAMIC_OPS.KEYS_9;
  if (modeHint.includes('7k')) return SELECT_DYNAMIC_OPS.KEYS_7;
  if (modeHint.includes('5k')) return SELECT_DYNAMIC_OPS.KEYS_5;
  // BMS `#PLAYER` 1=SP, 3=DP — DP charts default to 14K.
  if (song.chart.bms.player === 3) return SELECT_DYNAMIC_OPS.KEYS_14;
  return SELECT_DYNAMIC_OPS.KEYS_7;
}

/**
 * Inspects a chart's events / control flow to decide which feature
 * flags to set. Each detection is a quick scan over the relevant
 * collection — cheap because it only runs once per cursor move.
 */
function detectChartFeatures(song: BrowserSongEntry): {
  bga: boolean;
  longNote: boolean;
  text: boolean;
  bpmChange: boolean;
  random: boolean;
} {
  const chart = song.chart;
  // BGA channels: 04 (base), 06 (poor), 07 / 0A (layers).
  const bga = chart.events.some((event) => /^(04|06|07|0a)$/iu.test(event.channel));
  // LN: BMS-text uses `#LNOBJ` markers or channel 5x / 6x events.
  // Both live under `chart.bms` (the BmsExtensions block).
  const longNote =
    (chart.bms.lnObjs?.length ?? 0) > 0 ||
    chart.events.some((event) => event.channel.startsWith('5') || event.channel.startsWith('6'));
  // Attached text: `#TEXT` resources.
  const text = Object.keys(chart.resources.text).length > 0;
  // BPM change: channel 03 (inline hex) or 08 (lookup) carries BPM ops.
  const bpmChange = chart.events.some((event) => event.channel === '03' || event.channel === '08');
  // RANDOM control-flow lives in `chart.bms.controlFlow` and uses the
  // typed `command: 'RANDOM' | 'SETRANDOM' | …` shape, not a generic
  // string channel — match on the directive command directly.
  const random = chart.bms.controlFlow.some(
    (entry) => entry.kind === 'directive' && (entry.command === 'RANDOM' || entry.command === 'SETRANDOM'),
  );
  return { bga, longNote, text, bpmChange, random };
}

/**
 * Resolves an LR2 `#SRC_TEXT` source-type (`st`) onto a string from the
 * currently-focused song. Mirrors `pixi-gameplay.ts`'s resolver but for
 * the static select-screen subset. Returns `undefined` for st codes
 * outside the song-info range so the caller can skip painting. Codes
 * 10..15 / 17..18 (single-digit) and 20..28 (double-digit) are treated
 * the same — LR2 uses the second range for "subtitle / sub-artist /
 * etc." rendering on a separate layer, but practically the value
 * resolves identically.
 */
function resolveSelectText(st: number, song: BrowserSongEntry | undefined): string | undefined {
  // Slots that don't depend on a focused song.
  switch (st) {
    case 1:
      // Target / rival / cursor name. We don't ship rival mode yet —
      // surface a placeholder so the panel doesn't read empty.
      return 'TARGET';
    case 2:
      // Player name. Placeholder until a profile system exists.
      return 'PLAYER';
    case 30:
      // Search box content / jukebox name. We don't model search
      // yet, so return an empty string to keep the panel rendering.
      return '';
    case 50: // skin name
      return 'LR2 SELECT';
    case 51: // skin author
      return '';
    // Option-panel labels (60..85). These come from the skin's
    // option-state machine, which isn't wired yet — return a blank
    // string so the field renders without exposing stale data.
    case 60: // playmode
    case 61: // sort
    case 62: // difficulty
    case 63: // random 1P
    case 64: // random 2P
    case 65: // gauge 1P
    case 66: // gauge 2P
    case 67: // assist 1P
    case 68: // assist 2P
    case 69: // battle
    case 70: // flip
    case 71: // scoregraph
    case 72: // ghost
    case 73: // shutter
    case 74: // scroll type
    case 75: // bga size
    case 76: // bga
    case 77: // color depth
    case 78: // vsync
    case 79: // screen mode
    case 80: // judge auto
    case 81: // replay save mode
    case 82: // trial line 1
    case 83: // trial line 2
    case 84: // effect 1P
    case 85: // effect 2P
      return '';
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
      // 発狂レベル (insane level) — same source as playLevel for now,
      // since we don't ship a separate insane-table integration.
      return song.chart.metadata.difficulty === 5 ? (song.playLevel?.toString() ?? '') : '';
    default:
      return undefined;
  }
}

/**
 * Resolves an LR2 `#SRC_NUMBER` source-num onto a numeric value pulled
 * from the focused song's metadata or static skin state. Numbers map
 * to the canonical slots in `docs/LR2SkinHelp.md` `# num 一覧`:
 *
 * - **10..15** — play option values (HS, JUDGE TIMING, SUD+). Mostly
 *   placeholder until preferences persist.
 * - **20..26** — fps / date / time. Only `20=fps` actively varies.
 * - **30..41** — lifetime player stats (TOTAL PLAY/CLEAR/FAIL/judges,
 *   running combo, trial level). All `0` until persistence ships.
 * - **45..49** — same-folder difficulty levels (beginner..insane). We
 *   don't model the folder concept yet.
 * - **70..91** — best-score panel for the focused chart. Most are
 *   `undefined` until score history persists; chart-side stats
 *   (totalnotes, BPM max/min) are computed from the chart on the fly.
 * - **92..94** — IR (online-only) — always `undefined`.
 * - **160** — initial BPM (matches the gameplay `bpm` field).
 *
 * Returning `undefined` makes the renderer skip the slot, leaving it
 * blank — which matches LR2's behaviour when no value is bound.
 */
function resolveSelectNumber(num: number, song: BrowserSongEntry | undefined): number | undefined {
  // Slots that don't depend on a focused song.
  switch (num) {
    case 20:
      // FPS — `pixi-select` doesn't sample its own frame rate yet, so
      // surface 60 as a placeholder rather than leaving the panel blank.
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
    // Lifetime player stats (30..41). 0 placeholders until we add a
    // persistence layer for play history.
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
    // Play-option slots (10..15). Placeholder defaults — once the
    // option panel state lives in a store, switch to that.
    case 10: // HS-1P (×100, e.g. 230 = 2.30×)
    case 11: // HS-2P
      return 100;
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
    // Best-score panel (70..89). 0 placeholders for slots that need
    // score history; chart-derived ones (72/74) compute live.
    case 70: // best score
    case 71: // best exscore
      return 0;
    case 72: // exscore 理論値 (= totalnotes * 2)
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
    // BPM range (90/91). Computed by scanning channel-03 / channel-08
    // events; charts without BPM changes get the initial BPM for both.
    case 90:
      return resolveBpmRange(song).max;
    case 91:
      return resolveBpmRange(song).min;
    // IR slots (92..94) — undefined until online support arrives.
    case 92:
    case 93:
    case 94:
      return undefined;
    // Same-folder difficulty levels (45..49). We don't model folders
    // yet, so surface the focused chart's level under whichever slot
    // matches its difficulty and leave the others blank.
    case 45:
    case 46:
    case 47:
    case 48:
    case 49: {
      const expectedDifficulty = num - 44; // 45 → diff=1 (beginner), 49 → diff=5 (insane)
      return song.chart.metadata.difficulty === expectedDifficulty ? playLevelOrUndef : undefined;
    }
    case 160:
      // Initial BPM. The LR2 spec marks this as "live BPM"; on the
      // select screen the chart isn't playing, so the initial BPM is
      // the right read.
      return song.bpm;
    default:
      return undefined;
  }
}

/**
 * Computes the focused chart's BPM range. Scans BPM-change events
 * (channel 03 = inline hex BPM, channel 08 = lookup via
 * `resources.bpm`) plus the initial BPM. Cheap because it only runs
 * when a num=90 / num=91 slot is rendered (i.e. once per cursor move).
 */
function resolveBpmRange(song: BrowserSongEntry): { min: number; max: number } {
  // `BrowserSongEntry.bpm` is optional; fall back to the chart's
  // metadata BPM (which is non-optional in the json type) before
  // scanning events so the range never starts as `undefined`.
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
 * Maps the BMS `#DIFFICULTY` code to the LR2 label string. Mirrors the
 * gameplay-side helper of the same name so the select view shows the
 * same vocabulary.
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
 * Builds a Pixi `Text` sprite for a `#SRC_TEXT` element using the
 * built-in font. We don't yet implement `#LR2FONT` (image-font sheets),
 * so this is a best-effort fallback whose alignment / wrap matches the
 * skin's `align` field but uses a system sans-serif typeface.
 */
function makeTextSprite(value: string, element: Lr2TextElement, dst: Lr2DestinationRect = element.destination): Text {
  const rect = normaliseRect(dst);
  // System sans-serif at the same point-size as a pixel font reads
  // visibly larger; cap at min(rect.h - 2, 18) instead of `rect.h * 0.8`
  // so titles like "Alternate Ignition" still fit inside narrow LR2
  // text panels until `#LR2FONT` rendering replaces this fallback.
  const fontSize = clampFontSize(rect.h - 2, 8, 18);
  const text = new Text({
    text: value,
    style: new TextStyle({
      fill: dst.alpha > 0 ? (dst.r << 16) | (dst.g << 8) | dst.b : 0xffffff,
      fontSize,
      fontFamily: 'system-ui, sans-serif',
      wordWrap: rect.w > 0,
      wordWrapWidth: rect.w > 0 ? rect.w : undefined,
    }),
  });
  text.label = `text[st=${element.st}]`;
  text.alpha = dst.alpha;
  // LR2 #SRC_TEXT alignment (`docs/LR2SkinHelp.md` lines 1350+):
  //   0 = left   — DST x is the **left edge** of the rendered string
  //   1 = center — DST x is the **center**   of the rendered string
  //   2 = right  — DST x is the **right edge** of the rendered string
  // The earlier code was treating (x, y, w, h) as a bounding box and
  // adding `w` / `w/2` for center / right, which shifted right-aligned
  // text by an extra `w` pixels — pushing the title / artist / genre
  // panel into the bar-list area on the right side of the screen.
  if (element.alignment === 'center') {
    text.anchor.set(0.5, 0);
  } else if (element.alignment === 'right') {
    text.anchor.set(1, 0);
  } else {
    text.anchor.set(0, 0);
  }
  text.position.set(rect.x, rect.y);
  return text;
}

/**
 * Clamps a font-size suggestion (typically derived from a DST rect's
 * `h` value) into a sensible range. Pixi `Text` looks visibly larger
 * than an LR2 image font at the same nominal pixel size, so callers
 * pass tighter `max` bounds than they would for a pixel font.
 */
function clampFontSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Returns whether an element with the given `panel` gate should
 * currently render. Per LR2 spec:
 *
 *   - `panel = 0` → always render (default).
 *   - `panel = -1` → only when no option panel is open. We don't
 *     model panels yet, so this branch is always true.
 *   - `panel = 1..9` → only when that specific panel is open. Always
 *     hidden until the panel system is implemented.
 */
function isPanelOpen(panel: number): boolean {
  if (panel === 0) return true;
  if (panel === -1) return true;
  return false;
}

/**
 * Returns the cell index a `#SRC_BUTTON` should display for the
 * current option state. Mapped per LR2 `# button_type 一覧`
 * (`docs/LR2SkinHelp.md` lines 5887+). Until the select view tracks
 * its own option / panel / filter state, every type returns its
 * "default" cell (0 for most enums, the OFF cell for toggles). The
 * `cellCount = divx * divy` cap prevents an out-of-range index from
 * sampling outside the source rect.
 */
function resolveButtonStateIndex(type: number, cellCount: number): number {
  // Hook point for future state lookup. For now, every button shows
  // its baseline ("OFF" / "ALL" / "GROOVE" / etc.) artwork.
  const stateIndex = 0;
  return Math.max(0, Math.min(cellCount - 1, stateIndex));
}

/**
 * Maps the BMS `#DIFFICULTY` field (1=BEGINNER..5=INSANE, 0/missing =
 * undefined) to the LR2 `#SRC_BAR_LEVEL` kind enum. The "irRanking"
 * kind isn't a chart attribute — it shows up only in IR mode, which we
 * don't simulate yet, so we never select it from this mapping.
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

// Re-export the slot type so consumers (tests, future helpers) can
// reach it without dipping into the parser module directly.
export type { Lr2BarBodySlot };
