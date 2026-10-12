---
'@be-music/stringifier': patch
---

Fix `stringifyBms` losing a bmson chart's long notes, mine damage, `judge_rank` and `total`:

- A note with `l` now becomes a `#LNTYPE 1` long note on `5x` / `6x` that reads back as the same long note, and `#LNMODE` comes from `ln_type` / `t` when they agree (per-note types BMS cannot express are lost).
- A mine's value is now its `damage` in base 36 (rounded, clamped to `01`-`ZZ`, `04` when it has none) instead of a WAV slot that BMS players read as the damage, and its sample becomes `#WAV00`.
- `judge_rank` is now written as `#DEFEXRANK` (the same unit) instead of an out-of-range `#RANK`, and the percentage `total` is no longer written as an absolute `#TOTAL`.
