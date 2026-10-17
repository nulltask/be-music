---
'@be-music/player-web': minor
---

Add the contracts the scenes are moving to (ADR 0001), exported from `@be-music/player-web/scenes`: the family kits a host hands each skin family (`SelectKit`, `DecideKit`, `PlayKit`, `ResultKit`), `FamilyView` with the select, decide, play and result frames and intents a scene session and its view exchange, `PlayfieldSkin` for the shared playfield, and `SessionScene`, the `PixiScene` that runs a session with its view (ticker, keys to the session, intents from the view). No scene uses them yet.
