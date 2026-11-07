---
'@be-music/app-play': patch
---

Fix a RANDOM MIX narrowed by difficulty that started nothing after OK. When every chart that fits changes BPM (common for ANOTHER or INSANE), the BPM range leaves no chart that can be stage 1, while the dialog still counted matches and accepted OK. OK now checks for a chart that can be stage 1 under the draw settings and, when none can, keeps the dialog open and says to widen the BPM range or limits.
