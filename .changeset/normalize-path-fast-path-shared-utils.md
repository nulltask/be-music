---
'@be-music/shared-utils': patch
---

`normalizePath` returns a path that is already normal without splitting it, which is nearly every path of a dropped folder.
