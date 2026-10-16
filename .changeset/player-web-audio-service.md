---
'@be-music/player-web': minor
---

Add `createAudioService` to `@be-music/player-web/runtime`, the one audio service the scenes are moving to (ADR 0007): the select BGM, cues, jingles, chart preview and beatoraja skin sounds play on one lazily created system `AudioContext` behind the master volume, each sound is decoded once per bytes, every sound can carry an owner so a scene stops what it started on exit (`stopOwned`), and `openPlayGraph` opens a play's own `interactive` context and audio bus. No scene uses it yet.
