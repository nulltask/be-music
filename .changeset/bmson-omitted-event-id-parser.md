---
'@be-music/chart-parser': patch
---

Stop writing `id: 0` into bmson BGA events that only carry `id_set`; the id stays absent in the IR.
