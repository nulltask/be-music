import { html } from 'lit';

export const OPTIONS_HELP_TEMPLATE = html`
  <div id="options-help-content" hidden>
    <div class="help-lang is-active" data-lang="en">
      <h3 class="help-section-title">Options</h3>
      <ul class="help-list">
        <li>
          Click the <strong>Settings</strong> button (the gear) at the top right to open Options. Each tab gathers one
          area: Play, Tempo &amp; course, Skin &amp; display, Audio, Library, Leaderboard and Developer; Play options
          splits its many options into pages. The <strong>?</strong> beside an option shows what it does.
        </li>
        <li>
          Every setting is remembered in this browser and restored on your next visit.
          <strong>Developer → Reset settings and reload</strong> returns them all to their defaults (your best records
          stay).
        </li>
        <li>
          Settings that shape a play (lane options, gauge, modifiers, judgment windows) are locked while it runs and
          apply from the next chart; hi-speed, volume and a few view settings change live.
        </li>
      </ul>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Top</h4>
        <p class="help-menu-note">Above the folders.</p>
        <dl class="help-menu-items">
          <dt>Status</dt>
          <dd>What the player is doing now (read-only).</dd>
          <dt>Open folder</dt>
          <dd>Picks a folder of charts and / or skins; handled like a drop.</dd>
          <dt>Open files (ZIP / replay)</dt>
          <dd>
            Picks chart ZIP archives, or a replay (<code>*.bmplay.json</code>, or a course's
            <code>*.bmcourse.json</code>) to watch.
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Play options</h4>
        <p class="help-menu-note">
          Locked during a play unless noted. Options that only change the chart or the view (marked LR2, beatoraja or
          AC) work under every ruleset and run their source's algorithm; the judge rules come from Play options →
          Judgment windows. Items marked “Shown with …” say when they appear.
        </p>
        <dl class="help-menu-items">
          <dt>Judgment windows</dt>
          <dd>
            The rules every play follows: LR2, beatoraja or ????. It decides the windows, gauges, options offered, and
            which best records the select screen shows.
          </dd>
          <dt>Auto play</dt>
          <dd>Plays the chart automatically. An AUTO play saves no record.</dd>
          <dt>Gauge</dt>
          <dd>The gauge you play on. The choices follow the rules picked in Play options → Judgment windows.</dd>
          <dt>Judge algorithm</dt>
          <dd>
            With beatoraja rules, which note a press is judged against when several are in reach: Combo (default),
            Duration or Lowest.
          </dd>
          <dt data-for="Random 1P|Random 2P">Random 1P / Random 2P</dt>
          <dd>
            The lane option for each side. Every option is offered under every ruleset and runs its source's algorithm,
            grouped by source with the rules' own first. RANDOM, S-RANDOM and CONVERGE differ per source, so each is
            listed once per source, for example RANDOM (LR2) and RANDOM (beatoraja).
          </dd>
          <dt>H-RANDOM threshold BPM (beatoraja)</dt>
          <dd>The BPM whose 16th note counts as a too-fast repeat for H-RANDOM, ALL-SCR and the 7-to-9 scratch.</dd>
          <dt data-for="Fixed key 1P (LR2; 0=default)|Fixed key 2P (LR2; 0=default)">
            Fixed key 1P / 2P (LR2; 0=default)
          </dt>
          <dd>The lane LR2 CONVERGE gathers notes on. 0 picks the mode default.</dd>
          <dt data-for="Seed 1P (-1=random)|Seed 2P (-1=random)">Seed 1P / 2P (-1=random)</dt>
          <dd>
            Fixes the seed of the lane random under every ruleset; -1 draws a new one each play. Hidden for
            RANDOM_PLAYABLE, which ignores it.
          </dd>
          <dt>7-to-9 (beatoraja)</dt>
          <dd>Plays a 7KEY chart on nine lanes, in the chosen layout.</dd>
          <dt>7-to-9 scratch</dt>
          <dd>Where 7-to-9 puts scratch notes: Fixed, Avoid repeated hits or Alternate.</dd>
          <dt>Reuse previous arrangement</dt>
          <dd>Plays the same chart again with the last play's exact lanes, when that play had the same judge rules.</dd>
          <dt>New arrangement</dt>
          <dd>Drops the reused arrangement and resets both seeds to -1.</dd>
          <dt>bmson TOTAL 0</dt>
          <dd>
            How a bmson chart whose TOTAL is 0 % fills the gauge. Native compatibility (default) recovers as the other
            players do; No recovery (bmson spec) gives no recovery, keeping the damage. A play with no recovery saves no
            ranked record.
          </dd>
          <dt>Gauge auto-shift</dt>
          <dd>
            What happens when the gauge would fail: NONE, CONTINUE, SURVIVAL TO GROOVE, BEST CLEAR or SELECT TO UNDER
            (beatoraja's policies). Each ruleset shifts along its own gauges, for example LR2 from HAZARD to HARD,
            GROOVE and EASY.
          </dd>
          <dt>Lowest auto-shift gauge</dt>
          <dd>
            The lowest gauge BEST CLEAR and SELECT TO UNDER may shift down to. LR2 has no ASSIST EASY, so its lowest is
            EASY.
          </dd>
          <dt>Scroll (beatoraja)</dt>
          <dd>
            REMOVE draws the chart without its BPM and scroll changes; ADD adds random scroll changes. Judgment is
            unchanged.
          </dd>
          <dt data-for="Scroll section lines|Scroll rate">Scroll section lines / Scroll rate</dt>
          <dd>
            <em class="help-menu-when">Shown with Scroll set to ADD.</em> For scroll ADD: how many bar lines each change
            lasts, and how strong it is.
          </dd>
          <dt>Mines (beatoraja)</dt>
          <dd>REMOVE takes the mines out; ADD RANDOM, ADD NEAR and ADD ALL add mines.</dd>
          <dt>ANY KEY (PC)</dt>
          <dd>
            <em class="help-menu-when">Shown with Judgment windows → ????.</em> The PC edition's assist: any key takes
            the nearest note in reach on any lane, a chord takes as many presses as it has notes, and a long note stays
            held until the key that took its head is released. Saves no record.
          </dd>
          <dt>DP flip</dt>
          <dd>Swaps the 1P and 2P sides of a double-play chart.</dd>
          <dt data-for="Auto scratch 1P|Auto scratch 2P">Auto scratch 1P / 2P</dt>
          <dd>Plays that side's scratch notes for you.</dd>
          <dt>Long notes</dt>
          <dd>
            LEGACY NOTE turns charge notes into normal notes, LN REMOVE turns every long note into its head, and ADD LN
            / CN / HCN / ALL (beatoraja) make long notes under every ruleset. The added notes are judged as the rules'
            long notes, so CN and HCN differ from LN only under beatoraja rules.
          </dd>
          <dt>Battle</dt>
          <dd>
            Battle and conversion modes, grouped by source and offered under every ruleset. BATTLE (LR2) is two-player
            play, each player judged by the rules (???? calls it 2P PLAY); BATTLE (beatoraja) and BATTLE (????) put one
            player on both sides. COUPLE stays with LR2 rules.
          </dd>
          <dt>Gauge 2P</dt>
          <dd>
            <em class="help-menu-when"
              >Shown with two-player play: Battle set to BATTLE (LR2), COUPLE or 2P PLAY (????).</em
            >
            The second player's gauge.
          </dd>
          <dt data-for="M-RAN 1P|M-RAN 2P">M-RAN 1P / 2P</dt>
          <dd>
            <em class="help-menu-when"
              >Shown with two-player play: Battle set to BATTLE (LR2), COUPLE or 2P PLAY (????).</em
            >
            Mirrors that player's side after a RANDOM-type option.
          </dd>
          <dt>D-BATTLE scratch (LR2)</dt>
          <dd>
            <em class="help-menu-when">Shown with Battle set to D-BATTLE.</em> Keeps scratch notes playable instead of
            turning them into background sound.
          </dd>
          <dt>EXTRA MODE (LR2)</dt>
          <dd>Turns background keysounds into extra notes, as LR2's EXTRA MODE does.</dd>
          <dt>EXTRA minimum level (LR2)</dt>
          <dd>
            <em class="help-menu-when">Shown with EXTRA MODE (LR2) on.</em> How dense EXTRA MODE may get at least: LEVEL
            1 to 3.
          </dd>
          <dt>LN MODE (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Shown with beatoraja rules.</em> How a chart that leaves its long-note type open
            plays: LN, CN or HCN.
          </dd>
          <dt>CUSTOM JUDGE (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Shown with beatoraja rules.</em> Scales the judgment windows with the rates
            below.
          </dd>
          <dt
            data-for="Key PGREAT %|Key GREAT %|Key GOOD %|Scratch PGREAT %|Scratch GREAT %|Scratch GOOD %|LN margin %"
          >
            Key / Scratch PGREAT, GREAT, GOOD % · LN margin %
          </dt>
          <dd>
            <em class="help-menu-when">Shown with CUSTOM JUDGE on.</em> The width of each window for keys and scratches,
            and the long-note release margin.
          </dd>
          <dt>PRACTICE</dt>
          <dd>
            beatoraja's PRACTICE, under every ruleset: plays a range of the chart again and again until Esc. A practice
            play saves no replay and no record, and is never sent to the Leaderboard.
          </dd>
          <dt data-for="START TIME ms|END TIME ms (0 = end)">START TIME ms / END TIME ms</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on.</em> The range to practise, in chart milliseconds; 0 as
            the end means the chart's end.
          </dd>
          <dt data-for="GAUGE TYPE|GAUGE CATEGORY|GAUGE VALUE">GAUGE TYPE / GAUGE CATEGORY / GAUGE VALUE</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on.</em> The gauge, one of the rules' own gauges; its
            category (beatoraja rules only); and its starting value.
          </dd>
          <dt data-for="JUDGERANK (0 = chart)|TOTAL (0 = chart)">JUDGERANK / TOTAL</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on, except under ???? rules.</em> The judge rank and TOTAL to
            practise with; 0 keeps the chart's. Under LR2 rules JUDGERANK reads on LR2's #RANK table (25, 50, 75 and 100
            are VERY HARD to EASY) and TOTAL is used as is.
          </dd>
          <dt data-for="EXTRA depth (beatoraja)|EXTRA scratch (beatoraja)">EXTRA depth (beatoraja) / EXTRA scratch</dt>
          <dd>
            beatoraja EXTRA: how many background keysounds per row become notes (0 is off), and whether scratch lanes
            get them.
          </dd>
          <dt>Long-note add rate (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Shown with an ADD choice in Long notes.</em> How many of the notes become long
            notes, 0 to 1.
          </dd>
          <dt data-for="Sort|Key filter|Difficulty filter">Sort / Key filter / Difficulty filter</dt>
          <dd>How the built-in and LR2 select screens order and filter the list.</dd>
          <dt>HS-FIX</dt>
          <dd>
            <em class="help-menu-when">Hidden while CLASSIC, Normal or FLOATING HI-SPEED is on.</em> Keeps the scroll
            speed steady against a BPM: MAXBPM, MINBPM, AVERAGE, STARTBPM, or CONSTANT (LR2, offered under every
            ruleset).
          </dd>
          <dt>Display area info</dt>
          <dd>
            Keeps showing the cover length and green number at the cover edges: OFF, ON, SUDDEN+ ONLY or HID+/LIFT ONLY.
          </dd>
          <dt data-for="Effect 1P|Effect 2P">Effect 1P / 2P</dt>
          <dd>The lane covers for each side: OFF, HIDDEN, SUDDEN or HID+SUD.</dd>
          <dt data-for="Lane cover|Cover height">Lane cover / Cover height</dt>
          <dd>LR2's lane cover, and how much of the lane it covers.</dd>
          <dt>BPM GUIDE (beatoraja)</dt>
          <dd>Shows upcoming BPM changes on the lanes.</dd>
          <dt>BPM change warning (AC)</dt>
          <dd>
            Shows <code>current » next</code> BPM in a box on the lanes for 2 seconds before each BPM change: blue when
            it speeds up, red when it slows down.
          </dd>
          <dt data-for="LIFT 1P (beatoraja)|LIFT 2P (beatoraja)|LIFT height 1P|LIFT height 2P">
            LIFT 1P / 2P (beatoraja) · LIFT height
          </dt>
          <dd>Raises that side's judge line, and by how much. Changes live.</dd>
          <dt data-for="Visual CONSTANT (beatoraja)|Note duration (ms)|CONSTANT fade (ms)">
            Visual CONSTANT (beatoraja) · Note duration (ms) · CONSTANT fade (ms)
          </dt>
          <dd>Shows notes only for their last N ms before the judge line, with a fade at their edge.</dd>
          <dt>Auto judge timing</dt>
          <dd>
            Moves Judge timing by itself from your hits in a manual play: beatoraja's way after every hit, or LR2's by 1
            ms every ten hits. LR2 SILENT also plays without the chart's sounds and BGA and hides the judgment.
          </dd>
          <dt>Judge timing (ms)</dt>
          <dd>Shifts when the notes are drawn, −500 to 500 ms. Input, audio and judgment stay as they are.</dd>
          <dt data-for="Normal HI-SPEED (AC 32 measured)|Normal HS level">
            Normal HI-SPEED (AC 32 measured) · Normal HS level
          </dt>
          <dd>
            <em class="help-menu-when">The level shows with Normal HI-SPEED on.</em> Picks the speed from twenty levels
            measured on AC, instead of the Hi-speed slider.
          </dd>
          <dt data-for="CLASSIC HI-SPEED|Classic speed">CLASSIC HI-SPEED · Classic speed</dt>
          <dd>
            <em class="help-menu-when">The speed shows with CLASSIC HI-SPEED on.</em> Picks the speed from AC's eleven
            CLASSIC steps, 1.0 to 4.0.
          </dd>
          <dt data-for="FLOATING HI-SPEED (AC 32 measured)|Floating speed">
            FLOATING HI-SPEED (AC 32 measured) · Floating speed
          </dt>
          <dd>
            <em class="help-menu-when">The speed shows with FLOATING HI-SPEED on.</em> Keeps the green number while the
            covers move; Numpad 0 switches it during play.
          </dd>
          <dt>Fixed display area (AC 34)</dt>
          <dd>Ignores cover and LIFT changes during play; Enter twice restores the floating green number.</dd>
          <dt>Hi-speed</dt>
          <dd>
            <em class="help-menu-when">Hidden while CLASSIC, Normal or FLOATING HI-SPEED is on.</em> The scroll speed.
            Changes live, like ↑ / ↓ during play.
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Replay / ghost</h4>
        <p class="help-menu-note">Inside Play options.</p>
        <dl class="help-menu-items">
          <dt data-for="Tempo|Hi-speed|SUDDEN+ / HIDDEN+|LIFT">Tempo · Hi-speed · SUDDEN+ / HIDDEN+ · LIFT</dt>
          <dd>When on, a replay uses what the recorded player had; when off, your own settings.</dd>
          <dt data-for="Ghost|Ghost mode|Ghost status|Ghost replay file…">Ghost · Ghost mode</dt>
          <dd>
            Shows a recorded play with yours: your best, a replay slot, the Leaderboard's top run or a replay file, as a
            second playfield, a pacemaker, or a pacemaker with its key presses over your lanes. Ghost status says
            whether the chart under the cursor shows it.
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Key config</h4>
        <p class="help-menu-note">The Keys tab. Read as a play starts, so locked during one.</p>
        <dl class="help-menu-items">
          <dt
            data-for="1P scratch|1P key 1|1P key 2|1P key 3|1P key 4|1P key 5|1P key 6|1P key 7|2P key 1|2P key 2|2P key 3|2P key 4|2P key 5|2P key 6|2P key 7|2P scratch|Key 1|Key 2|Key 3|Key 4|Key 5|Key 6|Key 7|Key 8|Key 9"
          >
            Lanes
          </dt>
          <dd>
            The key each lane takes: 5 / 7 / 10 / 14 KEY share one set, 9 KEY has its own. Click a lane's key, then
            press the key to give it; a key another lane has moves to that lane's old key. Esc cancels. Esc, Space, F5,
            Backspace and the up / down arrows stay the play's.
          </dd>
          <dt>Reset keys to defaults</dt>
          <dd>Puts the page's lanes back on their default keys.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Tempo</h4>
        <dl class="help-menu-items">
          <dt>Enabled</dt>
          <dd>Turns the play tempo on.</dd>
          <dt>Tempo (%)</dt>
          <dd>How much faster or slower the chart plays. With the pitch following the tempo it changes live.</dd>
          <dt>Pitch</dt>
          <dd>Whether the pitch follows the tempo (as in LR2) or stays.</dd>
          <dt>Keep-pitch stretcher</dt>
          <dd>How the pitch is kept: WSOLA or Signalsmith Stretch.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Course</h4>
        <dl class="help-menu-items">
          <dt>Skip stage results</dt>
          <dd>Skips the result screen after each course stage.</dd>
          <dt>My courses…</dt>
          <dd>Renames, deletes and exports the courses you made.</dd>
          <dt>NONSTOP placement</dt>
          <dd>Stitches NONSTOP courses as intended, or exactly as LR2 does, quirks included.</dd>
          <dt data-for="Table URL|Import table courses">Table URL · Import table courses</dt>
          <dd>Imports the courses of a difficulty table from its URL; it is imported again on later visits.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Skin &amp; display</h4>
        <dl class="help-menu-items">
          <dt>Skin system</dt>
          <dd>
            Draws with the built-in, LR2 or beatoraja skin. Asks for a drop when none is loaded. Can change during a
            play.
          </dd>
          <dt data-for="Built-in skin|Skin effects">Built-in skin · Skin effects</dt>
          <dd>(Built-in tab) Synesthesia, Plain or Native, and how much animation they draw: Full, Reduced or Off.</dd>
          <dt>Skin settings</dt>
          <dd>(Built-in tab) The selected skin's own settings, with Reset to defaults.</dd>
          <dt data-for="Load LR2 skin…|LR2 theme">Load LR2 skin… · LR2 theme</dt>
          <dd>(LR2 tab) Loads an LR2 theme, and picks among the themes loaded.</dd>
          <dt data-for="Load beatoraja skin…|Beatoraja skins">Load beatoraja skin… · Beatoraja skins</dt>
          <dd>(beatoraja tab) Loads beatoraja skins, and picks one per screen and key mode.</dd>
          <dt data-for="Render resolution|Auto-detect resolution">Render resolution · Auto-detect resolution</dt>
          <dd>How sharply the canvas draws; lower it if the frame rate drops.</dd>
          <dt>Play layout</dt>
          <dd>Auto, Desktop or Touch (on-screen lanes and buttons).</dd>
          <dt>Judged notes</dt>
          <dd>Whether a judged note keeps scrolling until its time (as in LR2) or disappears.</dd>
          <dt>Show invisible notes</dt>
          <dd>Shows hidden keysound objects. Changes live; judgment is unchanged.</dd>
          <dt>Toggle fullscreen</dt>
          <dd>Enters or leaves fullscreen.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Audio</h4>
        <dl class="help-menu-items">
          <dt data-for="Mute|Master (%)|Key sound (%)|BGM (%)">Mute · Master / Key sound / BGM (%)</dt>
          <dd>Silences the player, and sets each volume.</dd>
          <dt>Play in silent mode</dt>
          <dd>Plays sound with an iPhone's silent switch on (where the browser allows it).</dd>
          <dt>Peak gain (next play)</dt>
          <dd>From the next play, raises the volume so the loudest peak is near −3 dBFS.</dd>
          <dt>Compressor</dt>
          <dd>
            Evens out loud keysounds and BGM: turn it on, pick the stages, and tune each compressor (with a reset).
          </dd>
          <dt data-for="Enabled|Key|BGM|Master">Enabled · Key / BGM / Master</dt>
          <dd>
            (Compressor) Turns the compressor on, and, with the split compressor, whether each stage (key sounds, BGM,
            the mix) runs. Applies live.
          </dd>
          <dt data-for="Threshold (dB)|Knee (dB)|Ratio (x:1)|Attack (ms)|Release (ms)|Reset to default">
            Threshold · Knee · Ratio · Attack · Release
          </dt>
          <dd>
            (Compressor) Each compressor's settings. They retune a running chart live and are remembered; Reset to
            default puts them back.
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Library &amp; records</h4>
        <dl class="help-menu-items">
          <dt data-for="Music ZIP URL|Skin ZIP URL|Load from URLs">Music ZIP URL · Skin ZIP URL · Load from URLs</dt>
          <dd>Loads a chart or skin ZIP from a URL, as <code>?music=</code> / <code>?skin=</code> do.</dd>
          <dt>Auto-save replays</dt>
          <dd>Downloads each finished play's replay.</dd>
          <dt>Clear best records</dt>
          <dd>Deletes the best records kept in this browser (asks first).</dd>
          <dt>Local data…</dt>
          <dd>
            Shows what the player keeps in this browser: its localStorage keys, its IndexedDB databases (your courses,
            the replay slots) and how much space they use. It only reads; clear data from its own controls.
          </dd>
          <dt>BGA video transcode</dt>
          <dd>Whether BGA videos are converted with WebCodecs, and the size they are reduced to.</dd>
          <dt data-for="Slot 1 auto-save|Slot 2 auto-save|Slot 3 auto-save|Slot 4 auto-save">Slot 1–4 auto-save</dt>
          <dd>
            (Replay slots) When a result saves its replay into each slot, by beatoraja's rules: a better (or equal) EX
            score, BP, max combo or clear lamp, any of them, always, or never. Saving by hand (keys 1–4) works whatever
            they say.
          </dd>
          <dt data-for="Use WebCodecs encoder|Resize">Use WebCodecs encoder · Resize</dt>
          <dd>
            (BGA video transcode) Converts BGA videos with the browser's WebCodecs encoder where it has one, and shrinks
            them to the chosen size (Off keeps it). Applies from the next chart.
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Capture</h4>
        <dl class="help-menu-items">
          <dt data-for="● Record gameplay video|Video format">● Record gameplay video · Video format</dt>
          <dd>Records the next play as a video to download, in the chosen format (MP4 · H.264 by default).</dd>
          <dt>📸 Screenshot</dt>
          <dd>Saves the screen as a PNG.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Leaderboard</h4>
        <dl class="help-menu-items">
          <dt>Submit to Leaderboard</dt>
          <dd>Sends each finished play to the Leaderboard (off by default).</dd>
          <dt data-for="Account|Create passkey (keep this account)|Sign in with passkey|Sign out">
            Account · Create passkey · Sign in with passkey · Sign out
          </dt>
          <dd>Shows who is signed in, keeps the account with a passkey, and signs in or out.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Developer</h4>
        <dl class="help-menu-items">
          <dt>CPU workers</dt>
          <dd>How many workers load charts and stretch audio in parallel.</dd>
          <dt>Auto pause on blur</dt>
          <dd>Pauses the play when the page loses focus.</dd>
          <dt>FPS</dt>
          <dd>The frame rate graph.</dd>
          <dt>Reset settings and reload</dt>
          <dd>Returns every setting to its default and reloads; best records stay.</dd>
        </dl>
      </section>

      <h3 class="help-section-title">Options &amp; recording</h3>
      <ul class="help-list">
        <li>
          <strong>Play options</strong> hold the lane options (RANDOM, S-RANDOM, SCATTER and more), gauges, battle
          modes, chart modifiers, HS-FIX and lane covers, following LR2 or beatoraja as
          <strong>Play options → Judgment windows</strong> picks. A replay records the options it was played with.
        </li>
        <li>
          Click <strong>Record gameplay video</strong> to capture the next play as a downloadable video (MP4 · H.264
          unless <strong>Video format</strong> says otherwise) (requires MediaRecorder support — see Acknowledgements /
          browser checks).
        </li>
        <li>
          The active skin's <strong>PLAY OPTION</strong> panel in chart select sets the same options (Random / Mirror /
          Auto-scratch / gauge / hi-speed and more).
        </li>
      </ul>
    </div>
    <div class="help-lang" data-lang="ja" hidden>
      <h3 class="help-section-title">Options</h3>
      <ul class="help-list">
        <li>
          右上の <strong>Settings</strong> ボタン (歯車) で Options が開きます。タブごとに Play、Tempo &amp;
          course、Skin &amp; display、Audio、Library、Leaderboard、Developer の設定がまとまっています。Play options
          は項目が多いのでページに分かれています。各項目の横の <strong>?</strong> にカーソルを合わせると説明が出ます。
        </li>
        <li>
          設定はすべてこのブラウザに記憶され、次に開いたときに元に戻ります。<strong
            >Developer → Reset settings and reload</strong
          >
          ですべて既定値に戻せます (ベスト記録は残ります)。
        </li>
        <li>
          プレイの内容を決める設定 (レーンのオプション、ゲージ、譜面の変更、判定)
          はプレイ中は変えられず、次の譜面から反映されます。ハイスピード、音量、一部の表示設定はプレイ中にも変えられます。
        </li>
      </ul>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">最上部</h4>
        <p class="help-menu-note">フォルダの上。</p>
        <dl class="help-menu-items">
          <dt>Status</dt>
          <dd>今の状態の表示 (読み取り専用)。</dd>
          <dt>Open folder</dt>
          <dd>譜面やスキンのフォルダを選んで読み込みます。ドロップと同じ扱いです。</dd>
          <dt>Open files (ZIP / replay)</dt>
          <dd>
            譜面の ZIP アーカイブ、または再生するリプレイ (<code>*.bmplay.json</code>、コースは
            <code>*.bmcourse.json</code>) を選びます。
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Play options</h4>
        <p class="help-menu-note">
          特に書かない限りプレイ中は変えられません。譜面や表示を変えるだけのオプション (LR2・beatoraja・AC と付いたもの)
          はどのルールでも使え、その出典のアルゴリズムで動きます。判定のルールは Play options → Judgment windows
          で決まります。「…のときに表示」とある項目は、その条件で表示されます。
        </p>
        <dl class="help-menu-items">
          <dt>Judgment windows</dt>
          <dd>
            すべてのプレイが従うルール。LR2、beatoraja、????。判定の幅、ゲージ、選べるオプション、選曲画面に出すベスト記録が変わります。
          </dd>
          <dt>Auto play</dt>
          <dd>譜面を自動で演奏します。AUTO のプレイは記録に残りません。</dd>
          <dt>Gauge</dt>
          <dd>プレイに使うゲージ。選べる種類は Play options → Judgment windows のルールで変わります。</dd>
          <dt>Judge algorithm</dt>
          <dd>
            beatoraja のルールで、近くに複数のノーツがあるときにどれを判定するか。Combo (既定)、Duration、Lowest。
          </dd>
          <dt data-for="Random 1P|Random 2P">Random 1P / Random 2P</dt>
          <dd>
            各サイドのレーンのオプション。どのオプションもどのルールでも選べ、その出典のアルゴリズムで動きます。出典ごとにまとめ、ルール自身の出典を先頭に並べます。RANDOM、S-RANDOM、CONVERGE
            は出典ごとに中身が違うため、RANDOM (LR2) と RANDOM (beatoraja) のように出典ごとに 1 つずつ並びます。
          </dd>
          <dt>H-RANDOM threshold BPM (beatoraja)</dt>
          <dd>H-RANDOM、ALL-SCR、7-to-9 のスクラッチで、連打とみなす 16 分音符の BPM。</dd>
          <dt data-for="Fixed key 1P (LR2; 0=default)|Fixed key 2P (LR2; 0=default)">
            Fixed key 1P / 2P (LR2; 0=default)
          </dt>
          <dd>LR2 の CONVERGE でノーツを集めるレーン。0 はモードの既定。</dd>
          <dt data-for="Seed 1P (-1=random)|Seed 2P (-1=random)">Seed 1P / 2P (-1=random)</dt>
          <dd>
            どのルールでも使うレーンのランダムのシード。-1 ならプレイごとに新しく決めます。シードを使わない
            RANDOM_PLAYABLE では隠れます。
          </dd>
          <dt>7-to-9 (beatoraja)</dt>
          <dd>7 鍵の譜面を、選んだ配置で 9 レーンで遊びます。</dd>
          <dt>7-to-9 scratch</dt>
          <dd>7-to-9 でスクラッチのノーツをどこに置くか。Fixed、Avoid repeated hits、Alternate。</dd>
          <dt>Reuse previous arrangement</dt>
          <dd>前回のプレイ (同じルールで遊んだもの) とまったく同じ配置で、同じ譜面をもう一度遊びます。</dd>
          <dt>New arrangement</dt>
          <dd>再利用している配置をやめ、シードを両方 -1 に戻します。</dd>
          <dt>bmson TOTAL 0</dt>
          <dd>
            TOTAL が 0 % の bmson 譜面でのゲージの増え方。Native compatibility (既定) は他のプレイヤーと同じく回復し、No
            recovery (bmson spec)
            はダメージはそのままで回復しません。回復しないプレイはランキング対象の記録になりません。
          </dd>
          <dt>Gauge auto-shift</dt>
          <dd>
            ゲージが尽きたときの扱い。NONE、CONTINUE、SURVIVAL TO GROOVE、BEST CLEAR、SELECT TO UNDER (beatoraja
            の方式)。ルールごとに自分のゲージの並びで切り替えます。たとえば LR2 では HAZARD から HARD、GROOVE、EASY
            の順です。
          </dd>
          <dt>Lowest auto-shift gauge</dt>
          <dd>
            BEST CLEAR と SELECT TO UNDER で下げてよい一番下のゲージ。LR2 には ASSIST EASY がないので、一番下は EASY
            です。
          </dd>
          <dt>Scroll (beatoraja)</dt>
          <dd>
            REMOVE は BPM やスクロールの変化をなくして描き、ADD
            はランダムなスクロールの変化を加えます。判定は変わりません。
          </dd>
          <dt data-for="Scroll section lines|Scroll rate">Scroll section lines / Scroll rate</dt>
          <dd>
            <em class="help-menu-when">Scroll が ADD のときに表示。</em> スクロールの ADD
            で、変化ごとの小節線の数と、変化の強さ。
          </dd>
          <dt>Mines (beatoraja)</dt>
          <dd>REMOVE は地雷を取り除き、ADD RANDOM、ADD NEAR、ADD ALL は地雷を加えます。</dd>
          <dt>ANY KEY (PC)</dt>
          <dd>
            <em class="help-menu-when">Judgment windows → ???? のときに表示。</em> PC
            版のアシストです。どのキーでも、判定範囲内でいちばん近いノーツをレーンを問わず取ります。同時押しは押した数だけ取り、ロングノーツは先頭を取ったキーを離すまで押したままになります。記録は残りません。
          </dd>
          <dt>DP flip</dt>
          <dd>DP の譜面の 1P 側と 2P 側を入れ替えます。</dd>
          <dt data-for="Auto scratch 1P|Auto scratch 2P">Auto scratch 1P / 2P</dt>
          <dd>そのサイドのスクラッチを自動で処理します。</dd>
          <dt>Long notes</dt>
          <dd>
            LEGACY NOTE はチャージノートを通常ノーツに、LN REMOVE はすべてのロングノートを始点だけにし、ADD LN / CN /
            HCN / ALL (beatoraja)
            はどのルールでもロングノートを作ります。足したノーツはルールのロングノートとして判定するので、CN と HCN が
            LN と違うのは beatoraja のルールのときだけです。
          </dd>
          <dt>Battle</dt>
          <dd>
            バトルと変換のモード。出典ごとにまとめ、どのルールでも選べます。BATTLE (LR2) は 2
            人プレイで、各プレイヤーはルールで判定します (???? では 2P PLAY)。BATTLE (beatoraja) と BATTLE (????) は 1
            人で両側を遊びます。COUPLE は LR2 のルールだけです。
          </dd>
          <dt>Gauge 2P</dt>
          <dd>
            <em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2)、COUPLE、2P PLAY (????)) のときに表示。</em>
            2 人目のゲージ。
          </dd>
          <dt data-for="M-RAN 1P|M-RAN 2P">M-RAN 1P / 2P</dt>
          <dd>
            <em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2)、COUPLE、2P PLAY (????)) のときに表示。</em>
            RANDOM 系のオプションのあと、そのプレイヤーの側を左右反転します。
          </dd>
          <dt>D-BATTLE scratch (LR2)</dt>
          <dd>
            <em class="help-menu-when">Battle が D-BATTLE のときに表示。</em> スクラッチを BGM
            にせず、叩くノーツのまま残します。
          </dd>
          <dt>EXTRA MODE (LR2)</dt>
          <dd>LR2 の EXTRA MODE のように、BGM のキー音をノーツに変えて増やします。</dd>
          <dt>EXTRA minimum level (LR2)</dt>
          <dd>
            <em class="help-menu-when">EXTRA MODE (LR2) がオンのときに表示。</em> EXTRA MODE の最低の密度。LEVEL 1〜3。
          </dd>
          <dt>LN MODE (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">beatoraja のルールのときに表示。</em> ロングノートの種類を決めていない譜面を
            LN、CN、HCN のどれで遊ぶか。
          </dd>
          <dt>CUSTOM JUDGE (beatoraja)</dt>
          <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> 下の倍率で判定の幅を変えます。</dd>
          <dt
            data-for="Key PGREAT %|Key GREAT %|Key GOOD %|Scratch PGREAT %|Scratch GREAT %|Scratch GOOD %|LN margin %"
          >
            Key / Scratch PGREAT, GREAT, GOOD % · LN margin %
          </dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに表示。</em>
            鍵盤とスクラッチの判定ごとの幅と、ロングノートを離すときの余裕。
          </dd>
          <dt>PRACTICE</dt>
          <dd>
            beatoraja の PRACTICE を、どのルールでも使えます。譜面の一部の範囲を Esc
            を押すまで繰り返します。練習のプレイはリプレイも記録も残さず、Leaderboard にも送りません。
          </dd>
          <dt data-for="START TIME ms|END TIME ms (0 = end)">START TIME ms / END TIME ms</dt>
          <dd>
            <em class="help-menu-when">PRACTICE がオンのときに表示。</em> 練習する範囲 (譜面のミリ秒)。終わりの 0
            は譜面の最後。
          </dd>
          <dt data-for="GAUGE TYPE|GAUGE CATEGORY|GAUGE VALUE">GAUGE TYPE / GAUGE CATEGORY / GAUGE VALUE</dt>
          <dd>
            <em class="help-menu-when">PRACTICE がオンのときに表示。</em> ゲージの種類 (そのルールのゲージ)、カテゴリ
            (beatoraja のルールのときだけ)、開始時の値。
          </dd>
          <dt data-for="JUDGERANK (0 = chart)|TOTAL (0 = chart)">JUDGERANK / TOTAL</dt>
          <dd>
            <em class="help-menu-when">PRACTICE がオンのときに表示 (???? のルールでは表示しません)。</em>
            練習で使う判定ランクと TOTAL。0 なら譜面の値。LR2 のルールでは JUDGERANK を LR2 の #RANK の表で読み
            (25・50・75・100 が VERY HARD〜EASY)、TOTAL はそのまま使います。
          </dd>
          <dt data-for="EXTRA depth (beatoraja)|EXTRA scratch (beatoraja)">EXTRA depth (beatoraja) / EXTRA scratch</dt>
          <dd>
            beatoraja の EXTRA。1 行あたり何個の BGM のキー音をノーツにするか (0 でオフ) と、スクラッチにも置くか。
          </dd>
          <dt>Long-note add rate (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Long notes が ADD のどれかのときに表示。</em> ロングノートにする割合 (0〜1)。
          </dd>
          <dt data-for="Sort|Key filter|Difficulty filter">Sort / Key filter / Difficulty filter</dt>
          <dd>内蔵スキンと LR2 スキンの選曲画面の並び順と絞り込み。</dd>
          <dt>HS-FIX</dt>
          <dd>
            <em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は非表示。</em> BPM
            に合わせてスクロール速度を一定に保ちます。MAXBPM、MINBPM、AVERAGE、STARTBPM、CONSTANT
            (LR2。どのルールでも選べます)。
          </dd>
          <dt>Display area info</dt>
          <dd>カバーの長さと緑数字をカバーの端に表示し続けます。OFF、ON、SUDDEN+ ONLY、HID+/LIFT ONLY。</dd>
          <dt data-for="Effect 1P|Effect 2P">Effect 1P / 2P</dt>
          <dd>各サイドのレーンカバー。OFF、HIDDEN、SUDDEN、HID+SUD。</dd>
          <dt data-for="Lane cover|Cover height">Lane cover / Cover height</dt>
          <dd>LR2 のレーンカバーと、その高さ。</dd>
          <dt>BPM GUIDE (beatoraja)</dt>
          <dd>これから来る BPM の変化をレーン上に表示します。</dd>
          <dt>BPM change warning (AC)</dt>
          <dd>
            BPM が変わる 2 秒前から、レーン上の箱に
            <code>今の BPM » 次の BPM</code> を表示します。速くなるときは青、遅くなるときは赤です。
          </dd>
          <dt data-for="LIFT 1P (beatoraja)|LIFT 2P (beatoraja)|LIFT height 1P|LIFT height 2P">
            LIFT 1P / 2P (beatoraja) · LIFT height
          </dt>
          <dd>そのサイドの判定ラインを上げます。高さはプレイ中にも変えられます。</dd>
          <dt data-for="Visual CONSTANT (beatoraja)|Note duration (ms)|CONSTANT fade (ms)">
            Visual CONSTANT (beatoraja) · Note duration (ms) · CONSTANT fade (ms)
          </dt>
          <dd>ノーツを判定ラインに届く前の N ミリ秒だけ表示し、その境目をフェードさせます。</dd>
          <dt>Auto judge timing</dt>
          <dd>
            手で遊んだときの叩いたタイミングから、Judge timing を自動で調整します。beatoraja の方式は 1 打ごとに、LR2
            の方式は 10 打ごとに 1 ミリ秒ずつ動かします。LR2 SILENT では譜面の音と BGA なしで遊び、判定も表示しません。
          </dd>
          <dt>Judge timing (ms)</dt>
          <dd>ノーツを描くタイミングをずらします (−500〜500 ミリ秒)。入力、音、判定はそのままです。</dd>
          <dt data-for="Normal HI-SPEED (AC 32 measured)|Normal HS level">
            Normal HI-SPEED (AC 32 measured) · Normal HS level
          </dt>
          <dd>
            <em class="help-menu-when">レベルは Normal HI-SPEED がオンのときに表示。</em> Hi-speed
            のスライダーの代わりに、AC で実測した 20 段階から速度を選びます。
          </dd>
          <dt data-for="CLASSIC HI-SPEED|Classic speed">CLASSIC HI-SPEED · Classic speed</dt>
          <dd>
            <em class="help-menu-when">速度は CLASSIC HI-SPEED がオンのときに表示。</em> AC の CLASSIC の 11 段階
            (1.0〜4.0) から速度を選びます。
          </dd>
          <dt data-for="FLOATING HI-SPEED (AC 32 measured)|Floating speed">
            FLOATING HI-SPEED (AC 32 measured) · Floating speed
          </dt>
          <dd>
            <em class="help-menu-when">速度は FLOATING HI-SPEED がオンのときに表示。</em>
            カバーを動かしても緑数字を保ちます。プレイ中はテンキーの 0 で切り替えます。
          </dd>
          <dt>Fixed display area (AC 34)</dt>
          <dd>プレイ中のカバーと LIFT の変更を受け付けません。Enter 2 回でフローティングの緑数字に戻します。</dd>
          <dt>Hi-speed</dt>
          <dd>
            <em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は非表示。</em>
            スクロールの速さ。プレイ中の ↑ / ↓ と同じく、すぐ反映されます。
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Replay / ghost</h4>
        <p class="help-menu-note">Play options の中。</p>
        <dl class="help-menu-items">
          <dt data-for="Tempo|Hi-speed|SUDDEN+ / HIDDEN+|LIFT">Tempo · Hi-speed · SUDDEN+ / HIDDEN+ · LIFT</dt>
          <dd>オンならリプレイは録画したプレイヤーの設定で、オフなら自分の設定で再生します。</dd>
          <dt data-for="Ghost|Ghost mode|Ghost status|Ghost replay file…">Ghost · Ghost mode</dt>
          <dd>
            記録されたプレイを自分のプレイと一緒に見せます。自己ベスト、リプレイスロット、Leaderboard の 1
            位、リプレイファイルのどれかを、2
            つ目のプレイフィールド、ペースメーカー、押下を自分のレーンに重ねるペースメーカーのどれかで見せます。Ghost
            status はカーソルの譜面で見せられるかを示します。
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Key config</h4>
        <p class="help-menu-note">Keys タブ。プレイの開始時に読むので、プレイ中は変えられません。</p>
        <dl class="help-menu-items">
          <dt
            data-for="1P scratch|1P key 1|1P key 2|1P key 3|1P key 4|1P key 5|1P key 6|1P key 7|2P key 1|2P key 2|2P key 3|2P key 4|2P key 5|2P key 6|2P key 7|2P scratch|Key 1|Key 2|Key 3|Key 4|Key 5|Key 6|Key 7|Key 8|Key 9"
          >
            Lanes
          </dt>
          <dd>
            各レーンに割り当てるキー。5 / 7 / 10 / 14 KEY は共通、9 KEY
            は別に設定します。レーンのキーをクリックしてから割り当てたいキーを押します。ほかのレーンが使っているキーなら、そのレーンには元のキーが入れ替わりで入ります。Esc
            で取り消し。Esc、Space、F5、Backspace、上下の矢印はプレイ用なので使えません。
          </dd>
          <dt>Reset keys to defaults</dt>
          <dd>このページのレーンを既定のキーに戻します。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Tempo</h4>
        <dl class="help-menu-items">
          <dt>Enabled</dt>
          <dd>再生速度の変更を有効にします。</dd>
          <dt>Tempo (%)</dt>
          <dd>譜面を何 % 速く、または遅く再生するか。ピッチがテンポに従う設定なら、プレイ中にも変えられます。</dd>
          <dt>Pitch</dt>
          <dd>ピッチをテンポに合わせて変える (LR2 と同じ) か、保つか。</dd>
          <dt>Keep-pitch stretcher</dt>
          <dd>ピッチを保つ方法。WSOLA か Signalsmith Stretch。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Course</h4>
        <dl class="help-menu-items">
          <dt>Skip stage results</dt>
          <dd>コースのステージごとのリザルト画面を飛ばします。</dd>
          <dt>My courses…</dt>
          <dd>自分で作ったコースの名前の変更、削除、書き出し。</dd>
          <dt>NONSTOP placement</dt>
          <dd>NONSTOP のコースを意図どおりにつなぐか、LR2 の挙動 (不具合も含む) のとおりにつなぐか。</dd>
          <dt data-for="Table URL|Import table courses">Table URL · Import table courses</dt>
          <dd>難易度表の URL からコースを読み込みます。次に開いたときにも読み込みます。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Skin &amp; display</h4>
        <dl class="help-menu-items">
          <dt>Skin system</dt>
          <dd>
            内蔵、LR2、beatoraja
            のどのスキンで描くか。読み込んでいなければドロップを求めます。プレイ中にも変えられます。
          </dd>
          <dt data-for="Built-in skin|Skin effects">Built-in skin · Skin effects</dt>
          <dd>(Built-in タブ) Synesthesia、Plain、Native のどれを使うかと、演出の量 (Full、Reduced、Off)。</dd>
          <dt>Skin settings</dt>
          <dd>(Built-in タブ) 選んだスキンの設定。Reset to defaults で既定値に戻せます。</dd>
          <dt data-for="Load LR2 skin…|LR2 theme">Load LR2 skin… · LR2 theme</dt>
          <dd>(LR2 タブ) LR2 のテーマを読み込み、読み込んだテーマから選びます。</dd>
          <dt data-for="Load beatoraja skin…|Beatoraja skins">Load beatoraja skin… · Beatoraja skins</dt>
          <dd>(beatoraja タブ) beatoraja のスキンを読み込み、画面とキーモードごとに選びます。</dd>
          <dt data-for="Render resolution|Auto-detect resolution">Render resolution · Auto-detect resolution</dt>
          <dd>キャンバスを描く解像度。フレームレートが落ちるときは下げます。</dd>
          <dt>Play layout</dt>
          <dd>Auto、Desktop、Touch (画面のレーンとボタンで操作)。</dd>
          <dt>Judged notes</dt>
          <dd>判定したノーツを本来の時刻まで流す (LR2 と同じ) か、消すか。</dd>
          <dt>Show invisible notes</dt>
          <dd>不可視オブジェクトを表示します。プレイ中にも切り替えられ、判定は変わりません。</dd>
          <dt>Toggle fullscreen</dt>
          <dd>フルスクリーンに入る / 出る。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Audio</h4>
        <dl class="help-menu-items">
          <dt data-for="Mute|Master (%)|Key sound (%)|BGM (%)">Mute · Master / Key sound / BGM (%)</dt>
          <dd>音を消します。また、それぞれの音量を決めます。</dd>
          <dt>Play in silent mode</dt>
          <dd>iPhone の消音モードでも音を鳴らします (ブラウザが対応している場合)。</dd>
          <dt>Peak gain (next play)</dt>
          <dd>次のプレイから、一番大きい音が −3 dBFS 近くになるよう音量を上げます。</dd>
          <dt>Compressor</dt>
          <dd>
            キー音と BGM の音量差をならします。オンにして段を選び、それぞれのコンプレッサーを調整できます
            (リセットあり)。
          </dd>
          <dt data-for="Enabled|Key|BGM|Master">Enabled · Key / BGM / Master</dt>
          <dd>
            (Compressor) コンプレッサーのオン / オフと、分割コンプレッサーでの各段 (キー音、BGM、全体) のオン /
            オフ。プレイ中にも反映されます。
          </dd>
          <dt data-for="Threshold (dB)|Knee (dB)|Ratio (x:1)|Attack (ms)|Release (ms)|Reset to default">
            Threshold · Knee · Ratio · Attack · Release
          </dt>
          <dd>
            (Compressor) 各コンプレッサーの設定。プレイ中の譜面にもすぐ反映され、記憶されます。Reset to default
            で既定に戻します。
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Library &amp; records</h4>
        <dl class="help-menu-items">
          <dt data-for="Music ZIP URL|Skin ZIP URL|Load from URLs">Music ZIP URL · Skin ZIP URL · Load from URLs</dt>
          <dd><code>?music=</code> / <code>?skin=</code> と同じく、URL から譜面やスキンの ZIP を読み込みます。</dd>
          <dt>Auto-save replays</dt>
          <dd>プレイが終わるたびにリプレイをダウンロードします。</dd>
          <dt>Clear best records</dt>
          <dd>このブラウザのベスト記録を消します (確認があります)。</dd>
          <dt>Local data…</dt>
          <dd>
            プレイヤーがこのブラウザに保存しているもの (localStorage のキー、自作コースやリプレイスロットの IndexedDB
            データベース、使っている容量) を表示します。読むだけなので、データは消すための各操作から消してください。
          </dd>
          <dt>BGA video transcode</dt>
          <dd>BGA の動画を WebCodecs で変換するかと、縮小するサイズ。</dd>
          <dt data-for="Slot 1 auto-save|Slot 2 auto-save|Slot 3 auto-save|Slot 4 auto-save">Slot 1–4 auto-save</dt>
          <dd>
            (Replay slots) リザルトで各スロットにリプレイを保存する条件 (beatoraja の規則)。EX
            スコア、BP、最大コンボ、クリアランプの更新
            (同じも含むかどうか)、いずれか、常に、保存しない、から選びます。キー 1–4
            での手動保存はこの設定によらず使えます。
          </dd>
          <dt data-for="Use WebCodecs encoder|Resize">Use WebCodecs encoder · Resize</dt>
          <dd>
            (BGA video transcode) ブラウザに WebCodecs のエンコーダーがあれば BGA
            の動画をそれで変換し、選んだサイズに縮小します (Off は縮小しません)。次の譜面から反映されます。
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Capture</h4>
        <dl class="help-menu-items">
          <dt data-for="● Record gameplay video|Video format">● Record gameplay video · Video format</dt>
          <dd>次のプレイを動画として録画してダウンロードします。形式は選べます (既定は MP4 · H.264)。</dd>
          <dt>📸 Screenshot</dt>
          <dd>画面を PNG で保存します。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Leaderboard</h4>
        <dl class="help-menu-items">
          <dt>Submit to Leaderboard</dt>
          <dd>プレイが終わるたびに Leaderboard へ送ります (既定はオフ)。</dd>
          <dt data-for="Account|Create passkey (keep this account)|Sign in with passkey|Sign out">
            Account · Create passkey · Sign in with passkey · Sign out
          </dt>
          <dd>サインイン中のアカウントの表示、パスキーでのアカウントの保存、サインインとサインアウト。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Developer</h4>
        <dl class="help-menu-items">
          <dt>CPU workers</dt>
          <dd>譜面の読み込みや音の伸縮を並列で行うワーカーの数。</dd>
          <dt>Auto pause on blur</dt>
          <dd>ページからフォーカスが外れたらプレイを一時停止します。</dd>
          <dt>FPS</dt>
          <dd>フレームレートのグラフ。</dd>
          <dt>Reset settings and reload</dt>
          <dd>すべての設定を既定値に戻して再読み込みします。ベスト記録は残ります。</dd>
        </dl>
      </section>

      <h3 class="help-section-title">オプションと録画</h3>
      <ul class="help-list">
        <li>
          <strong>Play options</strong> には、レーンのオプション (RANDOM、S-RANDOM、SCATTER
          など)、ゲージ、バトル、譜面の変更、HS-FIX、レーンカバーがあります。<strong
            >Play options → Judgment windows</strong
          >
          で選んだ LR2 や beatoraja の仕様に従います。リプレイにはプレイしたときのオプションが記録されます。
        </li>
        <li>
          <strong>Record gameplay video</strong> ボタンを押すと、次の再生を動画（<strong>Video format</strong>
          で選んだ形式、既定は MP4 · H.264）として録画してダウンロードできます (ブラウザが MediaRecorder
          に対応している必要があります — Acknowledgements / Browser checks を参照)。
        </li>
        <li>
          選曲画面で現在のスキンの <strong>PLAY OPTION</strong> パネルからも、同じオプション (Random / Mirror /
          Auto-scratch / ゲージ / hi-speed など) を設定できます。
        </li>
      </ul>
    </div>
  </div>
`;
