---
'@be-music/lr2-skin': patch
---

Fix the LR2 select screen lighting no bar op on a folder bar: a folder now lights op 1 (`LR2_OP.FOLDER_BAR`), as LR2 does for its folder bars (OpenLR2 `GetOptionFlag_dst`), so the parts a skin draws only on folders (their song counts, their frames) show.
