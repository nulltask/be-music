---
'@be-music/player-web': patch
---

With HS-FIX on, the in-play HI-SPEED readout (LR2 number 10, the HS slider and the built-in HUD) showed the HS-FIX-scaled scroll speed (200 for a picked 3.0), and ArrowUp / ArrowDown stepped that scaled value, moving the player's hi-speed off its 0.1 grid (3.0 → 3.15). The readouts now show the player's hi-speed, as the select panel and the host do, and the hotkeys step it; HS-FIX still scales only the scroll.
