---
'@be-music/player-web-demo': minor
---

Pick the render resolution for the device. Before the player has chosen one, the demo renders at 1.5× instead of the display's full `devicePixelRatio`, so an iPad holds 60 fps (it fell under 30 fps at 2×), and benchmarks the first select screen once it settles, storing the result: the frame rate is measured at 1× and then at each higher resolution from the top down, and the highest that holds the 1× frame rate is kept, so a device limited by its CPU rather than its resolution keeps its highest resolution. A run is dropped, storing nothing, when the page is hidden or a play replaces the select screen. The Debug Menu's Skin & display folder gains Render resolution, from 1× up to the display's ratio in 0.5 steps and remembered, and Auto-detect resolution, which runs the benchmark on demand.
