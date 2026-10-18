---
'@be-music/player-web-demo': patch
---

Fix a drop, a skin or theme change, or files or a play log loaded during a play losing the play's video recording and leaving its course run going: the next single play counted as the course's next stage, and leaving its result went on with the old course. Every scene change now finalizes a recording in progress, and one that the play, its result or its course did not ask for ends the course run, with the select screen back on the course bar. The Debug Menu's Skin system, Built-in skin, Skin effects, LR2 theme and Add skin buttons are disabled during a play, since they go back to the select screen.
