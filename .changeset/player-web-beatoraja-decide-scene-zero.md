---
'@be-music/player-web': patch
---

A beatoraja decide skin with `scene = 0` no longer leaves the screen waiting for a key, which a touch-only player could not press: the screen moves on to the play at once and fades out over the skin's `fadeout`, as beatoraja's `MusicDecide` starts its fade-out once `nowtime > scene`. A negative `scene` does the same; a skin without one still moves on after 3000 ms.
