---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` writing bmson that beatoraja and the parser read back differently:

- Lanes moved on the round trip: a `beat-7k` chart's keys 6 / 7 and scratch (`18` / `19` / `16`) came back on `14` / `15` / `13`, because non-keyboard lanes were numbered from 1 in channel order. Every hint the parser knows (`beat-5k`, `beat-7k`, `beat-10k`, `beat-14k`, `popn-5k`, `popn-9k`) now writes each lane at the `x` the parser maps back to it, with `beat-5k` / `beat-10k` on the spec's lanes (the scratch on `x` 8, the `beat-10k` 2P keys on `x` 9–13 and 2P scratch on `x` 16); unknown hints still number the lanes in use from 1.
- A BMS chart without a bmson `mode_hint` now gets its play variant's canonical hint (`beat-7k` rather than `beat-4k` for a 7 KEY chart using four lanes) when all of its lanes fit that layout, and the spec's `generic-<lanes>keys` hint (lanes numbered left to right) when they fit no canonical layout, instead of a made-up `beat-<lanes>k` that players read as `beat-7k`.
- Long notes and mine damage were dropped: `#LNOBJ` pairs and `5x` / `6x` long notes (`#LNTYPE 1` / `2`) became separate short notes, with `5x` / `6x` as extra lanes; each is now one note with `l` on its playable lane, and `#LNMODE` 1-3 (or `bmson.info.lnType`) becomes `info.ln_type`. A mine's base-36 value is now written as its `damage`, and mines take `#WAV00`, the BMS explosion sound, as their sample.
- Mines went to `key_channels`, which beatoraja reads as hidden notes: they now go to `mine_channels` with their `damage`, and BMS invisible objects (`3x` / `4x`), which became extra playable lanes in `sound_channels`, go to `key_channels` on the lane they sit on. A chart with mines or invisible objects no longer loses them when `skipPreservationValidation` is set.
- STOP lengths were written in BMS `#STOP` units instead of pulses, so a BMS chart's stops came back shortened: `stop_events[].duration` is now in pulses at the output resolution.
- `#RANK` was written as `info.judge_rank` (so `#RANK 2` became an almost zero-width window): a positive `#DEFEXRANK` is now written verbatim, `#RANK 0`–`4` maps to `33` / `67` / `100` / `133` / `167`, and any other `#RANK` leaves `judge_rank` out so the bmson default `100` applies.
- `#TOTAL` was written as `info.total`, a percentage of the player's default TOTAL (`#TOTAL 300` became 300%): a BMS / JSON chart's absolute TOTAL is now left out (the bmson default `100` applies), and `info.total` is written only from `bmson.info.total`, a bmson source's total.
- `stringifyBmson(json, { resolution })` at another resolution than the source bmson's rescaled the notes but not the preserved `lines`, so notes came back in later measures: the lines are now rescaled too.

A bmson source keeps its authored `judge_rank` and `total` on both the preserved and the regenerated output path.
