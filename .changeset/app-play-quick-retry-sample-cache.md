---
'@be-music/app-play': patch
---

Quick retry (F5, and R on the result screen) of a chart with many samples reaches its first note much sooner: its decoded samples are kept from the play before, so NOW LOADING no longer waits for them to decode again. The retry is still a fresh play with a new replay and RANDOM draw. The kept samples are freed on going back to the select screen, on starting another chart and when the page is left (`pagehide`).
