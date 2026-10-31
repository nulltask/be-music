---
'@be-music/chart-writer': patch
---

Preserve representable intrinsic slot gain as integer WAVCMD volume in BMS output. Reject lossy percentage conversion and unsupported bmson gain explicitly, including when preservation validation is skipped.
