---
'@be-music/player-web': minor
---

Add the be-music skin format and a second built-in skin, Synesthesia.

The default (skinless) family now renders through a `BeMusicSkin`: one object bundling the HUD chrome, lane, note, long-note, bomb, select, and result renderers over the fixed 640x480 design canvas. The shared scenes keep input, timing, and layout contracts and delegate everything they paint to the active skin, so skins can be swapped by passing `beMusicSkin` to `DefaultPixiGameplayView` / `DefaultPixiSongSelectView` / `DefaultPixiResultView` (or `PixiGameplayView` / `PixiSongSelectView` / `PixiResultView` for their skinless fallbacks).

- New exports: `BeMusicSkin` and its context types, `createBeMusicSkinRegistry`, `resolveBeMusicLaneKind`, `resolveSelectListWindow`, `phantomSkin`, `synesthesiaSkin`, and `BUILT_IN_BE_MUSIC_SKINS`.
- Phantom is the existing poster skin, unchanged in look and still the default.
- Synesthesia is inspired by the sound-and-light games of Tetsuya Mizuguchi: deep space with a streaming 3D starfield, a scrolling wireframe floor grid, glass panels, and colour that drifts with the song and swells on the beat. Hits detonate as perspective-projected 3D particle fountains with motion trails, tilted shockwave rings, a light pillar, a core flash, and an anamorphic streak. Select has a BPM-paced star tunnel, a tumbling wireframe icosahedron, and a ring of light orbiting the focused card; result has an entrance timeline with a 3D particle ring that bursts as the rank ignites. It draws with Michroma and M PLUS 1p, which hosts should load.
- Built-in skin text now rasterizes at the final device density (viewport scale x renderer resolution) instead of being magnified from the 640x480 design canvas, so labels and numbers stay crisp at any window size; glow shadows get texture padding so they no longer clip into hard rectangles.
- The Pixi renderer now uses the display's full `devicePixelRatio` instead of capping it at 2x, so 3x displays render the scenes at native density.
- Showpieces for both built-in skins: a count-in before the first beat (Phantom slashes READY? into GO!!, Synesthesia condenses READY and detonates a ring of light), a cut-in every 100 combo, a flourish when the gauge crosses the clear line, and a full-combo finale (Phantom's turning burst with confetti, Synesthesia's 3D spark sphere and prism rings). Phantom's result screen opens with an ink wipe carrying a giant RESULT slug.
- Synesthesia enters a zone as the combo builds: from 25 / 50 / 100 / 200 combo the stars speed up and multiply, the floor grid burns hotter, aurora ribbons and beat rings appear, stars smear into hyperspace streaks, and hits throw more sparks further. Overlapping hits now dim their white flash so colour stays the hero.
- `SkinlessGameplayChromeRuntime` gains `totalNotes` and `chartMs`, and the be-music lane and bomb contexts gain `combo`.
