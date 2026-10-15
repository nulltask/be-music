---
'@be-music/player': patch
---

Fix a press exactly on the edge of the widest judge window sometimes missing its note in live play (an empty POOR where a re-simulation of the play log judged the note): the engine looked for candidate notes by comparing float seconds, which can put a note a fraction of a microsecond beyond the edge. The search now compares whole microseconds, like the windows themselves.
