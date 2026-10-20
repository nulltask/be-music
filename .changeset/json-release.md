---
'@be-music/json': minor
---

Use canonical uppercase abbreviations in Be-Music types, helpers and JSON keys, including `BeMusicJSON`, `BMSResources`, `createEmptyJSON`, `cloneJSON`, `backBMP`, `initBPM`, `baseBPM`, `exWAV` and `poorBGA`. External BMS and bmson spellings remain unchanged.

- Model bmson mine channels and scroll events, preserving authored scroll events during cloning.
- Mark control-flow headers overridden by a later top-level definition with `overriddenByLaterHeader`.
- Avoid allocating replacement strings for already-normalized channels and object keys.

Migration: update consumers of the former type, helper and JSON key spellings. Deprecated long-note and damage fields on hidden-note entries are not interpreted as mines.
