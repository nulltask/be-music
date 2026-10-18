---
'@be-music/player-web': minor
---

Every screen is now a scene session drawn by its skin family's view (ADR 0001). `createSelectScene`, `createDecideScene`, `createPlayScene` and `createResultScene` (`./host`) take a family kit and the scene's options and return a `SessionScene` to show with `PixiSceneHost.setScene`. The kit is `{ family: 'built-in', skin, settings?, effects? }`, `{ family: 'lr2', skin }` (with `invisibleNoteSkin` for a play) or `{ family: 'beatoraja', kit }` with a kit from `loadBeatorajaSceneKit`. The session owns the screen's behaviour once for every family (timing, keys, sound through the audio service, the chart and its media, the engine, the ending), and the view only draws the session's frames and hands back intents, so the three families behave alike. `updateKit` hands a scene the player's new skin settings and ignores a kit of another family. The kit, frame, intent and view types (`SelectKit`, `PlayFrame`, `SelectIntent`, `PlayView`, `PlayfieldSkin`, …) are exported with the host API.

Every scene has one lifecycle. `PixiScene` gains a required `identity` (a `SceneIdentity`, `{ kind, family }`) that says which screen it is and which family draws it, so a host reads what is showing from `getCurrentScene()?.identity`. A scene loads off stage and wires its keys, touch lanes and auto-pause only when it is entered, so keys pressed during a decide screen no longer reach the play loading behind it, where Space paused it and F5 or a held Backspace ended it before it began.

The scene classes of every family are removed with their option types: `DefaultPixiSongSelectView`, `PixiSongSelectView`, `PixiBeatorajaSelectScene`, `DefaultPixiDecideView`, `PixiDecideView`, `PixiBeatorajaDecideScene`, `DefaultPixiGameplayView`, `PixiGameplayView`, `PixiBeatorajaGameplayView`, `DefaultPixiResultView`, `PixiResultView` and `PixiBeatorajaResultScene`. The note for each `create*Scene` maps their options and methods.

Migration:

- `view.mount(host, …)` → make the scene with its `create*Scene`, then `await host.setScene(scene)`. `setScene` exits the scene it replaces; dispose a scene you are done with yourself.
- `select.setVisible(false)` → show another scene, or `host.setScene(undefined)`; `select.setVisible(true)` → `host.setScene(select)`. The select scene is kept across a play: its `exit()` pauses its BGM, preview and drawing, and entering it again replays the skin's entrance. `gameplay.setVisible` is removed.
- A `PixiScene` of your own → give it an `identity`.
