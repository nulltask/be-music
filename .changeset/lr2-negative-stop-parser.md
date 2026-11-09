---
'@be-music/chart-parser': patch
---

A zero or negative `#STOPxx` no longer replaces a positive definition of the same ID made earlier in the file, as in LR2, which stores only values above 0.
