---
'@be-music/chart-writer': patch
---

Serialize a BMS object line without copying its events, build bmson notes as one object shape, and work out each position's pulse grid once, which makes writing a large chart 12% to 29% faster.
