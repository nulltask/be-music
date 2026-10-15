---
'@be-music/player': patch
---

Fix an LN released just before its tail scoring a BAD in live play and replays: the engine and the play-log simulator now share the ruleset's early-release rule, where LR2 keeps the head judgment unless the release comes more than the GOOD window early and beatoraja takes the worse of the head and the release judged against the long-note-end windows.
