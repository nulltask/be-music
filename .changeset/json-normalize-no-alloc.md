---
'@be-music/json': patch
---

`normalizeChannel` and `normalizeObjectKey` return an already-normalized two-character value as is instead of building a new string. They run once per event in the resolvers' and the fingerprint's loops, where nearly every value is already normalized.
