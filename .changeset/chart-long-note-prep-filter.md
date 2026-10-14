---
'@be-music/chart': patch
---

Resolve long notes with less sorting: `resolveBmsLongNotes` (used by `resolveChart` and the fingerprint) sorted every event of the chart to then keep only the `5x` / `6x` objects; it now picks those first and sorts only them (the sort is stable, so the order is the same). The fingerprint also remembers each event's exact position for the duration of one computation, since every `#RANDOM` outcome reads the same events again. The fingerprints are unchanged (checked on 5,537 real and 600 generated charts).
