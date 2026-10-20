---
'@be-music/beatoraja-skin': minor
---

Provide `@be-music/beatoraja-skin/scene` with deterministic resolvers for select, decide, play, result and course screens, including numbers, text, options, timers, graphs, offsets and system sounds.

- Extend named skin IDs for course constraints, stages, random-course bars, folder statistics and note density.
- Resolve skin fallback consistently across IIDX, PMS and keyboard modes, and expose the selected fallback variant.
- Match beatoraja's rank, main BPM, lane-cover and LIFT values, including per-mille cover readouts.
- Load Lua skins without unnecessary console output.

Migration: use the canonical uppercase-abbreviation API names. Resolve clear lamps with `@be-music/player/ruleset` and map them with `beatorajaClearLampOp`; `computeClearLampOp` is removed.
