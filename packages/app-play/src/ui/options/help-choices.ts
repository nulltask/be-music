/**
 * One choice of a list in the Options help: the option texts it covers, what picking it does, and the name shown
 * instead of those texts when it covers a group.
 */
export type OptionHelpChoice = readonly [names: string | readonly string[], help: string, label?: string];

/** The choices of each list the Options help describes, by Help section and then by the control's label. */
export type OptionHelpChoices = Readonly<Record<string, Readonly<Record<string, readonly OptionHelpChoice[]>>>>;

// The union of every ruleset's gauges: the help drops the ones the list does not offer under the rules in force.
const GAUGES: readonly OptionHelpChoice[] = [
  ['GROOVE', "LR2's normal gauge: starts at 20 % and clears when it ends at 80 % or more (default under LR2 rules)."],
  ['NORMAL', 'The normal gauge: clears when it ends at its border or above (default under beatoraja and ???? rules).'],
  ['EASY', 'A recovery gauge that loses less on a miss than the normal gauge, with the same clear border.'],
  ['ASSIST EASY', "beatoraja's gentlest gauge, with a lower clear border: 60 % in 7-key play, 50 % in 5-key play."],
  ['ASSISTED EASY', "AC's gentlest gauge: clears at 60 % and earns the ASSIST EASY lamp."],
  ['HARD', 'A survival gauge: starts full, drains on misses and ends the play when it empties.'],
  ['EX-HARD', "A survival gauge harsher than HARD, without HARD's damage reduction at a low gauge."],
  ['DEATH', "LR2's HAZARD: one BAD or POOR empties it, and it must also end at 80 % or more to clear."],
  ['DEATH corrected', 'DEATH without the 80 % border at the end: it clears by surviving.'],
  [
    'HAZARD',
    'A survival gauge that one BAD or POOR empties; under LR2 rules it must also end at 80 % or more to clear.',
  ],
  ['P.ATTACK', 'PERFECT ATTACK: a survival gauge that recovers on PGREAT, drains on GREAT and fails on GOOD or worse.'],
  ['G.ATTACK', 'GOOD ATTACK: a survival gauge that recovers on GOOD only; every other judgment drains it.'],
];

// PRACTICE's GAUGE TYPE adds beatoraja's course gauges to the ruleset's own.
const PRACTICE_GAUGES: readonly OptionHelpChoice[] = [
  ...GAUGES,
  ['GRADE', "beatoraja's course gauge CLASS, the one a course plays for a GROOVE or EASY pick."],
  ['EX GRADE', "beatoraja's course gauge EXCLASS, the one a course plays for a HARD pick."],
  ['EXHARD GRADE', "beatoraja's course gauge EXHARDCLASS, the one a course plays for a HAZARD pick."],
];

const LANE_OPTIONS: readonly OptionHelpChoice[] = [
  ['OFF', 'Plays the lanes as the chart has them.'],
  ['MIRROR', 'Reverses the order of the key lanes; the scratch stays.'],
  ['RANDOM', 'Shuffles the key lanes once for the whole chart; the scratch stays.'],
  [
    'S-RANDOM (LR2 / ????)',
    'Puts each note on a random key lane, timeline by timeline, without avoiding repeated hits on one lane.',
  ],
  [
    'S-RANDOM 9KEY corrected (LR2)',
    "LR2's S-RANDOM for a 9KEY chart, drawing only among the nine keys so no note lands out of reach.",
  ],
  ['SCATTER (LR2)', 'Puts each note on a random lane, avoiding the lanes the previous timeline used.'],
  ['SCATTER 9KEY corrected (LR2)', 'SCATTER for a 9KEY chart, drawing only among the nine keys.'],
  ['CONVERGE (LR2)', 'Gathers notes on the Fixed key lane; a note that finds it taken goes to a random free key lane.'],
  [
    'CONVERGE corrected (LR2)',
    'CONVERGE with the 2P target on the key picked, and a 9KEY chart kept to its nine keys.',
  ],
  ['R-RANDOM (beatoraja)', 'Rotates the key lanes as a whole, forwards or reversed; the scratch stays.'],
  ['S-RANDOM (beatoraja)', 'Places notes timeline by timeline, avoiding a lane hit within the last 40 ms.'],
  [
    'SPIRAL (beatoraja)',
    'Rotates the key lanes one step further on each timeline; a held long note pauses the rotation.',
  ],
  [
    'H-RANDOM (beatoraja)',
    'Like S-RANDOM, but prefers lanes not hit within a 16th note at the H-RANDOM threshold BPM.',
  ],
  [
    'ALL-SCR (beatoraja)',
    'Moves one key note per timeline to the scratch when it is free; the rest go like H-RANDOM. Not for 9KEY.',
  ],
  ['RANDOM-EX (beatoraja)', 'RANDOM that shuffles the scratch lane together with the keys. Not for 9KEY.'],
  ['S-RANDOM-EX (beatoraja)', 'S-RANDOM (beatoraja) over the keys and the scratch. Not for 9KEY.'],
  [
    'RANDOM PLAYABLE (beatoraja)',
    '9KEY only: one shuffle of the nine keys that turns no chord into an impossible three-key shape.',
  ],
  [
    'S-RANDOM PLAYABLE (beatoraja)',
    '9KEY only: places notes timeline by timeline, keeping chords of three to six notes in playable shapes.',
  ],
  ['CONVERGE (beatoraja)', '9KEY only: sends each note to the free lane with the longest current streak.'],
  ['SYNCHRONIZE RANDOM (????)', 'One RANDOM for the 1P keys; the 2P keys take the same lane numbers.'],
  ['SYMMETRY RANDOM (????)', 'One RANDOM for the 1P keys; the 2P keys take its mirror image.'],
];

const LANE_COVERS: readonly OptionHelpChoice[] = [
  ['OFF', 'No cover on this side.'],
  ['HIDDEN', 'Covers the lanes just above the judge line (HIDDEN+).'],
  ['SUDDEN', 'Covers the top of the lanes (SUDDEN+).'],
  ['HID+SUD', 'Both covers, each as tall as Cover height.'],
];

const REPLAY_AUTO_SAVE_RULES: readonly OptionHelpChoice[] = [
  ['Never (save by hand)', 'Saves nothing by itself; the slot key on the result screen still saves.'],
  ['Better EX score', "Saves when the EX score beats the best record (slot 1's default)."],
  ['Better or equal EX score', 'Saves when the EX score beats or equals the best record.'],
  ['Fewer BP', "Saves when the play has fewer BP than the best record (slot 3's default)."],
  ['Fewer or equal BP', 'Saves when the play has as few BP as the best record, or fewer.'],
  ['Better max combo', 'Saves when the max combo beats the best record.'],
  ['Better or equal max combo', 'Saves when the max combo beats or equals the best record.'],
  ['Better clear lamp', "Saves when the clear lamp beats the best record (slot 2's default)."],
  ['Better or equal clear lamp', 'Saves when the clear lamp beats or equals the best record.'],
  ['Any of them better', 'Saves when the EX score, BP, max combo or clear lamp is better.'],
  ['Always', "Saves every play that may keep a score, so the slot holds the latest (slot 4's default)."],
];

export const OPTION_HELP_CHOICES: OptionHelpChoices = {
  'Play options': {
    'Judgment windows': [
      ['LR2', "LR2's windows, gauges and lamps; a long note is judged at its head only (default)."],
      ['beatoraja', "beatoraja's windows and gauges, with LN MODE, CUSTOM JUDGE and the judge algorithm choices."],
      ['????', "AC's fixed windows and its gauges; every long note is a charge note, and ANY KEY (PC) is offered."],
    ],
    Gauge: GAUGES,
    'Judge algorithm': [
      ['Source default', 'LR2 and ???? rules always judge the earliest note in reach.'],
      ['Combo', 'Moves to a later note only once the earlier one is past its GOOD window (default).'],
      ['Duration', 'Judges the note closest in time to the press.'],
      ['Lowest', 'Always judges the earliest note in reach.'],
    ],
    'bmson TOTAL 0': [
      [
        'Native compatibility',
        'A bmson chart with TOTAL 0 recovers at the default TOTAL, as beatoraja plays it (default).',
      ],
      [
        'No recovery (bmson spec)',
        'No judgment raises the gauge and the damage stays; such a play is stored unranked and updates no best record.',
      ],
    ],
    'Gauge auto-shift': [
      ['NONE', 'The play ends when a survival gauge empties (default).'],
      ['CONTINUE', 'Keeps playing to the end on the emptied gauge, which stays at zero.'],
      [
        'SURVIVAL TO GROOVE',
        'When a survival gauge empties, continues on the normal gauge, which has run alongside from the start.',
      ],
      ['BEST CLEAR', 'Runs every gauge in parallel and plays on the hardest one that would still clear.'],
      ['SELECT TO UNDER', 'As BEST CLEAR, but never above the gauge picked.'],
    ],
    'Lowest auto-shift gauge': [
      ['ASSIST EASY', 'BEST CLEAR and SELECT TO UNDER may shift down to ASSIST EASY (default).'],
      ['ASSISTED EASY', 'BEST CLEAR and SELECT TO UNDER may shift down to ASSISTED EASY (default).'],
      ['EASY', 'BEST CLEAR and SELECT TO UNDER shift down no further than EASY.'],
      ['NORMAL', 'BEST CLEAR and SELECT TO UNDER shift down no further than NORMAL.'],
      ['GROOVE', 'BEST CLEAR and SELECT TO UNDER shift down no further than GROOVE.'],
    ],
    'LN MODE (beatoraja)': [
      ['LONG NOTE', 'A chart that names no long-note type plays as LN: only the head is judged (default).'],
      ['CHARGE NOTE', 'Such a chart plays as CN: the tail is judged too.'],
      ['HELL CHARGE NOTE', 'Such a chart plays as HCN: the tail is judged, and the gauge drains while it is not held.'],
    ],
    'GAMBOL (LR2)': [
      ['OFF', "The judgment windows follow the chart's #RANK (default)."],
      ['LEVEL 1', 'Fixes the windows at VERY HARD: PGREAT ±8 ms, GREAT ±24 ms, GOOD ±40 ms.'],
      ['LEVEL 2', 'As LEVEL 1, with GREAT and GOOD narrowed to ±12 ms.'],
    ],
    'Auto judge timing': [
      ['OFF', 'Judge timing moves only when you change it (default).'],
      ['beatoraja', 'After each PGREAT, GREAT or GOOD within ±150 ms, moves by a thirtieth of its offset.'],
      ['LR2 ON', 'Every ten hits, moves 1 ms toward the side your hits lean to.'],
      ['LR2 SILENT', "As LR2 ON, and plays without the chart's sounds and BGA and draws no judgment or combo."],
    ],
    'Random 1P': LANE_OPTIONS,
    'Random 2P': LANE_OPTIONS,
    '7-to-9 (beatoraja)': [
      ['OFF', 'A 7KEY chart plays on its own lanes (default).'],
      ['SC1 KEY2–8', 'Scratch on lane 1 and the keys on lanes 2 to 8; lane 9 is the spare.'],
      ['SC1 KEY3–9', 'Scratch on lane 1 and the keys on lanes 3 to 9; lane 2 is the spare.'],
      ['SC2 KEY3–9', 'Scratch on lane 2 and the keys on lanes 3 to 9; lane 1 is the spare.'],
      ['SC8 KEY1–7', 'Keys on lanes 1 to 7 and the scratch on lane 8; lane 9 is the spare.'],
      ['SC9 KEY1–7', 'Keys on lanes 1 to 7 and the scratch on lane 9; lane 8 is the spare.'],
      ['SC9 KEY2–8', 'Keys on lanes 2 to 8 and the scratch on lane 9; lane 1 is the spare.'],
    ],
    '7-to-9 scratch': [
      ['Fixed', 'Every scratch note goes to the scratch lane.'],
      [
        'Avoid repeated hits',
        'Moves to the spare lane when the scratch lane was hit within a 16th note at the H-RANDOM threshold BPM.',
      ],
      ['Alternate', 'Uses whichever of the scratch and spare lanes was hit less recently.'],
    ],
    Battle: [
      ['OFF', 'Plays the chart as it is.'],
      ['CHART HEADER', "Under LR2 rules, follows a BMS chart's #PLAYER: 2 plays as COUPLE and 4 as two-player BATTLE."],
      ['BATTLE (LR2)', 'Two players, each with its own judgment and gauge; a 5KEY or 7KEY chart is copied for each.'],
      ['COUPLE (LR2)', 'Two players, each on one side of a 10KEY or 14KEY chart as written.'],
      [
        'D-BATTLE (LR2)',
        'One player on both sides of a copied 5KEY or 7KEY chart; scratch notes become background sound.',
      ],
      [
        'SP TO DP (LR2)',
        'Splits a 5KEY or 7KEY chart across both sides; a 10KEY or 14KEY chart merges onto 1P, and 9KEY folds to 7.',
      ],
      [
        'SP TO DP corrected (LR2)',
        'SP TO DP, except that DP flip leaves a merged 10KEY or 14KEY chart on the 1P side.',
      ],
      [
        'BATTLE (beatoraja)',
        'One player on both sides: a 5, 7 or 24KEY chart is copied onto the 2P side, mines included.',
      ],
      ['BATTLE AS (beatoraja)', "BATTLE (beatoraja) with both sides' scratch notes as background sound."],
      ['BATTLE (????)', 'One player on both sides of a copied 7KEY chart; the play saves no record.'],
      [
        '2P PLAY (????)',
        'Two players, each with its own judgment and gauge; a 5KEY or 7KEY chart is copied whole, mines included.',
      ],
    ],
    'Gauge 2P': GAUGES,
    Scroll: [
      ['OFF', 'The chart scrolls as written (default).'],
      ['REMOVE (beatoraja)', 'Draws the chart at its first BPM, without BPM changes, STOPs or scroll changes.'],
      ['ADD (beatoraja)', 'Sets a random scroll speed every few bar lines, by Scroll section lines and Scroll rate.'],
      ['SOFTLANDING LEVEL 1 (LR2)', 'Changes the scroll speed at random, between a half and double, at every measure.'],
      ['SOFTLANDING LEVEL 2 (LR2)', 'As LEVEL 1, and at every note and mine as well.'],
    ],
    'Mines (beatoraja)': [
      ['OFF', 'The mines stay as the chart has them (default).'],
      ['REMOVE', 'Takes every mine out.'],
      ['ADD RANDOM', 'Puts a mine in each empty cell on a one-in-ten draw.'],
      ['ADD NEAR', 'Puts a mine in each empty cell next to a lane that has a note on the same row.'],
      ['ADD ALL', 'Puts a mine in every empty cell.'],
    ],
    'Long notes': [
      ['OFF', 'Long notes stay as the chart has them (default).'],
      [
        'LEGACY NOTE (AC 34)',
        'Turns charge notes and backspin scratches into their head note; LN and HCN stay as they are.',
      ],
      ['LN REMOVE (beatoraja)', 'Turns every long note into its head note, scratch lanes included.'],
      ['ADD LN (beatoraja)', 'Holds notes to the next row as LN, as often as Long-note add rate says.'],
      ['ADD CN (beatoraja)', 'As ADD LN, adding CN; it differs from LN only under beatoraja rules.'],
      ['ADD HCN (beatoraja)', 'As ADD LN, adding HCN; it differs from LN only under beatoraja rules.'],
      ['ADD ALL (beatoraja)', 'As ADD LN, drawing LN, CN or HCN for each added note.'],
    ],
    'EXTRA minimum level (LR2)': [
      ['LEVEL 1', 'The widest gap kept around existing notes, so the fewest added notes (default).'],
      ['LEVEL 2', 'A narrower gap, so more added notes; LEVEL 1 plays as this from 1,000 objects.'],
      ['LEVEL 3', 'The narrowest gap, so the most added notes; the lower levels play as this on a dense chart.'],
    ],
    'GAUGE TYPE': PRACTICE_GAUGES,
    'GAUGE CATEGORY': [
      ['Play mode', "Uses the gauge table of the chart's play mode."],
      ['FIVEKEYS', "Uses beatoraja's gauge table for 5KEY and 10KEY play."],
      ['SEVENKEYS', "Uses beatoraja's gauge table for 7KEY and 14KEY play."],
      ['PMS', "Uses beatoraja's gauge table for 9KEY play, whose gauge goes up to 120."],
      ['KEYBOARD', "Uses beatoraja's gauge table for the 24-key modes."],
      ['LR2', "Uses beatoraja's LR2-style gauge table."],
    ],
  },
  Tempo: {
    Pitch: [
      ['Pitch follows tempo (LR2)', 'Plays the samples faster or slower, so the pitch moves with the tempo (default).'],
      ['Keep pitch', 'Stretches the samples in time as they load and keeps their pitch.'],
    ],
    'Keep-pitch stretcher': [
      ['WSOLA', 'The built-in stretcher, the lighter of the two (default).'],
      ['Signalsmith Stretch', 'The Signalsmith Stretch library; a browser that cannot run it falls back to WSOLA.'],
    ],
  },
  'Replay / ghost': {
    'Target (beatoraja)': [
      [
        [
          'RANK A-',
          'RANK A',
          'RANK A+',
          'RANK AA-',
          'RANK AA',
          'RANK AA+',
          'RANK AAA-',
          'RANK AAA',
          'RANK AAA+',
          'RANK MAX-',
        ],
        'A rank border as the target score, from 17/27 (A-) to 26/27 (MAX-) of the maximum; RANK AAA is the default.',
        'RANK A- – RANK MAX-',
      ],
      ['MAX', 'The maximum score, twice the note count.'],
      ['NEXT RANK', 'The first rank border your best EX score has not reached.'],
      [
        ['IR NEXT 1RANK', 'IR NEXT 2RANK', 'IR NEXT 3RANK', 'IR NEXT 4RANK', 'IR NEXT 5RANK', 'IR NEXT 10RANK'],
        "The score n places above you on the chart's Leaderboard ranking.",
        'IR NEXT n RANK',
      ],
      [
        ['IR RANK 1', 'IR RANK 5', 'IR RANK 10', 'IR RANK 20', 'IR RANK 30', 'IR RANK 40', 'IR RANK 50'],
        'The score at place n of the ranking, or at its last place when it is shorter.',
        'IR RANK n',
      ],
      [
        [
          'IR RANK TOP 5%',
          'IR RANK TOP 10%',
          'IR RANK TOP 15%',
          'IR RANK TOP 20%',
          'IR RANK TOP 25%',
          'IR RANK TOP 30%',
          'IR RANK TOP 35%',
          'IR RANK TOP 40%',
          'IR RANK TOP 45%',
          'IR RANK TOP 50%',
        ],
        'The score that share of the players down the ranking.',
        'IR RANK TOP n%',
      ],
      ['SCORE RATE', 'Target score rate (%) of the maximum score.'],
    ],
    Ghost: [
      ['OFF', 'Shows no ghost (default).'],
      ['OWN BEST', "The chart's replay slot with the highest EX score."],
      [
        ['REPLAY SLOT 1', 'REPLAY SLOT 2', 'REPLAY SLOT 3', 'REPLAY SLOT 4'],
        'The replay in that slot of the chart.',
        'REPLAY SLOT 1 – 4',
      ],
      ['LEADERBOARD TOP', "The first run on the chart's Leaderboard ranking under the rules in force."],
      ['REPLAY FILE', 'The file picked with Ghost replay file…, when it was recorded on the chart.'],
    ],
    'Ghost mode': [
      [
        'SECOND PLAYFIELD',
        'The ghost plays on a playfield of its own beside yours: built-in skins, 5KEY or 7KEY single play (default).',
      ],
      ['PACEMAKER', 'The ghost is the score target, on every skin and any chart.'],
      ['PACEMAKER + LANES', 'The pacemaker, with its key presses and judgments drawn over your lanes: built-in skins.'],
    ],
  },
  View: {
    'HS-FIX': [
      ['OFF', 'The scroll speed follows the BPM (default).'],
      ['MAXBPM', 'Your hi-speed is the speed at the highest BPM; slower sections scroll slower.'],
      ['MINBPM', 'Your hi-speed is the speed at the lowest BPM; faster sections scroll faster.'],
      ['AVERAGE', 'Your hi-speed is the speed at the main BPM, the BPM the most notes sit at.'],
      ['CONSTANT', "LR2's CONSTANT: notes scroll at one fixed speed whatever the BPM, pausing on STOPs."],
      ['STARTBPM', "Your hi-speed is the speed at the chart header's starting BPM."],
    ],
    'Display area info': [
      ['OFF', "Leaves the readouts to the skin's own (default)."],
      ['ON', 'Keeps the cover length and the green number at the edge of every active cover.'],
      ['SUDDEN+ ONLY', 'Keeps them at the SUDDEN+ edge only.'],
      ['HID+/LIFT ONLY', 'Keeps them at the HIDDEN+ and LIFT edge only.'],
    ],
    'Effect 1P': LANE_COVERS,
    'Effect 2P': LANE_COVERS,
    'Judged notes': [
      [
        'Keep until its time (LR2)',
        'A note hit early keeps scrolling to the judge line, as in LR2 and beatoraja (default).',
      ],
      ['Hide on judge', 'A note disappears the moment it is judged.'],
    ],
    'Judge detail (built-in skins)': [
      ['OFF', 'Shows no timing above the judgment (default).'],
      ['FAST / SLOW', 'Words an early press FAST and a late one SLOW; a PGREAT shows nothing.'],
      ['±ms', 'Shows the offset in milliseconds for every timed judgment: negative when early, positive when late.'],
    ],
    'Judgment display (AC)': [
      ['Skin default', 'The judgment and combo show as the skin draws them.'],
      ['OFF', 'Draws no judgment and no combo on the play screen; the counts and the score are unchanged.'],
    ],
    'Auto scratch notes (AC)': [
      ['Show', 'Draws the scratch notes AUTO SCRATCH plays (default).'],
      ['Hide', 'Draws no note on a scratch lane AUTO SCRATCH plays; its key beam and bomb still show.'],
    ],
  },
  'Key config': {
    'Built-in skin controls': [
      ['LR2', "The built-in skins' screens read LR2's keys (default)."],
      ['beatoraja', "The built-in skins' screens read beatoraja's keys."],
    ],
  },
  'Skin & display': {
    'Skin system': [
      [
        'Auto (prefer loaded theme)',
        'Draws with a loaded beatoraja skin, else a loaded LR2 skin, else the built-in skins (default).',
      ],
      ['Built-in', 'Always draws with the built-in skins.'],
      [['LR2', 'LR2 (drop a skin)'], 'Draws with an LR2 skin; asks for a drop when none is loaded.', 'LR2'],
      [
        ['beatoraja', 'beatoraja (drop a skin)'],
        'Draws with a beatoraja skin; asks for a drop when none is loaded.',
        'beatoraja',
      ],
    ],
    'Built-in skin': [
      ['Synesthesia', 'A particle world in ember and gold that flies, flocks and bursts with the music.'],
      ['Plain', 'A minimal skin drawn with the Canvas 2D API.'],
      ['Native (DOM + Canvas)', 'HTML screens and score HUD around a playfield of canvas components.'],
    ],
    'Skin effects': [
      ['Full', 'Every effect.'],
      ['Reduced', 'No screen shake or full-screen flashes, and fewer particles.'],
      ['Off', 'Still screens and a plain hit flash only.'],
    ],
    'Renderer (applies on reload)': [
      ['WebGL 2', "Keeps up best on most laptops' integrated graphics (default)."],
      ['WebGPU', 'For the GPUs it suits; falls back to WebGL 2 where the browser cannot start it.'],
    ],
    'Play layout': [
      ['Auto', 'Picks the touch layout on phones and tablets, the desktop one elsewhere.'],
      ['Desktop', 'The standard layout.'],
      ['Touch', 'Equal-width lanes across the stage to tap, a slightly lower judge line and no BGA.'],
    ],
  },
  'Library & records': {
    'Slot 1 auto-save': REPLAY_AUTO_SAVE_RULES,
    'Slot 2 auto-save': REPLAY_AUTO_SAVE_RULES,
    'Slot 3 auto-save': REPLAY_AUTO_SAVE_RULES,
    'Slot 4 auto-save': REPLAY_AUTO_SAVE_RULES,
  },
  Select: {
    Sort: [
      ['OFF', "Keeps the library's order."],
      ['LEVEL', 'By play level, lowest first, then by title.'],
      ['TITLE', 'By title.'],
      ['CLEAR', 'By clear lamp; until the records feed the sort, it orders by title.'],
    ],
    'Key filter': [
      ['ALL', 'Lists every key mode.'],
      ['KEYS_5', 'Lists 5KEY charts only.'],
      ['KEYS_7', 'Lists 7KEY charts only.'],
      ['KEYS_10', 'Lists 10KEY (double play) charts only.'],
      ['KEYS_14', 'Lists 14KEY (double play) charts only.'],
      ['KEYS_9', 'Lists 9KEY charts only.'],
    ],
    'Difficulty filter': [
      ['ALL', 'Lists every difficulty.'],
      ['BEGINNER', 'Lists charts whose #DIFFICULTY is 1.'],
      ['NORMAL', 'Lists charts whose #DIFFICULTY is 2.'],
      ['HYPER', 'Lists charts whose #DIFFICULTY is 3.'],
      ['ANOTHER', 'Lists charts whose #DIFFICULTY is 4.'],
      ['INSANE', 'Lists charts whose #DIFFICULTY is 5.'],
    ],
  },
  Course: {
    'NONSTOP placement': [
      ['intended', 'Starts each stage where the previous one was placed; bmson stages can be stitched too (default).'],
      ['lr2', 'Places the stages exactly as LR2 does, its quirks included; BMS stages only.'],
    ],
  },
  Leaderboard: {
    'Submit when': [
      [
        'EX-SCORE improves (first play always)',
        'Sends a play only when it beats your best EX-SCORE on the chart; a first play is always sent (default).',
      ],
      ['Always', 'Sends every play.'],
    ],
  },
};
