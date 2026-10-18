---
'@be-music/player-web': patch
---

Fix the beatoraja result screen being impossible to leave on a phone or a tablet: it took keys only, as beatoraja does. A tap (a touch or a pen) now presses on as Enter does, once the skin's `input` has passed, then the screen fades out and continues. A mouse click still does nothing there. The beatoraja decide screen is unchanged: it moves on to the play by itself after its `scene`.
