---
'@be-music/skin-sdk': minor
---

Take the library entry and play option types from `@be-music/scene-model`, where the select screen's models now live. The names a skin uses stay as aliases and the shapes are unchanged: `BrowserSongEntry` is `LibraryChart`, `BrowserFolderNode` is `LibraryFolder`, `BrowserCourseEntry` is `LibraryCourse`, `BrowserCourseStage` is `LibraryCourseStage`, `BrowserBrowseEntry` is `LibraryEntry`, `BrowserSongSourceKind` is `ChartSourceKind`, `BeMusicPlayOptions` is `PlayOptions` and `BeMusicPlayOptionChoices` is `PlayOptionChoices`.

Two value types grow to the one list both skin families share. Migration: a skin that switches over them exhaustively should handle the new values or add a default branch.

- `BeMusicKeysFilter` adds `KEYS_24` and `KEYS_48` (beatoraja's 24-key modes).
- `BeMusicSelectSort` adds `ARTIST`, `GENRE`, `BPM`, `NOTES` and `LASTPLAY` (beatoraja's sorts).

The choices a skin can set through `setPlayOption` / `cyclePlayOption` are unchanged.
