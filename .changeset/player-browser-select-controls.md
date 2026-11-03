---
'@be-music/player-browser': minor
---

The select screen takes LR2's and beatoraja's lane keys, and That-Which-Must-Not-Be-Named PC's where they clash with neither. On LR2 skins (and the built-in skins with LR2's keys) the turntable scrolls, the white keys start the bar, the black keys back out, key 6 starts it in AUTO, → opens a folder, Tab opens the PLAY OPTION panel, 2 steps the sort, 3 the key mode filter and 0 opens the search. On beatoraja skins the turntable scrolls, key 1 and → play, key 3 opens a folder, key 5 starts in AUTO, keys 2 / 4 and ← close the folder, 1 / 2 / 3 step the key mode filter / sort / LN mode in beatoraja's orders, 0 searches, and F8 / F9 mark favourites.

The PLAY OPTION panel now opens on a tap and stays open until the next press, or shows only while START is held (`PANEL_HOLD_MS`). Its 1P keys follow LR2's panel 1: key 1 steps the key mode filter (it stepped DP FLIP), key 3 the battle mode, or DP FLIP with a double-play filter (it stepped the 2P random).

`PlayScene.takesKey` says whether one of the chart's lanes takes a key, and `resolveControlActions` is exported.
