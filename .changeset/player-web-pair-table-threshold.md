---
'@be-music/player-web': patch
---

Fix a small-load slowdown from the collection scan speed-up: every load allocated and filled a 64 KB table for two-character ids, which made loading a single song about 10 µs slower. The table is now built only once a load has looked up 2,048 values, so small loads cost what they did before and large scans keep the gain.
