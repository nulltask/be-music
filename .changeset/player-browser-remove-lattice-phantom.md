---
'@be-music/player-browser': minor
---

Remove the Phantom and Lattice skins: `phantomSkin` and `latticeSkin` are no longer exported, and `BUILT_IN_BE_MUSIC_SKINS` holds Synesthesia, Plain and Native. Neither was shipped by the player. The playfield the built-in and LR2 families fall back to when a skin or theme leaves the lanes, notes, long notes or bombs to the host keeps its look; it no longer comes from Phantom. A stored skin id of `phantom` or `lattice` resolves to the default skin.
