---
'@be-music/app-play': patch
---

Fix a RANDOM MIX narrowed by difficulty that started nothing after OK. When every chart that fits changes BPM (common for ANOTHER or INSANE), the BPM range leaves no chart that can be stage 1, while the dialog still counted matches and accepted OK. OK now checks for a chart that can be stage 1 under the draw settings and, when none can, keeps the dialog open and says to widen the BPM range or limits.

The dialog's draw settings also gain Draw charts whose BPM changes (on by default): stage 1 may then change BPM, and the BPM limits and range place a chart by its max BPM, so charts with BPM changes are drawn too. Off, LR2's rule applies, where a BPM range limits stage 1 to charts that keep one BPM.
