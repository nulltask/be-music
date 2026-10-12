---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` writing a BMS chart's `#TOTAL` as the bmson `info.total`: BMS `#TOTAL` is an absolute gauge TOTAL while bmson `total` is a percentage of the player's default TOTAL, so `#TOTAL 300` became 300% of the default. A BMS / JSON chart's absolute TOTAL is now left out (the bmson default `100` applies), and `info.total` is written only from `bmson.info.total` or a bmson source's total, which keep their authored value on both the preserved and the regenerated output path.
