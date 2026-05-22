---
'@be-music/stringifier': minor
---

Add an opt-in `skipPreservationValidation` flag to `stringifyBmsJson` that bypasses the round-trip re-parse + canonical fallback. In-process pipelines that can guarantee the preservation arrays match the JSON (tests, SHA-stable exports) save a parse + diff pass per call. Default behaviour (validate + fallback) is unchanged.
