---
'@be-music/player': patch
---

Two hot-loop optimisations:

- `core/engine.ts`: hoist `resolveBmsBase(resolvedJson)` and `resolvedJson.resources.wav` out of the autoplay tick into local constants. Both fields are immutable from the autoplay entry point on, but were re-walked dozens of times per second (LN body, every triggered sample, mine resolution).
- `judging.ts`: `lowerBoundBySeconds` now binary-searches `startIndex` when the caller declares `sortedBySeconds: true` and doesn't supply an explicit `startIndex`. Drops the per-call prefix scan from O(N) to O(log N) once the judge window opens deep into the chart.
