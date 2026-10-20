---
'@be-music/audio-renderer': minor
---

Render chart audio using the shared chart timing and sample-trigger rules, including parent-folder keysound lookup, valid #VOLWAV ranges and LR2 negative-BPM reversal behavior. Update ogg-opus-decoder to 1.7.5.

Migration: use `renderJSON` and the uppercase-abbreviation API names. Import timing resolvers, sample-trigger helpers and their types from `@be-music/chart`; the renderer root exports rendering APIs only, and `@be-music/audio-renderer/triggers` is removed.
