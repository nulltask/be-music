---
'@be-music/chart': minor
---

`resolveChartPlayVariant` accepts the chart's bmson `mode_hint` (`bmson.info.modeHint`) and resolves `keyboard-24k` / `keyboard-24k-double` to `24` / `48` outright, so a keyboard chart that only uses its first nine keys is no longer classified as 7 / 9 KEY. Other hints stay advisory.
