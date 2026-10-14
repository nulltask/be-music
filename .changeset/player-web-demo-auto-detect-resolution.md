---
'@be-music/player-web-demo': minor
---

Pick the render resolution for the device automatically. Before the player has chosen one, the first select screen is benchmarked once, after it settles, and the result is stored. "Auto-detect resolution" in the Debug Menu's Skin & display folder runs the same benchmark on demand. It measures the frame rate at 1× and then at each higher resolution from the top down, and keeps the highest that holds the 1× frame rate, so a device whose CPU, not its resolution, limits the frame rate keeps its highest resolution. A run is dropped, with nothing stored, when the page is hidden or the first-run benchmark's select screen gives way to a play.
