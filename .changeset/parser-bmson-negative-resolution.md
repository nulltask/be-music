---
'@be-music/parser': patch
---

Fix a negative bmson `resolution` falling back to 240: it is now read as its absolute value, as the bmson 1.0.0 spec says, so notes keep their authored spacing.
