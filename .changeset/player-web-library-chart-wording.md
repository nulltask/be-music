---
'@be-music/player-web': minor
---

The chart collection and the library entries it lists use chart wording: `BrowserSongCollection.songs` is `charts`, and the select scenes, the course loaders, the course maker and the built-in skins read a chart bar as `{ kind: 'chart', chart }`, a folder's `charts` and a course stage's `chart` (`@be-music/scene-model`'s library entries). `./collection` no longer re-exports the six `Browser*` entry aliases; the entry types come from `@be-music/scene-model`. `BrowserSongCollection`, `BrowserSongCollectionStore` and `BrowserSongAssetSource` keep their names.

Migration:

- `collection.songs` → `collection.charts`, and `{ sources, songs, errors }` → `{ sources, charts, errors }` when building a collection.
- `SelectStartEntry` and `SelectScene.focused()`: `{ kind: 'song', song }` → `{ kind: 'chart', chart }`; a course stage's `song` → `chart`.
- `BrowserSongEntry`, `BrowserFolderNode`, `BrowserCourseEntry`, `BrowserCourseStage`, `BrowserBrowseEntry`, `BrowserSongSourceKind` from `@be-music/player-web/collection` → `LibraryChart`, `LibraryFolder`, `LibraryCourse`, `LibraryCourseStage`, `LibraryEntry`, `ChartSourceKind` from `@be-music/scene-model`.
