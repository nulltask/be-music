---
'@be-music/app-play': minor
---

Keep what the player reads from difficulty tables and Bemuse music servers in this browser, so opening the player again asks those sites for nothing for a day and a site that is down stays listed from its last copy.

- Difficulty-table pages, headers and song lists, and Bemuse server indexes, are kept for a day; a song's Bemuse asset index, charts and preview check are kept until the server's index lists the song differently.
- Bemuse sound chunks are kept on disk (up to 1 GiB, oldest use first out), so a song played again downloads nothing.
- Files asked for again go as revalidations, so a server that sends validators answers an unchanged file with a 304.
- Reload folders (F8 / F2 on the select screen, and a new button in Options → Library & records) asks the tables and servers again at once.
