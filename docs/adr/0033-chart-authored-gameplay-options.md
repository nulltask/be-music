[日本語](./0033-chart-authored-gameplay-options.ja.md)

# 0033: Chart-authored RANDOM and judgment CRAZY options replace the player's, and are not assists

## Context

nanasigroove lets a chart's initial `#OPTION` force `774:RANDOM_*` (MIRROR, RANDOM, RANDOM+, ALL, ALL+), `774:NOTES_*` and the judgment-related `774:CRAZY_*` options (`GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, `ADDMINE`); none is allowed on A6 ([research](../research/chart-authored-options.md)). [hitkey's catalog](https://hitkey.nekokan.dyndns.info/option.htm) describes them in a sentence each: GOOD2BAD "when a judgment is GOOD or BAD or POOR, a groove-gauge decreases", HELLJUDGE "diminish the original judgment width by half (probably)", ADDMINE "landmines are automatically installed in the random position", RANDOM+ / ALL+ also move the special lines, ALL crosses the sides. The sources give no algorithm, no course rule and no record rule. These options change the judged lanes and the judgments, so they touch the player's own lane options, course locks, replays and the records the [assist policy](./0031-assist-record-policy.md) decides. The owner decided that a chart's option wins over the player's own setting of the same item, as the chart author's staging (#844).

## Decision

**Compilation.** `compileChartPlayOptions` reads the exact-case modern IDs from the resolved chart's initial declarations, in source order, the later one winning within a family. `RANDOM_OFF` clears the arrangement. `CRAZY_OFF` clears every gameplay CRAZY declared before it; it also stays the display operation that clears the visual CRAZY subfamilies ([ADR 0032](./0032-chart-authored-visual-families.md)), on A6 too. The display compiler stops diagnosing these initial declarations, and diagnoses an A6 use as `initial-only-option`. `NOTES_*` stays `unsupported-option`: DOUBLE and COPY change the play variant (COPY turns a single-play chart into a double-play one) and the lane layout every host draws, which is a separate change.

**Readings** (Be-Music formulas; no native parity is claimed):

| Option                  | Be-Music effect                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIRROR`, `RANDOM`      | The existing MIRROR / RANDOM on both sides, without the player's fixed lane or M-RAN                                                                                                                                                                     |
| `RANDOM+`               | One shuffle of each side's keys and scratch, recorded as nanasigroove's own `RANDOM+` (amended below; plain RANDOM on 9 KEY, which has no scratch)                                                                                                       |
| `ALL`, `ALL+`           | One shuffle across both sides' keys (with `ALL+`, the scratch lanes too) on a double-play chart; `RANDOM` / `RANDOM+` on a single-play chart                                                                                                             |
| `GOOD2BAD`, `GREAT2BAD` | The GOOD window takes the GREAT window, so a hit that would have been GOOD becomes BAD (beatoraja's `NO_GOOD`); `GREAT2BAD` gives GREAT and GOOD the PGREAT window (`NO_GREAT`). Read from the names; the catalog's gauge-only wording is not reproduced |
| `HELLJUDGE`             | Every judge window (PGREAT to BAD, notes and long-note ends) at half its width, rounded to whole microseconds; the empty-POOR window is unchanged                                                                                                        |
| `ADDMINE`               | The existing ADD_RANDOM mine modifier: a mine at each blank cell with an independent draw above 0.9                                                                                                                                                      |

**Precedence.** The chart's option replaces the player's choice of the same item: its arrangement replaces both sides' lane options, and ADDMINE replaces the mine option. A course's lane lock (`grade`, `grade_mirror`) does not suppress the chart either; the Leaderboard's course check accepts a stage whose chart forced its arrangement. The judge modifiers compose with a course's `no_good` / `no_great` constraint, the stricter collapse winning, after HELLJUDGE halves the windows. NONSTOP does not apply them: one stitched play runs one ruleset and one arrangement, so each stage's declarations are diagnosed as `unsupported-option` with the stage.

**Where they run.** The judge modifiers are part of `resolveRuleset` (`chartJudge`), which the live engine and the replay simulator share, so the server's re-simulation reproduces them. The browser host applies the arrangement and ADDMINE while preparing the chart (`applyChartPlayOptions`), before the notes go to the engine. The terminal has no lane or mine options, so it applies only the judge modifiers.

**Replay.** `chart.chartPlayOptions` records `{ version: 1, options }` when the chart forced anything. The arranged and mined notes are already in `chart.notes`. The simulator applies the recorded judge modifiers and never recompiles the source, so a replay recorded before this change (without the field) keeps its original judgments. A replay playback passes the recorded program, or an empty one for an older replay. `play.randomLane` and `play.mineModifier` record the values the play ran with, the chart's in place of the player's.

**Records.** These options come from the chart, and nanasigroove, their source, has no assist class. Every play of the chart gets them, so they do not split players. They are classified as no assist: the assist policy ignores the lane value of a play whose chart forced its arrangement (a chart RANDOM+ that an older replay recorded as RANDOM-EX is not beatoraja's LIGHT ASSIST), and the judge modifiers and ADDMINE add no finding. The player's own assists still count.

## Consequences

Charts that force these options play as their author staged them, deterministically on replay and on the server. Lamps and rankings of such a chart compare plays under the same compulsory options. Two limits remain. A Leaderboard that cannot read the chart trusts the recorded program, so a log could strip or add it. And `NOTES_*`, NONSTOP application and terminal arrangements are not implemented.

[ADR 0035](./0035-chart-authored-notes-options.md) later implemented `NOTES_*` and the terminal's arrangement and ADDMINE, and the Leaderboard now checks the recorded program against the chart's fingerprint documents.

## Amendment: nanasigroove's own readings (#1177, #1185)

The table above read GOOD2BAD, GREAT2BAD, HELLJUDGE and ADDMINE from their names. nanasigroove 1.552 plays them as follows, and Be-Music now does too, keeping each judge ruleset's own windows and gauges as the base:

| Option                  | nanasigroove 1.552                                                                                                                                | Be-Music                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GOOD2BAD`, `GREAT2BAD` | Judgments stay as they are; a GOOD (GOOD2BAD), or a GREAT and a GOOD (GREAT2BAD), moves the gauge as a BAD does. The game describes them that way | The same on the ruleset's gauge: those judgments take its BAD delta, on every gauge an auto-shift runs     |
| `HELLJUDGE`             | Its judge table is swapped for a narrower one: COOL and GREAT at 3/8 of their width, GOOD at 1/3, BAD at 1/4                                      | The ruleset's PGREAT, GREAT, GOOD and BAD windows narrowed by those ratios, notes and long-note ends alike |
| `ADDMINE`               | Mines scattered along every lane at random steps, with random damage (below)                                                                      | The same placement, as the engine's mine option `NANASI_ADD`                                               |

ADDMINE draws each lane in turn. One draw in 1000 makes a dense lane (steps of up to 168 positions, 48 to a beat), one in ten a varied lane (two steps between 180 and 360, and harsher damage odds), and the rest a regular lane (steps of up to 360). The first mine sits a random step plus 24 into the chart and each next one a fresh step plus 24 further on, to the chart's end. Four candidates in five become mines; one within 12 positions of a note on its lane is skipped. Damage falls in five bands on nanasigroove's 200-point gauge, from 1–5 up to 1–200; Be-Music halves it into a gauge percentage. The rarest band heals one point, which Be-Music's mine model cannot express: those mines deal no damage. Mine trigger and its accounting stay the judge ruleset's.

**The player can select them too.** The Options dialog offers **GOOD2BAD / GREAT2BAD**, **HELLJUDGE** and **ADDMINE** in a **nanasigroove** folder of their own. No LR2 or beatoraja option plays as they do, so they stay apart from the other sources' options; the player's ADDMINE replaces the beatoraja mine option while it is on, as the chart's does. A chart's own declaration wins within its family, as before (`withPlayerChartPlayOptions` in `@be-music/chart-model`).

**Replays.** The recorded chart gameplay program is version 3 when it holds any of these options. Version 1 and 2 programs keep the earlier readings above (halved windows, collapsed GOOD and GREAT windows, beatoraja's ADD RANDOM), so existing replays re-judge as they played.

## Amendment: RANDOM+ is nanasigroove's own lane value (#1244)

A chart's `774:RANDOM_RANDOM+` ran as beatoraja's RANDOM-EX and was recorded as `RANDOM-EX` in the replay's `play.randomLane`. The two are not shown to be the same: the catalog says only that RANDOM+ also moves the special lines [C]. A replay then read as if the player had chosen beatoraja's option, and the assist policy needed the chart's program to tell them apart. nanasigroove support exists for charts' `#OPTION` and must not lend its behavior an LR2 or beatoraja option's name (AGENTS.md), so RANDOM+ now has a lane value of its own, `RANDOM+`. Only a chart selects it: the player is never offered it, and it is no LR2 or beatoraja assist.

The shuffle is unchanged, Be-Music's reading: one uniform draw over the side's keys and scratch lanes, as RANDOM-EX draws, and plain RANDOM on 9 KEY. Replays recorded before this keep `RANDOM-EX`, and their notes still hold the arrangement, so they re-judge as they played; new replays record `RANDOM+`. ALL / ALL+ on a single-play chart read as RANDOM / RANDOM+ and are recorded the same way.

## Amendment: the ALL / ALL+ shuffle is nanasigroove's, under every ruleset (#1245)

The catalog says ALL shuffles across both sides and ALL+ also moves the special lines [C]; it gives no algorithm. On a double-play chart the browser drew ALL / ALL+ through its lane options, as RANDOM / RANDOM-EX with the judge ruleset fixed to LR2. The ruleset changed nothing there, since no fixed key, side or LR2 scratch option took part, but the call read as if an LR2 or beatoraja lane option ran nanasigroove's behavior. The browser now runs the engine's own chart arrangement (`arrangeChartPlayLanes`), which the terminal already used: one uniform draw, target by target, over both sides' keys, and with ALL+ both sides' scratch lanes after them, under every judge ruleset. It is Be-Music's reading and the same draw as before, so a seed keeps its arrangement and replays are unchanged.
