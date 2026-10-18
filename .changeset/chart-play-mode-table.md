---
'@be-music/chart': minor
---

Add the play-mode table, the single declaration of every play mode's lanes: `PLAY_MODE_LAYOUTS` lists each layout (5 / 7 / 9 PMS-STD / 9 BME-type / 10 / 14 / 24 / 48 KEY) left to right with each lane's kind, side, slot, colour class and BMS channels (visible, invisible, `#LNTYPE`, mine), plus the FREE ZONE channels it plays on its scratch, and `BMSON_MODE_HINT_LAYOUTS` gives the bmson `mode_hint` lane tables built from it. Look them up with `getPlayModeLayouts`, `findPlayModeLane`, `resolvePlayLaneChannels` and `resolveBmsonModeHintLayout`.

`resolveChartPlayVariant` is now the single lane-mode rule the engine, the CLI and the web player share:

- It accepts the chart's bmson `mode_hint` (`bmson.info.modeHint`) and resolves `keyboard-24k` / `keyboard-24k-double` to `24` / `48` outright, so a keyboard chart that only uses its first nine keys is no longer classified as 7 / 9 KEY. Other hints stay advisory.
- Fix the same chart being classified differently depending on its notation: `#LNTYPE` long notes on `5x` / `6x` now count as the lanes they occupy (an `#LNOBJ` chart with lane 8 notes was 7 KEY while its `#LNTYPE 1` twin was 5 KEY).
- The lanes in use decide 5 / 10 KEY against 7 / 14 KEY whatever the extension (a `.bme` chart without a 6 / 7 key column is 5 / 10 KEY, as in beatoraja); only `.pms` names a mode, and `chartPath` may be a bare extension such as `.pms`. A `#PLAYER 3` chart with a FREE ZONE on `17` and the IIDX 2P side stays IIDX DP.
