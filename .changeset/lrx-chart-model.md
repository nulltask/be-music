---
'@be-music/chart-model': minor
---

Resolve LRX charts: a lane note with a length is a CN lasting its ticks, and `resolveChartPlayVariant` reads the LRX `lanetype` (`ChartPlayVariantInput.lrx`) before the lane rules, so a 10-key chart that leaves the 2P scratch and first key empty is not read as PMS. The fingerprint reads LRX long-note ends from their ticks and carries the `lanetype` among its lane-mode inputs.
