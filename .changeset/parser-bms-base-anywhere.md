---
'@be-music/parser': patch
---

Fix `#BASE 62` being ignored when it follows the first object line: the parser now reads `#BASE` from the whole file before decoding, and the last `#BASE 36` / `#BASE 62` line wins, as in beatoraja.
