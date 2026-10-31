---
'@be-music/chart-writer': patch
---

Omit `id` from bmson BGA event output when the source omitted it, instead of emitting an `id: 0` the chart never had.
