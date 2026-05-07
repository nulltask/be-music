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
  logger,
  makeWebmSeekable,
  parseCompressorMode,
  readDroppedFiles,
  resolveSongSource,
  splitDroppedSongAndThemeFiles,
  summarizeBrowserCompat,
  type BrowserCompatReport,
  type BrowserSongCollection,
  type BrowserSongEntry,
  type CompressorMode,
  type LoadProgress,
  type PixiGameplayResultData,
  type PixiSongSelectNavigation,
} from '@be-music/player-web';
import {
  loadLr2ThemeSkinsFromFiles,
  pickLr2PlaySkin,
  summarizeLr2PlaySkins,
  type Lr2PlaySkinMap,
  type Lr2PlayVariant,
  type Lr2Skin,
} from '@be-music/lr2-skin';
import {
  BeatorajaPlaySkinPreviewScene,
  PixiBeatorajaDecideScene,
  PixiBeatorajaGameplayView,
  PixiBeatorajaResultScene,
  PixiBeatorajaSelectScene,
  isBeatorajaSkinIndicator,
  loadBeatorajaFonts,
  loadBeatorajaPlaySkinFromBundle,
  loadBeatorajaTexturesFromBundle,
  findBeatorajaThemeBgm,
  loadBeatorajaThemeFromFiles,
  pickBeatorajaPlayableSkinVariant,
  pickBeatorajaPlayableVariant,
  prepareBeatorajaGameplayChart,
  resolveChartPlayVariant,
  summarizeBeatorajaPlaySkins,
  type BeatorajaFontCache,
  type BeatorajaPlayableVariant,
  type BeatorajaPlayVariant,
  type BeatorajaTextureCache,
  type BeatorajaThemeBgm,
  type BeatorajaThemeBundle,
  type PreparedBeatorajaGameplayChart,
} from '@be-music/player-web';
import {
  BEATORAJA_SKIN_TYPE,
  buildDefaultSkinConfigOptions,
  bundleBeatorajaSources,
  expandBeatorajaWildcard,
  loadBeatorajaSkin,
  normalizeBeatorajaFonts,
  type BeatorajaSkinConfig,
  type BeatorajaSkinEntry,
  type BeatorajaSkinHeader,
} from '@be-music/beatoraja-skin';
import { BeatorajaSkinOptionsGui, type SkinChoice } from './beatoraja-skin-options-gui.ts';
import type { PlayerSummary } from '@be-music/player/core/engine';

const dropLog = logger('drop');
const recordLog = logger('record');
const gameplayLog = logger('gameplay');
// lil-gui auto-injects its stylesheet at construction time (see `injectStyles` option, default `true`), so we don't
// import its CSS explicitly — its package.json doesn't expose the file via `exports` anyway.
import GUI, { type Controller } from 'lil-gui';
import { wireHelpModal } from './help-modal.ts';
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
        - \`.drop-card\`: centered glassmorphism panel hosting the
          actual content; hosts the entry / hover animations.
        - icon + title + subtitle for the hierarchy.
      -->
      <div class="drop">
        <div class="drop-frame"></div>
        <div class="drop-card">
          <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true">
            <!--
              Stylized download arrow. The two halves animate
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
      center of the shell so it's visible regardless of which
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
                A browser-based BMS player. Drop in a folder containing BMS / BMSON charts and
                play them straight from the page. Reads <strong>Lunatic Rave 2</strong> skin
                files (<code>.lr2skin</code>) — drop your <code>LR2files</code> folder onto the
                page (alongside or before the chart drop) and the theme is applied automatically.
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
                <li>
                  Dropped files stay entirely in your browser. Charts, audio, and BGA assets are
                  <strong>never uploaded to any server</strong>.
                </li>
                <li>Some features are still missing or incomplete — expect rough edges.</li>
                <li>
                  <strong>Scores are not saved.</strong> There is no persistence or leaderboard
                  yet — refreshing the page or revisiting later loses every result.
                </li>
                <li>
                  <strong>Only the Lunatic Rave 2 default skin has been verified.</strong> Other LR2
                  skins parse and load, but their layout is unverified — expect element overlap,
                  off-by-a-few-pixels positioning, or missing animation frames on third-party
                  themes.
                </li>
                <li>Use at your own risk. No warranty is provided.</li>
              </ul>
            </section>
            <h3 class="help-section-title">Loading songs</h3>
            <ul class="help-list">
              <li>Drop a BMS folder anywhere on the page to register its charts.</li>
              <li>Drop an <code>LR2files</code> folder (or its contents) to apply an LR2 skin theme.</li>
              <li>
                Or click <strong>Open Folder</strong> in the lil-gui panel (top-right) to use the native
                file picker — same handling as a drag-drop, so a folder containing both an LR2 theme and
                BMS charts loads both in one shot. Press the button again to add another folder.
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
                ブラウザ上で動作する BMS プレイヤーです。BMS / BMSON が入ったフォルダをドロップするだけでそのまま再生できます。
                <strong>Lunatic Rave 2</strong> のスキンファイル (<code>.lr2skin</code>) を解釈するので、<code>LR2files</code> フォルダをページにドロップすれば既存の LR2 用スキンをそのまま適用できます。
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
                <li>
                  ドロップしたファイルはブラウザ内でのみ処理され、譜面・音声・BGA データを
                  <strong>サーバへ送信することは一切ありません</strong>。
                </li>
                <li>一部の機能はまだ実装されていません。動作が不完全な箇所があります。</li>
                <li>
                  <strong>スコアは保存されません。</strong>
                  永続化やランキング機能は未実装で、ページをリロード / 再訪するとリザルトはすべて失われます。
                </li>
                <li>
                  <strong>Lunatic Rave 2 のデフォルトスキンのみ動作確認しています。</strong>
                  他の LR2 スキンも読み込み自体は可能ですが、レイアウトは未検証です。要素の重なり / 数ピクセル単位のズレ / 一部アニメーションの欠落などが残っている可能性があります。
                </li>
                <li>利用は自己責任でお願いします。本ソフトウェアは無保証で提供されます。</li>
              </ul>
            </section>
            <h3 class="help-section-title">楽曲の読み込み</h3>
            <ul class="help-list">
              <li>BMS フォルダをページ上にドロップすると、その中のチャートが登録されます。</li>
              <li><code>LR2files</code> フォルダ (またはその中身) をドロップすると LR2 スキンが適用されます。</li>
              <li>
                右上 lil-gui パネルの <strong>Open Folder</strong> ボタンからネイティブのファイル選択ダイアログも使えます。
                ドラッグ&ドロップと同じ処理経路を通るので、テーマとチャートが同居したフォルダもまとめて読み込めます。
                ボタンを押し直せば別フォルダを追加で読み込めます。
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
 * Plain-data state object backing the lil-gui controllers. Each key matches a controller; reads / writes go through the
 * same `state.foo` reference so a programmatic update (e.g. `setAudioCompressor` triggered by a URL flag) can call
 * `controller.updateDisplay()` and the GUI reflects the new value. Function members are bound to the host so `this`
 * keeps its meaning when lil-gui invokes them.
 */
interface DemoGuiState {
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
   * Read-only status text (loading summaries, "Playing: …", recording state, etc.). Bound to a disabled string
   * controller so users can copy it out of the GUI but can't edit it. The runtime updates this via {@link setStatus}
   * which also pushes the new value into the controller.
   */
  status: string;
  /** Triggered by clicking the GUI's "Open Folder" button. */
  openFolder: () => void;
  /** Triggered by clicking the GUI's record toggle. */
  record: () => void;
  /**
   * Beatoraja preview action. Opens the `BeatorajaPlaySkinPreviewScene` over whatever scene is currently mounted,
   * showing the static skin painted on screen. Picks the skin variant matching the dropdown below; falls back to
   * the first available variant if the chosen one is missing in the loaded theme.
   */
  beatorajaPreview: () => void;
  /** Variant selection for the beatoraja preview. Limited to chart-shape variants the renderer wires today. */
  beatorajaPreviewVariant: '7' | '5' | '14' | '10' | '9';
}

class PlayerWebDemoApp {
  private readonly library = new BrowserSongLibrary();
  /**
   * Per-variant play skins, keyed by `Lr2PlayVariant`. Loaded once at theme-drop time so a DP chart can pick
   * `playSkins['14']` while a regular SP chart picks `playSkins['7']`.
   */
  private readonly playSkins: Lr2PlaySkinMap = {};
  /**
   * Single PixiJS host shared by every scene (select / gameplay / result). Scenes are attached and detached through
   * `PixiSceneHost` instead of constructing a separate Pixi `Application` per view.
   */
  private readonly sceneHost = new PixiSceneHost();
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  private selectSkin: Lr2Skin | undefined;
  private resultSkin: Lr2Skin | undefined;
  /**
   * LR2 Decide-screen skin (the brief splash between song select and gameplay). Loaded from
   * `Theme/<name>/Decide/decide.lr2skin` by `loadLr2ThemeSkinsFromFiles`. When undefined, the host skips the splash and
   * transitions directly to gameplay.
   */
  private decideSkin: Lr2Skin | undefined;
  /**
   * beatoraja theme bundle held in parallel with the LR2 state. We don't render beatoraja scenes yet — that PixiJS
   * wiring is a follow-up — but we DO want to detect a beatoraja theme drop so the user gets a clear log line and
   * the parser path stays exercised end-to-end.
   */
  private beatorajaTheme: BeatorajaThemeBundle | undefined;
  /**
   * BGM bytes discovered inside the loaded beatoraja theme bundle (`decide.wav` / `clear.wav` /
   * `fail.wav` / `result.wav`). Populated alongside `beatorajaTheme` after a successful drop.
   * The decide / result scenes consume these directly — no separate caching layer needed since
   * decoding happens lazily inside each scene's audio context.
   */
  private beatorajaThemeBgm: BeatorajaThemeBgm = {};
  /**
   * Loop-playable BGM bytes for the song-select scene (`LR2files/Bgm/<theme>/select.wav` from the dropped theme).
   * Forwarded to `PixiSongSelectView` via the constructor option on first mount and via `setSelectBgm` on subsequent
   * theme drops mid-session.
   */
  private selectBgmBytes: Uint8Array | undefined;
  /** Result-screen BGM bytes — picked per outcome inside `PixiResultView`. */
  private clearBgmBytes: Uint8Array | undefined;
  private failBgmBytes: Uint8Array | undefined;
  private resultBgmBytes: Uint8Array | undefined;
  /**
   * One-shot song-decided sound bytes (`LR2files/Bgm/<theme>/decide.wav`). Played by
   * `PixiSongSelectView.playDecideSound` on the select → gameplay transition.
   */
  private decideBgmBytes: Uint8Array | undefined;
  /**
   * LR2 system sound-effect bundle (`LR2files/Sound/lr2/<name>.wav`). Each slot maps to a `PixiSongSelectView`
   * system-sound name (cursorMove / folderOpen / folderClose). Forwarded via the constructor option on first mount and
   * via `setSystemSounds` on subsequent theme drops.
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
  /**
   * Beatoraja gameplay view. Active in place of `gameplayView` when the user toggles
   * `useBeatorajaGameplay` and the loaded theme has a skin variant matching the chart shape. Held
   * separately because the two views don't share an interface — the LR2 view manages its own audio
   * decoding internally, while this one consumes a `PreparedBeatorajaGameplayChart` from the
   * `prepareBeatorajaGameplayChart` helper.
   */
  private beatorajaGameplayView: PixiBeatorajaGameplayView | undefined;
  /** The current chart's prepared assets (audio + BGA). Disposed alongside the gameplay view. */
  private beatorajaGameplayPrep: PreparedBeatorajaGameplayChart | undefined;
  /** Beatoraja-skinned song select scene. Active when a beatoraja theme with a select skin is loaded. */
  private beatorajaSelectScene: PixiBeatorajaSelectScene | undefined;
  /**
   * Beatoraja-skinned decide splash. Active during the select → gameplay handoff when the loaded
   * theme ships a decide skin (`type = 6`). Disposed before the gameplay scene mounts.
   */
  private beatorajaDecideScene: PixiBeatorajaDecideScene | undefined;
  /**
   * Beatoraja-skinned result scene. Active after gameplay completes when the loaded theme ships a
   * result skin (`type = 7`). The chart's final `PlayerSummary` is forwarded so the skin's value
   * destinations can render frozen score / judge / combo readouts.
   */
  private beatorajaResultScene: PixiBeatorajaResultScene | undefined;
  /**
   * Bottom-right lil-gui panel exposing the active beatoraja skin's `property[]` / `filepath[]` /
   * note-offset for live editing. Lazily constructed once `start()` mounts the host (the panel is
   * absolute-positioned inside the demo shell so the shell needs to exist first).
   */
  private beatorajaSkinOptionsGui: BeatorajaSkinOptionsGui | undefined;
  /**
   * Per-skin-entry config picks. The skin-options panel mutates these and the active scene re-mounts
   * with the updated values. Survives scene transitions so navigating away and back preserves the
   * user's choices for each skin (a select skin and a play skin can carry independent configs).
   */
  private readonly beatorajaSkinConfigByEntry = new Map<string, BeatorajaSkinConfig>();
  /**
   * Per-`SkinType` user-picked entry override. Lets the user choose between multiple discovered
   * skins for a given scene type from the bottom-right GUI. Keyed by the numeric `header.type` so
   * each scene (`MUSIC_SELECT = 5`, `PLAY_7KEYS = 0`, etc.) tracks its own override.
   */
  private readonly beatorajaSkinOverridesByType = new Map<number, string>();
  /**
   * Last beatoraja-select highlighted index — survives scene tear-down so coming back from gameplay
   * lands on the same song the user just played.
   */
  private beatorajaSelectIndex = 0;
  private resultView: PixiResultView | undefined;
  private decideView: PixiDecideView | undefined;
  private hostMounted = false;
  /**
   * Last-known cursor / folder state of the select view, captured before gameplay so returning to song select restores
   * the user's position.
   */
  private lastSelectNavigation: PixiSongSelectNavigation | undefined;
  /**
   * Compressor architecture for `audioCompressorMode` on every gameplay mount. Defaults to `'split'` (the new 3-stage
   * bus — see `audio-bus.ts` for the design rationale); the demo accepts a `?compressor=legacy` URL flag for A/B
   * comparison against the old single-compressor topology, and `?compressor=off` to spawn gameplay with the bypass path
   * active out of the gate (the checkbox can also reach `off` mid-session).
   */
  private compressorMode: 'split' | 'legacy' = 'split';
  /**
   * GUI state object the lil-gui controllers read / write. Held on the instance so the GUI build code and the runtime
   * handlers (`toggleRecording` etc.) share a single source of truth — programmatic updates go through `state.foo = …`
   * + `controller.updateDisplay()`.
   */
  private readonly guiState: DemoGuiState;
  /**
   * lil-gui handles for controllers we need to address by name after construction — toggling the per-stage folder
   * visibility, renaming the record button, and reflecting URL- flag-driven compressor changes back into the GUI.
   */
  private gui: GUI | undefined;
  private compressorStageFolder: GUI | undefined;
  private recordController: Controller | undefined;
  /**
   * Disabled string controller used as the read-only status row inside the lil-gui panel. We hold a reference so {@link
   * setStatus} can call `updateDisplay()` directly rather than relying on lil-gui's `.listen()` polling.
   */
  private statusController: Controller | undefined;
  /**
   * `true` after the user clicks Record on the song-select screen but before they actually pick a song. Consumed (and
   * cleared) by `playSong` immediately after the gameplay view mounts, kicking off `startRecording()` so the very first
   * frame of the chart is captured.
   *
   * A second click on Record before picking a song flips this back to `false` ("disarm"), and any non-pick path that
   * leaves the select view (e.g. dropping a new folder mid- armed) is responsible for clearing it via {@link
   * disarmAutoRecord} so the flag doesn't survive into a future session that shouldn't be auto-captured.
   */
  private autoRecordArmed = false;
  public constructor(private readonly elements: PlayerWebDemoElements) {
    this.guiState = {
      autoPlay: false,
      autoPauseOnBlur: false,
      // Compressor stack ON by default — without it, multiple simultaneous `#WAV` samples sum past full scale and
      // digital- clip at the destination. The `MIXER_HEADROOM_GAIN_LINEAR` attenuation in `audio-bus.ts` buys a little
      // headroom but the master limiter is what reliably prevents audible clipping on dense charts. Power users wanting
      // an unprocessed signal path can still flip it via `?compressor=off` or the GUI.
      compressor: true,
      compressorKey: true,
      compressorBgm: true,
      compressorMaster: true,
      // BGA resize is OFF by default — original-resolution transcode is the safe choice for visual parity. Power users
      // hitting long encode times on HD BGA can pick a pixel cap from the GUI dropdown without rebuilding. `0` means
      // "preserve resolution"; any positive integer activates the resize path with that long-edge cap.
      bgaResizeMaxEdgePx: 0,
      // WebCodecs encode defaults ON when the browser exposes `VideoEncoder` — typically a 5-20× encode-side speedup
      // over the single-threaded wasm libx264 fallback, and the runtime silently falls back to ffmpeg if the encoder
      // rejects the configured codec parameters or any step throws. Browsers without `VideoEncoder` (Safari < 17, older
      // Firefox) keep the toggle disabled in the GUI and the seed stays `false`.
      bgaUseWebCodecs: typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis,
      // Debug overlay for invisible / keysound notes — off by default. Power users investigating chart authoring (or
      // diagnosing missing keysound triggers) flip it on; the regular gameplay surface stays clean otherwise.
      showInvisibleNotes: false,
      // Default to LR2 / beatoraja's stock behavior (judged notes disappear at the judge line) — matches what most
      // users coming from those players expect. The dropdown lets users opt into the `'KEEP_SCROLLING'` mode (≈
      // beatoraja LANEEFFECT ON) for timing-learning play.
      judgedNoteDisplay: 'HIDE',
      status: 'Ready',
      openFolder: () => this.elements.songInput.click(),
      record: () => {
        void this.toggleRecording();
      },
      beatorajaPreview: () => {
        void this.openBeatorajaPreview();
      },
      beatorajaPreviewVariant: '7',
    };
    // Pick up the `?compressor=split|legacy|off` URL flag once at boot. We resolve it through `parseCompressorMode`
    // (the same helper exported from `audio-bus.ts`) so the recognized values stay synced with the runtime API.
    // Unrecognized / missing flag → fall through to defaults: architecture `'split'`, GUI checkbox checked (compressor
    // on, see the `compressor: true` seed above for the rationale).
    //
    // `?compressor=split|legacy` is an explicit opt-in to that architecture and keeps the checkbox checked.
    // `?compressor=off` unchecks it for an unprocessed-signal A/B comparison.
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
      if (!files || files.length === 0) {
        return;
      }
      const fileList = [...files];
      // Reset the input value immediately so picking the SAME folder a second time still fires `change`. Browsers
      // suppress repeat `change` events when the new selection matches the previous value — without this, a user
      // re-picking after a misclick or an interrupted load would see the input silently ignore them.
      this.elements.songInput.value = '';
      void (async () => {
        // Browser file-picker drops go through the same loading overlay as drag-drop so a folder picked via the GUI
        // shows progress too. Hide the select scene up-front so its rendering / BGM stays paused while we read + parse
        // — the user shouldn't see the song list flicker mid-load.
        this.showLoadingOverlay();
        this.selectView?.setVisible(false);
        try {
          // Route through the same post-enumeration pipeline as drag-drop so the picker's selection produces a theme +
          // songs split (handy when a user hand-picks a folder whose root carries both an LR2 theme and a BMS pack),
          // instead of the previous `loadSongs`-only path that quietly skipped any LR2 assets in the selection.
          await this.processIncomingFiles(fileList);
        } finally {
          this.hideLoadingOverlay();
        }
      })();
    });

    // Global `/` shortcut focuses the search input. Standard editor convention — same as GitHub / Slack / Discord. We
    // suppress the actual `/` character so it doesn't end up in the input field.
    window.addEventListener('keydown', (event) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      // Don't hijack `/` when the user is already typing into some other input.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      this.elements.searchInput.focus();
      this.elements.searchInput.select();
    });
    // Search input: forward every keystroke to the select view so the bar list filters live. Escape clears the filter
    // and returns focus to the canvas (so arrow-key navigation works again immediately).
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
        // Pressing Enter while typing should let the user pick the currently-focused (filtered) result without leaving
        // the input first. `keydown` on the window won't fire on the select view (the input has focus), so route the
        // action explicitly.
        event.preventDefault();
        // No public "trigger Enter" API on the view; setSearchQuery already moved the cursor to 0 after each keystroke,
        // so closing the input + giving focus back to the canvas is enough for the user's next Enter press to pick that
        // song.
        this.elements.searchInput.blur();
      }
    });

    // Drag state via a depth counter rather than a plain add/remove pair on dragover/dragleave. The browser fires
    // `dragleave` not just when the cursor exits the window but also every time it crosses into a child element —
    // without counting, the `.dragging` class flickers off whenever the user drags across the canvas → toolbar
    // boundary, so the overlay would strobe (or, with `dragleave` firing once at the end, disappear before the user can
    // read the hint).
    //
    // Increment on every `dragenter`, decrement on every `dragleave`. We're truly outside the window once the counter
    // hits zero, at which point the class comes off. `drop` and the rare `dragend` reset the counter so a pathological
    // event sequence (browser quirk, devtools overlay, etc.) can't leave the class stuck on.
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
    // `dragover` still has to call `preventDefault` for the browser to treat the page as a valid drop target. We don't
    // toggle state here — that's `dragenter` / `dragleave`'s job — but skipping the preventDefault would silently turn
    // drops into "open file in browser" navigations.
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
    // Belt-and-braces: the spec lets `dragend` fire on the source element when a drag is canceled (Esc, drop on a
    // non-target). For files dragged in from the OS it shouldn't normally fire on `window`, but if a custom source ever
    // does we still want to clear state.
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
   * Hide the per-stage `Key` / `BGM` / `Master` folder when it doesn't apply to the current state:
   *
   * - Compressor checkbox unchecked → bus is in `'off'` mode, every stage is bypassed already.
   * - `?compressor=legacy` → the legacy architecture has just one compressor; per-stage toggles don't map onto it.
   *
   * lil-gui's `show(false)` collapses the folder out of the panel entirely, matching the previous `display: none`
   * behavior.
   */
  private refreshCompressorStageVisibility(): void {
    const visible = this.guiState.compressor && this.compressorMode === 'split';
    this.compressorStageFolder?.show(visible);
  }

  /**
   * Builds the floating lil-gui control panel and wires every controller to the gameplay / scene state. Centralizing
   * this in one method lets us bind handles to specific controllers (`recordController`, `compressorStageFolder`)
   * up-front, so runtime code can address them by name (renaming the record button when capture starts, hiding the
   * per-stage folder on compressor mode change) without re-querying the DOM.
   */
  private buildGui(): void {
    // Start the panel itself collapsed so it doesn't cover the select-screen / gameplay canvas the moment a user lands
    // on the demo. The nested folders (Compressor stages / BGA video transcode) stay open by default — once the user
    // opens the top-level panel, every controller is one click away rather than hidden behind another folder header.
    const gui = new GUI({ title: 'Debug Menu', width: 280 });
    gui.close();
    this.gui = gui;
    // Status row pinned to the top of the panel — first thing the user sees, so a glance at the GUI is enough to tell
    // whether a load is in flight, what's currently playing, or where a saved recording landed. Disabled so the field
    // reads as a passive read-out instead of an editable input. Updates are pushed explicitly via `setStatus`; cheaper
    // than lil-gui's `.listen()` polling and the only writer is this class anyway.
    this.statusController = gui.add(this.guiState, 'status').name('Status').disable();
    this.statusController.domElement.classList.add('status-row');
    gui.add(this.guiState, 'openFolder').name('Open Folder');
    // Beatoraja-skin preview controls. The dropdown picks which key-count variant to mount; the button opens the
    // preview scene over whatever's currently active. Only available after a beatoraja theme has been dropped.
    const beatorajaFolder = gui.addFolder('Beatoraja preview').close();
    beatorajaFolder.add(this.guiState, 'beatorajaPreviewVariant', ['7', '5', '14', '10', '9'] as const).name('Variant');
    beatorajaFolder.add(this.guiState, 'beatorajaPreview').name('Open preview');
    // Auto play used to be a lil-gui checkbox here too, but the in-scene PLAY OPTIONS panel (LR2 button_type 33 / 32 on
    // the select skin) already exposes it — the duplicate toolbar controller just added another surface to keep in
    // sync. The `guiState.autoPlay` field stays as the seed/fallback value until the select panel publishes its own
    // choice.
    gui
      .add(this.guiState, 'autoPauseOnBlur')
      .name('Auto pause on blur')
      .onChange((value: boolean) => {
        this.guiState.autoPauseOnBlur = value;
        // Push live so a chart already in flight starts honoring the new policy on its next visibility / blur event,
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
    // BGA video transcode controls. Both settings are seeded into the next `PixiGameplayView` constructor (see
    // `preloadGameplay` / `playSong` for the wiring), so changing them mid-session takes effect on the next chart mount
    // — no need to rebuild gameplay if the user is between songs. We don't push live into the running gameplay because
    // BGA assets are loaded once at chart- prepare time and the codec / resize decisions are encoded into the cached
    // video bytes.
    //
    // Both controls are dropdowns rather than free-form fields: the meaningful options cluster around standard video
    // heights (SD / 720p / 1080p / 4K) and a discrete codec pick. `0` in the resize dropdown is the magic "Off" value —
    // the consumer treats anything `≤ 0` as "preserve resolution". Earlier iterations split resize into a checkbox +
    // size pair, but users would change the size without realizing they also had to flip the checkbox — the resize was
    // silently a no-op. Folding both into one control with an explicit `Off` row removes that footgun.
    const transcode = gui.addFolder('BGA video transcode');
    // WebCodecs `VideoEncoder` is a browser feature; gate the checkbox on its existence so the user can't toggle a
    // state the runtime can't honor. On unsupported browsers (Safari < 17, older Firefox builds) the controller is
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
    // Chart-authoring debug overlay — paints invisible / keysound notes (BMS channels `3x` / `4x`) as thin green bars
    // in their playable lane. Seeded into the next `PixiGameplayView` constructor; toggling mid-song waits until the
    // next chart load to take effect (the invisible-note array is built once at chart-prepare time). Live-toggleable —
    // the gameplay view always extracts the invisible-note array and preloads the green sprite, so flipping this flag
    // flips the per-frame render branch on the very next paint.
    gui
      .add(this.guiState, 'showInvisibleNotes')
      .name('Show invisible notes')
      .onChange((value: boolean) => {
        this.guiState.showInvisibleNotes = value;
        this.gameplayView?.setShowInvisibleNotes(value);
      });
    // Picks between LR2-faithful "judged note disappears at the judge line" and our historical "keep scrolling past it"
    // behavior. Pushed live into the running gameplay view so a mid-song toggle takes effect on the very next paint —
    // the visibility check is a single per-frame branch with no backing state to rebuild.
    gui
      .add(this.guiState, 'judgedNoteDisplay', {
        'Keep scrolling (LANEEFFECT ON)': 'KEEP_SCROLLING',
        'Hide on judge (LR2 default)': 'HIDE',
      })
      .name('Judged notes')
      .onChange((value: 'KEEP_SCROLLING' | 'HIDE') => {
        this.guiState.judgedNoteDisplay = value;
        this.gameplayView?.setJudgedNoteDisplay(value);
      });
    this.recordController = gui.add(this.guiState, 'record').name('● Record');
    this.refreshCompressorStageVisibility();
  }

  /**
   * Single chokepoint for status-text updates. Writes the new value into `guiState` and refreshes the lil-gui
   * controller so the read-only row repaints with the new text.
   */
  private setStatus(text: string): void {
    this.guiState.status = text;
    this.statusController?.updateDisplay();
  }

  /**
   * Flip the gameplay recorder on / off. First click during a play session begins capture; second click finalizes the
   * blob and triggers a browser download as `<song>.webm`. Errors (codec unavailable, no gameplay view) surface to the
   * status panel.
   *
   * Visual state lives entirely on the lil-gui record controller: `name()` swaps the label between `● Record` / `■
   * Stop`, and `disable()` grays it out while the WebM blob is being assembled on stop. The `.recording` CSS class on
   * the controller's DOM element drives the red-glow accent so the lil-gui style takes precedence over our highlight.
   */
  private async toggleRecording(): Promise<void> {
    const gameplay = this.gameplayView;
    const controller = this.recordController;
    if (!gameplay) {
      // No chart is playing yet — interpret the click as "arm capture for the next song I pick" so the user can stage
      // recording from the song-select screen without having to hit Record at the precise moment gameplay starts. A
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
      this.setStatus('Finalizing recording…');
      try {
        const result = await gameplay.stopRecording();
        if (result) {
          // `MediaRecorder`'s native WebM stream is play-only — post-process the blob to inject `Duration` + `Cues` so
          // external players can seek inside it. Cheap on the typical chart-length take (a few hundred ms for a 1-3
          // minute recording on M-series hardware) and gracefully falls back to the raw blob if the patch fails, so a
          // corrupt take is never silently lost.
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
      recordLog.warn('start failed', error);
      this.setStatus(`Recording unavailable: ${(error as Error).message}`);
    }
  }

  /**
   * Filename base for the next saved recording. Derived from the currently-playing song's title (sanitized for
   * filesystem safety) or `gameplay-<timestamp>` when no song info is available. Updated on every `playSong` so
   * back-to-back recordings don't overwrite each other in the user's downloads folder.
   */
  private recordingFilenameBase = 'gameplay';

  /**
   * Reveals the centered loading overlay and reset its readout to a neutral "Loading…" state. The actual phase / counter
   * text fills in via `applyLoadProgress` as events fire from the loaders.
   */
  private showLoadingOverlay(): void {
    this.elements.loadingOverlay.classList.add('visible');
    this.elements.loadingOverlay.setAttribute('aria-hidden', 'false');
    this.elements.loadingLabel.textContent = 'Loading…';
    this.elements.loadingCounter.textContent = '';
    // Reset to indeterminate (no inline width) until the first `applyLoadProgress` lands. The CSS animates the bar so
    // the user sees motion even before the first phase event fires.
    this.elements.loadingBarFill.classList.add('indeterminate');
    this.elements.loadingBarFill.style.width = '';
  }

  private hideLoadingOverlay(): void {
    this.elements.loadingOverlay.classList.remove('visible');
    this.elements.loadingOverlay.setAttribute('aria-hidden', 'true');
  }

  /**
   * Maps a `LoadProgress` event from the player-web loaders onto the overlay DOM. Phases:
   *
   * - `enumerating` — total is `-1` (we're still walking the drop tree). Show the running file count + the current
   *   path, leave the bar in indeterminate animation mode.
   * - `reading` / `parsing` / `theme` — total is known. Switch the bar to determinate mode and set its width to
   *   `current / total`.
   *
   * Phase prefixes (`Reading files…` etc.) come from the `phaseLabels` map; the per-item label surfaces the underlying
   * filename / sub-task so the user can see which file is the current bottleneck.
   */
  private applyLoadProgress(progress: LoadProgress): void {
    const phaseLabel = phaseLabels[progress.phase];
    const counterFragments: string[] = [];
    if (progress.total > 0) {
      // Determinate phase — set explicit width and pin the counter to "X / N (P%)" so the user can eyeball ETA.
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
    // Show the overlay before we even start enumerating files — walking a deep `webkitGetAsEntry` tree on a chart pack
    // with tens of thousands of WAVs visibly stalls the UI for several seconds, and we want the user to see "we're
    // working on it" immediately rather than after the slow phase finishes.
    this.showLoadingOverlay();
    // Take the select scene offline for the duration of the load. `setVisible(false)` pauses BGM + the rAF tick + the
    // song list rendering, so:
    //
    // - the loaded LR2 theme's `select.wav` doesn't start the moment the (small) theme bundle finishes parsing while
    //   the (large) song collection is still being read,
    // - the song list doesn't visually shuffle as new entries land,
    // - and the user only sees the overlay until everything is ready — not a half-rendered scene behind it.
    //
    // `showSelect()` at the end of the try block re-enables the scene with the freshly populated state in one shot.
    this.selectView?.setVisible(false);
    try {
      const files = await readDroppedFiles(dataTransfer, {
        onProgress: (progress) => this.applyLoadProgress(progress),
      });
      await this.processIncomingFiles(files);
    } finally {
      // Always tear the overlay down — even when one of the sub-loaders threw or `splitDroppedSongAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would leave the UI permanently masked.
      this.hideLoadingOverlay();
    }
  }

  /**
   * Shared post-enumeration pipeline for both drag-drop and the Debug Menu's "Open Folder" picker. Routes the incoming
   * file list through {@link splitDroppedSongAndThemeFiles}, dispatches theme + song loaders in parallel, then mounts
   * the freshly populated select view.
   *
   * The caller is responsible for showing / hiding the loading overlay and pausing the select view — both entry points
   * handle that around their own enumeration phase.
   *
   * `loadSongs` appends to the existing library so a second / third invocation of this routine accumulates entries
   * rather than wiping the previous pack — the host can call this multiple times in succession (e.g. Open Folder
   * pressed twice with two different folders) and every drop's charts stay uniquely addressable through the library's
   * per-source prefixing.
   */
  private async processIncomingFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const { themeFiles, songFiles } = splitDroppedSongAndThemeFiles(files);
    // `splitDroppedSongAndThemeFiles` routes any non-chart files outside a chart directory into `themeFiles`. That
    // includes stray `readme.txt` / `info.json` / album-art images sitting at the root of a BMS pack that isn't a real
    // LR2 theme. Only run the theme loader when the drop actually carries an `.lr2skin` file — otherwise an "extra
    // files at the BMS root" drop wipes the previously-loaded LR2 theme by overwriting `selectSkin` / `playSkins` /
    // etc. with `undefined`.
    const carriesLr2Theme = themeFiles.some((file) =>
      (file.webkitRelativePath || file.name).toLowerCase().endsWith('.lr2skin'),
    );
    const carriesBeatorajaTheme = themeFiles.some((file) =>
      isBeatorajaSkinIndicator(file.webkitRelativePath || file.name),
    );
    const themeMarkers = [carriesLr2Theme ? 'lr2' : null, carriesBeatorajaTheme ? 'beatoraja' : null].filter(
      (marker): marker is string => marker !== null,
    );
    dropLog.info(
      `received ${files.length} file(s) · theme=${themeFiles.length}${
        themeMarkers.length > 0 ? ` (${themeMarkers.join('+')})` : ' (no skin entry → preserving current theme)'
      } · songs=${songFiles.length}`,
    );
    const tasks: Array<Promise<unknown>> = [];
    if (carriesLr2Theme) {
      tasks.push(this.loadTheme(themeFiles));
    }
    if (carriesBeatorajaTheme) {
      tasks.push(this.loadBeatorajaTheme(themeFiles));
    }
    if (songFiles.length > 0) {
      tasks.push(this.loadSongs(songFiles));
    }
    if (tasks.length === 0) {
      dropLog.warn('nothing to load — neither theme nor chart files matched');
      return;
    }
    await Promise.all(tasks);
    const playSkinSummary = summarizeLr2PlaySkins(this.playSkins);
    const beatorajaSummary = this.beatorajaTheme
      ? summarizeBeatorajaPlaySkins(this.beatorajaTheme.theme.playSkins) || 'none'
      : 'none';
    dropLog.info(
      `loaded · songs=${this.collection.songs.length} · errors=${
        this.collection.errors.length
      } · play-skins=${playSkinSummary || 'none'} · select-skin=${this.selectSkin?.name ?? 'none'}${
        this.beatorajaTheme ? ` · beatoraja-skins=${beatorajaSummary}` : ''
      }`,
    );
    if (this.collection.errors.length > 0) {
      dropLog.warn('parse errors:', this.collection.errors);
    }
    // Status panel stays terse on purpose — only show "loaded" when there's something to celebrate, and skip the
    // per-key-mode skin enumeration since the user can see the active skin in-canvas. "0 charts loaded" is suppressed
    // so a theme-only drop doesn't read like an error.
    if (this.collection.songs.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    } else if (this.selectSkin || this.resultSkin || Object.keys(this.playSkins).length > 0) {
      this.setStatus('Theme loaded');
    }
    await this.showSelect();
  }

  private async loadSongs(files: File[]): Promise<void> {
    this.setStatus('Loading songs...');
    // Append rather than replace so a second / third folder drop adds to the existing library instead of wiping the
    // previous pack. The library re-prefixes source / song IDs so each drop's entries stay uniquely addressable. The
    // very first drop is just `append onto an empty collection`, which produces the same result as `loadFromFiles`
    // would have.
    this.collection = await this.library.appendFromFiles(files, {
      onProgress: (progress) => this.applyLoadProgress(progress),
    });
    // Suppress the "0 charts loaded" reading — that text reads like a parse error to the user. The post-load status
    // text is set by `handleDrop` once both theme + songs land, so a mid-flight transient is plenty.
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
    // BGM / decide / system-sound bytes are stashed on the host here, but NOT pushed onto the live select view yet —
    // that happens in `showSelect()` once every load task has resolved. Otherwise the small theme bundle would land
    // first and start BGM playing before the larger song collection has even finished parsing, which felt jarring with
    // a loading overlay still on screen.
    //
    // We deliberately don't paint a per-skin "Play: 7K=… / 14K=…" status here. The skin is observable in-canvas the
    // moment the user enters song-select; spelling it out in the toolbar status panel was redundant and made the
    // toolbar wider than it needed to be. `handleDrop` writes a terse "Theme loaded" / "N charts loaded" once
    // everything lands.
  }

  /**
   * Load a beatoraja theme drop in parallel with the LR2 path. We currently parse the bundle and stash it on the
   * host for inspection; PixiJS rendering for beatoraja skins is implemented in a follow-up patch. The beatoraja
   * loader is independent of `loadTheme` — both states coexist so the user can drop both formats and switch between
   * them later.
   */
  private async loadBeatorajaTheme(files: File[]): Promise<void> {
    this.setStatus('Loading beatoraja theme...');
    try {
      const bundle = await loadBeatorajaThemeFromFiles(files, {
        onProgress: (progress) => this.applyLoadProgress(progress),
      });
      // Drop the previous preview scene's container, but keep the texture caches alive (we don't destroy
      // beatoraja textures in this session — see `beatorajaTextureCachesByEntry`'s field comment). The map
      // entries pointing at the old theme's bytes are released by clearing the map; the underlying Pixi
      // textures stay allocated until page reload, but they're unreachable from the renderer once the new
      // theme replaces `beatorajaTheme`.
      this.beatorajaPreviewScene?.dispose();
      this.beatorajaPreviewScene = undefined;
      this.beatorajaTextureCachesByEntry.clear();
      this.beatorajaTheme = bundle;
      // Scan the dropped bundle for decide / clear / fail / result BGM. Heuristic by basename —
      // see `findBeatorajaThemeBgm` for the rules. Awaited because some entries are read lazily;
      // the load is small (<1 MiB) and serialized so it doesn't add visible latency.
      this.beatorajaThemeBgm = await findBeatorajaThemeBgm(bundle);
      const summary = summarizeBeatorajaPlaySkins(bundle.theme.playSkins) || 'none';
      const sceneSummary = [
        bundle.theme.selectSkin ? 'select' : null,
        bundle.theme.decideSkin ? 'decide' : null,
        bundle.theme.resultSkin ? 'result' : null,
        bundle.theme.gradeResultSkin ? 'grade' : null,
      ]
        .filter((s): s is string => s !== null)
        .join('+');
      dropLog.info(
        `beatoraja theme loaded · play=${summary}${sceneSummary ? ` · scenes=${sceneSummary}` : ''}${
          bundle.warnings.length > 0 ? ` · warnings=${bundle.warnings.length}` : ''
        }`,
      );
      if (bundle.warnings.length > 0) {
        for (const w of bundle.warnings) {
          dropLog.warn(`beatoraja skin warning: ${w.entryPath}: ${w.message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dropLog.warn(`beatoraja theme load failed: ${message}`);
    }
  }

  /**
   * Per-entry-path memoized texture caches. Never destroyed in this session — see `beatoraja-textures.ts` for
   * why disposing beatoraja textures and re-decoding the same bytes crashes PixiJS v8's bind-group cache.
   * The same hazard is technically present in the LR2 path but LR2's flow doesn't re-mount the same skin.
   */
  private readonly beatorajaTextureCachesByEntry = new Map<string, BeatorajaTextureCache>();
  /**
   * Per-entry skin font cache. Same lifecycle as the texture cache — the registered `FontFace`s outlive
   * the scene (they sit on `document.fonts`), so re-mounting the same skin reuses the family lookup
   * without re-parsing the TTF bytes.
   */
  private readonly beatorajaFontCachesByEntry = new Map<string, BeatorajaFontCache>();
  private beatorajaPreviewScene: BeatorajaPlaySkinPreviewScene | undefined;

  /**
   * Build the static-paint preview for the currently-loaded beatoraja theme and mount it on the shared
   * scene host. This is intentionally minimal — the engine isn't running, so judge / combo / score / lamp ops are
   * all on their initial frames. Goal: show that the parser → renderer → on-screen pipeline reaches the screen for
   * `play 5 / 7 / 9 / 10 / 14`. Future patches will swap this for a full gameplay scene that drives the same view
   * from engine signals.
   */
  private async openBeatorajaPreview(): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle) {
      dropLog.warn('beatoraja preview: no theme loaded — drop a beatoraja theme folder first');
      this.setStatus('Beatoraja preview: drop a beatoraja theme folder first');
      return;
    }
    const desired = this.guiState.beatorajaPreviewVariant as BeatorajaPlayVariant;
    // Two-pass evaluation. The header pass surfaces the skin's `property[]` schema; we then materialize each
    // property's first item into a default `option` map and run the second pass with it. Without this, Lua skins
    // whose `main()` branches on `skin_config.option["Play Side"]` (and friends) hit none of their elseif arms and
    // emit an empty `source[]` — which is what we saw in the dev-server logs for play7.
    const headerLoad = loadBeatorajaPlaySkinFromBundle(bundle, desired);
    if (!headerLoad || !headerLoad.result.ok) {
      const reason = headerLoad?.result.ok === false ? headerLoad.result.error.message : 'no skin available';
      dropLog.warn(`beatoraja preview header: ${reason}`);
      this.setStatus(`Beatoraja preview: ${reason}`);
      return;
    }
    const defaultOption = buildDefaultSkinConfigOptions(headerLoad.result.header);
    const loaded = loadBeatorajaPlaySkinFromBundle(bundle, desired, { offset: 0, option: defaultOption });
    if (!loaded || !loaded.result.ok || !loaded.result.skin) {
      const reason = loaded?.result.ok === false ? loaded.result.error.message : 'no skin available';
      dropLog.warn(`beatoraja preview: ${reason}`);
      this.setStatus(`Beatoraja preview: ${reason}`);
      return;
    }
    dropLog.info(
      `beatoraja preview default options: ${
        Object.keys(defaultOption).length === 0
          ? '(none)'
          : Object.entries(defaultOption)
              .map(([k, v]) => `${k}=${v}`)
              .join(' / ')
      }`,
    );

    // Reuse the texture cache for this entry path if we've already built one, otherwise decode the variant's
    // `source[]` once and cache the result for the rest of the session. We never destroy these caches — see the
    // comment on `beatorajaTextureCachesByEntry` for the WebGPU / WebGL2 reason.
    let textures = this.beatorajaTextureCachesByEntry.get(loaded.entry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: loaded.entry.entryPath,
        sources: (loaded.result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      });
      dropLog.info(
        `beatoraja preview source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length}`,
      );
      for (const u of sourceBundle.unresolved) {
        dropLog.warn(`beatoraja preview unresolved source[${u.id}] '${u.path}': ${u.reason}`);
      }
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(loaded.entry.entryPath, textures);
    } else {
      dropLog.info(`beatoraja preview source bundle: reused cached textures for ${loaded.entry.entryPath}`);
    }

    await this.ensureHostMounted();

    // Tear down the LR2 gameplay view if one is up — the preview scene takes over the host's stage.
    this.gameplayView?.dispose();
    this.gameplayView = undefined;

    // Drop the previous preview scene's container without touching its textures (those are owned by the cached
    // texture map and survive the scene teardown).
    this.beatorajaPreviewScene?.dispose();
    this.beatorajaPreviewScene = new BeatorajaPlaySkinPreviewScene({
      skin: loaded.result.skin,
      textures,
      onExit: () => {
        void this.closeBeatorajaPreview();
      },
      // Placeholder text resolver — without an engine running we don't have the real song / score / state
      // strings, so we substitute a per-ref-op label so the preview still shows where each text destination
      // would render. Engine integration replaces this with a snapshot of the runtime text state.
      resolveTextContent: (refOp) => `<text:${refOp}>`,
    });

    await this.sceneHost.setScene(this.beatorajaPreviewScene);
    this.setStatus(`Beatoraja preview: ${desired}-keys (${loaded.entry.entryPath}) — press ESC to exit`);
  }

  private async closeBeatorajaPreview(): Promise<void> {
    await this.sceneHost.setScene(undefined);
    // Only the preview scene's container is detached; the texture cache stays alive in
    // `beatorajaTextureCachesByEntry` so the next preview can reuse it. See the field-level comment for the
    // dispose-avoidance rationale.
    this.beatorajaPreviewScene?.dispose();
    this.beatorajaPreviewScene = undefined;
    await this.showSelect();
  }

  /**
   * Returns true when the loaded beatoraja theme has a play skin we can mount for this chart — directly
   * or through the playable-variant fallback chain (a 5K chart will happily render on a 7K skin if the
   * theme author only shipped the 7-keys variant). Used by `playSong` / `showDecide` to decide whether
   * to branch into the beatoraja gameplay path.
   */
  private canPlaySongBeatoraja(song: BrowserSongEntry): boolean {
    return this.resolveBeatorajaSkinVariant(song) !== undefined;
  }

  /**
   * Resolve the actual skin variant the beatoraja gameplay path will mount for a chart. Returns the
   * desired variant verbatim when the theme ships it, the closest playable fallback otherwise, or
   * `undefined` when the theme has nothing playable.
   */
  private resolveBeatorajaSkinVariant(song: BrowserSongEntry) {
    const bundle = this.beatorajaTheme;
    if (!bundle) return undefined;
    const desired = pickBeatorajaPlayableVariant(this.chartShapeFor(song));
    if (desired === undefined) return undefined;
    return pickBeatorajaPlayableSkinVariant(bundle.theme.playSkins, desired);
  }

  /** Map a song's parsed chart onto the shape input `pickBeatorajaPlayableVariant` expects. */
  private chartShapeFor(song: BrowserSongEntry): { keys: number; isDouble: boolean; isPms: boolean } {
    const variant = resolveChartPlayVariant(song);
    return {
      keys: variant === '14' ? 14 : variant === '10' ? 10 : variant === '7' ? 7 : variant === '5' ? 5 : 9,
      isDouble: variant === '14' || variant === '10',
      isPms: variant === '9',
    };
  }

  /**
   * Beatoraja gameplay flow. Mirrors the LR2 `playSong` lifecycle (mount + audio decode → run engine →
   * route exit / completion to result / select), but routes audio through `runEngineDriver` and the
   * scene through `PixiBeatorajaGameplayView` instead of the LR2 view's bespoke render pipeline.
   *
   * The view assumes pre-decoded audio + BGA — those come from `prepareBeatorajaGameplayChart`. Each
   * play awaits the prep promise before constructing the view; if the prep fails, we surface the
   * status and bail back to song select rather than silently falling back to LR2 (the user explicitly
   * opted into the beatoraja path).
   */
  private async playSongBeatoraja(song: BrowserSongEntry, overrides: { autoPlay?: boolean }): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle) return;
    // The skin variant may differ from the chart's natural variant when the theme doesn't ship one and
    // we fall back (e.g. 5K chart played on the theme's 7-keys skin). The engine still drives the chart
    // at its native variant; only the skin chrome / note layer geometry follows the loaded skin.
    const variant = this.resolveBeatorajaSkinVariant(song);
    if (variant === undefined) return;
    const desiredVariant = pickBeatorajaPlayableVariant(this.chartShapeFor(song));
    if (variant !== desiredVariant) {
      gameplayLog.info(`beatoraja gameplay: theme has no '${desiredVariant}' skin — falling back to '${variant}'`);
    }

    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.decideView = undefined;
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.disposeBeatorajaGameplay();
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;

    // 1. Pick the actual skin entry for this variant, honoring any user override from the
    // bottom-right "Skin" dropdown. Falls back to `pickBeatorajaPlaySkin`'s discovery result.
    const playTypeCode = playSkinTypeForVariant(variant);
    const playCandidates = bundle.theme.entries.filter((entry) => entry.header.type === playTypeCode);
    const fallbackEntry = bundle.theme.playSkins[variant];
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(playTypeCode, playCandidates, fallbackEntry);
    if (selectedEntry === undefined) {
      gameplayLog.warn(`beatoraja gameplay: no skin entry for variant '${variant}'`);
      this.setStatus(`Beatoraja gameplay unavailable: no '${variant}' skin`);
      void this.showSelect();
      return;
    }

    // Two-pass evaluation — same contract as the select scene.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja gameplay header: ${headerLoad.error.message}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${headerLoad.error.message}`);
      void this.showSelect();
      return;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja gameplay: ${reason}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${reason}`);
      void this.showSelect();
      return;
    }
    // Narrow the union by extracting the (now-known-defined) `skin` reference; subsequent uses
    // type-check without `!` operators. Local `skinLoad` mirrors the legacy
    // `loadBeatorajaPlaySkinFromBundle` shape so downstream destructuring stays unchanged.
    const skin = result.skin;
    const skinLoad = { entry: selectedEntry, skin };

    // 2. Texture cache for the skin variant — reuse if previously decoded.
    let textures = this.beatorajaTextureCachesByEntry.get(skinLoad.entry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        sources: (skinLoad.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: skinLoad.skin.filepath,
        filepathOverrides: config.file,
      });
      gameplayLog.info(
        `beatoraja gameplay source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${skinLoad.entry.entryPath})`,
      );
      for (const u of sourceBundle.unresolved) {
        gameplayLog.warn(`beatoraja gameplay unresolved source[${u.id}] '${u.path}': ${u.reason}`);
      }
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(skinLoad.entry.entryPath, textures);
    }

    // 2b. Skin font cache. Same per-entry memoization as textures — TTFs are tiny (≤ a few hundred KB)
    // and the registered FontFace outlives every scene anyway.
    let fonts = this.beatorajaFontCachesByEntry.get(skinLoad.entry.entryPath);
    if (fonts === undefined) {
      const fontDeclarations = normalizeBeatorajaFonts(skinLoad.skin.font);
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        fonts: fontDeclarations,
      });
      gameplayLog.info(
        `beatoraja gameplay fonts: declared=${fontDeclarations.length} loaded=${fonts.values().length} (entry=${skinLoad.entry.entryPath})`,
      );
      this.beatorajaFontCachesByEntry.set(skinLoad.entry.entryPath, fonts);
    }

    // 3. Audio + BGA prep — owns the AudioContext for this play.
    const source = resolveSongSource(this.collection, song);
    if (!source) {
      this.setStatus(`Beatoraja gameplay: no source for ${song.title}`);
      void this.showSelect();
      return;
    }
    let prep: PreparedBeatorajaGameplayChart;
    try {
      prep = await prepareBeatorajaGameplayChart({
        song,
        source,
        audioCompressorMode: this.guiState.compressor === false ? 'off' : this.compressorMode,
      });
    } catch (error) {
      gameplayLog.warn('beatoraja prep failed', error);
      this.setStatus(`Beatoraja prep failed: ${(error as Error).message}`);
      void this.showSelect();
      return;
    }
    this.beatorajaGameplayPrep = prep;

    // 4. Mount the gameplay view.
    this.beatorajaGameplayView = new PixiBeatorajaGameplayView({
      skin: skinLoad.skin,
      textures,
      fonts,
      skinConfig: config,
      variant,
      chart: prep.chart,
      audio: prep.audio,
      mode: (overrides.autoPlay ?? this.guiState.autoPlay) ? 'auto' : 'manual',
      bgaTextures: prep.bga.textures,
      bgaCues: prep.bga.cues,
      onExit: () => {
        void this.finishBeatorajaGameplayThen(() => this.showSelect());
      },
      onComplete: (summary, maxCombo) => {
        // Result skin (`type = 7`) when the bundle ships one — otherwise jump back to select.
        // `finishBeatorajaGameplayThen` drops the gameplay scene first so the result scene gets a
        // clean stage; the result scene mounts in the `then` branch.
        void this.finishBeatorajaGameplayThen(async () => {
          const mounted = await this.showBeatorajaResult(song, summary, maxCombo);
          if (!mounted) await this.showSelect();
        });
      },
      onError: (error) => {
        // `PlayerInterruptedError` lands here for the ESC path — it's the expected exit for "user
        // pressed ESC mid-chart". Treat it as a clean exit.
        gameplayLog.info('beatoraja engine ended', { error: (error as Error).message });
        void this.finishBeatorajaGameplayThen(() => this.showSelect());
      },
    });
    this.beatorajaGameplayView.root.zIndex = 0;
    await this.sceneHost.setScene(this.beatorajaGameplayView);
    this.setStatus(`Playing (beatoraja): ${song.title}`);

    // Skin-options panel for the play skin's `property[]` / `filepath[]`. Live edits flow through
    // `applyBeatorajaPlaySkinConfig` → `replaceSkin` so the chrome rebuilds without tearing down
    // the engine driver. The audio session, chart playback, and scoring all keep running.
    this.refreshBeatorajaSkinOptionsGui({
      title: `Play skin (${variant} keys)`,
      entryPath: selectedEntry.entryPath,
      header: headerLoad.header,
      availableSkins: this.collectBeatorajaSkinChoices([playTypeCode]),
      onSkinChange: (nextEntryPath) => {
        this.beatorajaSkinOverridesByType.set(playTypeCode, nextEntryPath);
        const nextConfig = this.resolveBeatorajaSkinConfig(nextEntryPath, headerLoad.header);
        void this.applyBeatorajaPlaySkinConfig(nextEntryPath, variant, nextConfig);
      },
      onApply: (nextConfig) => {
        void this.applyBeatorajaPlaySkinConfig(selectedEntry.entryPath, variant, nextConfig);
      },
    });
  }

  /**
   * Apply a fresh skin-config to the active beatoraja gameplay scene WITHOUT restarting the chart.
   * Re-loads the skin with the new options, rebuilds the per-entry texture cache, then calls
   * `replaceSkin` on the live gameplay view. The runtime adapter's `setBaseOps` handles the option
   * delta so per-side judge state / timer stamps / current frame all carry through unchanged.
   */
  private async applyBeatorajaPlaySkinConfig(
    entryPath: string,
    variant: BeatorajaPlayableVariant,
    config: BeatorajaSkinConfig,
  ): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || !this.beatorajaGameplayView) return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an
    // alternate skin from the bottom-right "Skin" dropdown.
    const result = loadBeatorajaSkin({ entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) return;
    this.beatorajaTextureCachesByEntry.delete(entryPath);
    const sourceBundle = bundleBeatorajaSources({
      files: bundle.files,
      entryPath,
      sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      filepathSchema: result.skin.filepath,
      filepathOverrides: config.file,
    });
    const textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
    this.beatorajaTextureCachesByEntry.set(entryPath, textures);
    let fonts = this.beatorajaFontCachesByEntry.get(entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(entryPath, fonts);
    }
    this.beatorajaGameplayView.replaceSkin({ skin: result.skin, skinConfig: config, textures, fonts });

    const playTypeCode = playSkinTypeForVariant(variant);
    this.refreshBeatorajaSkinOptionsGui({
      title: `Play skin (${variant} keys)`,
      entryPath,
      header: result.header,
      availableSkins: this.collectBeatorajaSkinChoices([playTypeCode]),
      onSkinChange: (nextEntryPath) => {
        this.beatorajaSkinOverridesByType.set(playTypeCode, nextEntryPath);
        const nextConfig = this.resolveBeatorajaSkinConfig(nextEntryPath, result.header);
        void this.applyBeatorajaPlaySkinConfig(nextEntryPath, variant, nextConfig);
      },
      onApply: (nextConfig) => {
        void this.applyBeatorajaPlaySkinConfig(entryPath, variant, nextConfig);
      },
    });
  }

  /**
   * Mount the beatoraja-skinned song select scene. Loads the theme's select skin (with a default
   * `skin_config.option` fill from `buildDefaultSkinConfigOptions`), reuses cached textures / fonts
   * when available, and hands the scene a callback that routes the chosen song through the existing
   * `showDecide` / `playSong` flow.
   */
  private async showBeatorajaSelect(): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return;

    // Pick the actual entry to mount — honor a user override from the bottom-right "Skin" dropdown
    // when one was set, otherwise fall back to the discovery's "best" pick (`theme.selectSkin`).
    const selectCandidates = bundle.theme.entries.filter(
      (entry) => entry.header.type === BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
    );
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
      selectCandidates,
      bundle.theme.selectSkin,
    );
    if (selectedEntry === undefined) {
      gameplayLog.warn('beatoraja select: no select skin in theme');
      this.setStatus('Beatoraja select unavailable: no select skin');
      return;
    }

    // Two-pass evaluation — header pass picks up the skin's `property[]` schema, the second pass
    // re-runs `main()` with default option picks so dynamic `source[]` / `destination[]` populate.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja select: ${headerLoad.error.message}`);
      this.setStatus(`Beatoraja select unavailable: ${headerLoad.error.message}`);
      return;
    }
    // Resolve cached skin config (or seed defaults from the header's property[] schema). The
    // skin-options panel mutates this object as the user picks options.
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja select: ${reason}`);
      this.setStatus(`Beatoraja select unavailable: ${reason}`);
      return;
    }
    // Narrow the union by extracting the (now-known-defined) `skin` reference; subsequent uses
    // type-check without `!` operators.
    const skin = result.skin;
    const skinLoad = { entry: selectedEntry, skin };

    // Texture + font cache — same per-entry memoization as the gameplay path. The select skin lives
    // at a different `entryPath` than `play_*.luaskin` so the caches are naturally segregated.
    let textures = this.beatorajaTextureCachesByEntry.get(skinLoad.entry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        sources: (skinLoad.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: skinLoad.skin.filepath,
      });
      gameplayLog.info(
        `beatoraja select source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${skinLoad.entry.entryPath})`,
      );
      for (const u of sourceBundle.unresolved) {
        gameplayLog.warn(`beatoraja select unresolved source[${u.id}] '${u.path}': ${u.reason}`);
      }
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(skinLoad.entry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(skinLoad.entry.entryPath);
    if (fonts === undefined) {
      const fontDeclarations = normalizeBeatorajaFonts(skinLoad.skin.font);
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        fonts: fontDeclarations,
      });
      this.beatorajaFontCachesByEntry.set(skinLoad.entry.entryPath, fonts);
    }

    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = new PixiBeatorajaSelectScene({
      skin: skinLoad.skin,
      textures,
      fonts,
      skinConfig: config,
      songs: this.collection.songs,
      // Restore the last cursor so coming back from gameplay lands on the same song.
      initialIndex: this.beatorajaSelectIndex,
      onSongPicked: (song) => {
        // Cache the index using the picked song's identity — survives the scene tear-down.
        this.beatorajaSelectIndex = this.collection.songs.indexOf(song);
        // Same flow as the LR2 select view: route to decide → gameplay. The decide branch in
        // `showDecide` already detects the beatoraja gameplay case and skips its splash.
        void this.showDecide(song);
      },
      onExit: () => {
        // ESC from the beatoraja select returns to the empty drop screen.
        this.elements.shell.classList.add('empty');
        void this.sceneHost.setScene(undefined);
        this.beatorajaSelectScene?.dispose();
        this.beatorajaSelectScene = undefined;
        this.beatorajaSkinOptionsGui?.clear();
      },
    });
    await this.sceneHost.setScene(this.beatorajaSelectScene);
    this.setStatus(`Select (beatoraja): ${this.collection.songs.length} song(s)`);

    // Build the bottom-right skin-options panel for this select skin's `property[]` / `filepath[]`.
    // User picks flow back through `onApply` → live `replaceSkin` on the active scene so chrome
    // changes (Play Side, Score Graph On/Off, etc.) take effect on the very next Pixi frame
    // without disposing / re-mounting the scene.
    this.refreshBeatorajaSkinOptionsGui({
      title: `Select skin (${selectedEntry.entryPath.split('/').pop() ?? 'select'})`,
      entryPath: selectedEntry.entryPath,
      header: headerLoad.header,
      availableSkins: this.collectBeatorajaSkinChoices([BEATORAJA_SKIN_TYPE.MUSIC_SELECT]),
      onSkinChange: (nextEntryPath) => {
        // Persist the user's pick so subsequent select-scene mounts use the new entry too.
        this.beatorajaSkinOverridesByType.set(BEATORAJA_SKIN_TYPE.MUSIC_SELECT, nextEntryPath);
        // Apply against the new entry. The cached config for the new entry (or its defaults) is
        // resolved inside `applyBeatorajaSelectSkinConfig`; we don't need to pass it explicitly.
        const nextConfig = this.resolveBeatorajaSkinConfig(nextEntryPath, headerLoad.header);
        void this.applyBeatorajaSelectSkinConfig(nextEntryPath, nextConfig);
      },
      onApply: (nextConfig) => {
        void this.applyBeatorajaSelectSkinConfig(selectedEntry.entryPath, nextConfig);
      },
    });
  }

  /**
   * Apply a fresh skin-config to the active beatoraja select scene WITHOUT disposing / re-mounting.
   * Re-runs the skin's Lua `main()` (or re-parses the JSON) with the new options, refreshes the
   * texture cache (Lua skins emit different `source[]` lists per option set), then calls
   * `replaceSkin` on the live scene.
   */
  private async applyBeatorajaSelectSkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || !this.beatorajaSelectScene) return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an
    // alternate skin from the bottom-right dropdown.
    const result = loadBeatorajaSkin({ entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) return;
    // Drop and re-decode the texture cache for this entry — option changes can alter `source[]`.
    this.beatorajaTextureCachesByEntry.delete(entryPath);
    const sourceBundle = bundleBeatorajaSources({
      files: bundle.files,
      entryPath,
      sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      filepathSchema: result.skin.filepath,
      filepathOverrides: config.file,
    });
    const textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
    this.beatorajaTextureCachesByEntry.set(entryPath, textures);
    let fonts = this.beatorajaFontCachesByEntry.get(entryPath);
    if (fonts === undefined) {
      // Per-entry font cache miss — fonts may differ between skins, so load fresh for this entry.
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(entryPath, fonts);
    }
    this.beatorajaSelectScene.replaceSkin({ skin: result.skin, skinConfig: config, textures, fonts });

    // Refresh the skin-options panel against the new entry's header so the property dropdowns
    // reflect the new skin's `property[]` schema.
    this.refreshBeatorajaSkinOptionsGui({
      title: `Select skin (${entryPath.split('/').pop() ?? 'select'})`,
      entryPath,
      header: result.header,
      availableSkins: this.collectBeatorajaSkinChoices([BEATORAJA_SKIN_TYPE.MUSIC_SELECT]),
      onSkinChange: (nextEntryPath) => {
        this.beatorajaSkinOverridesByType.set(BEATORAJA_SKIN_TYPE.MUSIC_SELECT, nextEntryPath);
        const nextConfig = this.resolveBeatorajaSkinConfig(nextEntryPath, result.header);
        void this.applyBeatorajaSelectSkinConfig(nextEntryPath, nextConfig);
      },
      onApply: (nextConfig) => {
        void this.applyBeatorajaSelectSkinConfig(entryPath, nextConfig);
      },
    });
  }

  /**
   * Mount the beatoraja decide splash for `song`. Returns `true` when the splash actually mounted —
   * `false` falls through to the no-decide fast-path (the loaded theme didn't ship a decide skin,
   * the entry's header / payload failed to load, etc.). Both branches eventually call
   * `playSongBeatoraja`; the difference is whether the user sees an animated chrome between
   * select and gameplay.
   */
  private async showBeatorajaDecide(song: BrowserSongEntry, overrides: { autoPlay?: boolean }): Promise<boolean> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return false;

    // Decide skin discovery — same shape as select / play. Picks the user's override when set,
    // otherwise the bundle's first matching entry.
    const decideCandidates = bundle.theme.entries.filter((entry) => entry.header.type === BEATORAJA_SKIN_TYPE.DECIDE);
    const fallbackEntry = decideCandidates[0];
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.DECIDE,
      decideCandidates,
      fallbackEntry,
    );
    if (selectedEntry === undefined) return false;

    // Two-pass evaluation — same `loadBeatorajaSkin` contract as select / play. The first pass
    // gives us the header (used for `property[]` dropdown); the second runs the skin's `main()`
    // with the resolved option set so dynamic destinations populate.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja decide: ${headerLoad.error.message}`);
      return false;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja decide: ${reason}`);
      return false;
    }

    // Texture + font cache lookup — reuse existing entries, decode + register fresh ones.
    let textures = this.beatorajaTextureCachesByEntry.get(selectedEntry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: result.skin.filepath,
        filepathOverrides: config.file,
      });
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(selectedEntry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(selectedEntry.entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(selectedEntry.entryPath, fonts);
    }

    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    this.beatorajaDecideScene?.dispose();

    // Idempotency gate — `onContinue` and the auto-advance timer can race in theory; whichever
    // lands first wins. Same pattern as the LR2 decide path.
    let advanced = false;
    const advance = (then: () => void): void => {
      if (advanced) return;
      advanced = true;
      then();
    };

    this.beatorajaDecideScene = new PixiBeatorajaDecideScene({
      skin: result.skin,
      textures,
      fonts,
      skinConfig: config,
      song,
      bgmBytes: this.beatorajaThemeBgm.decide,
      onContinue: () =>
        advance(() => {
          // Drop the decide scene first so the gameplay scene gets a clean stage. `playSongBeatoraja`
          // handles the rest — host mount, audio prep, skin selection, etc.
          void this.sceneHost.setScene(undefined).then(() => {
            this.beatorajaDecideScene?.dispose();
            this.beatorajaDecideScene = undefined;
            void this.playSongBeatoraja(song, overrides);
          });
        }),
      onCancel: () =>
        advance(() => {
          // ESC from the splash returns to select — same fallback as LR2.
          void this.sceneHost.setScene(undefined).then(() => {
            this.beatorajaDecideScene?.dispose();
            this.beatorajaDecideScene = undefined;
            void this.showSelect();
          });
        }),
    });
    await this.sceneHost.setScene(this.beatorajaDecideScene);
    this.setStatus(`Decide (beatoraja): ${song.title}`);
    return true;
  }

  /**
   * Mount the beatoraja result scene for `song` against the chart's final `summary`. Returns
   * `true` when the scene actually mounted — `false` falls through to the no-result fast-path
   * (no result skin in the bundle, or skin load failed). Same shape as `showBeatorajaDecide`.
   */
  private async showBeatorajaResult(
    song: BrowserSongEntry,
    summary: PlayerSummary,
    maxCombo: number,
  ): Promise<boolean> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return false;

    const resultCandidates = bundle.theme.entries.filter((entry) => entry.header.type === BEATORAJA_SKIN_TYPE.RESULT);
    const fallbackEntry = resultCandidates[0];
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.RESULT,
      resultCandidates,
      fallbackEntry,
    );
    if (selectedEntry === undefined) return false;

    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja result: ${headerLoad.error.message}`);
      return false;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja result: ${reason}`);
      return false;
    }

    let textures = this.beatorajaTextureCachesByEntry.get(selectedEntry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: result.skin.filepath,
        filepathOverrides: config.file,
      });
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(selectedEntry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(selectedEntry.entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(selectedEntry.entryPath, fonts);
    }

    await this.ensureHostMounted();
    this.beatorajaResultScene?.dispose();

    let dismissed = false;
    this.beatorajaResultScene = new PixiBeatorajaResultScene({
      skin: result.skin,
      textures,
      fonts,
      skinConfig: config,
      song,
      summary,
      maxCombo,
      // Pick the outcome-specific jingle when one was discovered, falling back to the generic
      // `result` slot. Beatoraja themes that ship a single result BGM authoredit as `result.*`,
      // while themes that distinguish clear / fail (most reference themes) ship dedicated tracks.
      bgmBytes:
        ((summary.gauge?.cleared ?? false) ? this.beatorajaThemeBgm.clear : this.beatorajaThemeBgm.fail) ??
        this.beatorajaThemeBgm.result,
      onContinue: () => {
        if (dismissed) return;
        dismissed = true;
        void this.sceneHost.setScene(undefined).then(() => {
          this.beatorajaResultScene?.dispose();
          this.beatorajaResultScene = undefined;
          void this.showSelect();
        });
      },
    });
    await this.sceneHost.setScene(this.beatorajaResultScene);
    this.setStatus(
      `Result (beatoraja): ${song.title} · score=${summary.score} ex=${summary.exScore} maxCombo=${maxCombo}`,
    );
    return true;
  }

  /**
   * Collect the discovered skin entries whose `header.type` matches one of `acceptedTypes`. Used to
   * populate the bottom-right GUI's "Skin" dropdown — the demo passes `[MUSIC_SELECT]` for the
   * select scene, the active variant's type for the play scene, etc. Returns an empty array when
   * no theme is loaded.
   */
  private collectBeatorajaSkinChoices(acceptedTypes: ReadonlyArray<number>): SkinChoice[] {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return [];
    const accepted = new Set(acceptedTypes);
    return bundle.theme.entries
      .filter((entry) => accepted.has(entry.header.type))
      .map((entry) => ({ entryPath: entry.entryPath, label: skinChoiceLabel(entry) }));
  }

  /**
   * Pick the actual skin entry to mount for a scene, honoring the user's override when one was
   * recorded. Falls back to `fallback` (the discovery's "best" pick) when no override exists or
   * when the override no longer points at a valid entry (e.g., the user dropped a different theme).
   */
  private pickBeatorajaSkinEntryWithOverride(
    typeCode: number,
    candidates: ReadonlyArray<BeatorajaSkinEntry>,
    fallback: BeatorajaSkinEntry | undefined,
  ): BeatorajaSkinEntry | undefined {
    const override = this.beatorajaSkinOverridesByType.get(typeCode);
    if (override !== undefined) {
      const found = candidates.find((entry) => entry.entryPath === override);
      if (found !== undefined) return found;
      // Override stale (theme rotated) — drop it so the fallback takes over.
      this.beatorajaSkinOverridesByType.delete(typeCode);
    }
    return fallback;
  }

  /**
   * Pick the cached skin config for an entry — falling back to a fresh defaults-fill from the
   * header's `property[]` schema. Mutating the returned object directly mutates the cache, but the
   * skin-options panel emits fresh copies on change so the cached state never becomes accidentally
   * shared with downstream consumers.
   */
  private resolveBeatorajaSkinConfig(entryPath: string, header: BeatorajaSkinHeader): BeatorajaSkinConfig {
    let cached = this.beatorajaSkinConfigByEntry.get(entryPath);
    if (cached === undefined) {
      cached = { offset: 0, option: buildDefaultSkinConfigOptions(header), file: {} };
      this.beatorajaSkinConfigByEntry.set(entryPath, cached);
    }
    return cached;
  }

  /**
   * Pre-resolve `filepath[]` candidate lists for the skin-options panel. Each entry's `path` field
   * is a wildcard relative to the skin directory; `expandBeatorajaWildcard` walks the dropped file
   * map and returns every match. The panel hands these to lil-gui as dropdown options so the user
   * can pick a specific file by name rather than guessing.
   */
  private collectBeatorajaFileCandidates(
    entryPath: string,
    header: BeatorajaSkinHeader,
  ): ReadonlyMap<string, ReadonlyArray<string>> {
    const map = new Map<string, ReadonlyArray<string>>();
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return map;
    for (const fp of header.filepath ?? []) {
      const matches = expandBeatorajaWildcard(bundle.files, entryPath, fp.path);
      map.set(fp.name, matches);
    }
    return map;
  }

  /**
   * Lazily instantiate the skin-options panel. Deferred from the constructor because the demo shell
   * (the parent the panel attaches to) doesn't exist until `app.innerHTML` materializes.
   */
  private ensureBeatorajaSkinOptionsGui(): BeatorajaSkinOptionsGui {
    if (this.beatorajaSkinOptionsGui === undefined) {
      this.beatorajaSkinOptionsGui = new BeatorajaSkinOptionsGui({ container: this.elements.shell });
    }
    return this.beatorajaSkinOptionsGui;
  }

  /**
   * Update the bottom-right skin-options panel for a freshly-mounted beatoraja scene. Subsequent
   * user changes flow back through `onChange` → cache update → scene re-mount.
   */
  private refreshBeatorajaSkinOptionsGui(args: {
    title: string;
    entryPath: string;
    header: BeatorajaSkinHeader;
    /** Skin entries the user can switch to (typically all entries with matching `header.type`). */
    availableSkins?: ReadonlyArray<SkinChoice>;
    /** Fired when the user picks a different skin entry from the dropdown. */
    onSkinChange?: (nextEntryPath: string) => void;
    onApply: (updatedConfig: BeatorajaSkinConfig) => void;
  }): void {
    const config = this.resolveBeatorajaSkinConfig(args.entryPath, args.header);
    const candidates = this.collectBeatorajaFileCandidates(args.entryPath, args.header);
    const gui = this.ensureBeatorajaSkinOptionsGui();
    gui.setSkin({
      title: args.title,
      header: args.header,
      config,
      fileCandidates: candidates,
      availableSkins: args.availableSkins,
      currentEntryPath: args.entryPath,
      onSkinChange: args.onSkinChange,
      onChange: (next) => {
        // Persist and notify the caller so it can re-mount the active scene with the new config.
        this.beatorajaSkinConfigByEntry.set(args.entryPath, next);
        args.onApply(next);
      },
    });
  }

  /** Tear down the active beatoraja gameplay view + its prep bundle. Idempotent. */
  private disposeBeatorajaGameplay(): void {
    this.beatorajaGameplayView?.dispose();
    this.beatorajaGameplayView = undefined;
    if (this.beatorajaGameplayPrep) {
      void this.beatorajaGameplayPrep.dispose();
      this.beatorajaGameplayPrep = undefined;
    }
  }

  /** Sequence beatoraja-gameplay teardown → caller-supplied transition (mirrors `finishGameplayThen`). */
  private async finishBeatorajaGameplayThen(then: () => void | Promise<void>): Promise<void> {
    await this.sceneHost.setScene(undefined);
    this.disposeBeatorajaGameplay();
    await then();
  }

  private async showSelect(): Promise<void> {
    this.elements.shell.classList.remove('playing');
    // The `.empty` class drives the centered "Drop BMS folder…" hint. Toggle it off the moment we have charts to show,
    // and back on after a wipe / failed drop so the hint comes back instead of leaving the user staring at a blank
    // canvas.
    this.elements.shell.classList.toggle('empty', this.collection.songs.length === 0);
    await this.ensureHostMounted();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.disposeBeatorajaGameplay();
    this.resultView?.dispose();
    this.resultView = undefined;
    // Decide splash is cleared too — Escape from the splash should land back on the select scene rather than leave the
    // splash drawing over it.
    this.decideView?.dispose();
    this.decideView = undefined;
    // Beatoraja select scene takes precedence when a beatoraja theme with a select skin is loaded.
    // Falls through to the LR2 select path otherwise — same heuristic as `canPlaySongBeatoraja` for
    // gameplay: opt-in when the theme covers the surface, fall back when it doesn't.
    if (this.beatorajaTheme?.theme.selectSkin !== undefined && this.collection.songs.length > 0) {
      // Hide / dispose the LR2 select view if it was up — only one select can own the scene host.
      this.selectView?.setVisible(false);
      await this.showBeatorajaSelect();
      return;
    }
    // Same teardown for the beatoraja select scene if we're falling back to LR2 (theme dropped, etc.).
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    // Decide / result splashes don't outlive a return to select either — the gameplay-skinned
    // chrome they paint would otherwise overlay the select scene.
    this.beatorajaDecideScene?.dispose();
    this.beatorajaDecideScene = undefined;
    this.beatorajaResultScene?.dispose();
    this.beatorajaResultScene = undefined;
    if (this.selectView) {
      // Push the latest theme assets onto the view BEFORE flipping it visible. Order matters — `setSelectBgm` no-ops
      // when the bytes haven't changed, so back-from-play is silent; on a fresh theme drop it stops the old loop, swaps
      // the bytes, and (because we're still hidden) defers the actual `start()` until `setVisible(true)` lands a moment
      // later. Doing it the other way round would briefly start the prior theme's BGM during the visibility flip.
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
      // Seed the in-scene panel's autoPlay value from the cached demo state (carries the last value the user picked
      // across re-mounts of the select view).
      initialPlayOptions: { autoPlay: this.guiState.autoPlay },
      onPlayOptionsChange: (options) => {
        // Cache the last value so it survives a select-view re-mount even though the lil-gui toggle is gone.
        this.guiState.autoPlay = options.autoPlay;
      },
      onSongSelected: (song) => {
        // Fire the decide cue first — it plays through the select view's AudioContext which keeps running even after
        // the view is hidden, so the cue isn't cut by the gameplay mount.
        void this.selectView?.playDecideSound();
        void this.showDecide(song);
      },
      onSongAutoPlay: (song) => {
        // The skin's AUTOPLAY button forces the auto flag on for this session regardless of the toolbar checkbox state.
        // We DON'T mutate the checkbox here — the user might want to keep it off for the next manual play.
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
   * Mounts the decide-screen splash and routes the user into gameplay when it dismisses (auto-advance OR Enter / Space
   * / Escape input). Without a decide skin, falls straight through to `playSong` so themes that don't ship a Decide
   * directory still play the chart immediately.
   *
   * The decide view runs alongside the select view's AudioContext — `playDecideSound` was already fired at song-pick
   * time, and the splash visually masks the chart-load + gameplay-mount window that comes next.
   */
  private async showDecide(song: BrowserSongEntry, overrides: { autoPlay?: boolean } = {}): Promise<void> {
    // Beatoraja gameplay path. When the loaded theme ships a decide skin (`type = 6`), mount it
    // and route confirmation into the beatoraja gameplay scene. When it doesn't, hand straight to
    // `playSong` — the beatoraja branch there picks up the chart without a splash.
    if (this.canPlaySongBeatoraja(song)) {
      const mounted = await this.showBeatorajaDecide(song, overrides);
      if (!mounted) await this.playSong(song, overrides);
      return;
    }
    if (!this.decideSkin) {
      // No decide skin in the bundle (or skinless demo) — skip the splash entirely. The select view's `playDecideSound`
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
    // Build the gameplay view eagerly and kick off its heavy load (chart parse, audio decode, BGA preload) IN PARALLEL
    // with the Decide animation. The Decide splash typically runs ~3 s; chart asset decoding is mostly done by the time
    // the splash auto-advances, so the hand-off to gameplay becomes instant instead of dropping a frozen frame.
    const preloaded = this.preloadGameplay(song, overrides);
    let advanced = false;
    const advance = (then: () => void): void => {
      // Idempotent — the auto-advance timer, key input, and pointer click can all race; whichever lands first wins and
      // re-entries no-op.
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
          // User backed out of the splash — abandon the prepared gameplay scene before falling back to the select view.
          this.gameplayView?.dispose();
          this.gameplayView = undefined;
          void this.showSelect();
        }),
    });
    await this.decideView.mount(this.sceneHost, { song, collection: this.collection });
  }

  /**
   * Constructs a fresh `PixiGameplayView` with the current play-options snapshot and starts its `prepare()` against the
   * shared host. The returned promise resolves once chart audio is decoded — the host awaits it inside the Decide
   * `onContinue` handler before flipping the scene visible.
   *
   * Wired up here (rather than inline in `showDecide`) because the same option-marshalling + callback wiring is needed
   * whether we're going through Decide or the no-decide fast-path. `playSong` shares this construction shape.
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
      showInvisibleNotes: this.guiState.showInvisibleNotes,
      // Pass the loaded 9-keys play variant as the invisible-note sprite source — Pop'n's green wide note at index 3 is
      // the sprite the gameplay view paints over each invisible note when {@link DemoGuiState.showInvisibleNotes} is
      // on. Falls back to a flat green rectangle when the dropped theme didn't ship `play_9.lr2skin`.
      invisibleNoteSkin: this.playSkins['9'],
      judgedNoteDisplay: this.guiState.judgedNoteDisplay,
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
   * Tears the Decide splash down and hands the stage over to the (already-prepared) gameplay scene. Awaits the preload
   * promise: when the user dismisses Decide before chart audio has finished decoding, the splash's last frame stays on
   * screen until prepare resolves — visually a brief hold rather than the previous frozen-frame freeze.
   */
  private async startGameplayAfterDecide(song: BrowserSongEntry, preloaded: Promise<void>): Promise<void> {
    try {
      await preloaded;
    } catch (error) {
      gameplayLog.warn('preload failed; falling back to no-decide path', error);
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
        recordLog.warn('auto-start failed', error);
      }
    }
  }

  private async playSong(song: BrowserSongEntry, overrides: { autoPlay?: boolean } = {}): Promise<void> {
    // Beatoraja gameplay path. Branch out early when a beatoraja theme is loaded and the chart shape
    // resolves to a variant the renderer can mount (with `pickBeatorajaPlayableSkinVariant` fallback so
    // a 5K chart on a 7-keys-only theme still takes this path). Falls through to the LR2 path
    // otherwise — e.g. a 24-key chart on a beatoraja-only theme still gets the LR2 frame chrome.
    if (this.canPlaySongBeatoraja(song)) {
      await this.playSongBeatoraja(song, overrides);
      return;
    }
    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    // Tear down the decide splash before mounting gameplay — both share the host stage, so leaving the decide layer
    // alive would draw the splash on top of the gameplay scene.
    this.decideView?.dispose();
    this.decideView = undefined;
    this.gameplayView?.dispose();
    this.disposeBeatorajaGameplay();
    // Refresh the recording filename base for the upcoming play — each session writes to a unique file in the user's
    // downloads folder rather than overwriting the previous one.
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    const playSkin = pickLr2PlaySkin(this.playSkins, song);
    // Pull the canonical play-option snapshot (HiSpeed + AutoPlay tweaked from the in-scene "PLAY OPTIONS" panel) so
    // the gameplay scene starts with the user's chosen values. The explicit `overrides.autoPlay` from `onSongAutoPlay`
    // still wins so the AUTOPLAY skin button forces auto-judging on for a single launch regardless of the panel state.
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
      showInvisibleNotes: this.guiState.showInvisibleNotes,
      // Pass the loaded 9-keys play variant as the invisible-note sprite source — Pop'n's green wide note at index 3 is
      // the sprite the gameplay view paints over each invisible note when {@link DemoGuiState.showInvisibleNotes} is
      // on. Falls back to a flat green rectangle when the dropped theme didn't ship `play_9.lr2skin`.
      invisibleNoteSkin: this.playSkins['9'],
      judgedNoteDisplay: this.guiState.judgedNoteDisplay,
      onExit: () => {
        // Sequence finalize → transition. The transition methods (`showSelect` / `showResult` / `playSong`) all dispose
        // the gameplay view, which closes its AudioContext and tears down the bus the recorder taps. If we kicked the
        // transition off in parallel with `finalizeRecordingIfActive`, `MediaRecorder.stop()` would race the dispose
        // and lose its `'stop'` event under the closed context — the user would never see the auto-download. ESC /
        // chart-end / restart all converge on the same flow for that reason.
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
    // Consume the "user pressed Record on the select screen" flag now that gameplay is mounted — `startRecording`
    // requires the gameplay AudioContext to exist, which only happens after `mount`. Failing here is non-fatal: the
    // select-screen click already nudged the user that capture would start; if it doesn't (codec missing / no
    // MediaRecorder), the surfaced error replaces the armed status without breaking gameplay.
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
        recordLog.warn('auto-start failed', error);
        this.setStatus(`Recording unavailable: ${(error as Error).message}`);
      }
    }
  }

  /**
   * If a recording is active, calls {@link toggleRecording} to finalize + download. Used at chart end / exit / restart
   * so the user doesn't lose footage when transitioning out of gameplay.
   */
  private async finalizeRecordingIfActive(): Promise<void> {
    if (this.gameplayView?.isRecording()) {
      await this.toggleRecording();
    }
  }

  /**
   * Closes out an in-flight recording (if any) and then runs the caller-supplied transition (`showSelect` /
   * `showResult` / `playSong`). Sequencing here is non-negotiable: every one of those transitions disposes the gameplay
   * view, which in turn closes the AudioContext the `MediaRecorder` is tapping. Doing the dispose first leaves
   * `MediaRecorder.stop()` waiting on a `'stop'` event that never fires because its source stream died — the user would
   * see the result screen pop up but never get the saved WebM. Awaiting `finalizeRecordingIfActive` first lets the
   * recorder flush + download cleanly before the graph it depends on goes away.
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

// Browser compatibility probe runs first so the drop card paints the readiness verdict immediately on first render. We
// do this BEFORE constructing the demo app so that even a hard-fail (Pixi `Application.init()` throwing on a no-WebGL2
// browser) still leaves the user looking at the unsupported-browser message rather than a blank canvas.
renderBrowserCompatPanel(checkBrowserCompat());

// Wire up the bottom-right Help button + unified Help / OSS modal. The acknowledgement list is rendered lazily on first
// open of the OSS tab, so the initial paint isn't blocked on rendering ~30 dependency cards.
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
 * Renders the browser-compatibility diagnostic panel that lives alongside (not inside) the drop card. Feature support
 * doesn't change at runtime so this is a one-shot side-effect — call once at boot and the DOM stays in sync for the
 * session.
 *
 * The panel is the *only* place the compat verdict surfaces; the drop card stays focused on its call-to-action. When
 * required features are missing the panel flips into a red "Browser not supported" mode and lists each missing item
 * with its dependency note, so the user can identify exactly what's blocking them.
 */
function renderBrowserCompatPanel(report: BrowserCompatReport): void {
  const panel = document.querySelector<HTMLElement>('#compat-panel');
  const requiredList = document.querySelector<HTMLUListElement>('#compat-panel-required');
  const optionalList = document.querySelector<HTMLUListElement>('#compat-panel-optional');
  const statusLabel = document.querySelector<HTMLDivElement>('#compat-panel-status');
  if (!panel || !requiredList || !optionalList || !statusLabel) return;

  // `--ok` / `--fail` toggles the badge palette and the check-vs-cross mark visibility (the two icon `<path>`s share
  // the SVG, only one is shown at a time per CSS).
  panel.classList.toggle('compat-panel--ok', report.ok);
  panel.classList.toggle('compat-panel--fail', !report.ok);

  if (report.ok) {
    // Distinguish "everything works" from "core works but you're missing some optional niceties" — the latter is still
    // a green verdict but the count tells power users at a glance whether Web­Codecs / WebGPU / etc. are reachable.
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
 * Builds one feature row inside the compat panel. Status color is encoded both as a CSS modifier class (drives the
 * icon / background) and as a screen-reader-friendly text fallback so the verdict is accessible without color vision.
 */
function buildCompatRow(item: BrowserCompatReport['items'][number]): HTMLLIElement {
  const li = document.createElement('li');
  // `ok` = supported, `warn` = optional & missing (the player still works), `fail` = required & missing (player won't
  // function). Required-supported and optional-supported both map to `ok` — visual hierarchy comes from the section
  // split (Required vs Optional) above, not from a distinction here.
  const status = item.supported ? 'ok' : item.required ? 'fail' : 'warn';
  li.className = `compat-row compat-row--${status}`;
  li.title = item.note;

  const icon = document.createElement('span');
  icon.className = 'compat-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  // Plain text glyphs over inline SVG — keeps the markup compact and lets us color the glyph via `color:
  // currentColor`. The accessibility verdict is carried by the screen-reader text span below, not by the symbol.
  icon.textContent = item.supported ? '✓' : item.required ? '✕' : '–';
  li.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'compat-row-label';
  label.textContent = item.label;
  li.appendChild(label);

  const sr = document.createElement('span');
  sr.className = 'compat-row-sr';
  // Read-aloud text for assistive tech — `✓` / `✕` / `–` carry visual semantics but no name on their own. `aria-hidden`
  // on the icon hands the verdict to this hidden label instead.
  sr.textContent = item.supported ? 'supported' : item.required ? 'missing (required)' : 'missing (optional)';
  li.appendChild(sr);

  return li;
}

/**
 * Human-readable labels shown alongside the loading-overlay progress bar. Keyed by the `LoadProgressPhase`
 * discriminator the `player-web` loaders emit. The web UI is English-only, so these strings stay in English even though
 * the surrounding project conversation is in Japanese.
 */
const phaseLabels: Record<LoadProgress['phase'], string> = {
  enumerating: 'Collecting files…',
  reading: 'Reading files…',
  parsing: 'Parsing charts…',
  theme: 'Loading LR2 theme…',
};

/**
 * Produces a filesystem-safe base for the auto-downloaded recording filename. Strips characters that browsers / OSes
 * reject (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`), collapses runs of whitespace into single spaces, and trims the
 * result to a sensible cap so an absurdly long song title doesn't produce a path the OS rejects on save.
 */
function sanitizeFilenameStem(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80);
}

/** Map a playable variant to the matching `BEATORAJA_SKIN_TYPE` code. */
function playSkinTypeForVariant(variant: BeatorajaPlayableVariant): number {
  switch (variant) {
    case '7':
      return BEATORAJA_SKIN_TYPE.PLAY_7KEYS;
    case '5':
      return BEATORAJA_SKIN_TYPE.PLAY_5KEYS;
    case '14':
      return BEATORAJA_SKIN_TYPE.PLAY_14KEYS;
    case '10':
      return BEATORAJA_SKIN_TYPE.PLAY_10KEYS;
    case '9':
      return BEATORAJA_SKIN_TYPE.PLAY_9KEYS;
  }
}

/**
 * Format a discovered skin entry for the bottom-right GUI's "Skin" dropdown. Prefers the
 * `header.name` set by the skin author, falling back to the entry's filename. Suffixes the
 * filename in parens when both are available so duplicate-name skins (rare but possible) stay
 * distinguishable.
 */
function skinChoiceLabel(entry: BeatorajaSkinEntry): string {
  const name = entry.header.name?.trim();
  const slash = entry.entryPath.lastIndexOf('/');
  const filename = slash >= 0 ? entry.entryPath.slice(slash + 1) : entry.entryPath;
  if (name !== undefined && name.length > 0) return `${name} (${filename})`;
  return filename;
}
