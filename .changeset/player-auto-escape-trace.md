---
'@be-music/player': patch
---

The no-TUI trace of an ESC-aborted AUTO play ended with `kind:playback-end reason:complete`: it now reports `reason:escape`, as a manual play's does.
