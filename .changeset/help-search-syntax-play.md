---
'@be-music/app-play': patch
---

Help's Usage tab now explains the chart select search: plain text matches the title, subtitle, artist, genre or file name ignoring case, and text that starts with `?` is a chart filter (SQL `WHERE` clause with `ORDER BY` / `LIMIT`), with the columns it reads and examples that a test runs through the search. The old line said the search only covered the title, artist and genre.
