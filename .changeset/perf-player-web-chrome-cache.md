---
'@be-music/player-web': patch
---

Precompute `sortedChromeEntries` (tagged union over image / number / text / button / onMouse / slider) once per LR2 select-scene skin reference. The previous render path merged six arrays into `work[]` and called `.sort()` every frame; the underlying skin is frozen after parse so the order is static. Per-frame visibility (op gating, panel-open gating, DST keyframe evaluation) still happens during the switch dispatch — only the merge / sort step is hoisted out.
