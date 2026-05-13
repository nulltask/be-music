/**
 * Static HTML for the demo shell — injected once into `#app` at boot via `app.innerHTML = DEMO_APP_HTML`.
 *
 * Extracted from `main.ts` so the bootstrap module isn't dominated by ~470 lines of inline markup. The layout is
 * intentionally a single template-literal blob (no DOM-building APIs) so authoring / diffing reads like a static
 * HTML file. Inline `<!-- … -->` comments document each region — keep them when editing this file so the markup
 * stays self-documenting.
 *
 * Sub-elements wired up elsewhere:
 *  - `#help-button` / `#help-modal` — `help-modal.ts` (`wireHelpModal`)
 *  - `#compat-panel*` — `compat-panel.ts` (`renderBrowserCompatPanel`)
 *  - `#songs` / `#search` / `#stage` / `#loading-*` / `.shell` — referenced via `PlayerWebDemoElements` in `main.ts`
 */
export const DEMO_APP_HTML = `
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
                play them straight from the page. Reads <strong>Lunatic Rave 2</strong> skins
                (<code>.lr2skin</code>) and <strong>beatoraja</strong> skins
                (<code>.json</code> / <code>.luaskin</code>) — drop your
                <code>LR2files</code> folder, or your beatoraja <code>skin/</code> folder, onto
                the page (alongside or before the chart drop) and the theme is applied
                automatically.
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
                  <strong>Verified skins:</strong> the Lunatic Rave 2 default skin, plus the
                  beatoraja default skin (<code>skin/default</code>),
                  <code>ModernChic</code>, and <code>GdbG Original Skin</code>. Other LR2 /
                  beatoraja skins parse and load, but their layout is unverified — expect element
                  overlap, off-by-a-few-pixels positioning, or missing animation frames on
                  third-party themes.
                </li>
                <li>Use at your own risk. No warranty is provided.</li>
              </ul>
            </section>
            <h3 class="help-section-title">Loading songs</h3>
            <ul class="help-list">
              <li>Drop a BMS folder anywhere on the page to register its charts.</li>
              <li>
                Drop an <code>LR2files</code> folder, or a beatoraja <code>skin/</code> folder
                (or their contents), to apply a skin theme.
              </li>
              <li>
                Or click <strong>Open Folder</strong> in the lil-gui panel (top-right) to use the native
                file picker — same handling as a drag-drop, so a folder containing both an LR2 / beatoraja
                theme and BMS charts loads both in one shot. Press the button again to add another folder.
              </li>
              <li>Subsequent drops add to the library and keep the current theme.</li>
            </ul>

            <h3 class="help-section-title">Song select</h3>
            <ul class="help-list">
              <li><kbd>/</kbd> focuses the search input. Filter by title, artist, or genre.</li>
              <li><kbd>Esc</kbd> clears the search filter.</li>
              <li>Click a song row, or click the active skin's <em>PLAY</em> button, to start.</li>
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
                Open the active skin's <strong>PLAY OPTION</strong> panel during song select to set per-side
                modifiers (Random / Mirror / Auto-scratch / hi-speed).
              </li>
            </ul>
          </div>
          <div class="help-lang" data-lang="ja" hidden>
            <section class="help-about">
              <p class="help-about-summary">
                ブラウザ上で動作する BMS プレイヤーです。BMS / BMSON が入ったフォルダをドロップするだけでそのまま再生できます。
                <strong>Lunatic Rave 2</strong> のスキン (<code>.lr2skin</code>) と <strong>beatoraja</strong> のスキン (<code>.json</code> / <code>.luaskin</code>) を解釈するので、<code>LR2files</code> フォルダや beatoraja の <code>skin/</code> フォルダをページにドロップすれば既存のスキンをそのまま適用できます。
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
                  <strong>動作確認済みのスキン:</strong> Lunatic Rave 2 デフォルトスキンに加え、beatoraja デフォルトスキン (<code>skin/default</code>)、<code>ModernChic</code>、<code>GdbG Original Skin</code> の四種類です。
                  これら以外の LR2 / beatoraja スキンも読み込み自体は可能ですが、レイアウトは未検証です。要素の重なり / 数ピクセル単位のズレ / 一部アニメーションの欠落などが残っている可能性があります。
                </li>
                <li>利用は自己責任でお願いします。本ソフトウェアは無保証で提供されます。</li>
              </ul>
            </section>
            <h3 class="help-section-title">楽曲の読み込み</h3>
            <ul class="help-list">
              <li>BMS フォルダをページ上にドロップすると、その中のチャートが登録されます。</li>
              <li><code>LR2files</code> フォルダか beatoraja の <code>skin/</code> フォルダ (またはその中身) をドロップするとスキンが適用されます。</li>
              <li>
                右上 lil-gui パネルの <strong>Open Folder</strong> ボタンからネイティブのファイル選択ダイアログも使えます。
                ドラッグ&ドロップと同じ処理経路を通るので、LR2 / beatoraja のテーマとチャートが同居したフォルダもまとめて読み込めます。
                ボタンを押し直せば別フォルダを追加で読み込めます。
              </li>
              <li>追加でドロップした場合、既存のライブラリに追加され、テーマも維持されます。</li>
            </ul>

            <h3 class="help-section-title">選曲画面</h3>
            <ul class="help-list">
              <li><kbd>/</kbd> で検索入力にフォーカス。タイトル / アーティスト / ジャンルで絞り込めます。</li>
              <li><kbd>Esc</kbd> で検索条件をクリア。</li>
              <li>曲の行をクリック、または現在のスキンの <em>PLAY</em> ボタンで再生開始。</li>
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
                選曲画面で現在のスキンの <strong>PLAY OPTION</strong> パネルを開くと、Random / Mirror / Auto-scratch / hi-speed などのプレイヤー側モディファイアを設定できます。
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
