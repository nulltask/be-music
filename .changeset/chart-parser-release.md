---
'@be-music/chart-parser': patch
---

Report nonfatal chart warnings, and keep a positive `#STOPxx` over a later zero or negative one.

- Report nonfatal warnings when reading legacy bmson or a chart with an unknown or malformed mode hint.
- A zero or negative `#STOPxx` no longer replaces a positive definition of the same ID made earlier in the file, as in LR2, which stores only values above 0.
