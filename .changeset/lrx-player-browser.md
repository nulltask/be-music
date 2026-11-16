---
'@be-music/player-browser': minor
---

Accept LRX charts in dropped folders and archives: `.lrs` files are listed as charts and parsed with the `.lrh` header and `.lrm` BGA file found beside them (`ParseChartTaskInput.siblings`), cached under an `'lrx'` kind keyed by all three files, and their per-note values survive the collection's event packing.
