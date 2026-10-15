---
'@be-music/player': patch
---

Fix max combo and gauge differences between plays and their re-simulations caused by the order of judgments at nearby instants: the engine swept misses with one cursor across all lanes (missing a key note late behind a scratch note with a longer window), settled AUTO SCRATCH notes, tails and mine crossings in fixed groups per step, and replayed on a 1 ms grid, while the play-log simulator settled LN tails after every other judgment in a span. Both now settle every timed judgment at its own whole microsecond, misses at each note's deadline, and one instant tails first, then AUTO SCRATCH, then misses, then mines, each in channel order; replays step from one instant to the next.
