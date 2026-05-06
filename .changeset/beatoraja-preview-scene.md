---
'@be-music/player-web': minor
'@be-music/player-web-demo': patch
---

Add a beatoraja-skin preview scene reachable from the demo's debug menu.

`BeatorajaPlaySkinPreviewScene` mounts a `BeatorajaPlaySkinView` inside the shared `PixiSceneHost`, fits it to
the screen, and ticks it from `performance.now()` so cycle-based animations (key beams, hidden cover, bombs)
play. No engine signals yet — every runtime op-code (judge / combo / score / lamp) stays on its initial
frame.

The demo gains a "Beatoraja preview" folder in the debug menu with a variant dropdown (`7 / 5 / 14 / 10 / 9`)
and an "Open preview" button. Pressing the button after a beatoraja theme has been dropped builds the texture
cache, mounts the preview scene, and pipes ESC to close it back to the song-select view. The texture cache is
disposed on theme replacement so a re-drop doesn't strand GPU allocations from the previous theme.

Engine integration (notes / judge / combo / lamp) lands in follow-up patches; this commit completes the
parser → renderer → on-screen pipeline for the chartable variants.
