---
'@be-music/player-web': minor
---

Every scene now runs on one lifecycle: the built-in and LR2 select, decide, gameplay and result views implement `PixiScene` like the beatoraja scenes (`root`, `identity`, `enter(host)`, `exit()`, `dispose()`), are shown with `PixiSceneHost.setScene`, and no longer add themselves to the stage. `PixiScene.identity` (a `SceneIdentity`, `{ kind, family }`) says which screen a scene is and which skin family draws it, so a host reads what is showing from `getCurrentScene()?.identity`. The select view is kept alive across a play as before: its `exit()` pauses its BGM, chart preview and drawing, and entering it again replays the skin's entrance.

`CoreGameplayView.prepare()` loads the play without touching the stage or adding listeners; the play's keys, touch lanes and auto-pause are wired when the scene is entered. Keys pressed during a decide splash therefore no longer reach the play prepared behind it, where Space paused it, the arrow keys changed its hi-speed, and F5 or a held Backspace ended it before it began.

Migration:

- Select: `view.mount(host)` → `host.setScene(view)`.
- Decide: `view.mount(host, target)` → `view.setTarget(target)`, then `host.setScene(view)`.
- Result: `view.mount(host, result)` → `view.setResult(result)`, then `host.setScene(view)`.
- Gameplay: `view.mount(host, song, source)` → `await host.setScene(view)`, `await view.prepare(host, song, source)`, then `view.start()`. To load behind another screen, `prepare` first, then `setScene` and `start` when it is time.
- `select.setVisible(false)` → show another scene, or `host.setScene(undefined)`; `select.setVisible(true)` → `host.setScene(select)`. `gameplay.setVisible` is removed.
- `setScene` only exits the scene it replaces: dispose a scene you are done with yourself.
