---
'@be-music/scene-model': patch
---

Fix a replay of a `no_speed` course stage scrolling at the viewer's hi-speed while it showed the recorded covers. `reduceHiSpeed` ignored a replay's recorded hi-speed (`hi-speed-drawn`) while the course locked the hi-speed, though the recorded covers (`cover-set`) applied. The lock now stops only the player's own changes, so a replay shows the hi-speed and the covers as they were played. beatoraja's `no_speed` holds the two together too.
