---
'@be-music/player-web': patch
---

Look cropped skin textures up without building a key string: `createCachedCroppedTexture` runs for every LR2 / beatoraja note, skin image, digit and gauge cell each frame, and keyed its cache by `${x}|${y}|${w}|${h}`. It now walks maps keyed by the numbers themselves (about 4x faster per lookup and no garbage), with the same notion of which frames are equal.
