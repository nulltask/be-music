---
'@be-music/player-web': patch
---

Scan dropped folders faster (2,000 charts went from about 6-9 s to 4.5-5 s, together with the parser changes): the note count each song shows now comes from `countScoredNotes` instead of resolving and timing the whole chart, the play variant it worked out is reused instead of computed again, the chart paths sort with one `Intl.Collator('ja')` instead of `localeCompare` per comparison, and the packed event table looks two-character ids up by their character codes. The song list is unchanged.
