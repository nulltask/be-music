---
'@be-music/player-engine': patch
---

Speed up beatoraja S-RANDOM by reusing the unheld lane lists and ordering empty, mine-only and hidden-note destinations once per row while preserving seeded arrangements.
