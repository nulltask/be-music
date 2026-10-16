---
'@be-music/lr2-skin': patch
---

Fix LR2 number 102 drawing the frame rate on the play screen: 102 / 103 now draw the score rate LR2 draws there, the EX score as a percentage of the highest one for the notes judged so far, with its two digits after the dot on 103 (which drew the whole rate times 100). 115 / 116, the rate over every note, are truncated as LR2 does instead of rounded, on the play and the result screens alike (OpenLR2 `SetObjectValue_Num`). The `LR2_NUM.SCORE_RATE` / `TOTAL_RATE` descriptions, which had the two swapped, say so.
