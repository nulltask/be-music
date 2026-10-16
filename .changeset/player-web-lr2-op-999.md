---
'@be-music/player-web': patch
---

Fix the LR2 play screen never lighting op 999: it is a `#CUSTOMOPTION` op like 900-998 (OpenLR2 `GetOptionFlag_dst`), so a skin option that picks it now shows what it gates, as it already did on the select, decide and result screens.
