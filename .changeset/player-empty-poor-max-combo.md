---
'@be-music/player': patch
---

Fix the max combo ignoring combo breaks from empty POORs under beatoraja's five-key and PMS rules: the engine reset only the displayed combo, so the recorded max combo ran straight through an empty POOR while the play-log simulator broke it.
