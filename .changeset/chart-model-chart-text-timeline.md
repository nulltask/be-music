---
'@be-music/chart-model': minor
---

Add deterministic chart-text timeline construction and lookup for BMS channel 99, including quote decoding, replacement/clearing, missing references and separate TEXT00 miss metadata. Stop treating channel 99 as a sample trigger, preventing an unrelated WAV from sounding.
