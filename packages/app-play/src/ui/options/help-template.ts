import { html } from 'lit';
import { laneKeyHelp, screenKeyHelp } from './help-keys.ts';
import { OPTIONS_HELP_JA } from './help-template-ja.ts';

export { screenKeyHelpText } from './help-keys.ts';

export const OPTIONS_HELP_TEMPLATE = html`
  <div id="options-help-content" hidden>
    <div class="help-lang is-active" data-lang="en">
      <h3 class="help-section-title">Options</h3>
      <ul class="help-list">
        <li>
          Click the <strong>Settings</strong> button (the gear) at the top right to open Options. Each tab gathers one
          area: Play, View, Keys, Skin, Audio, Library, Leaderboard and Advanced; Play options and View split their many
          options into pages. The <strong>?</strong> beside an option shows what it does.
        </li>
        <li>
          Every setting is remembered in this browser and restored on your next visit.
          <strong>Advanced → Reset settings and reload</strong> returns them all to their defaults (your best records
          stay).
        </li>
        <li>
          Settings that shape a play (lane options, gauge, modifiers, judgment windows) are locked while it runs and
          apply from the next chart; hi-speed, volume and a few view settings change live.
        </li>
      </ul>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Top</h4>
        <p class="help-menu-note">At the top of the Library tab.</p>
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
          Judgment windows. Items marked “Shown with …” say when they appear, and “Used with …” when they can be set;
          until then they stay in place, disabled.
        </p>
        <dl class="help-menu-items">
          <dt>Judgment windows</dt>
          <dd>
            The rules every play follows: LR2, beatoraja or ????. It decides the windows, gauges, options offered, and
            which best records the select screen shows.
          </dd>
          <dt>Record kept</dt>
          <dd>
            What a play with the options picked keeps: its score, lamp and play count, or the lamp and play count only
            when an assisted option is on, or nothing. It names the options that cause it and the Leaderboard board. An
            option that assists only a chart it changes is worded as conditional.
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
          <dt>Random 1P</dt>
          <dd>
            The lane option for the 1P side (the only side in a single play). Every option is offered under every
            ruleset and runs its source's algorithm, grouped by source with the rules' own first. S-RANDOM and CONVERGE
            differ per source, so each is listed once per source, for example S-RANDOM (LR2 / ????), which LR2 and ????
            share, and S-RANDOM (beatoraja). RANDOM is the same in every source and is listed once.
          </dd>
          <dt>Random 2P</dt>
          <dd>The lane option for the 2P side of a double or two-player play, from the same list as Random 1P.</dd>
          <dt>H-RANDOM threshold BPM (beatoraja)</dt>
          <dd>The BPM whose 16th note counts as a too-fast repeat for H-RANDOM, ALL-SCR and the 7-to-9 scratch.</dd>
          <dt>Fixed key 1P (LR2; 0=default)</dt>
          <dd>The 1P lane LR2 CONVERGE gathers notes on. 0 picks the mode default.</dd>
          <dt>Fixed key 2P (LR2; 0=default)</dt>
          <dd>
            The 2P target for LR2 CONVERGE and CONVERGE corrected. 0 picks the mode default. RANDOM ignores this
            setting.
          </dd>
          <dt>Seed 1P (-1=random)</dt>
          <dd>
            Fixes the seed of the 1P lane random under every ruleset, so the same arrangement comes back; -1 draws a new
            one each play. Hidden for RANDOM_PLAYABLE, which ignores it.
          </dd>
          <dt>Seed 2P (-1=random)</dt>
          <dd>Fixes the seed of the 2P lane random, as Seed 1P does for 1P; -1 draws a new one each play.</dd>
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
          <dt>ADD NOTES (LR2) · LOUDNESS (LR2) · ADD LONGNOTES (LR2) · ADD MINES (LR2)</dt>
          <dd>
            LR2's hidden options that rewrite the chart, each off at 0 and strongest at 100. ADD NOTES adds notes to
            chords and LOUDNESS fills whole chords; both turn long notes into single notes, and such a play saves no
            record. ADD LONGNOTES holds notes half-way to the next one, and ADD MINES puts mines between notes; these
            cap the lamp. Not applied in a course or in PRACTICE.
          </dd>
          <dt>Scroll</dt>
          <dd>
            REMOVE (beatoraja) draws the chart without its BPM and scroll changes; ADD (beatoraja) adds random scroll
            changes. SOFTLANDING (LR2) changes the scroll speed at random between a half and double: LEVEL 1 at each
            measure, LEVEL 2 at each note as well. Judgment is unchanged.
          </dd>
          <dt>Scroll section lines</dt>
          <dd>
            <em class="help-menu-when">Used with Scroll set to ADD.</em> How many bar lines each scroll change lasts.
          </dd>
          <dt>Scroll rate</dt>
          <dd>
            <em class="help-menu-when">Used with Scroll set to ADD.</em> How strong each scroll change is, from 0 (none)
            to 1.
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
          <dt>Auto scratch 1P</dt>
          <dd>Plays the 1P side's scratch notes for you.</dd>
          <dt>Auto scratch 2P</dt>
          <dd>Plays the 2P side's scratch notes for you.</dd>
          <dt>GUIDE SE (beatoraja)</dt>
          <dd>
            Plays a sound for each judgment, from the sound set of a beatoraja theme (guide-pg.wav to guide-ms.wav). A
            set without them plays nothing. It follows the key sound volume and is read as the play starts.
          </dd>
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
          <dt>M-RAN 1P</dt>
          <dd>
            <em class="help-menu-when"
              >Shown with two-player play: Battle set to BATTLE (LR2), COUPLE or 2P PLAY (????).</em
            >
            Mirrors the 1P player's side after a RANDOM-type option.
          </dd>
          <dt>M-RAN 2P</dt>
          <dd>
            <em class="help-menu-when"
              >Shown with two-player play: Battle set to BATTLE (LR2), COUPLE or 2P PLAY (????).</em
            >
            Mirrors the 2P player's side after a RANDOM-type option.
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
            <em class="help-menu-when">Used with EXTRA MODE (LR2) on.</em> How dense EXTRA MODE may get at least: LEVEL
            1 to 3.
          </dd>
          <dt>LN MODE (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Shown with beatoraja rules.</em> How a chart that leaves its long-note type open
            plays: LN, CN or HCN.
          </dd>
          <dt>GAMBOL (LR2)</dt>
          <dd>
            <em class="help-menu-when">Shown with LR2 rules.</em> LR2's hidden option that narrows the judgment windows:
            LEVEL 1 fixes them at VERY HARD, LEVEL 2 also narrows GREAT and GOOD to 12 ms. The play is recorded as a
            normal one.
          </dd>
          <dt>CUSTOM JUDGE (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Shown with beatoraja rules.</em> Scales the judgment windows with the rates
            below.
          </dd>
          <dt>Key PGREAT %</dt>
          <dd>
            <em class="help-menu-when">Used with CUSTOM JUDGE on.</em> The width of the PGREAT window for key notes, as
            a percentage of the rules' own.
          </dd>
          <dt>Key GREAT %</dt>
          <dd>
            <em class="help-menu-when">Used with CUSTOM JUDGE on.</em> The width of the GREAT window for key notes, as a
            percentage of the rules' own.
          </dd>
          <dt>Key GOOD %</dt>
          <dd>
            <em class="help-menu-when">Used with CUSTOM JUDGE on.</em> The width of the GOOD window for key notes, as a
            percentage of the rules' own.
          </dd>
          <dt>Scratch PGREAT %</dt>
          <dd>
            <em class="help-menu-when">Used with CUSTOM JUDGE on.</em> The width of the PGREAT window for scratch notes,
            as a percentage of the rules' own.
          </dd>
          <dt>Scratch GREAT %</dt>
          <dd>
            <em class="help-menu-when">Used with CUSTOM JUDGE on.</em> The width of the GREAT window for scratch notes,
            as a percentage of the rules' own.
          </dd>
          <dt>Scratch GOOD %</dt>
          <dd>
            <em class="help-menu-when">Used with CUSTOM JUDGE on.</em> The width of the GOOD window for scratch notes,
            as a percentage of the rules' own.
          </dd>
          <dt>LN margin %</dt>
          <dd>
            <em class="help-menu-when">Used with CUSTOM JUDGE on.</em> How early a long note may be let go before its
            end and still count, as a percentage of the rules' own margin.
          </dd>
          <dt>PRACTICE</dt>
          <dd>
            beatoraja's PRACTICE, under every ruleset: a chart started with it on opens its score first. Press a bar to
            hear it, Shift-press or drag to pick a run of bars, then Start practice: the bars play again and again until
            Esc (no bars picked plays the whole chart). The dialog also sets the settings below, and Play without
            practice plays the chart as a regular play this time. A practice play saves no replay and no record, and is
            never sent to the Leaderboard.
          </dd>
          <dt>GAUGE TYPE</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on.</em> The gauge to practise on, one of the rules' own
            gauges.
          </dd>
          <dt>GAUGE CATEGORY</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on, under beatoraja rules.</em> The gauge's category, which
            picks its table.
          </dd>
          <dt>GAUGE VALUE</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on.</em> The gauge's value at the start of the practice.
          </dd>
          <dt>JUDGERANK (0 = chart)</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on, except under ???? rules.</em> The judge rank to practise
            with; 0 keeps the chart's. Under LR2 rules it reads on LR2's #RANK table (25, 50, 75 and 100 are VERY HARD
            to EASY).
          </dd>
          <dt>TOTAL (0 = chart)</dt>
          <dd>
            <em class="help-menu-when">Shown with PRACTICE on, except under ???? rules.</em> The TOTAL to practise with,
            which sets how fast the gauge rises; 0 keeps the chart's.
          </dd>
          <dt>EXTRA depth (beatoraja)</dt>
          <dd>beatoraja EXTRA: how many background keysounds per row become notes. 0 turns it off.</dd>
          <dt>EXTRA scratch (beatoraja)</dt>
          <dd>beatoraja EXTRA: whether the scratch lanes get added notes too.</dd>
          <dt>Long-note add rate (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Used with an ADD choice in Long notes.</em> How many of the notes become long
            notes, 0 to 1.
          </dd>
          <dt>Auto judge timing</dt>
          <dd>
            Moves Judge timing by itself from your hits in a manual play: beatoraja's way after every hit, or LR2's by 1
            ms every ten hits. LR2 SILENT also plays without the chart's sounds and BGA and hides the judgment.
          </dd>
          <dt>Judge timing (ms)</dt>
          <dd>Shifts when the notes are drawn, −500 to 500 ms. Input, audio and judgment stay as they are.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Replay / ghost</h4>
        <p class="help-menu-note">Inside Play options.</p>
        <dl class="help-menu-items">
          <dt>Tempo</dt>
          <dd>When on, a replay plays at the tempo it was recorded at; when off, at yours.</dd>
          <dt>Hi-speed</dt>
          <dd>When on, a replay scrolls at the recorded hi-speed; when off, at yours.</dd>
          <dt>SUDDEN+ / HIDDEN+</dt>
          <dd>When on, a replay shows the recorded SUDDEN+ and HIDDEN+ covers as they moved; when off, your own.</dd>
          <dt>LIFT</dt>
          <dd>When on, a replay raises the judge line as the recorded LIFT did; when off, by your own.</dd>
          <dt>Target (beatoraja)</dt>
          <dd>
            The score the pacemaker aims at: a rank border from A- to MAX-, MAX, or NEXT RANK, the first rank your best
            score has not reached. The IR targets read the chart's Leaderboard ranking: IR NEXT is that many places
            above you, IR RANK that place, and IR RANK TOP that share of the players down. They appear a moment into the
            play, and not on a chart without a ranking. SCORE RATE is the rate below. A ghost shown as the pacemaker
            takes its place. Changes live.
          </dd>
          <dt>Target score rate (%)</dt>
          <dd>The share of the maximum score the SCORE RATE target aims at. Changes live.</dd>
          <dt>Ghost</dt>
          <dd>
            Shows a recorded play with yours: your best, a replay slot, the Leaderboard's top run or a replay file. OFF
            shows none.
          </dd>
          <dt>Ghost mode</dt>
          <dd>
            How the ghost shows: as a second playfield, as a pacemaker, or as a pacemaker with its key presses over your
            lanes.
          </dd>
          <dt>Ghost status</dt>
          <dd>
            Whether the chart under the cursor would show the ghost picked, and why not when it would not (read-only).
          </dd>
          <dt>Ghost replay file…</dt>
          <dd>Picks the replay file the REPLAY FILE ghost plays.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">View</h4>
        <p class="help-menu-note">The View tab: what the lanes show. Locked during a play unless noted.</p>
        <dl class="help-menu-items">
          <dt>HS-FIX</dt>
          <dd>
            <em class="help-menu-when">Disabled while CLASSIC, Normal or FLOATING HI-SPEED is on.</em> Keeps the scroll
            speed steady against a BPM: MAXBPM, MINBPM, AVERAGE, STARTBPM, or CONSTANT (LR2, offered under every
            ruleset).
          </dd>
          <dt>Normal HI-SPEED (AC 32 measured)</dt>
          <dd>Picks the speed from twenty levels measured on AC, instead of the Hi-speed slider.</dd>
          <dt>Normal HS level</dt>
          <dd>
            <em class="help-menu-when">Used with Normal HI-SPEED on.</em> The level, 1 to 20; each scrolls at the green
            number AC measured for it.
          </dd>
          <dt>Fixed display area (AC 34)</dt>
          <dd>Ignores cover and LIFT changes during play; Enter twice restores the floating green number.</dd>
          <dt>FLOATING HI-SPEED (AC 32 measured)</dt>
          <dd>
            Keeps the green number while the covers move, by changing the hi-speed with them; Numpad 0 switches it
            during play.
          </dd>
          <dt>Floating speed</dt>
          <dd>
            <em class="help-menu-when">Used with FLOATING HI-SPEED on.</em> The hi-speed FLOATING starts from, in steps
            of 0.01.
          </dd>
          <dt>CLASSIC HI-SPEED</dt>
          <dd>Picks the speed from AC's eleven CLASSIC steps instead of the Hi-speed slider.</dd>
          <dt>Classic speed</dt>
          <dd><em class="help-menu-when">Used with CLASSIC HI-SPEED on.</em> The step, 1.0 to 4.0.</dd>
          <dt>Hi-speed</dt>
          <dd>
            <em class="help-menu-when">Disabled while CLASSIC, Normal or FLOATING HI-SPEED is on.</em> The scroll speed.
            Changes live, like ↑ / ↓ during play.
          </dd>
          <dt>Display area info</dt>
          <dd>
            Keeps showing the cover length and green number at the cover edges: OFF, ON, SUDDEN+ ONLY or HID+/LIFT ONLY.
          </dd>
          <dt>Effect 1P</dt>
          <dd>The 1P side's lane covers: OFF, HIDDEN, SUDDEN or HID+SUD.</dd>
          <dt>Effect 2P</dt>
          <dd>The 2P side's lane covers: OFF, HIDDEN, SUDDEN or HID+SUD.</dd>
          <dt>Lane cover</dt>
          <dd>Shows LR2's lane cover over the top of the lanes. Changes live.</dd>
          <dt>Cover height</dt>
          <dd>How much of the lane the lane cover hides, from 0 to 1. Changes live.</dd>
          <dt>LIFT 1P (beatoraja)</dt>
          <dd>Raises the 1P side's judge line. Changes live.</dd>
          <dt>LIFT 2P (beatoraja)</dt>
          <dd>Raises the 2P side's judge line. Changes live.</dd>
          <dt>LIFT height 1P</dt>
          <dd>How far LIFT raises the 1P judge line, as a fraction of the lane. Changes live.</dd>
          <dt>LIFT height 2P</dt>
          <dd>How far LIFT raises the 2P judge line, as a fraction of the lane. Changes live.</dd>
          <dt>BPM GUIDE (beatoraja)</dt>
          <dd>Shows upcoming BPM changes on the lanes.</dd>
          <dt>BPM change warning (AC)</dt>
          <dd>
            Shows <code>current » next</code> BPM in a box on the lanes for 2 seconds before each BPM change: blue when
            it speeds up, red when it slows down.
          </dd>
          <dt>Visual CONSTANT (beatoraja)</dt>
          <dd>Shows each note only for its last moments before the judge line, whatever the hi-speed.</dd>
          <dt>Note duration (ms)</dt>
          <dd>How long a note shows before the judge line under Visual CONSTANT. Changes live.</dd>
          <dt>CONSTANT fade (ms)</dt>
          <dd>How long a note takes to fade in at the edge of the range Visual CONSTANT shows. Changes live.</dd>
          <dt>Judged notes</dt>
          <dd>Whether a judged note keeps scrolling until its time (as in LR2) or disappears.</dd>
          <dt>Lane brightness (AC)</dt>
          <dd>How bright the lanes are, in percent. Notes, bar lines and covers keep their own. Changes live.</dd>
          <dt>Judgment display (AC)</dt>
          <dd>OFF draws no judgment or combo on the play screen. Changes live.</dd>
          <dt>Judge detail (built-in skins)</dt>
          <dd>
            Shows a judgment's timing above it on the built-in skins: FAST or SLOW, or the offset in milliseconds
            (negative early, positive late). Changes live.
          </dd>
          <dt>Judge detail: keys and scratch apart</dt>
          <dd>Shows the scratch's last timing and the keys' side by side, so one does not replace the other.</dd>
          <dt>Judgment counts (built-in skins)</dt>
          <dd>Off draws no judgment counts, FAST / SLOW counts or timing meter during the play. Changes live.</dd>
          <dt>Judgment position (built-in skins, %)</dt>
          <dd>
            Moves the built-in skins' judgment and combo up (-) or down (+) the lanes, in percent of their height. They
            stay inside the lanes. LR2 and beatoraja skins keep their own placement. Changes live.
          </dd>
          <dt>Show judge area (beatoraja)</dt>
          <dd>
            Draws the judgment windows as coloured bands above the judge line: blue for PGREAT, then green, yellow,
            orange and red. A note inside a band would get that judgment if pressed now. Changes live.
          </dd>
          <dt>Mark processed notes (beatoraja)</dt>
          <dd>
            Draws a note that was already judged with the skin's processed-note image, or dimmed where a skin has none,
            until it goes. Changes live.
          </dd>
          <dt>Auto scratch notes (AC)</dt>
          <dd>Whether the scratch notes AUTO SCRATCH plays are drawn. Changes live; the notes still play and count.</dd>
          <dt>LR2 mania options</dt>
          <dd>
            LR2's hidden panel options that only change how notes are drawn: ACCELERATION, EARTHQUAKE, TORNADO,
            SUPERLOOP, CHAR, HEARTBEAT, NABEATSU, SINCURVE, WAVE, SPIRAL effect, SIDEJUMP. ACCELERATION picks a mode; an
            option with a slider is off at 0 and strongest at 100. They change live and leave judgment and records as
            they are; beatoraja skins do not draw the per-note ones.
          </dd>
          <dt>Show invisible notes</dt>
          <dd>Shows hidden keysound objects. Changes live; judgment is unchanged.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Key config</h4>
        <p class="help-menu-note">
          The Keys tab. Click a row's key, then press the key to give it; Esc cancels. A key another lane of the page
          has moves to that lane's old key, and a key another operation of the same screen has is refused. Esc, Pause,
          F5, Backspace and the up / down arrows stay the play's. Read as a play starts, so locked during one.
        </p>
        <dl class="help-menu-items">
          ${laneKeyHelp('en')}
          <dt>1P START</dt>
          <dd>
            The 1P side's START, Q by default as in LR2. The screens read it with the lane keys, so no lane can share
            its key.
          </dd>
          <dt>1P SELECT</dt>
          <dd>
            The 1P side's SELECT, W by default as in LR2. The screens read it with the lane keys, so no lane can share
            its key.
          </dd>
          <dt>2P START</dt>
          <dd>
            The 2P side's START, O by default as in LR2. The screens read it with the lane keys, so no lane can share
            its key.
          </dd>
          <dt>2P SELECT</dt>
          <dd>
            The 2P side's SELECT, P by default as in LR2. The screens read it with the lane keys, so no lane can share
            its key.
          </dd>
          <dt>Built-in skin controls</dt>
          <dd>
            Whose keys the built-in skins' screens read: LR2's or beatoraja's. An LR2 or beatoraja skin always reads its
            own.
          </dd>
          ${screenKeyHelp('en')}
          <dt>Reset screen keys to defaults</dt>
          <dd>Puts every operation back on its default keys.</dd>
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
          <dt>Table URL</dt>
          <dd>The URL of a difficulty table whose courses to import.</dd>
          <dt>Import table courses</dt>
          <dd>Imports the courses of the table at Table URL; it is imported again on later visits.</dd>
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
          <dt>Built-in skin</dt>
          <dd>(Built-in tab) The built-in skin: Synesthesia, Plain or Native.</dd>
          <dt>Skin effects</dt>
          <dd>(Built-in tab) How much animation the built-in skins draw: Full, Reduced or Off.</dd>
          <dt>Skin settings</dt>
          <dd>(Built-in tab) The selected skin's own settings, with Reset to defaults.</dd>
          <dt>Load LR2 skin…</dt>
          <dd>(LR2 tab) Asks for an LR2 theme to drop or pick, and loads it.</dd>
          <dt>LR2 theme</dt>
          <dd>(LR2 tab) Picks among the LR2 themes loaded.</dd>
          <dt>Load beatoraja skin…</dt>
          <dd>(beatoraja tab) Asks for beatoraja skins to drop or pick, and loads them.</dd>
          <dt>Beatoraja skins</dt>
          <dd>(beatoraja tab) Picks the beatoraja skin for each screen and key mode.</dd>
          <dt>Render resolution</dt>
          <dd>
            How sharply the canvas draws, from 0.5× up to the display's pixel ratio; lower it if the frame rate drops.
            Below 1× the picture softens, for GPUs that cannot keep up even at 1×.
          </dd>
          <dt>Auto-detect resolution</dt>
          <dd>Measures the frame rate at each resolution on the screen showing and keeps the highest that holds it.</dd>
          <dt>Renderer (applies on reload)</dt>
          <dd>
            WebGL 2 (the default) or WebGPU. WebGL 2 keeps up best on most laptops' integrated graphics; the pick takes
            effect the next time the player loads.
          </dd>
          <dt>Play layout</dt>
          <dd>Auto, Desktop or Touch (on-screen lanes and buttons).</dd>
          <dt>Toggle fullscreen</dt>
          <dd>Enters or leaves fullscreen.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Audio</h4>
        <dl class="help-menu-items">
          <dt>Mute</dt>
          <dd>Silences the player, keeping the volumes for when it is turned off.</dd>
          <dt>Master (%)</dt>
          <dd>The volume of everything the player plays.</dd>
          <dt>Key sound (%)</dt>
          <dd>The volume of the sounds your key presses play.</dd>
          <dt>BGM (%)</dt>
          <dd>The volume of the chart's background sounds.</dd>
          <dt>Play in silent mode</dt>
          <dd>Plays sound with an iPhone's silent switch on (where the browser allows it).</dd>
          <dt>Peak gain (next play)</dt>
          <dd>From the next play, raises the volume so the loudest peak is near −3 dBFS.</dd>
          <dt>Compressor</dt>
          <dd>
            Evens out loud keysounds and BGM: turn it on, pick the stages, and tune each compressor (with a reset).
          </dd>
          <dt>Enabled</dt>
          <dd>(Compressor) Turns the compressor on. Applies live.</dd>
          <dt>Key</dt>
          <dd>(Stages) Whether the split compressor's key sound stage runs. Applies live.</dd>
          <dt>BGM</dt>
          <dd>(Stages) Whether the split compressor's BGM stage runs. Applies live.</dd>
          <dt>Master</dt>
          <dd>(Stages) Whether the split compressor's stage on the whole mix runs. Applies live.</dd>
          <dt>Threshold (dB)</dt>
          <dd>(Compressor) The level above which the compressor turns the sound down. Retunes a running chart live.</dd>
          <dt>Knee (dB)</dt>
          <dd>(Compressor) How gradually it starts compressing around the threshold.</dd>
          <dt>Ratio (x:1)</dt>
          <dd>(Compressor) How much it turns down what goes over the threshold: 4 lets 1 dB through for every 4.</dd>
          <dt>Attack (ms)</dt>
          <dd>(Compressor) How fast it turns a loud sound down.</dd>
          <dt>Release (ms)</dt>
          <dd>(Compressor) How fast it lets the sound back up after a loud one.</dd>
          <dt>Reset to default</dt>
          <dd>(Compressor) Puts this compressor's settings back.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">BGA camera</h4>
        <dl class="help-menu-items">
          <dt>Show camera in BGA</dt>
          <dd>
            Shows a camera in the play's BGA frame instead of the chart's BGA, with any skin: to show your hands on the
            keys, or your face when you stream. The camera opens only during a play with this on, and closes on every
            other screen. You can turn it on or off during a play. The picture is not sent anywhere, but a video
            recorded with Capture includes it, since it records the BGA frame.
          </dd>
          <dt>Camera</dt>
          <dd>
            Which camera to show; the default is the browser's default camera. The pick is remembered on this device. If
            the camera is unplugged or its permission is taken back, the play shows the BGA again.
          </dd>
          <dt>Allow camera access</dt>
          <dd>Asks the browser for the camera once, so the list shows the cameras by name. The camera closes again.</dd>
          <dt>Mirror camera</dt>
          <dd>Flips the picture left to right, as a mirror shows it; a camera filming your hands may need it.</dd>
          <dt>Preview camera</dt>
          <dd>
            Shows the picked camera here, as the BGA frame would show it, so you can frame it before a play. The camera
            opens only for the preview, and stops when you press Stop preview, leave this tab or close Options.
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Library &amp; records</h4>
        <dl class="help-menu-items">
          <dt>Music ZIP URL</dt>
          <dd>The URL of a chart ZIP to load, as <code>?music=</code> does.</dd>
          <dt>Skin ZIP URL</dt>
          <dd>The URL of a skin ZIP to load, as <code>?skin=</code> does.</dd>
          <dt>Load from URLs</dt>
          <dd>Loads the ZIPs at the two URLs above.</dd>
          <dt>Auto-save replays</dt>
          <dd>Downloads each finished play's replay.</dd>
          <dt>Clear best records</dt>
          <dd>Deletes the best records kept in this browser (asks first).</dd>
          <dt>Local data…</dt>
          <dd>
            Shows what the player keeps in this browser: its localStorage keys, its IndexedDB databases (your courses,
            the replay slots, the parsed charts) and how much space they use. It only reads; clear data from its own
            controls.
          </dd>
          <dt>Slot 1 auto-save</dt>
          <dd>
            (Replay slots) When a result saves its replay into slot 1, by beatoraja's rules: a better (or equal) EX
            score, BP, max combo or clear lamp, any of them, always, or never. Saving by hand (key 1) works whatever it
            says.
          </dd>
          <dt>Slot 2 auto-save</dt>
          <dd>
            (Replay slots) When a result saves its replay into slot 2, from the same choices as slot 1. Saving by hand
            (key 2) works whatever it says.
          </dd>
          <dt>Slot 3 auto-save</dt>
          <dd>
            (Replay slots) When a result saves its replay into slot 3, from the same choices as slot 1. Saving by hand
            (key 3) works whatever it says.
          </dd>
          <dt>Slot 4 auto-save</dt>
          <dd>
            (Replay slots) When a result saves its replay into slot 4, from the same choices as slot 1. Saving by hand
            (key 4) works whatever it says.
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Select</h4>
        <p class="help-menu-note">
          In the Library tab. The select screen's list; a play does not read them, so they change any time.
        </p>
        <dl class="help-menu-items">
          <dt>Sort</dt>
          <dd>How the built-in and LR2 select screens order the list.</dd>
          <dt>Key filter</dt>
          <dd>Which key modes the built-in and LR2 select screens list.</dd>
          <dt>Difficulty filter</dt>
          <dd>Which difficulties the built-in and LR2 select screens list.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Capture</h4>
        <dl class="help-menu-items">
          <dt>● Record gameplay video</dt>
          <dd>Records the next play as a video to download. A camera shown in the BGA frame is recorded too.</dd>
          <dt>Video format</dt>
          <dd>The video's container and codec: MP4 · H.264 by default, or MP4 / WebM with H.265, AV1, VP9 or VP8.</dd>
          <dt>📸 Screenshot</dt>
          <dd>Saves the screen as a PNG.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Leaderboard</h4>
        <dl class="help-menu-items">
          <dt>Submit to Leaderboard</dt>
          <dd>Sends each finished play to the Leaderboard (off by default).</dd>
          <dt>Submit when</dt>
          <dd>
            Sends a play only when it beats your best EX-SCORE on the chart, its first play always (default), or every
            play. Course runs are always sent.
          </dd>
          <dt>Account</dt>
          <dd>Who is signed in to the Leaderboard (read-only).</dd>
          <dt>Keep this account</dt>
          <dd>
            Keeps a guest account with a passkey, Google or Discord, so other devices can sign in to it and rankings
            list it.
          </dd>
          <dt>Sign in</dt>
          <dd>Signs in to the Leaderboard through Accounts.</dd>
          <dt>Sign out</dt>
          <dd>Signs out of the Leaderboard.</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Advanced</h4>
        <dl class="help-menu-items">
          <dt>CPU workers</dt>
          <dd>How many workers load charts and stretch audio in parallel.</dd>
          <dt>Auto pause on blur</dt>
          <dd>Pauses the play when the page loses focus.</dd>
          <dt>FPS</dt>
          <dd>The frame rate graph.</dd>
          <dt>BGA video transcode</dt>
          <dd>Whether BGA videos are converted with WebCodecs, and the size they are reduced to.</dd>
          <dt>Use WebCodecs encoder</dt>
          <dd>
            (BGA video transcode) Converts BGA videos with the browser's WebCodecs encoder where it has one. Applies
            from the next chart.
          </dd>
          <dt>Resize</dt>
          <dd>
            (BGA video transcode) The size BGA videos are shrunk to; Off keeps theirs. Applies from the next chart.
          </dd>
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
    ${OPTIONS_HELP_JA}
  </div>
`;
