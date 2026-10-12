---
'@be-music/chart': minor
---

Add the Be-Music Fingerprint (`bmfp1`, see docs/fingerprint-spec.md), which identifies a chart by what the player plays and sees in the lanes rather than by its bytes: `computeChartFingerprint` keeps the `#RANDOM` / `#SWITCH` branches as a tree to identify a chart file, `computePlayFingerprint` hashes the chart after its branches were chosen to identify one play, and `createChartFingerprintDocument` / `createPlayFingerprintDocument` / `canonicalizeFingerprintDocument` expose the canonical document behind them, so charts that differ only in BGA, BGM, keysounds, metadata, line order, `#WAV` numbering, measure resolution, decimal precision, or BMS against bmson share a fingerprint.
