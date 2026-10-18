---
'@be-music/player-web-demo': patch
---

Fix a course's play log being auto-saved by the "Auto-save play history" checkbox as it was when the course result showed: it could be changed on a stage result between stages, so the course log and its last stage's log disagreed. The course log is now saved by the setting as it was when its last stage started, as a single play's log is.
