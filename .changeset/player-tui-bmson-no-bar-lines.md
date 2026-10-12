---
'@be-music/player-tui': patch
---

Fix the terminal player drawing bar lines on a bmson chart with `lines: []`, which asks for none. The lane view now takes its bar lines from the resolved chart, as the web player does.
