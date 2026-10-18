---
'@be-music/player-web': patch
---

Steadier frame rates and faster loading:

- The built-in Pixi skins (Synesthesia, Phantom, Lattice) draw through the player's own renderer into a render texture, where each screen ran its own WebGL context and the player copied its whole canvas into a texture every frame; frame rates were unsteady, most visibly on tablets. Synesthesia's charge cloud gains WGSL shaders, so this also works when the player renders with WebGPU. Third-party skins keep drawing on their canvas.
- The LR2 play screen keeps Pixi's draw list stable between frames: its bitmap-text layer is re-attached only when it is not already on top, and each text keeps its glyphs while its string, size, tint and alpha stay the same.
- Cropped skin textures are looked up by their numbers instead of a key string per sprite (about 4x faster per lookup, no garbage), for every LR2 / beatoraja note, image, digit and gauge cell each frame.
- The beatoraja note and bar-line layers walk only the notes and markers in reach under LR2's drawing rules, keeping LR2's draw cursor between frames, and the current BPM is read with a binary search.
- The beatoraja skin view builds its Lua context and each destination group's offset ids once, instead of allocating them per element every frame.
- The shared playfield keeps its lane geometry until the lanes, play variant, layout or stage change, and the HUD reuses the frame's beat.
- Dropped folders scan faster (2,000 charts from about 6-9 s to 4.5-5 s, with the parser's changes): the song list's note count comes from `countScoredNotes` instead of timing the whole chart, the play variant is worked out once, chart paths sort with one `Intl.Collator`, and a large load looks two-character ids up in a table built once it has looked up 2,048 values, so a small load costs what it did.
