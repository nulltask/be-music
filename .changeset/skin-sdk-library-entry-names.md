---
'@be-music/skin-sdk': minor
---

The select list's entries use their `@be-music/scene-model` names and chart wording. The six `Browser*` aliases are removed; the SDK re-exports `LibraryChart`, `LibraryFolder`, `LibraryCourse`, `LibraryCourseStage`, `LibraryEntry` and `ChartSourceKind` instead, and `frame.entries` carries a chart bar as `{ kind: 'chart', chart }`, a folder's `charts` and a course stage's `chart`. `browseEntryTitle`, `browseEntryCount`, `browseEntryBadge` and `describeCourseCard` read the new fields. The `BeMusic*` aliases and the frames' `song`, `focusedSong` and `songRecord` are unchanged.

Migration for be-music skin authors:

- `entry.kind === 'song'` → `entry.kind === 'chart'`.
- `entry.song` → `entry.chart`.
- `folder.songs` → `folder.charts`.
- `stage.song` → `stage.chart`.
- `BrowserSongEntry` → `LibraryChart`.
- `BrowserFolderNode` → `LibraryFolder`.
- `BrowserCourseEntry` → `LibraryCourse`.
- `BrowserCourseStage` → `LibraryCourseStage`.
- `BrowserBrowseEntry` → `LibraryEntry`.
- `BrowserSongSourceKind` → `ChartSourceKind`.
