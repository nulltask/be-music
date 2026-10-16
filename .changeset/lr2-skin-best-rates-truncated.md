---
'@be-music/lr2-skin': patch
---

Fix the LR2 result screen rounding the best record's rates: number 73 (the EX score rate) and 85-89 (each judgement as a percentage of the notes) are now truncated to whole percents as LR2 draws them (OpenLR2 `SetObjectValue_Num`), so an 89.5 % play reads 89, not 90.
