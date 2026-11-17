---
'@be-music/app-play': patch
---

Start-up with a remembered folder no longer walks the folder or reads its chart files before the select screen shows: the folder's file listing and each chart's parse key are kept from the last load, the charts come from the parsed-chart cache in batches, and the folder is walked afterwards in a worker to pick up what changed on disk. A library of 4,500 charts (150,000 files) that took about 4 seconds to list now takes under 1. Course stages and best records take each chart's file hashes from the load, so a library with courses or difficulty tables is no longer read again in full after every start.
