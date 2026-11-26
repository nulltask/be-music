---
'@be-music/chart-source': patch
---

Collect a bmson node's unknown fields without allocating when it has none, which makes parsing a large bmson chart about 25% faster. Leave `bmson` unset on a cloned event that has none, so clones share the object shape of parsed events.
