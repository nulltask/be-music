---
'@be-music/app-play': minor
---

Keep parsed charts in this browser (IndexedDB `be-music-charts`), keyed by the SHA-256 of each chart file, so a folder dropped again, or reloaded, lists its charts without parsing them again. A new build clears what an earlier build parsed. The Local data viewer lists the new database.
