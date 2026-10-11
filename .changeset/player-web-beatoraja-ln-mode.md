---
'@be-music/player-web': patch
---

Fix the beatoraja select screen showing a chart's LN mode one step off: `#LNMODE` counts from 1 (1 = LN, 2 = CN, 3 = HCN), so a CN chart showed as HCN and an HCN chart as LN. The authored value is now mapped onto the LNMODE button index before it is shown or cycled.
