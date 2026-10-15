---
'@be-music/player': patch
---

Fix beatoraja PMS long notes with a late BAD head waiting out the 200 ms release margin in live play: beatoraja holds a release back only when the judgment is BAD or worse and early, taking the head's timing when it was further off than the release. Pressing the lane again right after such a release now counts as a fresh press, as in play-log re-simulations.
