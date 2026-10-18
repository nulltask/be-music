---
'@be-music/player-web': patch
---

The beatoraja select screen's TITLE, ARTIST and GENRE sorts order the text case-insensitively in the runtime's locale, as the built-in and LR2 screens do, so texts that differ only in case keep the library's order. They used to sort in Japanese locale order, lower case before upper case.
