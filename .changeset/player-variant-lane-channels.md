---
'@be-music/player': minor
---

Add `resolvePlayVariantLaneChannels` to `@be-music/player/core/lane-layout`: the full lane set of a chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY) in rendering order, whether or not the chart puts notes on every lane. 9 KEY picks the PMS layout when the chart uses `22..25` and the BME layout otherwise, and lanes in use outside the variant are kept.
