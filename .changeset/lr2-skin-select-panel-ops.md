---
'@be-music/lr2-skin': minor
---

Fix the LR2 select screen lighting the open option panel's number as an op: opening panel 1 lit op 1 (the selected bar is a folder) and panel 3 op 3 (a course), so skins drew folder and course chrome over a song. The select state now lights LR2's panel ops, as OpenLR2's `GetOptionFlag_dst` does: op 20 while no panel is open and 21-29 while panel 1-9 is. `LR2_OP` names them (`NO_PANEL`, `PANEL1`-`PANEL9`).
