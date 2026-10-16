---
'@be-music/player-web': minor
---

`loadBeatorajaChartImages(chart, source)` (`@be-music/player-web/skin`) decodes a chart's `#STAGEFILE`, `#BACKBMP` and `#BANNER` for a beatoraja skin's synthetic image slots (-100, -101 and -102), each looked up next to the chart, then at the source's root, and `resolveBeatorajaChartImage(images, id)` reads one slot. This is the loader the web demo kept for the beatoraja scenes, moved into the package so a beatoraja family view loads a chart's images itself.
