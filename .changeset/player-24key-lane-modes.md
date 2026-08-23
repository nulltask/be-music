---
'@be-music/player': minor
---

Drive 24 KEY SP / 48 KEY DP charts end to end — the extended lane channels are now scorable notes, not just a display-mode guess.

`extractTimedNotes` / `extractPlayableNotes` accept objects on the extended lane columns (`1A..1O` / `2A..2O`, plus the matching `3X`/`4X` invisible, `5X`/`6X` long-note, and `DX`/`EX` landmine families), so they land in `summary.total`, get judged, and reach the renderer. `ChartPlayVariant` gains `'24'` / `'48'`, and `resolveSideKeySlot`, `resolveLaneChannels`, and `createLaneBindings` resolve the 24 scratch-less columns per side in ascending channel order. `resolveLr2LaneIndex` returns `-1` for these variants because LR2 skins only define the 20 IIDX lane rects — hosts fall back to their own playfield instead of squeezing 24 lanes into the 7-key table.

FREE ZONE is now variant-aware. Channels `17` / `27` only get the quarter-note FREE ZONE tail on the IIDX families; under `9 KEY` and the keyboard modes they are ordinary key columns, so a tap stays a tap and a `#LNOBJ` tail is no longer shadowed by the phantom one-beat tail. The variant is taken from the new `playVariant` extraction option when the host supplies one (`preparePlaybackChartData` forwards `PlayerOptions.playVariant`), and is otherwise classified from the chart the first time a `17` / `27` object appears.
