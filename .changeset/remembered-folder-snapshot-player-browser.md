---
'@be-music/player-browser': minor
---

Add `ChartCacheKeyBook`, `readParsedCharts` and `ParsedChartCache.getMany`, so a host that knows a chart file is unchanged lists it from the parsed-chart cache without opening, reading or hashing the file, a batch of charts per lookup. Parsed charts are also cheaper to copy across a worker and the cache: event columns are as narrow as their values allow, and the fields a chart list does not read travel as JSON text parsed on first use. Chart files are read while others are parsed, instead of one file per parse worker. The loader keeps each chart's SHA-256 and MD5 with it (`seedChartFileHashes`, `seededChartFileHashes`, `chartFileHashesOfCacheKey`), so hosts need not read a chart file again to hash it.
