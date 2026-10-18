---
'@be-music/scene-model': minor
---

The library entries use the glossary's chart wording instead of the browser player's song wording: a chart bar is `{ kind: 'chart', chart }`, a folder lists its `charts`, a course stage names its `chart`, and a `Library` holds `charts`. The type names were already `Library*`; now their fields match, and `libraryEntryKey`, `browseEntries`, `focusedChart`, the sort, the filters, the search, the course view and the select cues read the new fields.

Migration:

- `LibraryEntry` `{ kind: 'song', song }` → `{ kind: 'chart', chart }`: check `entry.kind === 'chart'` and read `entry.chart`.
- `LibraryFolder.songs` → `LibraryFolder.charts`.
- `LibraryCourseStage.song` → `LibraryCourseStage.chart`.
- `Library.songs` → `Library.charts`.
