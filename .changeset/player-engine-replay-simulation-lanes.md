---
'@be-music/player-engine': patch
---

Replay re-simulation is about 13% faster: each time advance walks the lanes as an array instead of a map iterator, skips sorting when it has fewer than two events, checks a mine's due points inline instead of through a fresh closure, and works out each mine's PGREAT reach once instead of on every advance. Results are unchanged.
