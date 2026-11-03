---
'@be-music/player-browser': patch
---

Gameplay frames take much less main-thread time on Safari, and somewhat less on Chrome: the built-in Pixi skins' HUD text no longer rasterizes its labels and digits again almost every frame. The renderer keeps the last 128 text textures no `Text` uses any more, so a digit that leaves and comes back reuses its texture; an animated glow or outline colour is rounded to 16 levels per channel, so it gives the text a new style only when it crosses a step; and a pooled `Text` goes back to the string it showed last frame. On the Synesthesia skin this cut WebKit's per-frame script time by about a third and Chromium's by about an eighth.
