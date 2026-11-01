[日本語](./0033-chart-authored-gameplay-options.ja.md)

# 0033: Chart-authored RANDOM and judgment CRAZY options replace the player's, and are not assists

## Context

nanasigroove lets a chart's initial `#OPTION` force `774:RANDOM_*` (MIRROR, RANDOM, RANDOM+, ALL, ALL+), `774:NOTES_*` and the judgment-related `774:CRAZY_*` options (`GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, `ADDMINE`); none is allowed on A6 ([research](../research/chart-authored-options.md)). [hitkey's catalog](https://hitkey.nekokan.dyndns.info/option.htm) describes them in a sentence each: GOOD2BAD "when a judgment is GOOD or BAD or POOR, a groove-gauge decreases", HELLJUDGE "diminish the original judgment width by half (probably)", ADDMINE "landmines are automatically installed in the random position", RANDOM+ / ALL+ also move the special lines, ALL crosses the sides. The sources give no algorithm, no course rule and no record rule. These options change the judged lanes and the judgments, so they touch the player's own lane options, course locks, replays and the records the [assist policy](./0031-assist-record-policy.md) decides. The owner decided that a chart's option wins over the player's own setting of the same item, as the chart author's staging (#844).

## Decision

**Compilation.** `compileChartPlayOptions` reads the exact-case modern IDs from the resolved chart's initial declarations, in source order, the later one winning within a family. `RANDOM_OFF` clears the arrangement. `CRAZY_OFF` clears every gameplay CRAZY declared before it. The display compiler stops diagnosing these initial declarations, and diagnoses an A6 use as `initial-only-option`. `NOTES_*` stays `unsupported-option`: DOUBLE and COPY change the play variant (COPY turns a single-play chart into a double-play one) and the lane layout every host draws, which is a separate change.

**Readings** (Be-Music formulas; no native parity is claimed):

| Option                  | Be-Music effect                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIRROR`, `RANDOM`      | The existing MIRROR / RANDOM on both sides, without the player's fixed lane or M-RAN                                                                                                                                                                     |
| `RANDOM+`               | The existing scratch-inclusive RANDOM-EX shuffle on both sides (plain RANDOM on 9 KEY, which has no scratch)                                                                                                                                             |
| `ALL`, `ALL+`           | One shuffle across both sides' keys (with `ALL+`, the scratch lanes too) on a double-play chart; `RANDOM` / `RANDOM+` on a single-play chart                                                                                                             |
| `GOOD2BAD`, `GREAT2BAD` | The GOOD window takes the GREAT window, so a hit that would have been GOOD becomes BAD (beatoraja's `NO_GOOD`); `GREAT2BAD` gives GREAT and GOOD the PGREAT window (`NO_GREAT`). Read from the names; the catalog's gauge-only wording is not reproduced |
| `HELLJUDGE`             | Every judge window (PGREAT to BAD, notes and long-note ends) at half its width, rounded to whole microseconds; the empty-POOR window is unchanged                                                                                                        |
| `ADDMINE`               | The existing ADD_RANDOM mine modifier: a mine at each blank cell with an independent draw above 0.9                                                                                                                                                      |

**Precedence.** The chart's option replaces the player's choice of the same item: its arrangement replaces both sides' lane options, and ADDMINE replaces the mine option. A course's lane lock (`grade`, `grade_mirror`) does not suppress the chart either; the Leaderboard's course check accepts a stage whose chart forced its arrangement. The judge modifiers compose with a course's `no_good` / `no_great` constraint, the stricter collapse winning, after HELLJUDGE halves the windows. NONSTOP does not apply them: one stitched play runs one ruleset and one arrangement, so each stage's declarations are diagnosed as `unsupported-option` with the stage.

**Where they run.** The judge modifiers are part of `resolveRuleset` (`chartJudge`), which the live engine and the replay simulator share, so the server's re-simulation reproduces them. The browser host applies the arrangement and ADDMINE while preparing the chart (`applyChartPlayOptions`), before the notes go to the engine. The terminal has no lane or mine options, so it applies only the judge modifiers.

**Replay.** `chart.chartPlayOptions` records `{ version: 1, options }` when the chart forced anything. The arranged and mined notes are already in `chart.notes`. The simulator applies the recorded judge modifiers and never recompiles the source, so a replay recorded before this change (without the field) keeps its original judgments. A replay playback passes the recorded program, or an empty one for an older replay. `play.randomLane` and `play.mineModifier` record the values the play ran with, the chart's in place of the player's.

**Records.** These options come from the chart, and nanasigroove, their source, has no assist class. Every play of the chart gets them, so they do not split players. They are classified as no assist: the assist policy ignores the lane value of a play whose chart forced its arrangement (a chart RANDOM+ recorded as RANDOM-EX is not beatoraja's LIGHT ASSIST), and the judge modifiers and ADDMINE add no finding. The player's own assists still count.

## Consequences

Charts that force these options play as their author staged them, deterministically on replay and on the server. Lamps and rankings of such a chart compare plays under the same compulsory options. Two limits remain. A Leaderboard that cannot read the chart trusts the recorded program, so a log could strip or add it. And `NOTES_*`, NONSTOP application and terminal arrangements are not implemented.
