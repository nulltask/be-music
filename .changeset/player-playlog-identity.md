---
'@be-music/player': minor
---

Play logs identify the chart, the play and the software that recorded them, and say whether the play can be ranked:

- Be-Music Fingerprints (`bmfp0:…`), so logs match a chart by what is played even after keysound / BGA / metadata edits or a BMS ↔ bmson conversion, where `chart.sha256` no longer matches. The optional `chart.chartFingerprint` covers every `#RANDOM` / `#SWITCH` branch, so every play of a chart shares it, and `chart.playFingerprint` covers the branches the play rolled. `createPlaylogRecorder` computes both from the source chart (the new `recordPlaylog.sourceChart`, for hosts that resolve `#RANDOM` or rewrite lanes on the chart themselves, else the chart the engine was given) with the engine's `laneModeExtension` as the lane-mode input, so lane options such as MIRROR or a DP flip never change them, and omits a field it cannot compute.
- The play's outcomes as `play.randomDraws` (the `PlayerOptions.randomDraws` it played with), so a verifier with the chart file can rebuild the chart that was played with `resolveBmsControlFlowWithDraws` and recompute the fingerprint, and a replay passes them back as `PlayerOptions.randomDraws` to play the recorded branches.
- `chart.md5`, the chart file's MD5 that LR2 and LR2IR identify a chart by (`recordPlaylog.chartMd5`), and `chart.playLevel` (`#PLAYLEVEL` / bmson `info.level`, as text) and `chart.difficulty` (`#DIFFICULTY`, 1 BEGINNER .. 5 INSANE), so a leaderboard can show how hard a played chart is.
- A top-level `recorder` (`PlaylogRecorderInfo`: `name`, `version`, `build`, `engine`, `platform`), so a log can be traced back to the build that recorded it. Hosts declare the application fields through `recordPlaylog.recorder`; the recorder always stamps `engine` with the `@be-music/player` version (`PLAYLOG_ENGINE_VERSION`).
- `checkPlaylogEligibility` decides whether a play can be ranked, for the client that submits it and the server that ranks it: a manual play, not aborted, never at another tempo (`tempo`: a tempo-changed play is practice, as beatoraja's frequency trainer does not save its scores), not a course stage (`course-stage`), with both fingerprints. Assists (`auto-scratch`, `judge-window-override`) are returned as flags, so such a play is ranked apart. `PLAYLOG_SIMULATOR_RULESETS` is now a readonly tuple (`as const`), so it can feed enums and schema pickers directly.

`parsePlaylog` validates and keeps these fields while still accepting logs without them.

The format and the rulesets are marked as still in development:

- `BE_MUSIC_PLAYLOG_VERSION` is now `0`, a development revision that may change incompatibly without the number moving (the first stable one will be `1`). Recorded logs carry `version: 0`; `parsePlaylog` still reads logs stamped `version: 1`, which have the same shape, and returns them as revision `0`.
- The ruleset result ids become `lr2/0`, `beatoraja/0` and `iidx/0`: their rules may change between releases without a bump, so a cached `/0` result can differ from what a later release computes. The judging changes of this release (the mine rules, LR2's negative-BPM reverse scroll, the long-note and timing fixes) change results, so results from the old rules no longer carry the same id. Logs with `/1` results still parse; re-simulating or replaying them applies the current rules.
