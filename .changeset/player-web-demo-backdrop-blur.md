---
'@be-music/player-web-demo': patch
---

The Debug Menu and the other frosted panels are blurred again in Chromium browsers: the production CSS kept only `-webkit-backdrop-filter`, which Chromium ignores, because the minifier folded the prefixed declaration that followed the standard one. The Debug Menu background is also slightly more opaque so its text stays readable over busy charts.
