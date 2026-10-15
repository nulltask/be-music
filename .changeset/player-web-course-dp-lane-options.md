---
'@be-music/player-web': patch
---

A course's lane-option constraint left DP FLIP and the 2P lane option to the player's pick. `resolveCourseLaneOptions` (in place of `resolveCourseLaneOption`) now resolves both sides and FLIP together, as beatoraja's `MusicSelector` does: `grade` turns them all off, and `grade_mirror` plays a 1P MIRROR with 2P on MIRROR and FLIP on (any other pick turns them all off).
