---
'@be-music/lr2-skin': patch
---

Fix LR2 numbers 109 / 154 on the play screen reading the EX score still needed for AAA: they now read LR2's distance to the next DJ Rank, the EX score less the next rank's border over every note (`floor(notes × 2 × (rank + 1) / 9)`), negative until the border is reached and counting down to the maximum from AAA (OpenLR2 `SetObjectValue_Num`). Number 109, which read nothing, is named `LR2_NUM.NEXT_RANK_DIFF_ALT`.
