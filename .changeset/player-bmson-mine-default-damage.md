---
'@be-music/player': patch
---

Fix a bmson mine without `damage` taking its damage from the WAV slot the parser assigned to its channel, read as base 36: adding sound channels to a chart changed how much its mines hurt. Such a mine now deals the default 4 (%), the same fallback as an invalid BMS mine value. `resolveLandmineGaugeEffect` takes the chart's `sourceFormat` as an optional third argument for this.
