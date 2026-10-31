---
'@be-music/chart-model': patch
---

An `id_set`-only bmson `bga_events` or `poor_events` entry no longer clears the BGA. As beatoraja reads its default id 0, it shows header id 0 when one exists and otherwise changes nothing.
