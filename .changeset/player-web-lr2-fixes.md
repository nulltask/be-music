---
'@be-music/player-web': patch
---

LR2 skin fixes:

- The decide and result screens lit the wrong key-mode op, guessed from the raw channels: a `.pms` 9 KEY chart showed as 10 KEY, and a 7 KEY chart whose 6th / 7th keys only carry `#LNTYPE` long notes as 5 KEY. They now take it from the chart's play variant, as the select screen does.
- Play skins never showed the red gauge frame on HARD / DEATH plays: the per-frame gauge refresh cleared op 43 and lit op 42 again. It now updates only the gauge-range ops (230-240).
- The play screen never lit op 999; it is a `#CUSTOMOPTION` op like 900-998 (OpenLR2 `GetOptionFlag_dst`).
- The decide screen moved on at once without starting timer 2; it now starts it as it moves on or backs out, draws the skin's fade-out elements and moves on once the skin's `#FADEOUT` has run, as LR2 does.
- The select screen's BPM range (numbers 90 / 91) came from a scan of channels `03` / `08`, so a channel `03` value that a `#BPMxx` change overrides could widen it. It now comes from the chart's tempo map.
- Chart bars drew no `#SRC_BAR_LAMP`; they now draw the lamp of the player's best record (`records.chart`).
- The search text (`#SRC_TEXT st=30`) stayed blank; it now shows the search word.
