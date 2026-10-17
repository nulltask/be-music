---
'@be-music/player-web': minor
---

After a NONSTOP run the built-in and LR2 select screens put the cursor inside a song folder instead of on the course bar: the run replaces the collection, and restoring the saved cursor only looked among the song folders. It now finds course folders too. The rule is exported as `resolveSelectNavigation`.
