---
'@be-music/lr2-skin': patch
---

`pickLr2PlaySkin` passes the chart's bmson `mode_hint` to the lane-mode rule, so a bmson keyboard chart picks the keyboard-mode fallback chain even when it only uses its first nine keys.
