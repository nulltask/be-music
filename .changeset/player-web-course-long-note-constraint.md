---
'@be-music/player-web': patch
---

`applyCourseLongNoteConstraint` now lives in `@be-music/player/course`; `@be-music/player-web/collection` re-exports it, so existing imports keep working.
