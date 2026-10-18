---
'@be-music/player-web-demo': patch
---

Fix the select screen opening on an old bar when another skin family takes it over: after a play or a course, browsing elsewhere and then dropping another family's theme (or picking another Skin system or LR2 theme in the Debug Menu) opened the new screen on the bar where the last play or course started, not where the cursor was. The place kept for the return is now used once, when the select screen comes back, so a screen made again later opens on the cursor as it is now; a drop still opens what it brought, and a course still returns to its course bar.
