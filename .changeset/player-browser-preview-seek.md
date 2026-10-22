---
'@be-music/player-browser': minor
---

Add `PlayScene.seek(seconds)`, a `seek` play intent and `PlayFrame.seekable`: an AUTO play moves to a chart second and plays on, restarting the engine there with the decoded samples, prepared notes and BGA kept. The Web Audio session starts sounds partway (`triggerEventAt`). `PixiSceneHost` keeps its canvas in the page only while the active scene draws on it, also before the first scene, and exposes the element it was mounted in as `container`.
