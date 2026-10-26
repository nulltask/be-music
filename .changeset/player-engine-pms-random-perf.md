---
'@be-music/player-engine': patch
---

Speed up PMS RANDOM_PLAYABLE (`randomizePMSPlayableLanes`) about 3× (10.2 ms → 3.1 ms on the benchmark, 24 ms → 9 ms on a dense 600-row chart) with the same permutation picked: chords are checked through their three-lane subsets against a lookup table, the search runs as one loop that records the valid permutations' ordinals, and the pick replays the order to the chosen one.
