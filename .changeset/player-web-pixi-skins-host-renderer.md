---
'@be-music/player-web': patch
---

Fix unsteady frame rates with the built-in skins, most visible on tablets: each Pixi skin screen ran its own WebGL context and the player copied its whole canvas into a texture every frame. The built-in Pixi skins (Synesthesia, Phantom, Lattice) now draw through the player's own renderer into a render texture, so the extra context and the per-frame canvas copy are gone. Synesthesia's charge cloud gains WGSL versions of its shaders so this also works when the player renders with WebGPU. Third-party skins keep drawing on their canvas as before.
