---
'@be-music/player-web': patch
---

Yield to macrotasks while parsing a large chart so the page stays responsive (loading overlay animation, scrollbar, click handlers) and the browser doesn't flag the tab as unresponsive on multi-MB BMS / BMSON files.
