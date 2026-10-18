---
'@be-music/player-web': patch
---

Fix the beatoraja timing visualizer and timing distribution graph drawing late judgments on the right, mirrored from beatoraja: early judgments now sit right of the centre and late ones left, as beatoraja draws a judgment's offset (note time minus press time). The visualizer's judge-window bands flip with the samples, so beatoraja's BAD (220 ms early, 280 ms late on 7 KEY) reaches further on the left, and the distribution graph's average and deviation guides move to the same side as its bars.
