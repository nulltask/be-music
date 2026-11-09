---
'@be-music/player-engine': minor
---

A NONSTOP RANDOM MIX now takes 1-99 stages, as an EXPERT one does, instead of at most five; it still has no endless count, which `resolveRandomMixCount` reads as five stages. `RANDOM_MIX_NONSTOP_MAX_COUNT` is removed, and `isRandomMixKept` now keeps any counted draw, however long. `createRandomMixCourse` gives a NONSTOP draw the default connection after every stage, past the five LR2's course maker sets and the ten an LR2 course hash holds.

`parseLR2CourseFile` and `serializeLR2CourseFile` take `options.maxStages`: reading defaults to the five stages LR2 plays and reads every stage with `Infinity`; writing defaults to every stage and writes only the first `maxStages` when given. `withNonstopConnection` keeps a long course's connections past the ten the hash holds.
