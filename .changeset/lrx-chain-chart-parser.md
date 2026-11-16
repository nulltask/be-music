---
'@be-music/chart-parser': patch
---

An LRX chain note records its lane in `lrx.chainLane` (a hidden one does not). Background sounds outside plugout's BGM mixer group (all but the BGM columns' notes with a non-zero `dmg`) are flagged `lrx.keyVolume`. Reading Be-Music JSON back keeps both.
