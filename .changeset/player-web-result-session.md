---
'@be-music/player-web': minor
---

Add `createResultScene(kit, options)` to `@be-music/player-web/scenes`, the result screen built on the scene session and family view contracts (ADR 0001). Its session plays the result's jingle from the theme's sounds (`resolveResultJingles`: the course jingles for a course run) through the audio service and stops it as the screen leaves the stage, steps the screen as LR2's result timers do (Enter, Space or a click skip the graphs, then show the record update, then continue; Escape continues at any time), and plays the chart again on R once input is open when the run offers a quick retry (`resolveResultPresentation`) and `on.retry` is given. The built-in family's view draws a be-music skin's `result` screen. The scene is a `SessionScene` to show with `PixiSceneHost.setScene`; `updateKit` hands it the player's new skin settings. `ResultFrame` gains `graphShownAtMs` and `updateShownAtMs`, the result's steps (LR2's timers 151 and 152).
