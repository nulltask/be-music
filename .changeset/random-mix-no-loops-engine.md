---
'@be-music/player-engine': minor
---

Remove `loops` from `RandomMixConditions` and the `RANDOM_MIX_MAX_LOOPS` export: a RANDOM MIX is one draw. `normalizeRandomMixConditions` drops a stored `loops`.
