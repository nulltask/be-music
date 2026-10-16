---
'@be-music/lr2-skin': patch
---

Fix the LR2 result screen drawing the chart's title on text 20: LR2 reuses text 20 there for the internet ranking's message (OpenLR2 `SaveResult` clears it and `ProcI_Result` sets it), so with no internet ranking it now reads empty. Texts 21-29 still repeat the chart's texts as on the other screens.
