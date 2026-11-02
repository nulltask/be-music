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
