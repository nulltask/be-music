---
'@be-music/player-web-demo': patch
---

Best record fixes:

- Best records are kept per judge ruleset. Plays under LR2, beatoraja and IIDX folded into one record per chart, although each ruleset has its own lamps, BP and scoring; the select screen now shows the current ruleset's records and switches when Judge windows changes. Records kept before this are read as LR2 records, the default ruleset, so a PERFECT or MAX lamp reads as FULL COMBO and an EX HARD lamp (a DEATH clear under LR2) as NORMAL.
- beatoraja plays were never recorded and their select lamps lasted only for the session. They now record under the same rules as the other families, and the beatoraja select lights each bar's lamp from the saved records.
- A record's BP left empty POORs out; it now counts each one once, as LR2, beatoraja and the Leaderboard do, on every family.
- Clear lamps are recorded on the judge ruleset's own lamps: with LR2 judging, a full combo is the top lamp and a DEATH clear is NORMAL.
- Saved play logs identify the web player that recorded them (`recorder`: app name, version, source commit and `web` platform).
