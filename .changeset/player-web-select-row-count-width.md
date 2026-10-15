---
'@be-music/player-web': patch
---

Fix a course row's count cut short on the built-in selects (`4 stages · 1` for `4 stages · 1 missing`): a folder or course row's count now takes the width it needs, up to a cap, and the title gets the rest, instead of a fixed 64-84 px.
