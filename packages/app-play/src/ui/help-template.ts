import { buildInfoTemplate } from '@be-music/service-web-theme/client';
import { localized } from './localized.ts';
import { html } from 'lit';
import { PUBLIC_BETA_DELETION, PUBLIC_BETA_LABEL } from '@be-music/service-web-theme';
import { PLAYER_BUILD_INFO } from './shell-build-info.ts';

export const PLAYER_HELP_TEMPLATE = html`
  <dialog
    class="dialog help-dialog"
    id="help-modal"
    aria-labelledby="help-modal-title"
    aria-describedby="help-modal-description"
  >
    <div>
      <header>
        <h2 class="flex items-center gap-2" id="help-modal-title">
          <span>Be-Music Play</span><span class="badge" data-variant="outline">Beta</span>
        </h2>
        <div class="help-heading-row">
          <p id="help-modal-description">${localized('helpAbout')}</p>
          <div class="button-group help-lang-switch" role="group" aria-label=${localized('language')}>
            <button
              class="btn help-lang-toggle"
              data-size="sm"
              data-variant="secondary"
              type="button"
              data-lang="en"
              aria-pressed="true"
            >
              English
            </button>
            <button
              class="btn help-lang-toggle"
              data-size="sm"
              data-variant="outline"
              type="button"
              data-lang="ja"
              aria-pressed="false"
            >
              日本語
            </button>
          </div>
        </div>
      </header>
      <section class="tabs help-tabs">
        <nav role="tablist" aria-orientation="horizontal">
          <button
            type="button"
            role="tab"
            id="help-tab-usage"
            aria-controls="help-pane-usage"
            aria-selected="true"
            tabindex="0"
            data-pane="usage"
          >
            ${localized('usage')}
          </button>
          <button
            type="button"
            role="tab"
            id="help-tab-oss"
            aria-controls="help-pane-oss"
            aria-selected="false"
            tabindex="-1"
            data-pane="oss"
          >
            ${localized('acknowledgements')}
          </button>
        </nav>
        <div role="tabpanel" id="help-pane-usage" aria-labelledby="help-tab-usage" tabindex="-1" aria-selected="true">
          <div class="help-lang is-active" data-lang="en">
            <section class="help-about">
              <p class="help-about-summary">
                A browser-based BMS player. Drop in a folder containing BMS / bmson charts and play them straight from
                the page. It comes with three skins, Synesthesia, Plain and Native (Options → Skin &amp; display →
                Built-in skin), and reads <strong>Lunatic Rave 2</strong> skins (<code>.lr2skin</code>) and
                <strong>beatoraja</strong> skins (<code>.json</code> / <code>.luaskin</code>) — drop your
                <code>LR2files</code> folder, or your beatoraja <code>skin/</code> folder, onto the page (alongside or
                before the chart drop) and the theme is applied automatically.
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
                  <span
                    >A TUI build (terminal frontend) ships in the same monorepo as
                    <code>@be-music/player-terminal</code>.</span
                  >
                </li>
              </ul>
              <ul class="help-about-notes">
                <li>
                  Dropped files stay entirely in your browser. Charts, audio, and BGA assets are
                  <strong>never uploaded to any server</strong>. Only with <strong>Submit to Leaderboard</strong> on
                  does a finished play send its replay (your key presses and the chart's note layout) and a fingerprint
                  of the chart to the Leaderboard.
                </li>
                <li>Some features are still missing or incomplete — expect rough edges.</li>
                <li>
                  <strong>Best records stay in this browser.</strong> The Leaderboard (off by default, Options →
                  Leaderboard) is a ${PUBLIC_BETA_LABEL.en}: its rankings may be reset. ${PUBLIC_BETA_DELETION.en}
                </li>
                <li>
                  <strong>Verified skins:</strong> the Lunatic Rave 2 default skin, plus the beatoraja default skin
                  (<code>skin/default</code>), <code>ModernChic</code>, and <code>GdbG Original Skin</code>. Other LR2 /
                  beatoraja skins parse and load, but their layout is unverified — expect element overlap,
                  off-by-a-few-pixels positioning, or missing animation frames on third-party themes.
                </li>
                <li>Use at your own risk. No warranty is provided.</li>
              </ul>
            </section>
            <h3 class="help-section-title">Loading charts</h3>
            <ul class="help-list">
              <li>Drop a BMS folder anywhere on the page to register its charts.</li>
              <li>
                Drop an <code>LR2files</code> folder, or a beatoraja <code>skin/</code> folder (or their contents), to
                apply a skin theme.
              </li>
              <li>
                Or click <strong>Open folder</strong> in Options → Library to use the native folder picker — same
                handling as a drag-drop, so a folder containing both an LR2 / beatoraja theme and BMS charts loads both
                in one shot. Press the button again to add another folder. <strong>Open files</strong> picks ZIP
                archives or a replay (<code>*.bmplay.json</code>, or a course's <code>*.bmcourse.json</code>) to replay.
              </li>
              <li>Subsequent drops add to the library and keep the current theme.</li>
              <li>
                Course files in a dropped folder (LR2 <code>.lr2crs</code>, beatoraja course <code>.json</code>) list as
                course folders. Decide <strong>NEW COURSE</strong> in MY COURSES, MY DAN or MY NONSTOP to make your own;
                <strong>Course → My courses…</strong> in Options renames, deletes and exports them.
              </li>
              <li>
                Or link straight to a pack: open the page with
                <code>?music=https://…/song.zip</code> to auto-load a chart archive, and/or
                <code>?skin=https://…/theme.zip</code> to apply a skin — the charts are listed in this select screen.
                Cross-origin archive links are fetched through the player proxy and must use HTTPS.
              </li>
            </ul>

            <h3 class="help-section-title">Chart select</h3>
            <ul class="help-list">
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd> move the cursor, <kbd>Enter</kbd> opens a folder or starts the chart, and
                <kbd>Esc</kbd> / <kbd>Backspace</kbd> go back. Click a chart row, or the active skin's
                <em>PLAY</em>
                button, to start.
              </li>
              <li>
                START (<kbd>Q</kbd>) or <kbd>Space</kbd> opens the <strong>PLAY OPTION</strong> panel (built-in and LR2
                skins); beatoraja skins also take <kbd>PageUp</kbd> / <kbd>PageDown</kbd>, <kbd>Home</kbd> /
                <kbd>End</kbd> and
                <kbd>R</kbd>
                (a random chart).
              </li>
              <li><kbd>/</kbd> focuses the search input. Filter by title, artist, or genre.</li>
              <li><kbd>Esc</kbd> clears the search filter.</li>
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
                  <kbd>Shift</kbd> <span class="help-keymap-sep">·</span> <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd>
                  <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd> <kbd>,</kbd>
                </span>
              </div>
              <div class="help-keymap-note">
                Left Shift (Left Ctrl, Space) = 1P scratch · Right Shift (Right Ctrl) = 2P scratch · START / SELECT = Q
                / W (2P: O / P) · 9-button (PMS) charts use Z S X D C F V G B.
              </div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> adjusts hi-speed; hold to keep adjusting.</li>
              <li>
                Lane covers (Plain, Native, Synesthesia and beatoraja skins): <kbd>PageUp</kbd> /
                <kbd>PageDown</kbd> move SUDDEN+, <kbd>Home</kbd> / <kbd>End</kbd> the LIFT, <kbd>H</kbd> switches
                HIDDEN+ and <kbd>J</kbd> / <kbd>K</kbd> move it; hold <kbd>Shift</kbd> for larger steps. A key that a
                lane of the chart uses stays a lane key. Hold an adjustment key to keep moving; H toggles once per
                press. With FLOATING HI-SPEED, PageUp / PageDown fine-adjust hi-speed when SUDDEN+ and LIFT are both
                off.
              </li>
              <li>In AUTO play, <kbd>←</kbd> / <kbd>→</kbd> seek 5 s back / forward.</li>
              <li><kbd>Pause</kbd> or <kbd>Tab</kbd> pauses / resumes.</li>
              <li><kbd>F5</kbd> restarts the current chart.</li>
              <li><kbd>Esc</kbd> exits to the result screen (or back to chart select).</li>
              <li>
                Hold <kbd>Backspace</kbd> for 0.5 s to quit the play the same way (works in fullscreen on every
                browser).
              </li>
              <li>
                Double-click the playfield to enter or leave fullscreen. <kbd>Esc</kbd> leaves fullscreen first, then
                repeats the usual scene action. On Chrome / Edge, <kbd>Esc</kbd> keeps its usual scene action in
                fullscreen; hold <kbd>Esc</kbd> to leave fullscreen.
              </li>
            </ul>

            <h3 class="help-section-title">Result</h3>
            <ul class="help-list">
              <li><kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>Esc</kbd> returns to chart select.</li>
              <li><kbd>R</kbd> plays the same chart again right away with the same options.</li>
            </ul>
          </div>
          <div class="help-lang" data-lang="ja" hidden>
            <section class="help-about">
              <p class="help-about-summary">
                ブラウザ上で動作する BMS プレイヤーです。BMS / bmson
                が入ったフォルダをドロップするだけでそのまま再生できます。 内蔵スキンはシナスタジア
                (Synesthesia)、プレーン (Plain)、ネイティブ (Native) の 3 種類です (Options → Skin &amp; display →
                Built-in skin)。
                <strong>Lunatic Rave 2</strong> のスキン (<code>.lr2skin</code>) と <strong>beatoraja</strong> のスキン
                (<code>.json</code> / <code>.luaskin</code>) も解釈するので、<code>LR2files</code> フォルダや beatoraja
                の <code>skin/</code> フォルダをページにドロップすれば既存のスキンをそのまま適用できます。
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
                  <span>同じモノレポに TUI 版 (<code>@be-music/player-terminal</code>) も同梱されています。</span>
                </li>
              </ul>
              <ul class="help-about-notes">
                <li>
                  ドロップしたファイルはブラウザ内でのみ処理され、譜面・音声・BGA データを
                  <strong>サーバへ送信することは一切ありません</strong>。
                  <strong>Submit to Leaderboard</strong> をオンにしたときだけ、プレイ終了時にリプレイ
                  (キー入力と譜面のノーツ配置) と譜面のフィンガープリントを Leaderboard に送ります。
                </li>
                <li>一部の機能はまだ実装されていません。動作が不完全な箇所があります。</li>
                <li>
                  <strong>ベスト記録はこのブラウザに保存されます。</strong>
                  Leaderboard (初期状態はオフ、Options → Leaderboard)
                  は${PUBLIC_BETA_LABEL.ja}で、ランキングはリセットされることがあります。${PUBLIC_BETA_DELETION.ja}
                </li>
                <li>
                  <strong>動作確認済みのスキン:</strong> Lunatic Rave 2 デフォルトスキンに加え、beatoraja
                  デフォルトスキン (<code>skin/default</code>)、<code>ModernChic</code>、<code>GdbG Original Skin</code>
                  の四種類です。 これら以外の LR2 / beatoraja
                  スキンも読み込み自体は可能ですが、レイアウトは未検証です。要素の重なり / 数ピクセル単位のズレ /
                  一部アニメーションの欠落などが残っている可能性があります。
                </li>
                <li>利用は自己責任でお願いします。本ソフトウェアは無保証で提供されます。</li>
              </ul>
            </section>
            <h3 class="help-section-title">譜面の読み込み</h3>
            <ul class="help-list">
              <li>BMS フォルダをページ上にドロップすると、その中の譜面が登録されます。</li>
              <li>
                <code>LR2files</code> フォルダか beatoraja の <code>skin/</code> フォルダ (またはその中身)
                をドロップするとスキンが適用されます。
              </li>
              <li>
                Options の Library にある
                <strong>Open folder</strong> ボタンからネイティブのフォルダ選択ダイアログも使えます。
                ドラッグ&ドロップと同じ処理経路を通るので、LR2 / beatoraja
                のテーマと譜面が同居したフォルダもまとめて読み込めます。
                ボタンを押し直せば別フォルダを追加で読み込めます。 <strong>Open files</strong> では ZIP
                アーカイブやリプレイ (<code>*.bmplay.json</code>、コースは <code>*.bmcourse.json</code>) を選べます。
              </li>
              <li>追加でドロップした場合、既存のライブラリに追加され、テーマも維持されます。</li>
              <li>
                ドロップしたフォルダに含まれるコースファイル (LR2 の <code>.lr2crs</code>、beatoraja のコースの
                <code>.json</code>) はコースのフォルダとして並びます。 MY COURSES / MY DAN / MY NONSTOP の
                <strong>NEW COURSE</strong>
                を決定すると自分でコースを作れます。作ったコースの名前の変更・削除・書き出しは Options の
                <strong>Course → My courses…</strong> から行えます。
              </li>
            </ul>

            <h3 class="help-section-title">選曲画面</h3>
            <ul class="help-list">
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd> でカーソル移動、<kbd>Enter</kbd> でフォルダを開くか譜面を開始、<kbd
                  >Esc</kbd
                >
                / <kbd>Backspace</kbd> で戻ります。 譜面の行をクリック、または現在のスキンの
                <em>PLAY</em> ボタンでも開始できます。
              </li>
              <li>
                START (<kbd>Q</kbd>) か <kbd>Space</kbd> で <strong>PLAY OPTION</strong> パネルを開きます (内蔵スキンと
                LR2 スキン)。beatoraja スキンでは <kbd>PageUp</kbd> / <kbd>PageDown</kbd>、<kbd>Home</kbd> /
                <kbd>End</kbd>、<kbd>R</kbd>
                (ランダムに譜面を選ぶ) も使えます。
              </li>
              <li><kbd>/</kbd> で検索入力にフォーカス。タイトル / アーティスト / ジャンルで絞り込めます。</li>
              <li><kbd>Esc</kbd> で検索条件をクリア。</li>
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
                  <kbd>Shift</kbd> <span class="help-keymap-sep">·</span> <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd>
                  <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd> <kbd>,</kbd>
                </span>
              </div>
              <div class="help-keymap-note">
                左 Shift (左 Ctrl、Space) = 1P スクラッチ · 右 Shift (右 Ctrl) = 2P スクラッチ · START / SELECT = Q / W
                (2P は O / P) · 9 ボタン (PMS) の譜面は Z S X D C F V G B。
              </div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> でハイスピード調整。長押しで連続調整できます。</li>
              <li>
                レーンカバー (Plain / Native / Synesthesia と beatoraja スキン): <kbd>PageUp</kbd> /
                <kbd>PageDown</kbd> で SUDDEN+、<kbd>Home</kbd> / <kbd>End</kbd> で LIFT を動かし、<kbd>H</kbd> で
                HIDDEN+ を切り替え、<kbd>J</kbd> / <kbd>K</kbd> で動かします。<kbd>Shift</kbd>
                を押しながらだと大きく動きます。譜面のレーンに使われているキーはレーンの入力になります。
                調整キーは長押しで連続して動きます。H は押すたびに 1 回だけ切り替わります。FLOATING HI-SPEED
                では、SUDDEN+ と LIFT が両方 OFF のとき、PageUp / PageDown でハイスピードを微調整します。
              </li>
              <li>AUTO プレイでは <kbd>←</kbd> / <kbd>→</kbd> で 5 秒戻る / 進むことができます。</li>
              <li><kbd>Pause</kbd> か <kbd>Tab</kbd> でポーズ / 再開。</li>
              <li><kbd>F5</kbd> で現在の譜面をリスタート。</li>
              <li><kbd>Esc</kbd> でリザルト画面 (または選曲画面) へ戻ります。</li>
              <li>
                <kbd>Backspace</kbd> を 0.5 秒長押しでも同じようにプレイを中断します
                (どのブラウザでもフルスクリーン中に使えます)。
              </li>
              <li>
                プレイフィールドをダブルクリックするとフルスクリーンに入り / 解除します。<kbd>Esc</kbd>
                は先にフルスクリーンを解除し、もう一度押すと通常のシーン操作になります。Chrome / Edge
                ではフルスクリーン中も <kbd>Esc</kbd> は通常のシーン操作のままで、<kbd>Esc</kbd>
                長押しでフルスクリーンを解除します。
              </li>
            </ul>

            <h3 class="help-section-title">リザルト</h3>
            <ul class="help-list">
              <li><kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>Esc</kbd> で選曲画面へ戻ります。</li>
              <li><kbd>R</kbd> で同じオプションのまま同じ譜面をすぐにもう一度プレイします。</li>
            </ul>
          </div>
        </div>
        <div
          role="tabpanel"
          id="help-pane-oss"
          aria-labelledby="help-tab-oss"
          tabindex="-1"
          aria-selected="false"
          hidden
        >
          <ol class="help-oss-list" id="help-oss-list"></ol>
        </div>
      </section>
      <footer class="service-build-footer">${buildInfoTemplate(PLAYER_BUILD_INFO)}</footer>
      <button type="button" id="help-modal-close" aria-label=${localized('close')}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  </dialog>
`;
