---
'@be-music/player-web': patch
---

Switch a beatoraja skin's note lane layout when the op gating it changes mid-play, such as turning the lift on or off. The note layer cached its lane rects for the first op set it saw and never refreshed them, because the runtime adapter updates that one set in place every frame; it now caches on the `note.dst[]` block the ops select, so the lanes, judgement line and bar lines move with the layout while other frames still reuse the cached rects.
