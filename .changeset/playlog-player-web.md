---
'@be-music/player-web': minor
---

Record a play log (`*.bmplay.json` input replay) for every gameplay run: the LR2/default gameplay scene exposes it through `PixiGameplayResultData.playlog`, the beatoraja scene through `PixiBeatorajaGameplayView.getPlaylog()`, and the `@be-music/player-web/runtime` subpath re-exports the playlog serializer helpers (`serializePlaylog`, `parsePlaylog`, `resolvePlaylogFilename`) for hosts.
