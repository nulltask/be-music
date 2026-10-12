---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` dropping a BMS chart's long notes and mine damage. `#LNOBJ` pairs and `5x` / `6x` long notes (`#LNTYPE 1` / `2`) used to become separate short notes, with `5x` / `6x` as extra lanes; each is now one note with `l` on its playable lane, and `#LNMODE` 1-3 becomes `info.ln_type`. A mine's base-36 value is now written as its `damage` instead of being lost, and the mines take `#WAV00`, the BMS explosion sound, as their sample instead of the WAV slot their value happens to name. A chart's `bmson.info.lnType` is also written as `info.ln_type` when the output is regenerated.
