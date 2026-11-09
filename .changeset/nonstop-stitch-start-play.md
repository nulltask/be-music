---
'@be-music/app-play': patch
---

Fix the page freezing when a NONSTOP course starts or restarts from a large library: the stages' files are looked up ahead of the stitch a slice at a time, so the select screen keeps drawing, and the stitch itself no longer scans every file of the library.
