---
'@be-music/chart': patch
---

Fix `resolveChartPlayVariant` classifying the same chart differently depending on its notation and host: `#LNTYPE` long notes on `5x` / `6x` now count as the lanes they occupy (an `#LNOBJ` chart with lane 8 notes was 7 KEY while its `#LNTYPE 1` twin was 5 KEY). The rule now also carries the documented `.bme` completion (a `.bme` chart without a 6 / 7 key column is 7 / 14 KEY) and keeps a `#PLAYER 3` chart with a FREE ZONE on `17` and the IIDX 2P side as IIDX DP, so the engine and the CLI can use it as their single lane-mode rule. `chartPath` may also be a bare extension such as `.bme`.
