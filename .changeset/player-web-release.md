---
'@be-music/player-web': minor
---

Provide shared select, decide, play and result scene sessions for built-in, LR2 and beatoraja skins, with family-specific views over one scene model.

- Expose the host API through `/host`, skin loading through `/skin`, library/course handling through `/collection`, audio through `/audio` and video capture through `/recording`.
- Use one audio service for system sounds, previews, jingles and gameplay, with shared master volume and platform audio-session handling.
- Load LR2/beatoraja course files, difficulty-table courses and random courses; support course drafting, constraints, stage carry-over, trophies and stitched NONSTOP transitions.
- Support live hi-speed control, lane covers, tempo and pitch modes, lazy-loaded Signalsmith Stretch with WSOLA fallback, keyboard-wheel lanes and configurable render resolution.
- Record MP4 or WebM with codec selection and seekable output, using Mediabunny 1.61.6. Remove mp4-muxer and ts-ebml, avoiding their Node-polyfill requirements.
- Preserve random outcomes, recording state, replay inputs and scene transitions consistently; support quick retry and holding Backspace to quit.
- Match LR2/beatoraja note drawing, negative-BPM reversal, BGA/POOR layers, NONSTOP BGA cross-fades, failure timing, result lamps, rank values, density readouts and theme sounds.
- Preserve browse position, filters and search across scene changes, improve frame stability and loading, and cap either canvas dimension at 4096 pixels.

Migration: replace `/scenes` with `/host` scene factories. Audio and capture exports formerly under `/runtime` move to `/audio` and `/recording`; `/chart` preview APIs move to `/audio`. Use library models from `@be-music/scene-model`, chart timing from `@be-music/chart`, skin contracts from `@be-music/skin-sdk` and play logs from `@be-music/player/playlog`. Use canonical uppercase-abbreviation names.
