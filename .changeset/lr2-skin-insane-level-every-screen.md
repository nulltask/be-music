---
'@be-music/lr2-skin': patch
---

Fix LR2 text 29 (the INSANE level) reading nothing on the decide, play and result screens: LR2 sets texts 10-29 on the select screen and keeps them through the screens that follow (OpenLR2 `ProcS_Select`), so they now draw it as the select screen does.
