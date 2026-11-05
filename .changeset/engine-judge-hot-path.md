---
'@be-music/player-engine': patch
---

The judge loop allocates far less per frame: it no longer builds empty due lists, sorts empty long-note and HCN maps, or allocates AUTO SCRATCH closures on frames where nothing falls due. Play notes and mines now carry every field from creation in one order (absent fields are `undefined`), and the head-only long-note modifier clears tails by assignment instead of `delete`, so V8 keeps them in one hidden class instead of dictionary mode.
