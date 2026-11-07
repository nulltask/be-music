---
'@be-music/player-engine': minor
---

Make a RANDOM MIX one draw, and leave FREE ZONE out of the NONSTOP long-note check.

- Remove `loops` from `RandomMixConditions` and the `RANDOM_MIX_MAX_LOOPS` export: a RANDOM MIX is one draw. `normalizeRandomMixConditions` drops a stored `loops`.
- A NONSTOP stitch no longer switches to per-note bmson long-note types because of a stage's FREE ZONE notes, which are not long notes.
