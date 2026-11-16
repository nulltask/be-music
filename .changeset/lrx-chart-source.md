---
'@be-music/chart-source': minor
---

Add LRX as a source format: `sourceFormat: 'lrx'`, the per-note `BeMusicEvent.lrx` values (long-note length, chain flag, volume, pan, frequency, envelope, slice, reverse, damage, recover), the chart-level `BeMusicJSON.lrx` header values, `LRX_TICKS_PER_BEAT`, and the `unsupported-lane-type` / `unsupported-channel` diagnostics. `cloneJSON` copies them.
