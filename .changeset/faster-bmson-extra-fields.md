---
'@be-music/chart-source': patch
---

Collect a bmson node's unknown fields without allocating when it has none, which makes parsing a large bmson chart about 30% faster.
