[日本語](./0031-assist-record-policy.ja.md)

# 0031: Classify assists by option source, decide consequences by judge ruleset, and append lamps

## Context

Play options are offered under every judge ruleset ([#774](https://github.com/nulltask/be-music/issues/774), [ADR 0019](./0019-source-qualified-option-values.md)), so a play can mix options from LR2, beatoraja and That-Which-Must-Not-Be-Named. The three sources disagree on what an assisted play keeps. LR2 caps the lamp at EASY and saves no score, and keeps D-BATTLE, SP TO DP and EXTRA MODE on separate lamps (OpenLR2 `LR2f.cpp` L9196-L9364). beatoraja 0.8.9 awards LIGHT ASSIST EASY or ASSIST EASY for a cleared assisted play and blocks score updates (`BMSPlayer.createScoreData`, `PlayDataAccessor.updateScore`). AC 34 lists assist options and saves no data from BATTLE, and the PC edition turns four options into NO PLAY. The ranking flags before this change covered only AUTO SCRATCH and the debug judge-window override. Local records ignored assists entirely, and `CLEAR_LAMPS` had no LIGHT ASSIST EASY, even though the Leaderboard persists lamps by their index.

The maintainer decided ([#602](https://github.com/nulltask/be-music/issues/602), [#603](https://github.com/nulltask/be-music/issues/603)) that each judge ruleset follows its own rules, that an option is classified by its own source, and that stored records are not re-derived.

## Decision

**Two steps, one resolver.** `classifyReplayAssists` in `@be-music/player-engine/records` turns a replay's recorded options and chart facts into findings. Each finding is classified by its option's source into `light`, `assist` or `no-save`, and a play takes the highest class. `resolveRecordPolicy` then gives separate outputs for the judge ruleset: whether the play keeps a record, whether score fields update, the lamp rule (cap or replace), the record slot, course behavior, Leaderboard placement and replay retention. The resolver is runtime-neutral and deterministic and reads only recorded fields. Local records, the result lamp, course records, Leaderboard submission and re-simulation all call it. The per-option table is in [Play options](../play-options.md#assist-and-record-policy).

- A bare value two sources define is the played ruleset's, as ADR 0019 reads it. beatoraja's chart-dependent rules use the recorded change counts and the BPM range.
- `light` and `assist` are lamp-only under every ruleset: LR2 caps at EASY, beatoraja replaces a clear with LIGHT ASSIST EASY or ASSIST EASY, and `____` with ASSIST EASY (AC's ASSIST CLEAR). `no-save` keeps nothing. A course with any assisted stage keeps no course record.
- The Leaderboard still receives every play except AUTO and replay playback. `light` and `assist` rank on the assisted board, and `no-save` plays and assisted course runs are stored unranked.

**Append-only stored lamp ranks.** LIGHT ASSIST EASY joins `CLEAR_LAMPS` between ASSIST EASY and EASY, which is the lamp order. Its stored rank is 10, after MAX, and ranks 0 to 9 keep their lamps. `clearLampRank` returns the stored rank, which is no longer an order. Comparisons use `compareClearLamps` and `compareClearLampRanks`, and SQL that orders lamps maps rank 10 to a sort key between 2 and 3. beatoraja's ASSIST EASY gauge now clears on LIGHT ASSIST EASY, as its `ClearType` maps gauge 0.

**No re-derivation.** Local bests and Leaderboard results stored before the change keep their values. Old beatoraja ASSIST EASY gauge clears stay ASSIST EASY (rank 2). New text values for `score.unranked` (`no-save`) and `course_score.unranked` (`assist`) go into a nullable text column, so they need no data migration.

## Consequences

- A new option is not merged without a classification by its source and a row in the policy table.
- A stored lamp rank must never be reordered. A future lamp takes the next free rank, and every place that orders lamps goes through the comparison functions.
- LR2's separate lamps exist locally only. The Leaderboard puts those plays on the assisted board with an uncapped lamp under `lr2`.
- AC's score treatment of assist options is not stated by the cited pages. Following LR2 and beatoraja, Be-Music blocks it; a better source can change this rule alone.
