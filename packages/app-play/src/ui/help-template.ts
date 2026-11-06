import { buildInfoTemplate } from '@be-music/service-web-theme/client';
import { localized } from './localized.ts';
import { html } from 'lit';
import { PUBLIC_BETA_DELETION, PUBLIC_BETA_LABEL } from '@be-music/service-web-theme';
import { PLAYER_BUILD_INFO } from './shell-build-info.ts';
import { HELP_SEARCH_EXAMPLES } from './help-search-examples.ts';

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
            id="help-tab-keyboard"
            aria-controls="help-pane-keyboard"
            aria-selected="false"
            tabindex="-1"
            data-pane="keyboard"
          >
            ${localized('keyboard')}
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
                the page. It comes with three skins, Synesthesia, Plain and Native (Options → Skin → Built-in skin), and
                reads <strong>Lunatic Rave 2</strong> skins (<code>.lr2skin</code>) and <strong>beatoraja</strong> skins
                (<code>.json</code> / <code>.luaskin</code>) — drop your <code>LR2files</code> folder, or your beatoraja
                <code>skin/</code> folder, onto the page (alongside or before the chart drop) and the theme is applied
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
                <kbd>↑</kbd> / <kbd>↓</kbd> or the turntable move the cursor, <kbd>Enter</kbd> opens a folder or starts
                the chart, and <kbd>Esc</kbd> / <kbd>Backspace</kbd> go back; at the top level <kbd>Esc</kbd> asks
                whether to leave for the drop screen. Click a chart row, or the active skin's
                <em>PLAY</em>
                button, to start.
              </li>
              <li>
                Lane keys as in LR2: the white keys start, the black keys go back, key 6 starts in AUTO (held 2 s, the
                saved replay), key 4 held opens the chart's Leaderboard ranking, <kbd>F3</kbd> held with the arrows
                edits its difficulty and level, <kbd>F1</kbd> opens Help, → opens a folder, and SELECT, <kbd>1</kbd> or
                → on a chart moves to the track's next difficulty. beatoraja skins as in beatoraja: key 1 plays, key 5
                is AUTO, keys 2 / 4 close the folder, and START, SELECT and <kbd>5</kbd> open its option panels 1–3.
                <kbd>2</kbd> sorts, <kbd>0</kbd> searches, <kbd>F8</kbd> (<kbd>F2</kbd> on beatoraja skins) reads the
                dropped folders again. beatoraja skins also take <kbd>Ctrl</kbd>+<kbd>F3</kbd> /
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F3</kbd> to copy the chart's MD5 / SHA-256, <kbd>F10</kbd> to play
                the folder in AUTO, <kbd>8</kbd> to open the chart's folder and <kbd>9</kbd> for its text file. Every
                key can be moved under Options → Keys → Screens.
              </li>
              <li>
                START (<kbd>Q</kbd>), <kbd>Space</kbd> or <kbd>Tab</kbd> opens the <strong>PLAY OPTION</strong> panel
                (built-in and LR2 skins): tap to keep it open, hold to show it while held; beatoraja skins also take
                <kbd>PageUp</kbd> / <kbd>PageDown</kbd>, <kbd>Home</kbd> / <kbd>End</kbd> and
                <kbd>R</kbd>
                (a random chart).
              </li>
              <li><kbd>/</kbd> or <kbd>0</kbd> focuses the search input (see Searching charts below).</li>
              <li><kbd>Esc</kbd> clears the search filter.</li>
            </ul>

            <h3 class="help-section-title">Searching charts</h3>
            <ul class="help-list">
              <li>
                Plain text lists the charts whose title, subtitle, artist, genre or file name contains it, ignoring
                upper and lower case. The whole text is one phrase: spaces, quotes and words such as <code>OR</code> are
                matched as typed, and full-width / half-width letters and hiragana / katakana are told apart. At the top
                level every chart is searched; inside a folder, only its charts. The MODE and difficulty filters still
                apply.
              </li>
              <li>
                Text that starts with <code>?</code> is a chart filter, written like an SQL <code>WHERE</code> clause
                (beatoraja's random-course filters): <code>=</code> <code>!=</code> <code>&lt;</code>
                <code>&lt;=</code> <code>&gt;</code> <code>&gt;=</code>, <code>BETWEEN … AND …</code>,
                <code>IN (…)</code>, <code>LIKE</code> (<code>%</code> any text, <code>_</code> one character, case
                ignored for A–Z), <code>IS NULL</code>, <code>AND</code> <code>OR</code> <code>NOT</code> and
                parentheses, then an optional <code>ORDER BY … DESC</code> and <code>LIMIT n</code> (which replace the
                sort). Put text in single quotes; <code>=</code> on text is exact and case-sensitive. Keywords may be
                lower case. A filter that does not parse shows why under the search box and filters nothing.
              </li>
              <li>
                Columns: <code>title</code> <code>subtitle</code> <code>artist</code> <code>subartist</code>
                <code>genre</code> <code>path</code>, <code>level</code>, <code>difficulty</code> (1 BEGINNER … 5
                INSANE), <code>song.mode</code> (keys: 5, 7, 9, 10, 14; 25 for 24 keys), <code>song.notes</code>,
                <code>minbpm</code> / <code>maxbpm</code>, <code>length</code> (ms), <code>judge</code> (#RANK); your
                best record <code>score.clear</code> (1 FAILED, 3 ASSIST EASY, 4 EASY, 5 NORMAL, 6 HARD, 7 EX HARD, 8
                FULL COMBO; NULL when never played), <code>score.exscore</code>, <code>score.minbp</code>,
                <code>playcount</code>; and <code>information.total</code>, <code>density</code>, <code>mainbpm</code>.
                Write <code>song.mode</code> and <code>song.notes</code> in full. MD5 / SHA-256 cannot be searched.
              </li>
              ${HELP_SEARCH_EXAMPLES.map((example) => html`<li><code>${example.query}</code> — ${example.en}</li>`)}
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
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd> adjusts hi-speed; hold to keep adjusting. On beatoraja skins they move the
                lane cover instead, and on the others <kbd>←</kbd> / <kbd>→</kbd> do (outside AUTO play).
              </li>
              <li>
                START (<kbd>Q</kbd>) + a key steps the hi-speed (odd keys down, even keys up; on LR2 skins SELECT does
                too, and keys 6 / 7 move the lane cover while it shows); START + the turntable moves the cover on
                beatoraja skins, and SELECT + a key changes the visible time (green number) by 1 ms. START twice
                switches the lane cover. START + SELECT held for a second quits, and after the last note either one ends
                the play.
              </li>
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
              <li>
                LR2 skins: hold <kbd>1</kbd> / <kbd>2</kbd> with an arrow to move / scale the play skin, or
                <kbd>6</kbd> / <kbd>7</kbd> to raise the 1P / 2P lanes. beatoraja skins: in AUTO play, hold
                <kbd>1</kbd>–<kbd>4</kbd> to play slower or faster.
              </li>
              <li>
                On every screen, <kbd>F4</kbd> switches full screen and <kbd>F6</kbd> takes a screenshot;
                <kbd>F7</kbd> (<kbd>F1</kbd> on beatoraja skins) shows the frame rate.
              </li>
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
              <li>
                <kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>Esc</kbd> returns to chart select; so do the lane keys (LR2
                skins: any, beatoraja skins: keys 1–4).
              </li>
              <li>
                Keys held as the screen leaves retry the chart: a white and a black key (LR2 skins), key 5 or 7
                (beatoraja skins), or <kbd>Esc</kbd> held half a second.
              </li>
              <li><kbd>R</kbd> plays the same chart again right away with the same options.</li>
            </ul>
          </div>
          <div class="help-lang" data-lang="ja" hidden>
            <section class="help-about">
              <p class="help-about-summary">
                ブラウザ上で動作する BMS プレイヤーです。BMS / bmson
                が入ったフォルダをドロップするだけでそのまま再生できます。 内蔵スキンはシナスタジア
                (Synesthesia)、プレーン (Plain)、ネイティブ (Native) の 3 種類です (Options → Skin → Built-in skin)。
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
                / <kbd>Backspace</kbd> で戻ります。最上位で <kbd>Esc</kbd> を押すと、ドロップ画面へ戻るか確認します。
                譜面の行をクリック、または現在のスキンの
                <em>PLAY</em> ボタンでも開始できます。皿でもカーソルを動かせます。
              </li>
              <li>
                鍵盤は LR2 と同じく、白鍵で開始、黒鍵で戻る、鍵盤 6 で AUTO (2 秒押し続けると保存したリプレイ)、鍵盤 4
                の長押しで Leaderboard のランキング、<kbd>F3</kbd> を押しながら矢印で難易度とレベルを編集、<kbd>F1</kbd>
                でヘルプ、→ でフォルダを開き、譜面の上で SELECT・<kbd>1</kbd>・→
                を押すと同じ曲の次の難易度へ移ります。beatoraja スキンでは beatoraja と同じく、鍵盤 1 でプレイ、鍵盤 5
                で AUTO、鍵盤 2 / 4 でフォルダを閉じ、START・SELECT・<kbd>5</kbd> でオプションパネル 1〜3 を開きます。
                <kbd>2</kbd> でソート、<kbd>0</kbd> で検索、<kbd>F8</kbd> (beatoraja スキンでは <kbd>F2</kbd>)
                でドロップしたフォルダを読み直します。beatoraja スキンでは <kbd>Ctrl</kbd>+<kbd>F3</kbd> /
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F3</kbd> で譜面の MD5 / SHA-256 をコピー、<kbd>F10</kbd>
                でフォルダを AUTO で通しプレイ、<kbd>8</kbd> で譜面のフォルダを開き、<kbd>9</kbd>
                でテキストファイルを開きます。どのキーも Options → Keys → Screens で変えられます。
              </li>
              <li>
                START (<kbd>Q</kbd>)・<kbd>Space</kbd>・<kbd>Tab</kbd> で <strong>PLAY OPTION</strong> パネルを開きます
                (内蔵スキンと LR2 スキン)。短く押すと開いたまま、押し続けると押している間だけ表示します。beatoraja
                スキンでは <kbd>PageUp</kbd> / <kbd>PageDown</kbd>、<kbd>Home</kbd> / <kbd>End</kbd>、<kbd>R</kbd>
                (ランダムに譜面を選ぶ) も使えます。
              </li>
              <li><kbd>/</kbd> か <kbd>0</kbd> で検索入力にフォーカス (書き方は下の「譜面の検索」)。</li>
              <li><kbd>Esc</kbd> で検索条件をクリア。</li>
            </ul>

            <h3 class="help-section-title">譜面の検索</h3>
            <ul class="help-list">
              <li>
                ふつうの文字列は、タイトル・サブタイトル・アーティスト・ジャンル・ファイル名にそれを含む譜面を並べます。
                大文字と小文字は区別しません。全体で 1 つの語句として扱うので、空白・引用符・<code>OR</code>
                などの語も打ったとおりに探し、全角と半角、ひらがなとカタカナは別の文字として扱います。最上位ではすべての譜面を、フォルダの中ではその譜面だけを探します。MODE
                と難易度の絞り込みは検索中も効きます。
              </li>
              <li>
                <code>?</code> で始めると譜面フィルターになり、SQL の <code>WHERE</code> 句 (beatoraja
                のランダムコースのフィルター) の形で書きます。<code>=</code> <code>!=</code> <code>&lt;</code>
                <code>&lt;=</code> <code>&gt;</code> <code>&gt;=</code>、<code>BETWEEN … AND …</code>、
                <code>IN (…)</code>、<code>LIKE</code> (<code>%</code> は任意の文字列、<code>_</code> は 1 文字。A〜Z
                の大文字と小文字は区別しません)、<code>IS NULL</code>、<code>AND</code> <code>OR</code>
                <code>NOT</code> と括弧、続けて <code>ORDER BY … DESC</code> と <code>LIMIT n</code> を書けます
                (ソートの代わりになります)。文字列は単一引用符で囲みます。文字列の <code>=</code>
                は完全一致で、大文字と小文字を区別します。キーワードは小文字でもかまいません。解析できない式は、検索欄の下に理由を出し、何も絞り込みません。
              </li>
              <li>
                列: <code>title</code> <code>subtitle</code> <code>artist</code> <code>subartist</code>
                <code>genre</code> <code>path</code>、<code>level</code>、<code>difficulty</code> (1 BEGINNER 〜 5
                INSANE)、<code>song.mode</code> (鍵盤数: 5・7・9・10・14、24 鍵は 25)、<code>song.notes</code>、
                <code>minbpm</code> / <code>maxbpm</code>、<code>length</code> (ミリ秒)、<code>judge</code>
                (#RANK)。自己ベストの <code>score.clear</code> (1 FAILED、3 ASSIST EASY、4 EASY、5 NORMAL、6 HARD、7 EX
                HARD、8 FULL COMBO。未プレイは
                NULL)、<code>score.exscore</code>、<code>score.minbp</code>、<code>playcount</code>。
                <code>information.total</code>・<code>density</code>・<code>mainbpm</code>。<code>song.mode</code> と
                <code>song.notes</code> は省略せずに書きます。MD5 / SHA-256 では検索できません。
              </li>
              ${HELP_SEARCH_EXAMPLES.map((example) => html`<li><code>${example.query}</code> — ${example.ja}</li>`)}
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
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd> でハイスピード調整。長押しで連続調整できます。beatoraja
                スキンでは代わりにレーンカバーを動かし、それ以外のスキンでは <kbd>←</kbd> / <kbd>→</kbd>
                でレーンカバーを動かします (AUTO プレイ以外)。
              </li>
              <li>
                START (<kbd>Q</kbd>) + 鍵盤でハイスピード調整 (奇数鍵で下げ、偶数鍵で上げ。LR2 スキンでは SELECT
                でも同じで、レーンカバー表示中は鍵盤 6 / 7 でカバーを動かします)。beatoraja スキンでは START +
                皿でカバーを動かし、SELECT + 鍵盤で表示時間 (緑数字) を 1 ms ずつ変えます。START 2
                回押しでレーンカバーの ON / OFF。START + SELECT を 1
                秒押し続けると中断し、最後のノーツの後はどちらか一方だけでプレイを終えます。
              </li>
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
              <li>
                LR2 スキン: <kbd>1</kbd> / <kbd>2</kbd> を押しながら矢印でプレイのスキンを動かす / 拡大縮小、<kbd
                  >6</kbd
                >
                / <kbd>7</kbd> で 1P / 2P のレーンを上げ下げ。beatoraja スキン: AUTO プレイ中に <kbd>1</kbd>〜<kbd
                  >4</kbd
                >
                を押している間だけ遅く / 速く再生します。
              </li>
              <li>
                どの画面でも <kbd>F4</kbd> でフルスクリーンを切り替え、<kbd>F6</kbd> でスクリーンショットを撮り、<kbd
                  >F7</kbd
                >
                (beatoraja スキンでは <kbd>F1</kbd>) でフレームレートを表示します。
              </li>
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
              <li>
                <kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>Esc</kbd> で選曲画面へ戻ります。鍵盤でも戻れます (LR2
                スキンはどの鍵盤でも、beatoraja スキンは鍵盤 1〜4)。
              </li>
              <li>
                画面を抜けるときにキーを押したままだと、もう一度プレイします: 白鍵と黒鍵 (LR2 スキン)、鍵盤 5 か 7
                (beatoraja スキン)、または <kbd>Esc</kbd> を 0.5 秒押し続ける。
              </li>
              <li><kbd>R</kbd> で同じオプションのまま同じ譜面をすぐにもう一度プレイします。</li>
            </ul>
          </div>
        </div>
        <div
          role="tabpanel"
          id="help-pane-keyboard"
          aria-labelledby="help-tab-keyboard"
          tabindex="-1"
          aria-selected="false"
          hidden
        ></div>
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
