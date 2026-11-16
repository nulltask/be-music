---
'@be-music/chart-model': minor
---

Add `resolveBmsExWAVDeclarations`, the `#EXWAVxx` declarations no later `#WAVxx` redefined, which filename, volume and playback resolution now use. `#EXWAVxx` also reads nanasigroove 1.552's `r` rate multiplier (clamped to 1 at or below 0 and to 2 above it, applied after `f`) and a repeated flag letter, which replaces the earlier value; both used to make the line invalid.
