---
'@be-music/player': patch
---

Fix the play-log simulator treating a lane held by two keys as released when either key came up: a mine crossing it then did not detonate, while the engine (and beatoraja, where any key on the lane counts) did. The simulator now tracks which keys hold each lane, as the engine does.
