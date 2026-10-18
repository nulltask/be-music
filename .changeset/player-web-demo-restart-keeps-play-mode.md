---
'@be-music/player-web-demo': patch
---

Fix F5 during a play starting the chart again in another mode: an AUTO play started from a skin's AUTO button came back as a manual play, and a replay came back as a live play that could even write a best record, because the restart followed the Debug Menu's Auto play instead of the play's own mode. F5 now starts the chart again with the play's AUTO and replay, as R on its result already did.
