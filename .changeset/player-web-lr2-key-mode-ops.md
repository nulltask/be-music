---
'@be-music/player-web': patch
---

Fix the LR2 decide and result screens lighting the wrong key-mode op: they guessed it from the raw channels, so a `.pms` 9 KEY chart showed as 10 KEY and a 7 KEY chart whose 6th / 7th keys only carry `#LNTYPE` long notes showed as 5 KEY. Both screens now use the select screen's op, which comes from the chart's play variant.
