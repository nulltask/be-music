---
'@be-music/chart': minor
---

Add `computeFingerprintOfDocument`, which hashes a fingerprint document built elsewhere (for example one a client sent to a server) into the same `bmfp0:` string `computeChartFingerprint` / `computePlayFingerprint` return for it, so a verifier can check a claimed fingerprint against its document without the chart file.
