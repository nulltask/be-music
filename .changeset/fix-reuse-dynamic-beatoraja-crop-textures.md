---
'@be-music/player-web': patch
---

Cache dynamic beatoraja crop textures across frames in the skin view so animated sprite layers no longer allocate a fresh cropped `Texture` per tick. Frees the GC pressure that surfaced as periodic stalls on sprite-heavy beatoraja themes.
