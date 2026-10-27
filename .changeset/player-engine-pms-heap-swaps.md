---
'@be-music/player-engine': patch
---

PMS playable RANDOM picks its permutation about twice as fast: the search walks a once-built table of Heap's algorithm's swaps instead of its counter bookkeeping, skips the mirror by its ordinal, and reuses one buffer for the valid ordinals instead of allocating 1.4 MB per call. The picked permutation is unchanged.
