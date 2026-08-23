---
'@be-music/chart': minor
---

Recognize the 24-key (Keyboardmania) lane channels, so charts authored past the classic nine columns classify and extract like any other playable chart.

`ChartPlayVariant` gains `'24'` and `'48'`. `resolveChartPlayVariant` now checks the extended lane channels (`1A..1Z` / `2A..2Z`) before every other rule and returns `'48'` when the chart also uses the 2P side, `'24'` otherwise — ahead of the `.pms` extension, the `#PLAYER 3` + `17` POPN-9 signature, and the "full `11..19` 1P keyboard" rule, each of which a 24-key chart would otherwise trip.

The `<side><lane>` channel predicates accept the extended `A`-`Z` lane codes alongside the classic `1`-`9`: `isPlayableChannel` (`1X` / `2X`), `isLandmineChannel` (`DX` / `EX`), `isBmsLongNoteChannel` (`5X` / `6X`), and `isPlayLaneSoundChannel`. `mapBmsLongNoteChannelToPlayable` maps the extended long-note columns onto their playable counterparts (`5A` → `1A`, `6O` → `2O`).
