---
'@be-music/player': patch
---

AUTO play resolved its ruleset as if the chart had no `#EXRANKxx` changes, and its no-TUI trace reported their windows without the `judgeWindowMs` override: `autoPlay` now resolves the same ruleset as `manualPlay`, so everything that reads the windows at a chart time sees the changes in both modes.
