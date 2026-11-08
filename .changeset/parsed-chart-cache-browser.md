---
'@be-music/player-browser': minor
---

Add `LoadProgressOptions.parsedChartCache`, a `ParsedChartCache` a host gives the chart collection loader to keep parsed charts across loads: the loader looks each chart file up by the SHA-256 of its bytes and the kind of its name (`parsedChartCacheKey`), parses only the charts it does not find, and keeps those. `parseChartThroughCache`, `parsedChartCacheKey` and `parsedChartPathKind` are exported with it. A cache that fails to read or write leaves the load parsing as before.
