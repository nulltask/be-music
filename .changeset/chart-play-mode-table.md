---
'@be-music/chart': minor
---

Add the play-mode table, the single declaration of every play mode's lanes: `PLAY_MODE_LAYOUTS` lists each layout (5 / 7 / 9 PMS-STD / 9 BME-type / 10 / 14 / 24 / 48 KEY) left to right with each lane's kind, side, slot, colour class and BMS channels (visible, invisible, `#LNTYPE`, mine), plus the FREE ZONE channels it plays on its scratch, and `BMSON_MODE_HINT_LAYOUTS` gives the bmson `mode_hint` lane tables built from it. Look them up with `getPlayModeLayouts`, `findPlayModeLane`, `resolvePlayLaneChannels` and `resolveBmsonModeHintLayout`.
