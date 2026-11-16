[日本語](./0035-chart-authored-notes-options.ja.md)

# 0035: Chart-authored NOTES options convert the chart in the engine, and the fingerprint carries the gameplay options

## Context

[ADR 0033](./0033-chart-authored-gameplay-options.md) left `774:NOTES_*` diagnosed: DOUBLE and COPY change the lanes every host draws, and COPY turns a single-play chart into a double-play one (#932). [hitkey's catalog](https://hitkey.nekokan.dyndns.info/option.htm) is the only description. DOUBLE "doubles notes on non-special lines" (special lines are the turntable and the foot pedal). COPY reverses the single-play chart, special lines excluded, and copies it to the 2P side (DBM): 5 KEY `[11..15, 16]` becomes 10 KEY with 2P `[15..11, 16]`, and 9 KEY becomes 18 KEY. On 10, 14 or 18 KEY, or OCT/FP, "nothing happens". DBLCOPY is DOUBLE plus COPY. `NOTES_OFF` cancels them, and `CRAZY_OFF` does not. They are initial-only, with legacy aliases `CRA-HYPER` / `CRA-CPDOUBLE`. The catalog gives no placement rule for DOUBLE, no course rule and no record rule.

A key mode change touches the skin a host draws, the records (kept by chart), courses (one key mode per course) and replays. The Leaderboard also could not check `chart.chartPlayOptions`, because it never sees the chart: it gets the Be-Music Fingerprint documents, which left `#OPTION` out.

## Decision

**Compilation.** `compileChartPlayOptions` adds `notes: 'DOUBLE' | 'COPY' | 'DBLCOPY'` from the exact-case modern IDs; `NOTES_OFF` clears it and `CRAZY_OFF` leaves it. Legacy aliases stay diagnosed, as for the other families. The recorded program keeps `version: 1`: no earlier recorder wrote `notes`, and an earlier strict parser rejects it, so no replay is reinterpreted.

**Readings** (Be-Music's own; no native parity is claimed):

| Option    | Be-Music effect                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DOUBLE`  | Every key note gains a partner on its mirror lane of the same side (key `i` of `n` on key `n + 1 - i`; 9 KEY mirrors all nine keys). A partner is skipped when a note, long note or mine occupies the mirror lane anywhere from the note's head to its tail, ends included. The middle key of an odd side has no mirror lane. Scratch, wheel and FREE ZONE notes stay single. A partner keeps the note's keysound. |
| `COPY`    | A 5 / 7 KEY chart is copied onto the 2P side with its keys mirrored and its scratch on the 2P scratch, mines and invisible objects included. It plays as 10 / 14 KEY. On any other variant it does nothing: Be-Music has no 18 KEY mode, and 24 KEY is not in the catalog.                                                                                                                                         |
| `DBLCOPY` | DOUBLE, then COPY of the doubled side; DOUBLE alone where COPY cannot run.                                                                                                                                                                                                                                                                                                                                         |

**Where they run.** `preparePlaybackChart` converts the notes after the note and mine modifiers, so a partner avoids an added mine and ADDMINE's mines are copied too. The conversion runs before the battle conversions and the host's lane options. The play variant changes there, so every host lays out, binds and judges the double-play variant, and the skin follows it as it follows a BATTLE chart. The chart's RANDOM applies to the converted chart (ALL crosses the sides of a copied chart).

**Precedence.** A chart that copies itself decides the double-play chart: the player's battle conversion (SP TO DP, D-BATTLE, BATTLE, TWO-PLAYER, COUPLE) is off. DP FLIP leaves the sides as the chart authored them. DOUBLE composes with the player's options as a note conversion.

**Courses.** A course keeps one key mode, so a course stage (GRADE, EXPERT, NONSTOP) leaves COPY out, and DBLCOPY keeps its DOUBLE. A declaration that lost its effect is diagnosed `unsupported-option`. Such a stage does not update its chart's record, which is of the double-play chart (`RecordPlayKind.chartCopyLeftOut`). NONSTOP applies none of a stage's gameplay options, as before.

**Effective program.** `resolveEffectiveChartPlayOptions` narrows the compiled program to what takes effect in the play, from the chart's own variant and whether the play is a course stage. The browser, the engine's own preparation (the terminal) and the Leaderboard share it. A replay records only the effective program; its notes hold the result, and `chart.laneMode` the double-play mode. Playback converts with the recorded `notes`, and rebuilds the 2P side's mine and long-note placements from the 1P side's, as for a BATTLE replay.

**Terminal.** The engine applies the chart's arrangement and ADDMINE itself when no host prepared the chart, so the terminal now plays chart RANDOM, ADDMINE and NOTES. It draws a RANDOM permutation uniformly, target by target; it has no lane options of its own and no seed to record.

**Records.** The chart's free play always has its conversion, so its record is of one key mode. Like the other chart options, a conversion is not an assist (ADR 0031): every player of the chart gets it.

**Leaderboard.** The fingerprint documents carry the compiled gameplay options as `playOptions`, a header field (also in `#RANDOM` branches), omitted when there are none. A chart without gameplay options keeps its fingerprint; one with them gets a new one, because they change notes and judging. On submission, the server reads `playOptions` and `laneMode` from the play document, which it has already checked against the play fingerprint (L3). It narrows them for the play's context, and rejects a replay whose `chart.chartPlayOptions` differs with `chart-play-options-mismatch` (422). A NONSTOP run's stitched play must record none.

## Consequences

Charts that force NOTES play as double or copied charts in every host, on replay and on the server. The fingerprint now separates charts that differ only in gameplay options. `bmfp0` is the development version, so no bump is needed, and charts without options keep their fingerprints. A replay can no longer strip or add the chart's program without changing the play fingerprint, which then names another chart. The DOUBLE placement is Be-Music's own rule and may differ from nanasigroove. The select screen still classifies a COPY chart by its authored key mode, and a NOTES COPY chart in a course plays single.

## Amendment: nanasigroove's own conversions (#1184)

The readings above were Be-Music's own. nanasigroove 1.552 converts the chart as follows, and Be-Music now does too:

**DOUBLE copies whole lanes, one copy after another.** Each copy takes the source lane as it stands, so a lane that has already received a copy passes it on. The scratch and FREE ZONE are left alone; invisible objects travel with their lane, and mines do not.

| Variant | Copies, in order                                                                             |
| ------- | -------------------------------------------------------------------------------------------- |
| 5 KEY   | 1→3, 2→4, 3→5, 4→2, 5→3: keys 3 and 5 carry keys 1, 3 and 5; keys 2 and 4 carry keys 2 and 4 |
| 7 KEY   | 1→3, 2→4, 3→5, 4→2, 5→7, 6→4, 7→5                                                            |
| 9 KEY   | 1→3, 2→4, 3→5, 4→2, 5→7, 6→4, 7→9, 8→6, 9→7 (keys 6 to 9 are channels 22 to 25)              |
| 10 KEY  | 5 KEY on each side                                                                           |
| 14 KEY  | 7 KEY on each side                                                                           |

Each lane then keeps one object at each instant, preferring in turn the lane's own long note, its own key note, a long note from the same side, a key note from the same side, and otherwise whichever arrived first (the lane's own objects first, then the copies in the order they were made). Be-Music keeps two narrow rules of its own, because a Be-Music lane plays one object at a time:

- The chart's own visible objects always stay. An instant the chart already doubles is the chart's, not DOUBLE's.
- A long-note copy stays only when both its ends stay. A copy is dropped where it would overlap a long note already on its lane.

nanasigroove defines no DOUBLE for 24 / 48 KEY, so it does nothing there and is diagnosed `unsupported-option`.

**COPY** mirrors the 1P side onto 2P as above, but leaves the mines on 1P. **DBLCOPY** copies first and then doubles both sides of the double-play chart, on the 10 / 14 KEY copies. nanasigroove's COPY also turns 9 KEY into 18 KEY; Be-Music has no 18 KEY mode, so that stays unsupported. The course rule stays Be-Music's.

**The player can select them too.** The Options dialog's **nanasigroove** folder offers **NOTES**: OFF, DOUBLE, COPY or DBLCOPY. A chart's own `774:NOTES_*` wins (`withPlayerChartPlayOptions`). The Leaderboard accepts a replay whose program adds the player's GOOD2BAD / GREAT2BAD, HELLJUDGE or NOTES where the chart sets none, and narrows the program with the replay's own version.

**Replays.** A program with NOTES is now version 3, as with the CRAZY options in [ADR 0033](./0033-chart-authored-gameplay-options.md). Version 1 and 2 programs keep the readings above: mirror-lane DOUBLE on every variant with key lanes, COPY with the mines, and DBLCOPY doubling before it copies. Existing replays and records keep their notes.

## Amendment: a player's NOTES COPY keeps no record (#1243)

The replay recorded only the program a play ran with, which `withPlayerChartPlayOptions` merges from the chart's `#OPTION` and the player's selections, so a chart that forces COPY and a player who selects COPY looked the same, and a player's COPY play of a 7 KEY chart landed in that chart's record.

nanasigroove 1.552's manual says FREE mode allows every option and records the score; only AUTO and VISUAL keep none, and AUTO-SC counts as an EASY clear [C]. It names no limit for NOTES or CRAZY. Be-Music's records are kept per chart and its key mode, though: a chart that forces COPY has a record of the double-play chart, and a course stage that left the copy out does not update it (above). A play the player's COPY copied is not a play of the chart's key mode either, so Be-Music classifies it `no-save` (source `be-music`, option `nanasi-notes:COPY` or `nanasi-notes:DBLCOPY`): it keeps no local record, and the Leaderboard stores it unranked. This is Be-Music's rule, not nanasigroove's. The player's DOUBLE, GOOD2BAD / GREAT2BAD and HELLJUDGE keep the chart's key mode and only make the play harder, so they stay ordinary plays, as nanasigroove records them.

The replay now names the options the player added in `play.playerChartPlayOptions` (`playerChartPlayOptionsOf`): those of the effective program the chart's declaration does not set, as they ran, so a course stage that left the player's COPY out names none and a DBLCOPY that kept its DOUBLE names DOUBLE. Each must equal the program's value. The Leaderboard checks that the field names exactly the options the play document's `playOptions` do not declare. The replay format is still at its development revision, so the field ships without a version bump ([ADR 0019](./0019-source-qualified-option-values.md)); player NOTES has not been released, so no earlier replay lacks it.
