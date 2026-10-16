---
'@be-music/player-web': patch
---

The beatoraja select screen searches as the built-in and LR2 screens do: a chart also matches on its file label (where authors put hints such as `[ANOTHER]`), a course folder lists the courses whose name matches, and the search text is trimmed, so a search of spaces searches nothing. It used to match a chart's title, subtitle, artist and genre only, list every course of a course folder, and search for the spaces too.
