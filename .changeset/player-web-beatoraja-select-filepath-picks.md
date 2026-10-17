---
'@be-music/player-web': patch
---

The beatoraja select screen's first load picks each `source[]` wildcard's file by the skin's `filepath[]` options (the header's default file the first time), as every other beatoraja screen does. It used to take the first file the wildcard matched until the player changed an option, so a skin whose default is not that first file drew other parts at first. `loadBeatorajaSceneKit` loses its `applyFilepathPicks` option, which only kept that behaviour.
