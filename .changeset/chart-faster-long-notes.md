---
'@be-music/chart': patch
---

Resolve long notes with less sorting: `resolveBmsLongNotes` sorted every event of the chart to then keep only the `5x` / `6x` objects; it now picks those first and sorts only them. The sort is stable, so the result is the same.
