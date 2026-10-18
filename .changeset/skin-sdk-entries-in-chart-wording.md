---
'@be-music/skin-sdk': minor
---

The select list's entries and the play options are now `@be-music/scene-model`'s types, in the glossary's chart wording, and the list gains course bars. The SDK re-exports `LibraryChart`, `LibraryFolder`, `LibraryCourse`, `LibraryCourseStage`, `LibraryEntry` and `ChartSourceKind`; `BeMusicPlayOptions` is `PlayOptions` and `BeMusicPlayOptionChoices` is `PlayOptionChoices`. The `BeMusic*` names and the frames' `song`, `focusedSong` and `songRecord` are unchanged.

- `frame.entries` carries a chart bar as `{ kind: 'chart', chart }` and a folder's `charts`.
- A course bar is `{ kind: 'course', course }` (`LibraryCourse`, each stage matched to a local chart as `stage.chart`), and a course folder lists its `courses`. A course can be LR2's NEW COURSE bar that starts making a course (`newCourse`), one the player made (`editable`) or a beatoraja random course whose stages are drawn on start (`random`).
- `browseEntryTitle`, `browseEntryCount` and `browseEntryBadge` give a row's headline, size and badge for every entry kind: a NEW COURSE bar reads `make a course` / `NEW` and is left out of a folder's course count, and a random course reads `N stages · random` instead of counting its undrawn stages as missing.
- `BeMusicKeysFilter` adds `KEYS_24` and `KEYS_48` (beatoraja's 24-key modes), and `BeMusicSelectSort` adds `ARTIST`, `GENRE`, `BPM`, `NOTES` and `LASTPLAY` (beatoraja's sorts), the one list both skin families share. The choices a skin can set through `setPlayOption` / `cyclePlayOption` are unchanged.

Migration for skin authors:

- `entry.kind === 'song'` → `entry.kind === 'chart'`.
- `entry.song` → `entry.chart`.
- `folder.songs` → `folder.charts`.
- `BrowserSongEntry` → `LibraryChart`.
- `BrowserFolderNode` → `LibraryFolder`.
- `BrowserBrowseEntry` → `LibraryEntry`.
- `BrowserSongSourceKind` → `ChartSourceKind`.
- A skin that switches exhaustively over `entry.kind`, `BeMusicKeysFilter` or `BeMusicSelectSort` handles the new values or adds a default branch.
