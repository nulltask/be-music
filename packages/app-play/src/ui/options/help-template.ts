import { html, type TemplateResult } from 'lit';
import { CONTROL_ACTIONS, type ControlActionDefinition, type ControlScreen } from '@be-music/player-browser/host';
import { LANE_KEY_CONFIG, type LaneKeyConfigLane, type LaneKeyGroup } from '@be-music/player-engine/lanes';
import { ACTION_LABELS_JA, actionKeyConfigLabel, laneKeyConfigLabel, schemesOf } from './action-labels.ts';

type HelpLang = 'en' | 'ja';

/** What a lane's row says it sets: the lane it plays, in its key config group. */
function laneKeyHelpText(group: LaneKeyGroup, lane: LaneKeyConfigLane, lang: HelpLang): string {
  if (group === 'popn') {
    return lang === 'ja'
      ? `9 KEY で ${lane.id} 番のボタンを押すキー。`
      : `The key that plays button ${lane.id} in 9 KEY.`;
  }
  if (lane.scratch) {
    return lang === 'ja'
      ? `5 / 7 / 10 / 14 KEY で ${lane.side} 側の皿を回すキー。Ctrl (1P 側は Space も) は皿の 2 つ目のキーのままです。`
      : `The key that turns the ${lane.side} turntable in 5 / 7 / 10 / 14 KEY. Ctrl (and Space on 1P) stays its second key.`;
  }
  const number = laneKeyConfigLabel(group, lane).split(' ').at(-1);
  return lang === 'ja'
    ? `5 / 7 / 10 / 14 KEY で ${lane.side} 側の ${number} 番の鍵盤を押すキー。`
    : `The key that plays the ${lane.side} side's key ${number} in 5 / 7 / 10 / 14 KEY.`;
}

/** An entry per lane of the key config, each naming the lane it sets. */
function laneKeyHelp(lang: HelpLang): TemplateResult[] {
  return (['beat', 'popn'] as const).flatMap((group) =>
    LANE_KEY_CONFIG[group].map(
      (lane) =>
        html`<dt>${laneKeyConfigLabel(group, lane)}</dt>
          <dd>${laneKeyHelpText(group, lane, lang)}</dd>`,
    ),
  );
}

const SCREEN_PHRASES: Readonly<Record<HelpLang, Readonly<Record<ControlScreen, string>>>> = {
  en: {
    global: 'every screen',
    select: 'the select screen',
    decide: 'the decide screen',
    play: 'the play screen',
    result: 'the result screen',
  },
  ja: { global: 'すべての画面', select: '選曲画面', decide: '決定画面', play: 'プレイ画面', result: 'リザルト画面' },
};

/** What an operation's row says it sets: the operation and its screen, and the key map it is on when only one has it. */
export function screenKeyHelpText(definition: ControlActionDefinition, lang: HelpLang): string {
  const schemes = schemesOf(definition);
  const only = schemes.length === 1 ? (schemes[0] === 'lr2' ? 'LR2' : 'beatoraja') : undefined;
  const screen = SCREEN_PHRASES[lang][definition.screen];
  if (lang === 'ja') {
    const name = ACTION_LABELS_JA[definition.label] ?? definition.label;
    return `${screen}で「${name}」を行うキー。${only === undefined ? '' : `${only} のキー操作だけにあります。`}`;
  }
  return `The keys for “${definition.label}” on ${screen}.${only === undefined ? '' : ` Only ${only}'s key map has it.`}`;
}

/** An entry per operation of the Screens page. */
function screenKeyHelp(lang: HelpLang): TemplateResult[] {
  return CONTROL_ACTIONS.map((action) => {
    const definition = action as ControlActionDefinition;
    return html`<dt>${actionKeyConfigLabel(definition)}</dt>
      <dd>${screenKeyHelpText(definition, lang)}</dd>`;
  });
}

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
          <dt>Scroll (beatoraja)</dt>
          <dd>
            REMOVE draws the chart without its BPM and scroll changes; ADD adds random scroll changes. Judgment is
            unchanged.
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
          <dt>Auto scratch notes (AC)</dt>
          <dd>Whether the scratch notes AUTO SCRATCH plays are drawn. Changes live; the notes still play and count.</dd>
          <dt>LR2 mania options</dt>
          <dd>
            LR2's hidden panel options that only change how notes are drawn: ACCELERATION, EARTHQUAKE, TORNADO,
            SUPERLOOP. ACCELERATION picks a mode; an option with a slider is off at 0 and strongest at 100. They change
            live and leave judgment and records as they are; beatoraja skins do not draw the per-note ones.
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
    <div class="help-lang" data-lang="ja" hidden>
      <h3 class="help-section-title">Options</h3>
      <ul class="help-list">
        <li>
          右上の <strong>Settings</strong> ボタン (歯車) で Options が開きます。タブごとに Play、View、Keys、Skin、
          Audio、Library、Leaderboard、Advanced の設定がまとまっています。Play options と View
          は項目が多いのでページに分かれています。各項目の横の <strong>?</strong> にカーソルを合わせると説明が出ます。
        </li>
        <li>
          設定はすべてこのブラウザに記憶され、次に開いたときに元に戻ります。<strong
            >Advanced → Reset settings and reload</strong
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
        <p class="help-menu-note">Library タブの最上部。</p>
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
          で決まります。「…のときに表示」とある項目は、その条件で表示されます。「…のときに使います」とある項目は、その条件で設定できるようになり、それまでは同じ場所に無効のまま表示されます。
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
          <dt>Random 1P</dt>
          <dd>
            1P 側のレーンのオプション (1
            人プレイではこちらだけ)。どのオプションもどのルールでも選べ、その出典のアルゴリズムで動きます。出典ごとにまとめ、ルール自身の出典を先頭に並べます。S-RANDOM
            と CONVERGE は出典ごとに中身が違うため、LR2 と ???? で共通の S-RANDOM (LR2 / ????) と S-RANDOM (beatoraja)
            のように出典ごとに 1 つずつ並びます。RANDOM はどの出典でも同じなので 1 つだけです。
          </dd>
          <dt>Random 2P</dt>
          <dd>DP や 2 人プレイでの 2P 側のレーンのオプション。Random 1P と同じ一覧から選びます。</dd>
          <dt>H-RANDOM threshold BPM (beatoraja)</dt>
          <dd>H-RANDOM、ALL-SCR、7-to-9 のスクラッチで、連打とみなす 16 分音符の BPM。</dd>
          <dt>Fixed key 1P (LR2; 0=default)</dt>
          <dd>LR2 の CONVERGE で 1P 側のノーツを集めるレーン。0 はモードの既定。</dd>
          <dt>Fixed key 2P (LR2; 0=default)</dt>
          <dd>
            LR2 の CONVERGE と CONVERGE corrected で 2P 側のノートを集めるレーン。0 はモードの既定。RANDOM
            では使いません。
          </dd>
          <dt>Seed 1P (-1=random)</dt>
          <dd>
            どのルールでも使う 1P 側のレーンのランダムのシード。固定すると同じ配置になります。-1
            ならプレイごとに新しく決めます。シードを使わない RANDOM_PLAYABLE では隠れます。
          </dd>
          <dt>Seed 2P (-1=random)</dt>
          <dd>2P 側のレーンのランダムのシード。Seed 1P と同じく、-1 ならプレイごとに新しく決めます。</dd>
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
          <dt>Scroll section lines</dt>
          <dd>
            <em class="help-menu-when">Scroll が ADD のときに使います。</em> スクロールの変化 1 回が続く小節線の数。
          </dd>
          <dt>Scroll rate</dt>
          <dd>
            <em class="help-menu-when">Scroll が ADD のときに使います。</em> スクロールの変化の強さ。0 (なし) 〜 1。
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
          <dt>Auto scratch 1P</dt>
          <dd>1P 側のスクラッチを自動で処理します。</dd>
          <dt>Auto scratch 2P</dt>
          <dd>2P 側のスクラッチを自動で処理します。</dd>
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
          <dt>M-RAN 1P</dt>
          <dd>
            <em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2)、COUPLE、2P PLAY (????)) のときに表示。</em>
            RANDOM 系のオプションのあと、1P のプレイヤーの側を左右反転します。
          </dd>
          <dt>M-RAN 2P</dt>
          <dd>
            <em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2)、COUPLE、2P PLAY (????)) のときに表示。</em>
            RANDOM 系のオプションのあと、2P のプレイヤーの側を左右反転します。
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
            <em class="help-menu-when">EXTRA MODE (LR2) がオンのときに使います。</em> EXTRA MODE の最低の密度。LEVEL
            1〜3。
          </dd>
          <dt>LN MODE (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">beatoraja のルールのときに表示。</em> ロングノートの種類を決めていない譜面を
            LN、CN、HCN のどれで遊ぶか。
          </dd>
          <dt>CUSTOM JUDGE (beatoraja)</dt>
          <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> 下の倍率で判定の幅を変えます。</dd>
          <dt>Key PGREAT %</dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> 鍵盤の PGREAT の判定幅
            (ルール本来の幅に対する割合)。
          </dd>
          <dt>Key GREAT %</dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> 鍵盤の GREAT の判定幅
            (ルール本来の幅に対する割合)。
          </dd>
          <dt>Key GOOD %</dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> 鍵盤の GOOD の判定幅
            (ルール本来の幅に対する割合)。
          </dd>
          <dt>Scratch PGREAT %</dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> スクラッチの PGREAT の判定幅
            (ルール本来の幅に対する割合)。
          </dd>
          <dt>Scratch GREAT %</dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> スクラッチの GREAT の判定幅
            (ルール本来の幅に対する割合)。
          </dd>
          <dt>Scratch GOOD %</dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> スクラッチの GOOD の判定幅
            (ルール本来の幅に対する割合)。
          </dd>
          <dt>LN margin %</dt>
          <dd>
            <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em>
            ロングノートを終わりより早く離しても成功とする余裕 (ルール本来の余裕に対する割合)。
          </dd>
          <dt>PRACTICE</dt>
          <dd>
            beatoraja の PRACTICE を、どのルールでも使えます。オンにして選曲すると、まず譜面を表示します。小節を押すと
            その小節を試聴し、Shift
            を押しながら押すかドラッグすると連続した小節を選べます。「練習を始める」を押すと、選んだ小節を Esc
            を押すまで繰り返します
            (小節を選ばなければ譜面全体)。下の設定もダイアログで変えられ、「練習せずに遊ぶ」では今回は通常のプレイになります。練習のプレイはリプレイも記録も残さず、Leaderboard
            にも送りません。
          </dd>
          <dt>GAUGE TYPE</dt>
          <dd><em class="help-menu-when">PRACTICE がオンのときに表示。</em> 練習で使うゲージ (そのルールのゲージ)。</dd>
          <dt>GAUGE CATEGORY</dt>
          <dd>
            <em class="help-menu-when">PRACTICE がオンで、beatoraja のルールのときに表示。</em>
            ゲージのカテゴリ。使う表が決まります。
          </dd>
          <dt>GAUGE VALUE</dt>
          <dd><em class="help-menu-when">PRACTICE がオンのときに表示。</em> 練習を始めるときのゲージの値。</dd>
          <dt>JUDGERANK (0 = chart)</dt>
          <dd>
            <em class="help-menu-when">PRACTICE がオンのときに表示 (???? のルールでは表示しません)。</em>
            練習で使う判定ランク。0 なら譜面の値。LR2 のルールでは LR2 の #RANK の表で読みます (25・50・75・100 が VERY
            HARD〜EASY)。
          </dd>
          <dt>TOTAL (0 = chart)</dt>
          <dd>
            <em class="help-menu-when">PRACTICE がオンのときに表示 (???? のルールでは表示しません)。</em> 練習で使う
            TOTAL (ゲージの増え方)。0 なら譜面の値。
          </dd>
          <dt>EXTRA depth (beatoraja)</dt>
          <dd>beatoraja の EXTRA。1 行あたり何個の BGM のキー音をノーツにするか。0 でオフ。</dd>
          <dt>EXTRA scratch (beatoraja)</dt>
          <dd>beatoraja の EXTRA。スクラッチのレーンにもノーツを足すか。</dd>
          <dt>Long-note add rate (beatoraja)</dt>
          <dd>
            <em class="help-menu-when">Long notes が ADD のどれかのときに使います。</em> ロングノートにする割合 (0〜1)。
          </dd>
          <dt>Auto judge timing</dt>
          <dd>
            手で遊んだときの叩いたタイミングから、Judge timing を自動で調整します。beatoraja の方式は 1 打ごとに、LR2
            の方式は 10 打ごとに 1 ミリ秒ずつ動かします。LR2 SILENT では譜面の音と BGA なしで遊び、判定も表示しません。
          </dd>
          <dt>Judge timing (ms)</dt>
          <dd>ノーツを描くタイミングをずらします (−500〜500 ミリ秒)。入力、音、判定はそのままです。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Replay / ghost</h4>
        <p class="help-menu-note">Play options の中。</p>
        <dl class="help-menu-items">
          <dt>Tempo</dt>
          <dd>オンならリプレイは録画時のテンポで、オフなら自分のテンポで再生します。</dd>
          <dt>Hi-speed</dt>
          <dd>オンならリプレイは録画時のハイスピードで、オフなら自分のハイスピードで流れます。</dd>
          <dt>SUDDEN+ / HIDDEN+</dt>
          <dd>オンならリプレイは録画時の SUDDEN+ / HIDDEN+ の動きを見せ、オフなら自分のカバーで見せます。</dd>
          <dt>LIFT</dt>
          <dd>オンならリプレイは録画時の LIFT で判定ラインを上げ、オフなら自分の LIFT で上げます。</dd>
          <dt>Ghost</dt>
          <dd>
            記録されたプレイを自分のプレイと一緒に見せます。自己ベスト、リプレイスロット、Leaderboard の 1
            位、リプレイファイルから選びます。OFF なら見せません。
          </dd>
          <dt>Ghost mode</dt>
          <dd>
            ゴーストの見せ方。2
            つ目のプレイフィールド、ペースメーカー、押下を自分のレーンに重ねるペースメーカーから選びます。
          </dd>
          <dt>Ghost status</dt>
          <dd>カーソルの譜面で選んだゴーストを見せられるか、見せられないときはその理由 (読み取り専用)。</dd>
          <dt>Ghost replay file…</dt>
          <dd>REPLAY FILE のゴーストが再生するリプレイファイルを選びます。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">View</h4>
        <p class="help-menu-note">View タブ: レーンの見え方。特に書かない限りプレイ中は変えられません。</p>
        <dl class="help-menu-items">
          <dt>HS-FIX</dt>
          <dd>
            <em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は無効。</em> BPM
            に合わせてスクロール速度を一定に保ちます。MAXBPM、MINBPM、AVERAGE、STARTBPM、CONSTANT
            (LR2。どのルールでも選べます)。
          </dd>
          <dt>Normal HI-SPEED (AC 32 measured)</dt>
          <dd>Hi-speed のスライダーの代わりに、AC で実測した 20 段階から速度を選びます。</dd>
          <dt>Normal HS level</dt>
          <dd>
            <em class="help-menu-when">Normal HI-SPEED がオンのときに使います。</em> レベル (1〜20)。それぞれ AC
            で実測した緑数字で流れます。
          </dd>
          <dt>Fixed display area (AC 34)</dt>
          <dd>プレイ中のカバーと LIFT の変更を受け付けません。Enter 2 回でフローティングの緑数字に戻します。</dd>
          <dt>FLOATING HI-SPEED (AC 32 measured)</dt>
          <dd>
            カバーを動かしても、ハイスピードを合わせて変えて緑数字を保ちます。プレイ中はテンキーの 0 で切り替えます。
          </dd>
          <dt>Floating speed</dt>
          <dd>
            <em class="help-menu-when">FLOATING HI-SPEED がオンのときに使います。</em> FLOATING の起点のハイスピード
            (0.01 刻み)。
          </dd>
          <dt>CLASSIC HI-SPEED</dt>
          <dd>Hi-speed のスライダーの代わりに、AC の CLASSIC の 11 段階から速度を選びます。</dd>
          <dt>Classic speed</dt>
          <dd><em class="help-menu-when">CLASSIC HI-SPEED がオンのときに使います。</em> 段階 (1.0〜4.0)。</dd>
          <dt>Hi-speed</dt>
          <dd>
            <em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は無効。</em>
            スクロールの速さ。プレイ中の ↑ / ↓ と同じく、すぐ反映されます。
          </dd>
          <dt>Display area info</dt>
          <dd>カバーの長さと緑数字をカバーの端に表示し続けます。OFF、ON、SUDDEN+ ONLY、HID+/LIFT ONLY。</dd>
          <dt>Effect 1P</dt>
          <dd>1P 側のレーンカバー。OFF、HIDDEN、SUDDEN、HID+SUD。</dd>
          <dt>Effect 2P</dt>
          <dd>2P 側のレーンカバー。OFF、HIDDEN、SUDDEN、HID+SUD。</dd>
          <dt>Lane cover</dt>
          <dd>レーンの上に LR2 のレーンカバーを出します。プレイ中にも変えられます。</dd>
          <dt>Cover height</dt>
          <dd>レーンカバーがレーンを隠す割合 (0〜1)。プレイ中にも変えられます。</dd>
          <dt>LIFT 1P (beatoraja)</dt>
          <dd>1P 側の判定ラインを上げます。プレイ中にも変えられます。</dd>
          <dt>LIFT 2P (beatoraja)</dt>
          <dd>2P 側の判定ラインを上げます。プレイ中にも変えられます。</dd>
          <dt>LIFT height 1P</dt>
          <dd>LIFT で 1P 側の判定ラインを上げる高さ (レーンに対する割合)。プレイ中にも変えられます。</dd>
          <dt>LIFT height 2P</dt>
          <dd>LIFT で 2P 側の判定ラインを上げる高さ (レーンに対する割合)。プレイ中にも変えられます。</dd>
          <dt>BPM GUIDE (beatoraja)</dt>
          <dd>これから来る BPM の変化をレーン上に表示します。</dd>
          <dt>BPM change warning (AC)</dt>
          <dd>
            BPM が変わる 2 秒前から、レーン上の箱に
            <code>今の BPM » 次の BPM</code> を表示します。速くなるときは青、遅くなるときは赤です。
          </dd>
          <dt>Visual CONSTANT (beatoraja)</dt>
          <dd>ハイスピードによらず、ノーツを判定ラインに届く直前の間だけ表示します。</dd>
          <dt>Note duration (ms)</dt>
          <dd>Visual CONSTANT で、ノーツを判定ラインの前に表示する時間。プレイ中にも変えられます。</dd>
          <dt>CONSTANT fade (ms)</dt>
          <dd>Visual CONSTANT で、表示範囲の境目でノーツがフェードインする時間。プレイ中にも変えられます。</dd>
          <dt>Judged notes</dt>
          <dd>判定したノーツを本来の時刻まで流す (LR2 と同じ) か、消すか。</dd>
          <dt>Auto scratch notes (AC)</dt>
          <dd>
            AUTO SCRATCH が演奏するスクラッチのノーツを表示するか。プレイ中にも切り替えられ、演奏と記録は変わりません。
          </dd>
          <dt>LR2 mania options</dt>
          <dd>
            LR2 の隠しパネルにある、ノーツの描画だけを変えるオプションです: ACCELERATION, EARTHQUAKE, TORNADO,
            SUPERLOOP。 ACCELERATION はモードを選び、スライダーのものは 0 でオフ、100 で最も強くなります。プレイ中にも
            切り替えられ、判定と記録は変わりません。ノーツ単位の演出は beatoraja スキンでは描画しません。
          </dd>
          <dt>Show invisible notes</dt>
          <dd>不可視オブジェクトを表示します。プレイ中にも切り替えられ、判定は変わりません。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Key config</h4>
        <p class="help-menu-note">
          Keys タブ。行のキーをクリックしてから、割り当てたいキーを押します。Esc
          で取り消し。そのページのほかのレーンが使っているキーなら、そのレーンには元のキーが入れ替わりで入り、同じ画面のほかの操作が使っているキーは使えません。Esc、Pause、F5、Backspace、上下の矢印はプレイ用です。プレイの開始時に読むので、プレイ中は変えられません。
        </p>
        <dl class="help-menu-items">
          ${laneKeyHelp('ja')}
          <dt>1P START</dt>
          <dd>
            1P 側の START。既定は LR2 と同じ Q。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
          </dd>
          <dt>1P SELECT</dt>
          <dd>
            1P 側の SELECT。既定は LR2 と同じ
            W。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
          </dd>
          <dt>2P START</dt>
          <dd>
            2P 側の START。既定は LR2 と同じ O。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
          </dd>
          <dt>2P SELECT</dt>
          <dd>
            2P 側の SELECT。既定は LR2 と同じ
            P。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
          </dd>
          <dt>Built-in skin controls</dt>
          <dd>
            内蔵スキンの画面がどちらのキー操作に従うか: LR2 か beatoraja。LR2 スキンと beatoraja
            スキンは常にそれぞれのキー操作に従います。
          </dd>
          ${screenKeyHelp('ja')}
          <dt>Reset screen keys to defaults</dt>
          <dd>すべての操作を既定のキーに戻します。</dd>
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
          <dt>Table URL</dt>
          <dd>コースを読み込む難易度表の URL。</dd>
          <dt>Import table courses</dt>
          <dd>Table URL の難易度表からコースを読み込みます。次に開いたときにも読み込みます。</dd>
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
          <dt>Built-in skin</dt>
          <dd>(Built-in タブ) 使う内蔵スキン。Synesthesia、Plain、Native。</dd>
          <dt>Skin effects</dt>
          <dd>(Built-in タブ) 内蔵スキンの演出の量。Full、Reduced、Off。</dd>
          <dt>Skin settings</dt>
          <dd>(Built-in タブ) 選んだスキンの設定。Reset to defaults で既定値に戻せます。</dd>
          <dt>Load LR2 skin…</dt>
          <dd>(LR2 タブ) LR2 のテーマのドロップか選択を促し、読み込みます。</dd>
          <dt>LR2 theme</dt>
          <dd>(LR2 タブ) 読み込んだ LR2 のテーマから選びます。</dd>
          <dt>Load beatoraja skin…</dt>
          <dd>(beatoraja タブ) beatoraja のスキンのドロップか選択を促し、読み込みます。</dd>
          <dt>Beatoraja skins</dt>
          <dd>(beatoraja タブ) 画面とキーモードごとに beatoraja のスキンを選びます。</dd>
          <dt>Render resolution</dt>
          <dd>
            キャンバスを描く解像度 (0.5× から画面のピクセル比まで)。フレームレートが落ちるときは下げます。1×
            未満は画がぼやけますが、1× でも追いつかない GPU 向けです。
          </dd>
          <dt>Auto-detect resolution</dt>
          <dd>表示中の画面で解像度ごとにフレームレートを測り、保てるいちばん高い解像度にします。</dd>
          <dt>Renderer (applies on reload)</dt>
          <dd>
            WebGL 2 (既定) か WebGPU。多くのノート PC の内蔵グラフィックスでは WebGL 2
            がいちばん速く描けます。次に読み込んだときから反映されます。
          </dd>
          <dt>Play layout</dt>
          <dd>Auto、Desktop、Touch (画面のレーンとボタンで操作)。</dd>
          <dt>Toggle fullscreen</dt>
          <dd>フルスクリーンに入る / 出る。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Audio</h4>
        <dl class="help-menu-items">
          <dt>Mute</dt>
          <dd>プレイヤーの音を消します。音量の設定はそのまま残ります。</dd>
          <dt>Master (%)</dt>
          <dd>プレイヤーが鳴らすすべての音の音量。</dd>
          <dt>Key sound (%)</dt>
          <dd>鍵盤を押して鳴るキー音の音量。</dd>
          <dt>BGM (%)</dt>
          <dd>譜面の BGM の音量。</dd>
          <dt>Play in silent mode</dt>
          <dd>iPhone の消音モードでも音を鳴らします (ブラウザが対応している場合)。</dd>
          <dt>Peak gain (next play)</dt>
          <dd>次のプレイから、一番大きい音が −3 dBFS 近くになるよう音量を上げます。</dd>
          <dt>Compressor</dt>
          <dd>
            キー音と BGM の音量差をならします。オンにして段を選び、それぞれのコンプレッサーを調整できます
            (リセットあり)。
          </dd>
          <dt>Enabled</dt>
          <dd>(Compressor) コンプレッサーをオンにします。プレイ中にも反映されます。</dd>
          <dt>Key</dt>
          <dd>(段ごとのオン / オフ) 分割コンプレッサーのキー音の段を使うか。プレイ中にも反映されます。</dd>
          <dt>BGM</dt>
          <dd>(段ごとのオン / オフ) 分割コンプレッサーの BGM の段を使うか。プレイ中にも反映されます。</dd>
          <dt>Master</dt>
          <dd>(段ごとのオン / オフ) 分割コンプレッサーの全体の段を使うか。プレイ中にも反映されます。</dd>
          <dt>Threshold (dB)</dt>
          <dd>(Compressor) この音量を超えた音を下げ始めます。プレイ中の譜面にもすぐ反映されます。</dd>
          <dt>Knee (dB)</dt>
          <dd>(Compressor) しきい値の前後で、どれだけなだらかに圧縮を始めるか。</dd>
          <dt>Ratio (x:1)</dt>
          <dd>(Compressor) しきい値を超えた分をどれだけ下げるか。4 なら 4 dB 超えるごとに 1 dB だけ通します。</dd>
          <dt>Attack (ms)</dt>
          <dd>(Compressor) 大きな音をどれだけ速く下げるか。</dd>
          <dt>Release (ms)</dt>
          <dd>(Compressor) 大きな音のあと、どれだけ速く元に戻すか。</dd>
          <dt>Reset to default</dt>
          <dd>(Compressor) このコンプレッサーの設定を既定に戻します。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">BGA camera</h4>
        <dl class="help-menu-items">
          <dt>Show camera in BGA</dt>
          <dd>
            プレイ画面の BGA の枠に、譜面の BGA
            の代わりにカメラの映像を映します。どのスキンでも使えます。手元を写して打鍵の様子を見せたり、配信で顔を出したりするときに使います。オンのときだけプレイ中にカメラを起動し、ほかの画面では止めます。プレイ中にも切り替えられます。映像はどこにも送りませんが、Capture
            で録画すると BGA の枠ごと映像も記録されます。
          </dd>
          <dt>Camera</dt>
          <dd>
            映すカメラ。既定はブラウザの既定のカメラです。選んだカメラはこの端末に記憶します。カメラが抜かれたり、許可が取り消されたりすると、BGA
            に戻ります。
          </dd>
          <dt>Allow camera access</dt>
          <dd>一度だけブラウザにカメラの許可を求め、一覧にカメラの名前が出るようにします。カメラはすぐ止めます。</dd>
          <dt>Mirror camera</dt>
          <dd>映像を左右反転します。手元を写すときに必要になることがあります。</dd>
          <dt>Preview camera</dt>
          <dd>
            選んだカメラを、BGA
            の枠と同じ向きでここに映します。プレイの前に画角を合わせるのに使います。カメラはプレビューの間だけ動き、Stop
            preview を押す、このタブを離れる、Options を閉じる、のいずれかで止まります。
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Library &amp; records</h4>
        <dl class="help-menu-items">
          <dt>Music ZIP URL</dt>
          <dd><code>?music=</code> と同じく、読み込む譜面の ZIP の URL。</dd>
          <dt>Skin ZIP URL</dt>
          <dd><code>?skin=</code> と同じく、読み込むスキンの ZIP の URL。</dd>
          <dt>Load from URLs</dt>
          <dd>上の 2 つの URL の ZIP を読み込みます。</dd>
          <dt>Auto-save replays</dt>
          <dd>プレイが終わるたびにリプレイをダウンロードします。</dd>
          <dt>Clear best records</dt>
          <dd>このブラウザのベスト記録を消します (確認があります)。</dd>
          <dt>Local data…</dt>
          <dd>
            プレイヤーがこのブラウザに保存しているもの (localStorage
            のキー、自作コース・リプレイスロット・解析済み譜面の IndexedDB データベース、使っている容量)
            を表示します。読むだけなので、データは消すための各操作から消してください。
          </dd>
          <dt>Slot 1 auto-save</dt>
          <dd>
            (Replay slots) リザルトでスロット 1 にリプレイを保存する条件 (beatoraja の規則)。EX
            スコア、BP、最大コンボ、クリアランプの更新
            (同じも含むかどうか)、いずれか、常に、保存しない、から選びます。キー 1
            での手動保存はこの設定によらず使えます。
          </dd>
          <dt>Slot 2 auto-save</dt>
          <dd>
            (Replay slots) リザルトでスロット 2 にリプレイを保存する条件。スロット 1 と同じ一覧から選びます。キー 2
            での手動保存はこの設定によらず使えます。
          </dd>
          <dt>Slot 3 auto-save</dt>
          <dd>
            (Replay slots) リザルトでスロット 3 にリプレイを保存する条件。スロット 1 と同じ一覧から選びます。キー 3
            での手動保存はこの設定によらず使えます。
          </dd>
          <dt>Slot 4 auto-save</dt>
          <dd>
            (Replay slots) リザルトでスロット 4 にリプレイを保存する条件。スロット 1 と同じ一覧から選びます。キー 4
            での手動保存はこの設定によらず使えます。
          </dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Select</h4>
        <p class="help-menu-note">
          Library タブの中。選曲画面の一覧の設定です。プレイには使わないので、いつでも変えられます。
        </p>
        <dl class="help-menu-items">
          <dt>Sort</dt>
          <dd>内蔵スキンと LR2 スキンの選曲画面での一覧の並び順。</dd>
          <dt>Key filter</dt>
          <dd>内蔵スキンと LR2 スキンの選曲画面に並べるキーモード。</dd>
          <dt>Difficulty filter</dt>
          <dd>内蔵スキンと LR2 スキンの選曲画面に並べる難易度。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Capture</h4>
        <dl class="help-menu-items">
          <dt>● Record gameplay video</dt>
          <dd>次のプレイを動画として録画してダウンロードします。BGA の枠に映したカメラの映像も記録されます。</dd>
          <dt>Video format</dt>
          <dd>動画のコンテナとコーデック。既定は MP4 · H.264 で、MP4 / WebM と H.265・AV1・VP9・VP8 から選べます。</dd>
          <dt>📸 Screenshot</dt>
          <dd>画面を PNG で保存します。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Leaderboard</h4>
        <dl class="help-menu-items">
          <dt>Submit to Leaderboard</dt>
          <dd>プレイが終わるたびに Leaderboard へ送ります (既定はオフ)。</dd>
          <dt>Submit when</dt>
          <dd>
            その譜面の自己ベスト EX-SCORE を超えたプレイだけ (初回は必ず、既定)
            か、毎回送るかを選びます。コースは常に送ります。
          </dd>
          <dt>Account</dt>
          <dd>Leaderboard にログイン中のアカウント (読み取り専用)。</dd>
          <dt>Keep this account</dt>
          <dd>
            ゲストアカウントをパスキー・Google・Discord
            で保存します。ほかの端末からログインでき、ランキングにも載ります。
          </dd>
          <dt>Sign in</dt>
          <dd>Accounts から Leaderboard にログインします。</dd>
          <dt>Sign out</dt>
          <dd>Leaderboard からログアウトします。</dd>
        </dl>
      </section>
      <section class="help-menu-folder">
        <h4 class="help-menu-folder-title">Advanced</h4>
        <dl class="help-menu-items">
          <dt>CPU workers</dt>
          <dd>譜面の読み込みや音の伸縮を並列で行うワーカーの数。</dd>
          <dt>Auto pause on blur</dt>
          <dd>ページからフォーカスが外れたらプレイを一時停止します。</dd>
          <dt>FPS</dt>
          <dd>フレームレートのグラフ。</dd>
          <dt>BGA video transcode</dt>
          <dd>BGA の動画を WebCodecs で変換するかと、縮小するサイズ。</dd>
          <dt>Use WebCodecs encoder</dt>
          <dd>
            (BGA video transcode) ブラウザに WebCodecs のエンコーダーがあれば BGA
            の動画をそれで変換します。次の譜面から反映されます。
          </dd>
          <dt>Resize</dt>
          <dd>(BGA video transcode) BGA の動画を縮小するサイズ。Off なら縮小しません。次の譜面から反映されます。</dd>
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
