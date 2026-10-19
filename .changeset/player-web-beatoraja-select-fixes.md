---
'@be-music/player-web': patch
---

beatoraja select skin fixes:

- The beatoraja select screen browses as the built-in and LR2 screens do. A chart also matches a search on its file label (where authors put hints such as `[ANOTHER]`) and the search text is trimmed. TITLE, ARTIST and GENRE sort case-insensitively in the runtime's locale, LEVEL reads a level written as text with its fraction (`12.5` after `12`) and orders equal levels by title, and SORT orders the root folders too. Every folder bar stays listed under the MODE filter, where a folder with no chart of that mode vanished.
- After a play the screen came back on the first bar of the folder instead of the bar that was played; it now restores the live cursor at every depth.
- Its first load took the first file each `source[]` wildcard matched until the player changed an option; it now picks it by the skin's `filepath[]` options, as every other beatoraja screen does.
- A click on a bar's title text was sometimes lost to the bar list layer; only the row hit areas take clicks now.
- The select and decide screens showed the header BPM as the chart's main BPM (number 92); they now show the BPM the most judged notes sit at, on the chart as the play draws it. The max / min BPM come from the chart's tempo map.
