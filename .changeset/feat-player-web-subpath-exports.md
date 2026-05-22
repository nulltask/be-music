---
'@be-music/player-web': minor
---

Split `@be-music/player-web`'s public surface from a single grab-bag `./` entry into five per-area subpaths: `./scenes`, `./skin`, `./chart`, `./collection`, `./runtime`. The main `.` export keeps re-exporting everything, so existing imports continue to work unchanged. New code should prefer the per-area subpaths to make the dependency surface explicit (e.g. importing only from `@be-music/player-web/scenes` shows the consumer doesn't reach into chart preprocessing or song-collection helpers).
