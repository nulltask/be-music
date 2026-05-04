import {
  BrowserSongLibrary,
  PixiGameplayView,
  PixiDecideView,
  PixiResultView,
  PixiSceneHost,
  PixiSongSelectView,
  checkBrowserCompat,
  describeSongCollection,
  downloadBlob,
  loadLr2ThemeSkinsFromFiles,
  makeWebmSeekable,
  parseCompressorMode,
  pickLr2PlaySkin,
  readDroppedFiles,
  resolveSongSource,
  splitDroppedSongAndThemeFiles,
  summarizeBrowserCompat,
  summarizeLr2PlaySkins,
  type BrowserCompatReport,
  type BrowserSongCollection,
  type BrowserSongEntry,
  type CompressorMode,
  type LoadProgress,
  type Lr2PlayVariant,
  type Lr2PlaySkinMap,
  type Lr2Skin,
  type PixiGameplayResultData,
  type PixiSongSelectNavigation,
} from '@be-music/player-web-core';
// lil-gui auto-injects its stylesheet at construction time (see
// `injectStyles` option, default `true`), so we don't import its
// CSS explicitly — its package.json doesn't expose the file via
// `exports` anyway.
import GUI, { type Controller } from 'lil-gui';
// Virtual module produced by the `be-music:acknowledgements`
// Vite plugin (see `vite.config.ts`). The list is computed at
// build time from the runtime dep tree, so a `pnpm install` is
// the only step needed to keep the modal in sync.
import acknowledgements from 'virtual:acknowledgements';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = `
  <div class="shell empty">
    <!--
      Hidden file input — triggered by the GUI's "Open folder /
      ZIP" button. lil-gui has no native file controller, so we
      forward a synthetic click to this hidden input from the
      function controller's handler. \`webkitdirectory\` makes the
      browser show a folder picker on Chromium / Safari; multiple
      ZIPs / charts can also be selected via the same input.
    -->
    <input id="songs" type="file" webkitdirectory multiple class="hidden-file-input" />
    <input id="search" class="search-input" type="search" placeholder="Search title / artist / genre..." />
    <div class="stage" id="stage">
      <!--
        Drop hint. Visible whenever the shell carries the
        \`.empty\` class (no songs loaded yet) so the user has a
        clear "drop a folder here" target up-front, plus during
        an active drag (\`.dragging\`) so the hint reappears even
        once charts are loaded. Falls behind the canvas otherwise.

        Structured as three layers:
        - \`.drop-frame\`: subtle outer ring spanning the whole
          stage, lights up during a live drag.
        - \`.drop-card\`: centred glassmorphism panel hosting the
          actual content; hosts the entry / hover animations.
        - icon + title + subtitle for the hierarchy.
      -->
      <div class="drop">
        <div class="drop-frame"></div>
        <div class="drop-card">
          <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true">
            <!--
              Stylised download arrow. The two halves animate
              independently so the head bounces while the
              shaft holds steady — feels lighter than a single
              translateY.
            -->
            <path
              class="drop-icon-shaft"
              d="M24 6 L24 30"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
            />
            <path
              class="drop-icon-head"
              d="M14 22 L24 32 L34 22"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M10 38 L38 38"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              opacity="0.55"
            />
          </svg>
          <div class="drop-title">Drop to load</div>
          <div class="drop-subtitle">
            <span>BMS folder</span>
            <span class="drop-subtitle-sep">·</span>
            <span>LR2 Files</span>
          </div>
        </div>
      </div>
    </div>
    <!--
      Browser-compatibility panel. Lives at the shell level — NOT
      inside the drop card — so it reads as a separate diagnostic
      widget rather than as decoration on the call-to-action.
      Header (icon + eyebrow + status) communicates at-a-glance
      readiness; the body lists every probed feature split into
      \`Required\` / \`Optional\` sections so the user can see
      exactly which feature is responsible for an unsupported
      verdict. Populated once at boot from \`checkBrowserCompat()\`.
    -->
    <aside class="compat-panel" id="compat-panel" aria-label="Browser compatibility check">
      <header class="compat-panel-header">
        <div class="compat-panel-badge" id="compat-panel-badge" aria-hidden="true">
          <!--
            Status mark. The default check arc paints when the
            browser is fully supported; the JS swaps in a cross
            path for the unsupported state by toggling a class on
            the panel root.
          -->
          <svg viewBox="0 0 24 24" class="compat-panel-badge-icon" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
            <path
              class="compat-panel-badge-mark compat-panel-badge-mark--check"
              d="M7 12 L11 16 L17 9"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              class="compat-panel-badge-mark compat-panel-badge-mark--cross"
              d="M8 8 L16 16 M16 8 L8 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <div class="compat-panel-heading">
          <div class="compat-panel-eyebrow">System check</div>
          <div class="compat-panel-status" id="compat-panel-status">Browser ready</div>
        </div>
      </header>
      <div class="compat-panel-sections">
        <section class="compat-panel-section">
          <h3 class="compat-panel-section-title">Required</h3>
          <ul class="compat-panel-list" id="compat-panel-required"></ul>
        </section>
        <section class="compat-panel-section">
          <h3 class="compat-panel-section-title">Optional</h3>
          <ul class="compat-panel-list" id="compat-panel-optional"></ul>
        </section>
      </div>
    </aside>
    <!--
      Loading overlay. Hidden by default; revealed via the
      "visible" class while a folder / ZIP drop is mid-load. The
      bar below moves between "indeterminate" (CSS animation) and
      "determinate" (inline width %) states depending on whether
      the active phase reports a known total. The card sits in the
      centre of the shell so it's visible regardless of which
      scene is currently mounted (select / gameplay / result).
    -->
    <div class="loading-overlay" id="loading-overlay" aria-hidden="true">
      <div class="loading-card" role="status" aria-live="polite">
        <div class="loading-label" id="loading-label">Loading…</div>
        <div class="loading-bar"><div class="loading-bar-fill" id="loading-bar-fill"></div></div>
        <div class="loading-counter" id="loading-counter"></div>
      </div>
    </div>
    <!--
      Bottom-right floating Help button. Pinned so it stays
      reachable from every scene (select / gameplay / result)
      without having to compete with lil-gui (top-right) or the
      search bar (bottom-left). Opens the unified Help dialog
      that hosts both the usage guide and the third-party
      attribution required by the libraries we ship.
    -->
    <button class="help-button" id="help-button" type="button" aria-haspopup="dialog" aria-controls="help-modal">
      <svg class="help-button-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path
          d="M9.4 9.5 a2.6 2.6 0 1 1 3.6 2.4 c-0.7 0.3 -1 0.9 -1 1.6 V14.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
      </svg>
      <span class="help-button-label">Help</span>
    </button>
    <!--
      Help modal. Two tabs:
      - Usage: drag-drop instructions, keyboard shortcuts,
        gameplay keys, options.
      - Open source: build-time-resolved acknowledgement list
        (one card per npm dependency that ships in the runtime
        bundle, with verbatim LICENSE text).
      Hidden by default; toggled via the \`.visible\` class on
      the overlay.
    -->
    <div class="help-modal" id="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title" aria-hidden="true">
      <div class="help-modal-backdrop" id="help-modal-backdrop"></div>
      <div class="help-modal-card">
        <header class="help-modal-header">
          <div>
            <div class="help-modal-eyebrow">Help &amp; About</div>
            <h2 class="help-modal-title" id="help-modal-title">be-music player</h2>
          </div>
          <button class="help-modal-close" id="help-modal-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M7 7 L17 17 M17 7 L7 17"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>
        <div class="help-modal-tabs" role="tablist">
          <button
            class="help-modal-tab is-active"
            id="help-tab-usage"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="help-pane-usage"
            data-pane="usage"
          >
            Usage
          </button>
          <button
            class="help-modal-tab"
            id="help-tab-oss"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="help-pane-oss"
            data-pane="oss"
          >
            Open source
          </button>
        </div>
        <section
          class="help-modal-pane is-active"
          id="help-pane-usage"
          role="tabpanel"
          aria-labelledby="help-tab-usage"
          tabindex="0"
        >
          <!--
            Language switcher. The two \`.help-lang\` blocks below
            carry parallel translations; only one is shown at a
            time. Default selection comes from \`navigator.language\`
            at boot — \`ja-*\` users land on Japanese, everyone else
            on English.
          -->
          <div class="help-lang-switch" role="group" aria-label="Language">
            <button
              class="help-lang-toggle is-active"
              type="button"
              data-lang="en"
              aria-pressed="true"
            >
              English
            </button>
            <button class="help-lang-toggle" type="button" data-lang="ja" aria-pressed="false">
              日本語
            </button>
          </div>
          <div class="help-lang is-active" data-lang="en">
            <section class="help-about">
              <p class="help-about-summary">
                A browser-based BMS player. Drop in any folder of charts and play them straight
                from the page. Reads <strong>Lunatic Rave 2</strong> skin files
                (<code>.lr2skin</code>), so existing LR2 themes can be used as-is.
              </p>
              <ul class="help-about-meta">
                <li>
                  <span class="help-about-key">Author</span>
                  <a href="https://nulltask.dev" target="_blank" rel="noopener noreferrer">nulltask · nulltask.dev</a>
                </li>
                <li>
                  <span class="help-about-key">Source</span>
                  <a href="https://github.com/nulltask/be-music" target="_blank" rel="noopener noreferrer">
                    github.com/nulltask/be-music
                  </a>
                </li>
                <li>
                  <span class="help-about-key">Also available</span>
                  <span>A TUI build (terminal frontend) ships in the same monorepo as <code>@be-music/player-tui</code>.</span>
                </li>
              </ul>
              <ul class="help-about-notes">
                <li>Some features are still missing or incomplete — expect rough edges.</li>
                <li>Use at your own risk. No warranty is provided.</li>
                <li>
                  Dropped files stay entirely in your browser. Charts, audio, and BGA assets are
                  <strong>never uploaded to any server</strong>.
                </li>
              </ul>
            </section>
            <h3 class="help-section-title">Loading songs</h3>
            <ul class="help-list">
              <li>Drop a BMS folder anywhere on the page to register its charts.</li>
              <li>Drop an <code>LR2files</code> folder (or its contents) to apply an LR2 skin theme.</li>
              <li>
                Or click <strong>Open folder / ZIP</strong> in the lil-gui panel (top-right) to use the native
                file picker.
              </li>
              <li>Subsequent drops add to the library and keep the current theme.</li>
            </ul>

            <h3 class="help-section-title">Song select</h3>
            <ul class="help-list">
              <li><kbd>/</kbd> focuses the search input. Filter by title, artist, or genre.</li>
              <li><kbd>Esc</kbd> clears the search filter.</li>
              <li>Click a song row, or click the LR2 skin's <em>PLAY</em> button, to start.</li>
            </ul>

            <h3 class="help-section-title">Gameplay (default keys)</h3>
            <div class="help-keymap">
              <div class="help-keymap-row">
                <span class="help-keymap-side">1P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd>
                  <span class="help-keymap-sep">·</span>
                  <kbd>Z</kbd> <kbd>S</kbd> <kbd>X</kbd> <kbd>D</kbd> <kbd>C</kbd> <kbd>F</kbd> <kbd>V</kbd>
                </span>
              </div>
              <div class="help-keymap-row">
                <span class="help-keymap-side">2P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd> <span class="help-keymap-sep">·</span>
                  <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd> <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd>
                </span>
              </div>
              <div class="help-keymap-note">Left Shift = 1P scratch · Right Shift = 2P scratch · K = 2P 6th key.</div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> adjusts hi-speed.</li>
              <li><kbd>Space</kbd> pauses / resumes.</li>
              <li><kbd>F5</kbd> restarts the current chart.</li>
              <li><kbd>Esc</kbd> exits to the result screen (or back to song select).</li>
            </ul>

            <h3 class="help-section-title">Options &amp; recording</h3>
            <ul class="help-list">
              <li>The lil-gui panel (top-right) holds auto-play, compressor, BGA transcode, and recording controls.</li>
              <li>
                Click <strong>Record</strong> to capture the next play as a downloadable WebM (requires
                MediaRecorder support — see Open source / browser checks).
              </li>
              <li>
                Open the LR2 skin's <strong>PLAY OPTION</strong> panel during song select to set per-side
                modifiers (Random / Mirror / Auto-scratch / hi-speed).
              </li>
            </ul>
          </div>
          <div class="help-lang" data-lang="ja" hidden>
            <section class="help-about">
              <p class="help-about-summary">
                ブラウザ上で動作する BMS プレイヤーです。チャートが入ったフォルダをドロップするだけでそのまま再生できます。
                <strong>Lunatic Rave 2</strong> のスキンファイル (<code>.lr2skin</code>) を解釈するので、既存の LR2 用スキンをそのまま利用できます。
              </p>
              <ul class="help-about-meta">
                <li>
                  <span class="help-about-key">作者</span>
                  <a href="https://nulltask.dev" target="_blank" rel="noopener noreferrer">nulltask · nulltask.dev</a>
                </li>
                <li>
                  <span class="help-about-key">ソースコード</span>
                  <a href="https://github.com/nulltask/be-music" target="_blank" rel="noopener noreferrer">
                    github.com/nulltask/be-music
                  </a>
                </li>
                <li>
                  <span class="help-about-key">関連</span>
                  <span>同じモノレポに TUI 版 (<code>@be-music/player-tui</code>) も同梱されています。</span>
                </li>
              </ul>
              <ul class="help-about-notes">
                <li>一部の機能はまだ実装されていません。動作が不完全な箇所があります。</li>
                <li>利用は自己責任でお願いします。本ソフトウェアは無保証で提供されます。</li>
                <li>
                  ドロップしたファイルはブラウザ内でのみ処理され、譜面・音声・BGA データを
                  <strong>サーバへ送信することは一切ありません</strong>。
                </li>
              </ul>
            </section>
            <h3 class="help-section-title">楽曲の読み込み</h3>
            <ul class="help-list">
              <li>BMS フォルダをページ上にドロップすると、その中のチャートが登録されます。</li>
              <li><code>LR2files</code> フォルダ (またはその中身) をドロップすると LR2 スキンが適用されます。</li>
              <li>
                右上 lil-gui パネルの <strong>Open folder / ZIP</strong> ボタンからネイティブのファイル選択ダイアログも使えます。
              </li>
              <li>追加でドロップした場合、既存のライブラリに追加され、テーマも維持されます。</li>
            </ul>

            <h3 class="help-section-title">選曲画面</h3>
            <ul class="help-list">
              <li><kbd>/</kbd> で検索入力にフォーカス。タイトル / アーティスト / ジャンルで絞り込めます。</li>
              <li><kbd>Esc</kbd> で検索条件をクリア。</li>
              <li>曲の行をクリック、または LR2 スキンの <em>PLAY</em> ボタンで再生開始。</li>
            </ul>

            <h3 class="help-section-title">ゲームプレイ (デフォルトキー)</h3>
            <div class="help-keymap">
              <div class="help-keymap-row">
                <span class="help-keymap-side">1P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd>
                  <span class="help-keymap-sep">·</span>
                  <kbd>Z</kbd> <kbd>S</kbd> <kbd>X</kbd> <kbd>D</kbd> <kbd>C</kbd> <kbd>F</kbd> <kbd>V</kbd>
                </span>
              </div>
              <div class="help-keymap-row">
                <span class="help-keymap-side">2P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd> <span class="help-keymap-sep">·</span>
                  <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd> <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd>
                </span>
              </div>
              <div class="help-keymap-note">左 Shift = 1P スクラッチ · 右 Shift = 2P スクラッチ · K = 2P 6 鍵。</div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> でハイスピード調整。</li>
              <li><kbd>Space</kbd> でポーズ / 再開。</li>
              <li><kbd>F5</kbd> で現在のチャートをリスタート。</li>
              <li><kbd>Esc</kbd> でリザルト画面 (または選曲画面) へ戻ります。</li>
            </ul>

            <h3 class="help-section-title">オプションと録画</h3>
            <ul class="help-list">
              <li>右上 lil-gui パネルにオートプレイ / コンプレッサー / BGA トランスコード / 録画コントロールがあります。</li>
              <li>
                <strong>Record</strong> ボタンを押すと、次の再生を WebM として録画してダウンロードできます (ブラウザが MediaRecorder に対応している必要があります — Open source / Browser checks を参照)。
              </li>
              <li>
                選曲画面で LR2 スキンの <strong>PLAY OPTION</strong> パネルを開くと、Random / Mirror / Auto-scratch / hi-speed などのプレイヤー側モディファイアを設定できます。
              </li>
            </ul>
          </div>
        </section>
        <section
          class="help-modal-pane"
          id="help-pane-oss"
          role="tabpanel"
          aria-labelledby="help-tab-oss"
          tabindex="0"
          hidden
        >
          <p class="help-pane-intro">
            This player is built on the open source libraries listed below. Each entry shows the
            verbatim copyright / license text shipped with the package.
          </p>
          <ol class="help-oss-list" id="help-oss-list"></ol>
        </section>
      </div>
    </div>
  </div>
`;

interface PlayerWebDemoElements {
  stage: HTMLDivElement;
  shell: HTMLDivElement;
  /**
   * Hidden `<input type="file" webkitdirectory>` triggered from a
   * lil-gui function controller. The DOM element survives across
   * lil-gui rebuilds (e.g. theme changes) so the underlying
   * `change` listener stays bound through the session.
   */
  songInput: HTMLInputElement;
  /**
   * Floating DOM `<input>` overlay positioned near the LR2 default
   * skin's search-text rect. Focus is given to it when the user
   * clicks the skin's `#SRC_TEXT,st=30,edit=1` region or hits the
   * `/` shortcut; typing into it filters the song list via
   * `PixiSongSelectView.setSearchQuery`.
   */
  searchInput: HTMLInputElement;
  /**
   * Centred overlay shown while a dropped folder / ZIP is being
   * read + parsed. Toggled via the `.visible` class so CSS
   * controls the fade-in / fade-out, and the `aria-hidden`
   * attribute mirrors the visibility for screen readers.
   */
  loadingOverlay: HTMLDivElement;
  loadingLabel: HTMLDivElement;
  loadingBarFill: HTMLDivElement;
  loadingCounter: HTMLDivElement;
}

/**
 * Plain-data state object backing the lil-gui controllers. Each
 * key matches a controller; reads / writes go through the
 * same `state.foo` reference so a programmatic update (e.g.
 * `setAudioCompressor` triggered by a URL flag) can call
 * `controller.updateDisplay()` and the GUI reflects the new
 * value. Function members are bound to the host so `this` keeps
 * its meaning when lil-gui invokes them.
 */
interface DemoGuiState {
  autoPlay: boolean;
  /**
   * When true, gameplay auto-pauses on tab visibility change /
   * window blur and auto-resumes on focus. False (the default)
   * keeps the play scene running in the background — convenient
   * for capturing recordings while another window holds focus.
   */
  autoPauseOnBlur: boolean;
  compressor: boolean;
  compressorKey: boolean;
  compressorBgm: boolean;
  compressorMaster: boolean;
  /**
   * Pixel cap for the longest edge of BGA videos that need the
   * ffmpeg.wasm transcode fallback. Single-threaded libx264 cost
   * is linear in pixel count, so capping the long edge is the
   * biggest single-threaded encode-time lever — at the cost of
   * a (usually imperceptible) reduction in BGA texture sharpness.
   *
   * `0` is the special "Off" value: no resize happens and the
   * source resolution passes through unchanged. Off by default
   * so the BMS-author resolution is preserved unless the user
   * explicitly opts in via the GUI dropdown. Any positive value
   * activates the resize path with that pixel cap; the
   * `Math.max` guard at the consumer side rejects accidental
   * negatives.
   */
  bgaResizeMaxEdgePx: number;
  /**
   * When true, BGA transcoding uses the browser's WebCodecs
   * `VideoEncoder` (hardware-accelerated where supported)
   * instead of the libx264 wasm encoder. Decoding still goes
   * through ffmpeg.wasm because WebCodecs' decoder doesn't
   * speak the legacy MPEG-1 / VC-1 codecs BMS BGA usually
   * ships in.
   *
   * Forced to `false` and disabled in the GUI when the browser
   * doesn't expose `VideoEncoder` (Safari < 17, older
   * Firefox builds). Ignored at runtime if the encoder
   * rejects the configured parameters or the raw decoded
   * frames would blow the memory budget — the transcode then
   * silently falls back to the ffmpeg encode path.
   */
  bgaUseWebCodecs: boolean;
  /**
   * Read-only status text (loading summaries, "Playing: …",
   * recording state, etc.). Bound to a disabled string
   * controller so users can copy it out of the GUI but can't
   * edit it. The runtime updates this via {@link setStatus}
   * which also pushes the new value into the controller.
   */
  status: string;
  /** Triggered by clicking the GUI's "Open folder / ZIP" button. */
  openFolder: () => void;
  /** Triggered by clicking the GUI's record toggle. */
  record: () => void;
}

class PlayerWebDemoApp {
  private readonly library = new BrowserSongLibrary();
  /**
   * Per-variant play skins, keyed by `Lr2PlayVariant`. Loaded once at
   * theme-drop time so a DP chart can pick `playSkins['14']` while a
   * regular SP chart picks `playSkins['7']`.
   */
  private readonly playSkins: Lr2PlaySkinMap = {};
  /**
   * Single PixiJS host shared by every scene (select / gameplay / result).
   * Scenes are attached and detached through `PixiSceneHost` instead of
   * constructing a separate Pixi `Application` per view.
   */
  private readonly sceneHost = new PixiSceneHost();
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  private selectSkin: Lr2Skin | undefined;
  private resultSkin: Lr2Skin | undefined;
  /**
   * LR2 Decide-screen skin (the brief splash between song select
   * and gameplay). Loaded from `Theme/<name>/Decide/decide.lr2skin`
   * by `loadLr2ThemeSkinsFromFiles`. When undefined, the host
   * skips the splash and transitions directly to gameplay.
   */
  private decideSkin: Lr2Skin | undefined;
  /**
   * Loop-playable BGM bytes for the song-select scene
   * (`LR2files/Bgm/<theme>/select.wav` from the dropped theme).
   * Forwarded to `PixiSongSelectView` via the constructor option
   * on first mount and via `setSelectBgm` on subsequent theme
   * drops mid-session.
   */
  private selectBgmBytes: Uint8Array | undefined;
  /** Result-screen BGM bytes — picked per outcome inside `PixiResultView`. */
  private clearBgmBytes: Uint8Array | undefined;
  private failBgmBytes: Uint8Array | undefined;
  private resultBgmBytes: Uint8Array | undefined;
  /**
   * One-shot song-decided sound bytes
   * (`LR2files/Bgm/<theme>/decide.wav`). Played by
   * `PixiSongSelectView.playDecideSound` on the select →
   * gameplay transition.
   */
  private decideBgmBytes: Uint8Array | undefined;
  /**
   * LR2 system sound-effect bundle
   * (`LR2files/Sound/lr2/<name>.wav`). Each slot maps to a
   * `PixiSongSelectView` system-sound name (cursorMove /
   * folderOpen / folderClose). Forwarded via the constructor
   * option on first mount and via `setSystemSounds` on
   * subsequent theme drops.
   */
  private systemSoundBundle: {
    cursorMove?: Uint8Array;
    folderOpen?: Uint8Array;
    folderClose?: Uint8Array;
    optionOpen?: Uint8Array;
    optionClose?: Uint8Array;
    optionChange?: Uint8Array;
  } = {};
  private selectView: PixiSongSelectView | undefined;
  private gameplayView: PixiGameplayView | undefined;
  private resultView: PixiResultView | undefined;
  private decideView: PixiDecideView | undefined;
  private hostMounted = false;
  /**
   * Last-known cursor / folder state of the select view, captured before
   * gameplay so returning to song select restores the user's position.
   */
  private lastSelectNavigation: PixiSongSelectNavigation | undefined;
  /**
   * Compressor architecture for `audioCompressorMode` on every
   * gameplay mount. Defaults to `'split'` (the new 3-stage bus —
   * see `audio-bus.ts` for the design rationale); the demo accepts
   * a `?compressor=legacy` URL flag for A/B comparison against the
   * old single-compressor topology, and `?compressor=off` to spawn
   * gameplay with the bypass path active out of the gate (the
   * checkbox can also reach `off` mid-session).
   */
  private compressorMode: 'split' | 'legacy' = 'split';
  /**
   * GUI state object the lil-gui controllers read / write. Held
   * on the instance so the GUI build code and the runtime
   * handlers (`toggleRecording` etc.) share a single source of
   * truth — programmatic updates go through `state.foo = …` +
   * `controller.updateDisplay()`.
   */
  private readonly guiState: DemoGuiState;
  /**
   * lil-gui handles for controllers we need to address by name
   * after construction — toggling the per-stage folder
   * visibility, renaming the record button, and reflecting URL-
   * flag-driven compressor changes back into the GUI.
   */
  private gui: GUI | undefined;
  private compressorStageFolder: GUI | undefined;
  private recordController: Controller | undefined;
  /**
   * Disabled string controller used as the read-only status
   * row inside the lil-gui panel. We hold a reference so
   * {@link setStatus} can call `updateDisplay()` directly
   * rather than relying on lil-gui's `.listen()` polling.
   */
  private statusController: Controller | undefined;
  /**
   * `true` after the user clicks Record on the song-select
   * screen but before they actually pick a song. Consumed (and
   * cleared) by `playSong` immediately after the gameplay view
   * mounts, kicking off `startRecording()` so the very first
   * frame of the chart is captured.
   *
   * A second click on Record before picking a song flips this
   * back to `false` ("disarm"), and any non-pick path that
   * leaves the select view (e.g. dropping a new folder mid-
   * armed) is responsible for clearing it via {@link disarmAutoRecord}
   * so the flag doesn't survive into a future session that
   * shouldn't be auto-captured.
   */
  private autoRecordArmed = false;
  public constructor(private readonly elements: PlayerWebDemoElements) {
    this.guiState = {
      autoPlay: false,
      autoPauseOnBlur: false,
      // Compressor stack ON by default — without it, multiple
      // simultaneous `#WAV` samples sum past full scale and digital-
      // clip at the destination. The `MIXER_HEADROOM_GAIN_LINEAR`
      // attenuation in `audio-bus.ts` buys a little headroom but the
      // master limiter is what reliably prevents audible clipping
      // on dense charts. Power users wanting an unprocessed signal
      // path can still flip it via `?compressor=off` or the GUI.
      compressor: true,
      compressorKey: true,
      compressorBgm: true,
      compressorMaster: true,
      // BGA resize is OFF by default — original-resolution
      // transcode is the safe choice for visual parity. Power
      // users hitting long encode times on HD BGA can pick a
      // pixel cap from the GUI dropdown without rebuilding.
      // `0` means "preserve resolution"; any positive integer
      // activates the resize path with that long-edge cap.
      bgaResizeMaxEdgePx: 0,
      // WebCodecs encode is OFF by default for safety —
      // browser support is good but not universal, and the
      // raw-frame buffering means very large BGA can OOM
      // before the fallback kicks in. Power users can opt in
      // via the GUI checkbox; the GUI greys it out when
      // `VideoEncoder` is missing so the user can't toggle
      // an unsupported state.
      bgaUseWebCodecs: false,
      status: 'Ready',
      openFolder: () => this.elements.songInput.click(),
      record: () => {
        void this.toggleRecording();
      },
    };
    // Pick up the `?compressor=split|legacy|off` URL flag once at
    // boot. We resolve it through `parseCompressorMode` (the same
    // helper exported from `audio-bus.ts`) so the recognised values
    // stay synced with the runtime API. Unrecognised / missing flag
    // → fall through to defaults: architecture `'split'`, GUI
    // checkbox checked (compressor on, see the `compressor: true`
    // seed above for the rationale).
    //
    // `?compressor=split|legacy` is an explicit opt-in to that
    // architecture and keeps the checkbox checked. `?compressor=off`
    // unchecks it for an unprocessed-signal A/B comparison.
    const flag: CompressorMode | undefined = parseCompressorMode(
      new URL(window.location.href).searchParams.get('compressor'),
    );
    if (flag === 'split' || flag === 'legacy') {
      this.compressorMode = flag;
      this.guiState.compressor = true;
    } else if (flag === 'off') {
      this.guiState.compressor = false;
    }
  }

  public start(): void {
    this.buildGui();
    void this.showSelect();

    this.elements.songInput.addEventListener('change', () => {
      const files = this.elements.songInput.files;
      if (!files) {
        return;
      }
      void (async () => {
        // Browser file-picker drops go through the same loading
        // overlay as drag-drop so a folder picked via the GUI
        // shows progress too. Hide the select scene up-front so
        // its rendering / BGM stays paused while we read + parse
        // — the user shouldn't see the song list flicker mid-load.
        this.showLoadingOverlay();
        this.selectView?.setVisible(false);
        try {
          await this.loadSongs([...files]);
        } finally {
          this.hideLoadingOverlay();
        }
        await this.showSelect();
      })();
    });

    // Global `/` shortcut focuses the search input. Standard
    // editor convention — same as GitHub / Slack / Discord. We
    // suppress the actual `/` character so it doesn't end up in
    // the input field.
    window.addEventListener('keydown', (event) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      // Don't hijack `/` when the user is already typing into
      // some other input.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      this.elements.searchInput.focus();
      this.elements.searchInput.select();
    });
    // Search input: forward every keystroke to the select view so
    // the bar list filters live. Escape clears the filter and
    // returns focus to the canvas (so arrow-key navigation works
    // again immediately).
    this.elements.searchInput.addEventListener('input', () => {
      this.selectView?.setSearchQuery(this.elements.searchInput.value);
    });
    this.elements.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.elements.searchInput.value = '';
        this.selectView?.setSearchQuery('');
        this.elements.searchInput.blur();
      } else if (event.key === 'Enter') {
        // Pressing Enter while typing should let the user pick the
        // currently-focused (filtered) result without leaving the
        // input first. `keydown` on the window won't fire on the
        // select view (the input has focus), so route the action
        // explicitly.
        event.preventDefault();
        // No public "trigger Enter" API on the view; setSearchQuery
        // already moved the cursor to 0 after each keystroke, so
        // closing the input + giving focus back to the canvas is
        // enough for the user's next Enter press to pick that song.
        this.elements.searchInput.blur();
      }
    });

    // Drag state via a depth counter rather than a plain
    // add/remove pair on dragover/dragleave. The browser fires
    // `dragleave` not just when the cursor exits the window but
    // also every time it crosses into a child element — without
    // counting, the `.dragging` class flickers off whenever the
    // user drags across the canvas → toolbar boundary, so the
    // overlay would strobe (or, with `dragleave` firing once at
    // the end, disappear before the user can read the hint).
    //
    // Increment on every `dragenter`, decrement on every
    // `dragleave`. We're truly outside the window once the
    // counter hits zero, at which point the class comes off.
    // `drop` and the rare `dragend` reset the counter so a
    // pathological event sequence (browser quirk, devtools
    // overlay, etc.) can't leave the class stuck on.
    let dragDepth = 0;
    const setDragging = (active: boolean): void => {
      document.body.classList.toggle('dragging', active);
    };
    window.addEventListener('dragenter', (event) => {
      event.preventDefault();
      dragDepth += 1;
      if (dragDepth === 1) {
        setDragging(true);
      }
    });
    // `dragover` still has to call `preventDefault` for the
    // browser to treat the page as a valid drop target. We
    // don't toggle state here — that's `dragenter` / `dragleave`'s
    // job — but skipping the preventDefault would silently
    // turn drops into "open file in browser" navigations.
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragging(false);
      }
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      dragDepth = 0;
      setDragging(false);
      if (event.dataTransfer) {
        void this.handleDrop(event.dataTransfer);
      }
    });
    // Belt-and-braces: the spec lets `dragend` fire on the
    // source element when a drag is cancelled (Esc, drop on
    // a non-target). For files dragged in from the OS it
    // shouldn't normally fire on `window`, but if a custom
    // source ever does we still want to clear state.
    window.addEventListener('dragend', () => {
      dragDepth = 0;
      setDragging(false);
    });
  }

  private async ensureHostMounted(): Promise<void> {
    if (this.hostMounted) return;
    this.hostMounted = true;
    await this.sceneHost.mount(this.elements.stage);
  }

  /**
   * Hide the per-stage `Key` / `BGM` / `Master` folder when it
   * doesn't apply to the current state:
   *
   * - Compressor checkbox unchecked → bus is in `'off'` mode, every
   *   stage is bypassed already.
   * - `?compressor=legacy` → the legacy architecture has just one
   *   compressor; per-stage toggles don't map onto it.
   *
   * lil-gui's `show(false)` collapses the folder out of the panel
   * entirely, matching the previous `display: none` behaviour.
   */
  private refreshCompressorStageVisibility(): void {
    const visible = this.guiState.compressor && this.compressorMode === 'split';
    this.compressorStageFolder?.show(visible);
  }

  /**
   * Builds the floating lil-gui control panel and wires every
   * controller to the gameplay / scene state. Centralising this
   * in one method lets us bind handles to specific controllers
   * (`recordController`, `compressorStageFolder`) up-front, so
   * runtime code can address them by name (renaming the record
   * button when capture starts, hiding the per-stage folder on
   * compressor mode change) without re-querying the DOM.
   */
  private buildGui(): void {
    // Start collapsed so the panel doesn't cover the
    // select-screen / gameplay canvas the moment a user lands
    // on the demo. `closeFolders: true` keeps the nested
    // folders (Compressor stages / BGA video transcode) shut
    // when the user re-opens the panel — they're advanced
    // tunables most of the time. The user can still pop the
    // panel open via the title bar at any point.
    const gui = new GUI({ title: 'be-music demo', width: 280, closeFolders: true });
    gui.close();
    this.gui = gui;
    // Status row pinned to the top of the panel — first thing
    // the user sees, so a glance at the GUI is enough to tell
    // whether a load is in flight, what's currently playing, or
    // where a saved recording landed. Disabled so the field
    // reads as a passive read-out instead of an editable input.
    // Updates are pushed explicitly via `setStatus`; cheaper
    // than lil-gui's `.listen()` polling and the only writer is
    // this class anyway.
    this.statusController = gui.add(this.guiState, 'status').name('Status').disable();
    this.statusController.domElement.classList.add('status-row');
    gui.add(this.guiState, 'openFolder').name('Open folder / ZIP');
    // Auto play used to be a lil-gui checkbox here too, but the
    // in-scene PLAY OPTIONS panel (LR2 button_type 33 / 32 on the
    // select skin) already exposes it — the duplicate toolbar
    // controller just added another surface to keep in sync. The
    // `guiState.autoPlay` field stays as the seed/fallback value
    // until the select panel publishes its own choice.
    gui
      .add(this.guiState, 'autoPauseOnBlur')
      .name('Auto pause on blur')
      .onChange((value: boolean) => {
        this.guiState.autoPauseOnBlur = value;
        // Push live so a chart already in flight starts honouring
        // the new policy on its next visibility / blur event,
        // without forcing the user to restart the song.
        this.gameplayView?.setAutoPauseOnBlur(value);
      });
    gui
      .add(this.guiState, 'compressor')
      .name('Compressor')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressor(value);
        this.refreshCompressorStageVisibility();
      });
    const stages = gui.addFolder('Compressor stages');
    this.compressorStageFolder = stages;
    stages
      .add(this.guiState, 'compressorKey')
      .name('Key')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('key', value);
      });
    stages
      .add(this.guiState, 'compressorBgm')
      .name('BGM')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('bgm', value);
      });
    stages
      .add(this.guiState, 'compressorMaster')
      .name('Master')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('master', value);
      });
    // BGA video transcode controls. Both settings are seeded
    // into the next `PixiGameplayView` constructor (see
    // `preloadGameplay` / `playSong` for the wiring), so
    // changing them mid-session takes effect on the next chart
    // mount — no need to rebuild gameplay if the user is
    // between songs. We don't push live into the running
    // gameplay because BGA assets are loaded once at chart-
    // prepare time and the codec / resize decisions are encoded
    // into the cached video bytes.
    //
    // Both controls are dropdowns rather than free-form fields:
    // the meaningful options cluster around standard video
    // heights (SD / 720p / 1080p / 4K) and a discrete codec
    // pick. `0` in the resize dropdown is the magic "Off"
    // value — the consumer treats anything `≤ 0` as "preserve
    // resolution". Earlier iterations split resize into a
    // checkbox + size pair, but users would change the size
    // without realising they also had to flip the checkbox —
    // the resize was silently a no-op. Folding both into one
    // control with an explicit `Off` row removes that footgun.
    const transcode = gui.addFolder('BGA video transcode');
    // WebCodecs `VideoEncoder` is a browser feature; gate the
    // checkbox on its existence so the user can't toggle a
    // state the runtime can't honour. On unsupported browsers
    // (Safari < 17, older Firefox builds) the controller is
    // disabled and the seed value stays at `false`.
    const webCodecsSupported = typeof window !== 'undefined' && 'VideoEncoder' in window;
    const webCodecsController = transcode
      .add(this.guiState, 'bgaUseWebCodecs')
      .name(webCodecsSupported ? 'Use WebCodecs encoder' : 'Use WebCodecs encoder (unsupported)')
      .onChange((value: boolean) => {
        this.guiState.bgaUseWebCodecs = value;
      });
    if (!webCodecsSupported) {
      webCodecsController.disable();
    }
    transcode
      .add(this.guiState, 'bgaResizeMaxEdgePx', {
        'Off (preserve resolution)': 0,
        '256 px (BMS spec)': 256,
        '360 px (≈ SD)': 360,
        '480 px (SD)': 480,
        '512 px': 512,
        '720 px (HD)': 720,
        '1080 px (FHD)': 1080,
        '1440 px (QHD)': 1440,
        '2160 px (4K)': 2160,
      })
      .name('Resize')
      .onChange((value: number) => {
        this.guiState.bgaResizeMaxEdgePx = value;
      });
    this.recordController = gui.add(this.guiState, 'record').name('● Record');
    this.refreshCompressorStageVisibility();
  }

  /**
   * Single chokepoint for status-text updates. Writes the new
   * value into `guiState` and refreshes the lil-gui controller
   * so the read-only row repaints with the new text.
   */
  private setStatus(text: string): void {
    this.guiState.status = text;
    this.statusController?.updateDisplay();
  }

  /**
   * Flip the gameplay recorder on / off. First click during a
   * play session begins capture; second click finalizes the
   * blob and triggers a browser download as
   * `<song>.webm`. Errors (codec unavailable, no gameplay view)
   * surface to the status panel.
   *
   * Visual state lives entirely on the lil-gui record controller:
   * `name()` swaps the label between `● Record` / `■ Stop`, and
   * `disable()` greys it out while the WebM blob is being
   * assembled on stop. The `.recording` CSS class on the
   * controller's DOM element drives the red-glow accent so the
   * lil-gui style takes precedence over our highlight.
   */
  private async toggleRecording(): Promise<void> {
    const gameplay = this.gameplayView;
    const controller = this.recordController;
    if (!gameplay) {
      // No chart is playing yet — interpret the click as "arm
      // capture for the next song I pick" so the user can stage
      // recording from the song-select screen without having to
      // hit Record at the precise moment gameplay starts. A
      // second click before picking a song disarms.
      this.autoRecordArmed = !this.autoRecordArmed;
      if (this.autoRecordArmed) {
        controller?.domElement.classList.add('arming');
        controller?.name('◉ Recording on next song');
        this.setStatus('Recording armed — pick a song to start capturing');
      } else {
        controller?.domElement.classList.remove('arming');
        controller?.name('● Record');
        this.setStatus('Recording disarmed');
      }
      return;
    }
    if (gameplay.isRecording()) {
      controller?.disable();
      this.setStatus('Finalising recording…');
      try {
        const result = await gameplay.stopRecording();
        if (result) {
          // `MediaRecorder`'s native WebM stream is play-only —
          // post-process the blob to inject `Duration` + `Cues`
          // so external players can seek inside it. Cheap on the
          // typical chart-length take (a few hundred ms for a
          // 1-3 minute recording on M-series hardware) and
          // gracefully falls back to the raw blob if the patch
          // fails, so a corrupt take is never silently lost.
          const seekable = await makeWebmSeekable(result.blob);
          const filename = `${this.recordingFilenameBase}.webm`;
          downloadBlob(seekable, filename);
          const seconds = (result.durationMs / 1000).toFixed(1);
          const sizeMb = (seekable.size / (1024 * 1024)).toFixed(1);
          this.setStatus(`Saved ${filename} (${seconds}s, ${sizeMb} MB)`);
        }
      } finally {
        controller?.domElement.classList.remove('recording');
        controller?.name('● Record');
        controller?.enable();
      }
      return;
    }
    try {
      gameplay.startRecording();
      controller?.domElement.classList.add('recording');
      controller?.name('■ Stop');
      this.setStatus('Recording…');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[record] start failed', error);
      this.setStatus(`Recording unavailable: ${(error as Error).message}`);
    }
  }

  /**
   * Filename base for the next saved recording. Derived from the
   * currently-playing song's title (sanitised for filesystem
   * safety) or `gameplay-<timestamp>` when no song info is
   * available. Updated on every `playSong` so back-to-back
   * recordings don't overwrite each other in the user's
   * downloads folder.
   */
  private recordingFilenameBase = 'gameplay';

  /**
   * Reveals the centred loading overlay and reset its readout to a
   * neutral "Loading…" state. The actual phase / counter text fills
   * in via `applyLoadProgress` as events fire from the loaders.
   */
  private showLoadingOverlay(): void {
    this.elements.loadingOverlay.classList.add('visible');
    this.elements.loadingOverlay.setAttribute('aria-hidden', 'false');
    this.elements.loadingLabel.textContent = 'Loading…';
    this.elements.loadingCounter.textContent = '';
    // Reset to indeterminate (no inline width) until the first
    // `applyLoadProgress` lands. The CSS animates the bar so the
    // user sees motion even before the first phase event fires.
    this.elements.loadingBarFill.classList.add('indeterminate');
    this.elements.loadingBarFill.style.width = '';
  }

  private hideLoadingOverlay(): void {
    this.elements.loadingOverlay.classList.remove('visible');
    this.elements.loadingOverlay.setAttribute('aria-hidden', 'true');
  }

  /**
   * Maps a `LoadProgress` event from the player-web-core loaders
   * onto the overlay DOM. Phases:
   *
   * - `enumerating` — total is `-1` (we're still walking the drop
   *   tree). Show the running file count + the current path,
   *   leave the bar in indeterminate animation mode.
   * - `reading` / `parsing` / `theme` — total is known. Switch
   *   the bar to determinate mode and set its width to
   *   `current / total`.
   *
   * Phase prefixes (`Reading files…` etc.) come from the
   * `phaseLabels` map; the per-item label surfaces the underlying
   * filename / sub-task so the user can see which file is the
   * current bottleneck.
   */
  private applyLoadProgress(progress: LoadProgress): void {
    const phaseLabel = phaseLabels[progress.phase];
    const counterFragments: string[] = [];
    if (progress.total > 0) {
      // Determinate phase — set explicit width and pin the
      // counter to "X / N (P%)" so the user can eyeball ETA.
      const ratio = Math.max(0, Math.min(1, progress.current / progress.total));
      this.elements.loadingBarFill.classList.remove('indeterminate');
      this.elements.loadingBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;
      counterFragments.push(`${progress.current} / ${progress.total}`);
    } else {
      // Indeterminate (enumeration) — only `current` is meaningful.
      this.elements.loadingBarFill.classList.add('indeterminate');
      this.elements.loadingBarFill.style.width = '';
      if (progress.current > 0) {
        counterFragments.push(`${progress.current}`);
      }
    }
    if (progress.label) {
      counterFragments.push(progress.label);
    }
    this.elements.loadingLabel.textContent = phaseLabel;
    this.elements.loadingCounter.textContent = counterFragments.join(' · ');
  }

  private async handleDrop(dataTransfer: DataTransfer): Promise<void> {
    // Show the overlay before we even start enumerating files —
    // walking a deep `webkitGetAsEntry` tree on a chart pack with
    // tens of thousands of WAVs visibly stalls the UI for several
    // seconds, and we want the user to see "we're working on it"
    // immediately rather than after the slow phase finishes.
    this.showLoadingOverlay();
    // Take the select scene offline for the duration of the load.
    // `setVisible(false)` pauses BGM + the rAF tick + the song
    // list rendering, so:
    //
    // - the loaded LR2 theme's `select.wav` doesn't start the
    //   moment the (small) theme bundle finishes parsing while
    //   the (large) song collection is still being read,
    // - the song list doesn't visually shuffle as new entries
    //   land,
    // - and the user only sees the overlay until everything is
    //   ready — not a half-rendered scene behind it.
    //
    // `showSelect()` at the end of the try block re-enables the
    // scene with the freshly populated state in one shot.
    this.selectView?.setVisible(false);
    try {
      const files = await readDroppedFiles(dataTransfer, {
        onProgress: (progress) => this.applyLoadProgress(progress),
      });
      if (files.length === 0) {
        return;
      }
      const { themeFiles, songFiles } = splitDroppedSongAndThemeFiles(files);
      // `splitDroppedSongAndThemeFiles` routes any non-chart files
      // outside a chart directory into `themeFiles`. That includes
      // stray `readme.txt` / `info.json` / album-art images sitting
      // at the root of a BMS pack that isn't a real LR2 theme. Only
      // run the theme loader when the drop actually carries an
      // `.lr2skin` file — otherwise an "extra files at the BMS root"
      // drop wipes the previously-loaded LR2 theme by overwriting
      // `selectSkin` / `playSkins` / etc. with `undefined`.
      const carriesLr2Theme = themeFiles.some((file) =>
        (file.webkitRelativePath || file.name).toLowerCase().endsWith('.lr2skin'),
      );
      // eslint-disable-next-line no-console
      console.log(
        `[drop] received ${files.length} file(s) · theme=${themeFiles.length}${carriesLr2Theme ? '' : ' (no .lr2skin → preserving current theme)'} · songs=${songFiles.length}`,
      );
      const tasks: Array<Promise<unknown>> = [];
      if (carriesLr2Theme) {
        tasks.push(this.loadTheme(themeFiles));
      }
      if (songFiles.length > 0) {
        tasks.push(this.loadSongs(songFiles));
      }
      if (tasks.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[drop] nothing to load — neither theme nor chart files matched');
        return;
      }
      await Promise.all(tasks);
      const playSkinSummary = summarizeLr2PlaySkins(this.playSkins);
      // eslint-disable-next-line no-console
      console.log(
        `[drop] loaded · songs=${this.collection.songs.length} · errors=${
          this.collection.errors.length
        } · play-skins=${playSkinSummary || 'none'} · select-skin=${this.selectSkin?.name ?? 'none'}`,
      );
      if (this.collection.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[drop] parse errors:', this.collection.errors);
      }
      // Status panel stays terse on purpose — only show "loaded"
      // when there's something to celebrate, and skip the
      // per-key-mode skin enumeration since the user can see the
      // active skin in-canvas. "0 charts loaded" is suppressed so
      // a theme-only drop doesn't read like an error.
      if (this.collection.songs.length > 0) {
        this.setStatus(describeSongCollection(this.collection));
      } else if (this.selectSkin || this.resultSkin || Object.keys(this.playSkins).length > 0) {
        this.setStatus('Theme loaded');
      }
      await this.showSelect();
    } finally {
      // Always tear the overlay down — even when one of the
      // sub-loaders threw or `splitDroppedSongAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would
      // leave the UI permanently masked.
      this.hideLoadingOverlay();
    }
  }

  private async loadSongs(files: File[]): Promise<void> {
    this.setStatus('Loading songs...');
    // Append rather than replace so a second / third folder drop
    // adds to the existing library instead of wiping the previous
    // pack. The library re-prefixes source / song IDs so each
    // drop's entries stay uniquely addressable. The very first
    // drop is just `append onto an empty collection`, which
    // produces the same result as `loadFromFiles` would have.
    this.collection = await this.library.appendFromFiles(files, {
      onProgress: (progress) => this.applyLoadProgress(progress),
    });
    // Suppress the "0 charts loaded" reading — that text reads
    // like a parse error to the user. The post-load status text
    // is set by `handleDrop` once both theme + songs land, so a
    // mid-flight transient is plenty.
    if (this.collection.songs.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    }
  }

  private async loadTheme(files: File[]): Promise<void> {
    this.setStatus('Loading LR2 theme...');
    const loadedTheme = await loadLr2ThemeSkinsFromFiles(files, {
      onProgress: (progress) => this.applyLoadProgress(progress),
    });
    for (const variant of Object.keys(this.playSkins) as Lr2PlayVariant[]) {
      delete this.playSkins[variant];
    }
    Object.assign(this.playSkins, loadedTheme.playSkins);
    this.selectSkin = loadedTheme.selectSkin;
    this.resultSkin = loadedTheme.resultSkin;
    this.decideSkin = loadedTheme.decideSkin;
    this.selectBgmBytes = loadedTheme.selectBgm?.bytes;
    this.decideBgmBytes = loadedTheme.decideBgm?.bytes;
    this.clearBgmBytes = loadedTheme.clearBgm?.bytes;
    this.failBgmBytes = loadedTheme.failBgm?.bytes;
    this.resultBgmBytes = loadedTheme.resultBgm?.bytes;
    this.systemSoundBundle = {
      cursorMove: loadedTheme.systemSounds.cursorMove?.bytes,
      folderOpen: loadedTheme.systemSounds.folderOpen?.bytes,
      folderClose: loadedTheme.systemSounds.folderClose?.bytes,
      optionOpen: loadedTheme.systemSounds.optionOpen?.bytes,
      optionClose: loadedTheme.systemSounds.optionClose?.bytes,
      optionChange: loadedTheme.systemSounds.optionChange?.bytes,
    };
    // BGM / decide / system-sound bytes are stashed on the host
    // here, but NOT pushed onto the live select view yet — that
    // happens in `showSelect()` once every load task has resolved.
    // Otherwise the small theme bundle would land first and start
    // BGM playing before the larger song collection has even
    // finished parsing, which felt jarring with a loading
    // overlay still on screen.
    //
    // We deliberately don't paint a per-skin "Play: 7K=… / 14K=…"
    // status here. The skin is observable in-canvas the moment
    // the user enters song-select; spelling it out in the toolbar
    // status panel was redundant and made the toolbar wider than
    // it needed to be. `handleDrop` writes a terse "Theme
    // loaded" / "N charts loaded" once everything lands.
  }

  private async showSelect(): Promise<void> {
    this.elements.shell.classList.remove('playing');
    // The `.empty` class drives the centred "Drop BMS folder…"
    // hint. Toggle it off the moment we have charts to show, and
    // back on after a wipe / failed drop so the hint comes back
    // instead of leaving the user staring at a blank canvas.
    this.elements.shell.classList.toggle('empty', this.collection.songs.length === 0);
    await this.ensureHostMounted();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.resultView?.dispose();
    this.resultView = undefined;
    // Decide splash is cleared too — Escape from the splash
    // should land back on the select scene rather than leave the
    // splash drawing over it.
    this.decideView?.dispose();
    this.decideView = undefined;
    if (this.selectView) {
      // Push the latest theme assets onto the view BEFORE flipping
      // it visible. Order matters — `setSelectBgm` no-ops when the
      // bytes haven't changed, so back-from-play is silent; on a
      // fresh theme drop it stops the old loop, swaps the bytes,
      // and (because we're still hidden) defers the actual
      // `start()` until `setVisible(true)` lands a moment later.
      // Doing it the other way round would briefly start the
      // prior theme's BGM during the visibility flip.
      this.selectView.setSkin(this.selectSkin);
      this.selectView.setSelectBgm(this.selectBgmBytes);
      this.selectView.setDecideBgm(this.decideBgmBytes);
      this.selectView.setSystemSounds(this.systemSoundBundle);
      this.selectView.setCollection(this.collection);
      this.selectView.setVisible(true);
      if (this.lastSelectNavigation) {
        this.selectView.setNavigation(this.lastSelectNavigation);
      }
      return;
    }
    this.selectView = new PixiSongSelectView({
      skin: this.selectSkin,
      selectBgm: this.selectBgmBytes,
      decideBgm: this.decideBgmBytes,
      systemSounds: this.systemSoundBundle,
      initialNavigation: this.lastSelectNavigation,
      // Seed the in-scene panel's autoPlay value from the cached
      // demo state (carries the last value the user picked across
      // re-mounts of the select view).
      initialPlayOptions: { autoPlay: this.guiState.autoPlay },
      onPlayOptionsChange: (options) => {
        // Cache the last value so it survives a select-view
        // re-mount even though the lil-gui toggle is gone.
        this.guiState.autoPlay = options.autoPlay;
      },
      onSongSelected: (song) => {
        // Fire the decide cue first — it plays through the
        // select view's AudioContext which keeps running even
        // after the view is hidden, so the cue isn't cut by the
        // gameplay mount.
        void this.selectView?.playDecideSound();
        void this.showDecide(song);
      },
      onSongAutoPlay: (song) => {
        // The skin's AUTOPLAY button forces the auto flag on for
        // this session regardless of the toolbar checkbox state.
        // We DON'T mutate the checkbox here — the user might want
        // to keep it off for the next manual play.
        void this.selectView?.playDecideSound();
        void this.showDecide(song, { autoPlay: true });
      },
      onSearchActivate: () => {
        this.elements.searchInput.focus();
        this.elements.searchInput.select();
      },
    });
    await this.selectView.mount(this.sceneHost);
    this.selectView.setCollection(this.collection);
  }

  /**
   * Mounts the decide-screen splash and routes the user into
   * gameplay when it dismisses (auto-advance OR Enter / Space /
   * Escape input). Without a decide skin, falls straight through
   * to `playSong` so themes that don't ship a Decide directory
   * still play the chart immediately.
   *
   * The decide view runs alongside the select view's AudioContext
   * — `playDecideSound` was already fired at song-pick time, and
   * the splash visually masks the chart-load + gameplay-mount
   * window that comes next.
   */
  private async showDecide(song: BrowserSongEntry, overrides: { autoPlay?: boolean } = {}): Promise<void> {
    if (!this.decideSkin) {
      // No decide skin in the bundle (or skinless demo) — skip
      // the splash entirely. The select view's `playDecideSound`
      // already fired so the audio cue still plays.
      await this.playSong(song, overrides);
      return;
    }
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    // Build the gameplay view eagerly and kick off its heavy
    // load (chart parse, audio decode, BGA preload) IN PARALLEL
    // with the Decide animation. The Decide splash typically
    // runs ~3 s; chart asset decoding is mostly done by the time
    // the splash auto-advances, so the hand-off to gameplay
    // becomes instant instead of dropping a frozen frame.
    const preloaded = this.preloadGameplay(song, overrides);
    let advanced = false;
    const advance = (then: () => void): void => {
      // Idempotent — the auto-advance timer, key input, and
      // pointer click can all race; whichever lands first wins
      // and re-entries no-op.
      if (advanced) return;
      advanced = true;
      then();
    };
    this.decideView = new PixiDecideView({
      skin: this.decideSkin,
      onContinue: () =>
        advance(() => {
          void this.startGameplayAfterDecide(song, preloaded);
        }),
      onCancel: () =>
        advance(() => {
          // User backed out of the splash — abandon the prepared
          // gameplay scene before falling back to the select view.
          this.gameplayView?.dispose();
          this.gameplayView = undefined;
          void this.showSelect();
        }),
    });
    await this.decideView.mount(this.sceneHost, { song, collection: this.collection });
  }

  /**
   * Constructs a fresh `PixiGameplayView` with the current
   * play-options snapshot and starts its `prepare()` against the
   * shared host. The returned promise resolves once chart audio
   * is decoded — the host awaits it inside the Decide
   * `onContinue` handler before flipping the scene visible.
   *
   * Wired up here (rather than inline in `showDecide`) because
   * the same option-marshalling + callback wiring is needed
   * whether we're going through Decide or the no-decide
   * fast-path. `playSong` shares this construction shape.
   */
  private preloadGameplay(song: BrowserSongEntry, overrides: { autoPlay?: boolean }): Promise<void> {
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    const playSkin = pickLr2PlaySkin(this.playSkins, song);
    const playOptions = this.selectView?.getPlayOptions();
    this.gameplayView = new PixiGameplayView({
      skin: playSkin,
      autoPlay: overrides.autoPlay ?? playOptions?.autoPlay ?? this.guiState.autoPlay,
      autoPauseOnBlur: this.guiState.autoPauseOnBlur,
      initialHiSpeed: playOptions?.hiSpeed,
      bga: playOptions?.bga,
      bgaSize: playOptions?.bgaSize,
      scoreGraph: playOptions?.scoreGraph,
      hsFix: playOptions?.hsFix,
      hiddenSudden1P: playOptions?.hiddenSudden1P,
      hiddenSudden2P: playOptions?.hiddenSudden2P,
      shutter: playOptions?.shutter,
      laneCover: playOptions?.laneCover,
      autoScratch1P: playOptions?.autoScratch1P,
      autoScratch2P: playOptions?.autoScratch2P,
      dpFlip: playOptions?.dpFlip,
      random1P: playOptions?.random1P,
      random2P: playOptions?.random2P,
      gauge: playOptions?.gauge1P,
      audioCompressor: this.guiState.compressor,
      audioCompressorMode: this.compressorMode,
      audioCompressorStages: {
        key: this.guiState.compressorKey,
        bgm: this.guiState.compressorBgm,
        master: this.guiState.compressorMaster,
      },
      bgaTranscodeMaxLongEdgePx: this.guiState.bgaResizeMaxEdgePx > 0 ? this.guiState.bgaResizeMaxEdgePx : undefined,
      bgaTranscodeUseWebCodecs: this.guiState.bgaUseWebCodecs,
      onExit: () => {
        void this.finishGameplayThen(() => this.showSelect());
      },
      onChartFinished: (result) => {
        void this.finishGameplayThen(() => this.showResult(result));
      },
      onRestart: () => {
        void this.finishGameplayThen(() => this.playSong(song));
      },
    });
    return this.gameplayView.prepare(this.sceneHost, song, resolveSongSource(this.collection, song));
  }

  /**
   * Tears the Decide splash down and hands the stage over to the
   * (already-prepared) gameplay scene. Awaits the preload
   * promise: when the user dismisses Decide before chart audio
   * has finished decoding, the splash's last frame stays on
   * screen until prepare resolves — visually a brief hold rather
   * than the previous frozen-frame freeze.
   */
  private async startGameplayAfterDecide(song: BrowserSongEntry, preloaded: Promise<void>): Promise<void> {
    try {
      await preloaded;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[gameplay] preload failed; falling back to no-decide path', error);
      this.gameplayView?.dispose();
      this.gameplayView = undefined;
      this.decideView?.dispose();
      this.decideView = undefined;
      await this.playSong(song);
      return;
    }
    if (!this.gameplayView) return;
    this.elements.shell.classList.add('playing');
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.decideView = undefined;
    this.setStatus(`Playing: ${song.title}`);
    this.gameplayView.start();
    if (this.autoRecordArmed) {
      this.autoRecordArmed = false;
      const controller = this.recordController;
      controller?.domElement.classList.remove('arming');
      try {
        this.gameplayView.startRecording();
        controller?.domElement.classList.add('recording');
        controller?.name('■ Stop');
        this.setStatus('Recording…');
      } catch (error) {
        controller?.name('● Record');
        // eslint-disable-next-line no-console
        console.warn('[record] auto-start failed', error);
      }
    }
  }

  private async playSong(song: BrowserSongEntry, overrides: { autoPlay?: boolean } = {}): Promise<void> {
    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    // Tear down the decide splash before mounting gameplay —
    // both share the host stage, so leaving the decide layer
    // alive would draw the splash on top of the gameplay scene.
    this.decideView?.dispose();
    this.decideView = undefined;
    this.gameplayView?.dispose();
    // Refresh the recording filename base for the upcoming play —
    // each session writes to a unique file in the user's downloads
    // folder rather than overwriting the previous one.
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    const playSkin = pickLr2PlaySkin(this.playSkins, song);
    // Pull the canonical play-option snapshot (HiSpeed + AutoPlay
    // tweaked from the in-scene "PLAY OPTIONS" panel) so the
    // gameplay scene starts with the user's chosen values. The
    // explicit `overrides.autoPlay` from `onSongAutoPlay` still
    // wins so the AUTOPLAY skin button forces auto-judging on for
    // a single launch regardless of the panel state.
    const playOptions = this.selectView?.getPlayOptions();
    this.gameplayView = new PixiGameplayView({
      skin: playSkin,
      autoPlay: overrides.autoPlay ?? playOptions?.autoPlay ?? this.guiState.autoPlay,
      autoPauseOnBlur: this.guiState.autoPauseOnBlur,
      initialHiSpeed: playOptions?.hiSpeed,
      bga: playOptions?.bga,
      bgaSize: playOptions?.bgaSize,
      scoreGraph: playOptions?.scoreGraph,
      hsFix: playOptions?.hsFix,
      hiddenSudden1P: playOptions?.hiddenSudden1P,
      hiddenSudden2P: playOptions?.hiddenSudden2P,
      shutter: playOptions?.shutter,
      laneCover: playOptions?.laneCover,
      autoScratch1P: playOptions?.autoScratch1P,
      autoScratch2P: playOptions?.autoScratch2P,
      dpFlip: playOptions?.dpFlip,
      random1P: playOptions?.random1P,
      random2P: playOptions?.random2P,
      gauge: playOptions?.gauge1P,
      audioCompressor: this.guiState.compressor,
      audioCompressorMode: this.compressorMode,
      audioCompressorStages: {
        key: this.guiState.compressorKey,
        bgm: this.guiState.compressorBgm,
        master: this.guiState.compressorMaster,
      },
      bgaTranscodeMaxLongEdgePx: this.guiState.bgaResizeMaxEdgePx > 0 ? this.guiState.bgaResizeMaxEdgePx : undefined,
      bgaTranscodeUseWebCodecs: this.guiState.bgaUseWebCodecs,
      onExit: () => {
        // Sequence finalize → transition. The transition methods
        // (`showSelect` / `showResult` / `playSong`) all dispose
        // the gameplay view, which closes its AudioContext and
        // tears down the bus the recorder taps. If we kicked the
        // transition off in parallel with `finalizeRecordingIfActive`,
        // `MediaRecorder.stop()` would race the dispose and lose
        // its `'stop'` event under the closed context — the user
        // would never see the auto-download. ESC / chart-end /
        // restart all converge on the same flow for that reason.
        void this.finishGameplayThen(() => this.showSelect());
      },
      onChartFinished: (result) => {
        void this.finishGameplayThen(() => this.showResult(result));
      },
      onRestart: () => {
        void this.finishGameplayThen(() => this.playSong(song));
      },
    });
    this.setStatus(`Playing: ${song.title}`);
    await this.gameplayView.mount(this.sceneHost, song, resolveSongSource(this.collection, song));
    // Consume the "user pressed Record on the select screen"
    // flag now that gameplay is mounted — `startRecording`
    // requires the gameplay AudioContext to exist, which only
    // happens after `mount`. Failing here is non-fatal: the
    // select-screen click already nudged the user that capture
    // would start; if it doesn't (codec missing / no
    // MediaRecorder), the surfaced error replaces the armed
    // status without breaking gameplay.
    if (this.autoRecordArmed) {
      this.autoRecordArmed = false;
      const controller = this.recordController;
      controller?.domElement.classList.remove('arming');
      try {
        this.gameplayView.startRecording();
        controller?.domElement.classList.add('recording');
        controller?.name('■ Stop');
        this.setStatus('Recording…');
      } catch (error) {
        controller?.name('● Record');
        // eslint-disable-next-line no-console
        console.warn('[record] auto-start failed', error);
        this.setStatus(`Recording unavailable: ${(error as Error).message}`);
      }
    }
  }

  /**
   * If a recording is active, calls {@link toggleRecording} to
   * finalise + download. Used at chart end / exit / restart so
   * the user doesn't lose footage when transitioning out of
   * gameplay.
   */
  private async finalizeRecordingIfActive(): Promise<void> {
    if (this.gameplayView?.isRecording()) {
      await this.toggleRecording();
    }
  }

  /**
   * Closes out an in-flight recording (if any) and then runs the
   * caller-supplied transition (`showSelect` / `showResult` /
   * `playSong`). Sequencing here is non-negotiable: every one of
   * those transitions disposes the gameplay view, which in turn
   * closes the AudioContext the `MediaRecorder` is tapping. Doing
   * the dispose first leaves `MediaRecorder.stop()` waiting on a
   * `'stop'` event that never fires because its source stream
   * died — the user would see the result screen pop up but never
   * get the saved WebM. Awaiting `finalizeRecordingIfActive`
   * first lets the recorder flush + download cleanly before the
   * graph it depends on goes away.
   */
  private async finishGameplayThen(transition: () => Promise<void>): Promise<void> {
    await this.finalizeRecordingIfActive();
    await transition();
  }

  private async showResult(data: PixiGameplayResultData): Promise<void> {
    await this.ensureHostMounted();
    this.resultView?.dispose();
    this.resultView = new PixiResultView({
      skin: this.resultSkin,
      collection: this.collection,
      clearBgm: this.clearBgmBytes,
      failBgm: this.failBgmBytes,
      resultBgm: this.resultBgmBytes,
      onContinue: () => {
        void this.showSelect();
      },
    });
    await this.resultView.mount(this.sceneHost, data);
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.setStatus(`Result: ${data.song.title}`);
  }
}

// Browser compatibility probe runs first so the drop card paints
// the readiness verdict immediately on first render. We do this
// BEFORE constructing the demo app so that even a hard-fail
// (Pixi `Application.init()` throwing on a no-WebGL2 browser)
// still leaves the user looking at the unsupported-browser message
// rather than a blank canvas.
renderBrowserCompatPanel(checkBrowserCompat());

// Wire up the bottom-right Help button + unified Help / OSS
// modal. The acknowledgement list is rendered lazily on first
// open of the OSS tab, so the initial paint isn't blocked on
// rendering ~30 dependency cards.
wireHelpModal();

new PlayerWebDemoApp({
  stage: document.querySelector<HTMLDivElement>('#stage')!,
  shell: document.querySelector<HTMLDivElement>('.shell')!,
  songInput: document.querySelector<HTMLInputElement>('#songs')!,
  searchInput: document.querySelector<HTMLInputElement>('#search')!,
  loadingOverlay: document.querySelector<HTMLDivElement>('#loading-overlay')!,
  loadingLabel: document.querySelector<HTMLDivElement>('#loading-label')!,
  loadingBarFill: document.querySelector<HTMLDivElement>('#loading-bar-fill')!,
  loadingCounter: document.querySelector<HTMLDivElement>('#loading-counter')!,
}).start();

/**
 * Renders the browser-compatibility diagnostic panel that lives
 * alongside (not inside) the drop card. Feature support doesn't
 * change at runtime so this is a one-shot side-effect — call once
 * at boot and the DOM stays in sync for the session.
 *
 * The panel is the *only* place the compat verdict surfaces; the
 * drop card stays focused on its call-to-action. When required
 * features are missing the panel flips into a red "Browser not
 * supported" mode and lists each missing item with its
 * dependency note, so the user can identify exactly what's
 * blocking them.
 */
function renderBrowserCompatPanel(report: BrowserCompatReport): void {
  const panel = document.querySelector<HTMLElement>('#compat-panel');
  const requiredList = document.querySelector<HTMLUListElement>('#compat-panel-required');
  const optionalList = document.querySelector<HTMLUListElement>('#compat-panel-optional');
  const statusLabel = document.querySelector<HTMLDivElement>('#compat-panel-status');
  if (!panel || !requiredList || !optionalList || !statusLabel) return;

  // `--ok` / `--fail` toggles the badge palette and the
  // check-vs-cross mark visibility (the two icon `<path>`s share
  // the SVG, only one is shown at a time per CSS).
  panel.classList.toggle('compat-panel--ok', report.ok);
  panel.classList.toggle('compat-panel--fail', !report.ok);

  if (report.ok) {
    // Distinguish "everything works" from "core works but you're
    // missing some optional niceties" — the latter is still a
    // green verdict but the count tells power users at a glance
    // whether Web­Codecs / WebGPU / etc. are reachable.
    const missingOptional = report.items.filter((item) => !item.required && !item.supported).length;
    statusLabel.textContent =
      missingOptional > 0 ? `Browser ready · ${missingOptional} optional missing` : 'Browser ready';
  } else {
    statusLabel.textContent = summarizeBrowserCompat(report) ?? 'Browser not supported';
  }

  requiredList.replaceChildren();
  optionalList.replaceChildren();
  for (const item of report.items) {
    const target = item.required ? requiredList : optionalList;
    target.appendChild(buildCompatRow(item));
  }
}

/**
 * Builds one feature row inside the compat panel. Status colour
 * is encoded both as a CSS modifier class (drives the icon /
 * background) and as a screen-reader-friendly text fallback so
 * the verdict is accessible without colour vision.
 */
function buildCompatRow(item: BrowserCompatReport['items'][number]): HTMLLIElement {
  const li = document.createElement('li');
  // `ok` = supported, `warn` = optional & missing (the player
  // still works), `fail` = required & missing (player won't
  // function). Required-supported and optional-supported both
  // map to `ok` — visual hierarchy comes from the section split
  // (Required vs Optional) above, not from a distinction here.
  const status = item.supported ? 'ok' : item.required ? 'fail' : 'warn';
  li.className = `compat-row compat-row--${status}`;
  li.title = item.note;

  const icon = document.createElement('span');
  icon.className = 'compat-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  // Plain text glyphs over inline SVG — keeps the markup compact
  // and lets us colour the glyph via `color: currentColor`. The
  // accessibility verdict is carried by the screen-reader text
  // span below, not by the symbol.
  icon.textContent = item.supported ? '✓' : item.required ? '✕' : '–';
  li.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'compat-row-label';
  label.textContent = item.label;
  li.appendChild(label);

  const sr = document.createElement('span');
  sr.className = 'compat-row-sr';
  // Read-aloud text for assistive tech — `✓` / `✕` / `–` carry
  // visual semantics but no name on their own. `aria-hidden` on
  // the icon hands the verdict to this hidden label instead.
  sr.textContent = item.supported ? 'supported' : item.required ? 'missing (required)' : 'missing (optional)';
  li.appendChild(sr);

  return li;
}

/**
 * Wires the bottom-right Help button to the unified Help /
 * Open-source modal. Two tabs share the dialog:
 *
 *  - Usage: a static guide rendered straight from the HTML
 *    template (no JS rendering needed).
 *  - Open source: the build-time-resolved acknowledgement
 *    list, rendered lazily the first time the tab is shown.
 *
 * Behaviour:
 *  - Click the button → show modal (always reopens on the
 *    Usage tab), focus the close button.
 *  - Click the backdrop, the close button, or press Escape →
 *    hide the modal, return focus to the button.
 *  - Click a tab → swap visible pane, render the OSS list on
 *    first activation.
 *
 * Pointer + keyboard parity is intentional — the dialog is
 * reachable purely via Tab / Enter / Escape on a keyboard so
 * the legal-attribution surface meets a basic-a11y bar.
 */
function wireHelpModal(): void {
  const button = document.querySelector<HTMLButtonElement>('#help-button');
  const modal = document.querySelector<HTMLDivElement>('#help-modal');
  const backdrop = document.querySelector<HTMLDivElement>('#help-modal-backdrop');
  const closeButton = document.querySelector<HTMLButtonElement>('#help-modal-close');
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-modal-tab'));
  const panes = Array.from(document.querySelectorAll<HTMLElement>('.help-modal-pane'));
  const ossList = document.querySelector<HTMLOListElement>('#help-oss-list');
  if (!button || !modal || !backdrop || !closeButton || tabs.length === 0 || panes.length === 0 || !ossList) {
    return;
  }

  let ossPopulated = false;
  const activatePane = (paneId: string): void => {
    for (const tab of tabs) {
      const matches = tab.dataset.pane === paneId;
      tab.classList.toggle('is-active', matches);
      tab.setAttribute('aria-selected', matches ? 'true' : 'false');
    }
    for (const pane of panes) {
      const matches = pane.id === `help-pane-${paneId}`;
      pane.classList.toggle('is-active', matches);
      // `hidden` keeps the inactive pane out of the
      // accessibility tree AND prevents its scrollable list
      // from stealing keyboard focus when Tab cycles.
      pane.toggleAttribute('hidden', !matches);
    }
    if (paneId === 'oss' && !ossPopulated) {
      renderAcknowledgementsList(ossList);
      ossPopulated = true;
    }
  };

  const open = (): void => {
    // Always reset to the Usage tab on open so a returning
    // visitor sees the primary call-to-action first.
    activatePane('usage');
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
    closeButton.focus();
  };
  const close = (): void => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    button.focus();
  };

  button.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const pane = tab.dataset.pane;
      if (pane) activatePane(pane);
    });
  }
  // Esc closes — only when the modal is currently open. We
  // attach to `document` rather than the modal itself so the
  // shortcut works regardless of which descendant has focus.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!modal.classList.contains('visible')) return;
    event.preventDefault();
    close();
  });

  wireUsageLanguageSwitch();
}

/**
 * Wires the EN / 日本語 toggle inside the Usage pane. Defaults
 * to whichever language matches `navigator.language` at boot —
 * `ja-*` browsers land on Japanese, everyone else on English.
 * The switch only toggles visibility on the static HTML
 * blocks; nothing is fetched or recomputed.
 */
function wireUsageLanguageSwitch(): void {
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-lang-toggle'));
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('.help-lang'));
  if (toggles.length === 0 || blocks.length === 0) return;

  const activate = (lang: string): void => {
    for (const toggle of toggles) {
      const matches = toggle.dataset.lang === lang;
      toggle.classList.toggle('is-active', matches);
      toggle.setAttribute('aria-pressed', matches ? 'true' : 'false');
    }
    for (const block of blocks) {
      const matches = block.dataset.lang === lang;
      block.classList.toggle('is-active', matches);
      block.toggleAttribute('hidden', !matches);
    }
  };

  // Default selection. Anything starting with `ja` (e.g.
  // `ja-JP`, `ja`) maps to Japanese; everything else falls
  // through to English. We don't persist the user's choice
  // — the switch is one click, and the page wasn't expected
  // to remember it across sessions.
  const initial = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  activate(initial);

  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      const lang = toggle.dataset.lang;
      if (lang) activate(lang);
    });
  }
}

/**
 * Builds one row per acknowledgement. Each row is a `<details>`
 * so the license text is hidden until the user expands it —
 * keeps the at-rest list scannable while still putting the full
 * text one click away.
 */
function renderAcknowledgementsList(list: HTMLOListElement): void {
  list.replaceChildren();
  if (acknowledgements.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'ack-empty';
    empty.textContent = 'No third-party dependencies were detected at build time.';
    list.appendChild(empty);
    return;
  }
  for (const entry of acknowledgements) {
    list.appendChild(buildAcknowledgementCard(entry));
  }
}

function buildAcknowledgementCard(entry: (typeof acknowledgements)[number]): HTMLLIElement {
  const card = document.createElement('li');
  card.className = 'ack-card';

  // Flat layout — no `<details>` / `<summary>`. Earlier we
  // tried collapsing each card behind a disclosure widget,
  // but Chromium 121+ rewired `<details>` internals to use
  // shadow slots that fight with our CSS, leaving cards
  // collapsed to ~12 px even with `details.open = true`.
  // The license-text is the whole point of the modal anyway,
  // so always-visible is the better default.
  const heading = document.createElement('div');
  heading.className = 'ack-card-heading';
  const name = document.createElement('span');
  name.className = 'ack-card-name';
  name.textContent = entry.name;
  heading.appendChild(name);
  const version = document.createElement('span');
  version.className = 'ack-card-version';
  version.textContent = `v${entry.version}`;
  heading.appendChild(version);
  if (entry.license) {
    const license = document.createElement('span');
    license.className = 'ack-card-license';
    license.textContent = entry.license;
    heading.appendChild(license);
  }
  card.appendChild(heading);

  const meta = document.createElement('div');
  meta.className = 'ack-card-meta';
  // Prefer homepage; fall back to the repository URL. Strip
  // common npm prefixes (`git+`, `.git`) so the displayed link
  // is human-friendly while the `href` keeps the raw URL.
  const link = entry.homepage ?? cleanRepositoryUrl(entry.repository);
  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.textContent = link.replace(/^https?:\/\//u, '');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'ack-card-link';
    meta.appendChild(a);
  }
  if (entry.author) {
    const author = document.createElement('span');
    author.className = 'ack-card-author';
    author.textContent = entry.author;
    meta.appendChild(author);
  }
  if (meta.childNodes.length > 0) {
    card.appendChild(meta);
  }

  if (entry.licenseText) {
    const pre = document.createElement('pre');
    pre.className = 'ack-card-license-text';
    pre.textContent = entry.licenseText;
    card.appendChild(pre);
  } else {
    const note = document.createElement('div');
    note.className = 'ack-card-license-missing';
    note.textContent = 'No LICENSE file shipped with this package.';
    card.appendChild(note);
  }

  return card;
}

function cleanRepositoryUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Strip `git+` / `.git` and `git://` → `https://`. Doesn't
  // try to be exhaustive — these three transforms cover ~all
  // npm packages we ship.
  return raw
    .replace(/^git\+/u, '')
    .replace(/^git:\/\//u, 'https://')
    .replace(/\.git$/u, '');
}

/**
 * Human-readable labels shown alongside the loading-overlay
 * progress bar. Keyed by the `LoadProgressPhase` discriminator the
 * `player-web-core` loaders emit. The web UI is English-only, so
 * these strings stay in English even though the surrounding
 * project conversation is in Japanese.
 */
const phaseLabels: Record<LoadProgress['phase'], string> = {
  enumerating: 'Collecting files…',
  reading: 'Reading files…',
  parsing: 'Parsing charts…',
  theme: 'Loading LR2 theme…',
};

/**
 * Produces a filesystem-safe base for the auto-downloaded
 * recording filename. Strips characters that browsers / OSes
 * reject (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`),
 * collapses runs of whitespace into single spaces, and trims
 * the result to a sensible cap so an absurdly long song title
 * doesn't produce a path the OS rejects on save.
 */
function sanitizeFilenameStem(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80);
}
