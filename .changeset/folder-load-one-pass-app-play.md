---
'@be-music/app-play': patch
---

Saved folders read again at startup no longer load one at a time: every readable folder is listed first and their charts are then parsed in one pass, as a drop of several folders is, so the progress counts to one total and the select screen comes back once instead of after each folder. The folder reload (LR2's F8, beatoraja's F2) also lists every load again, with a running count, before parsing all of their charts in one pass. Saved folders with the same name are listed under numbered names (`BMS (2)`) so their files keep apart.
