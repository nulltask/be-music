---
'@be-music/player-web-demo': patch
---

Read the library in chart wording: the demo takes `LibraryChart`, `LibraryCourse` and `LibraryEntry` from `@be-music/scene-model` and reads `collection.charts`, chart bars as `{ kind: 'chart', chart }` and each course stage's `chart`. The test hook keeps contract v1: a chart bar is still reported as `kind: 'song'`, and `state().library.songs` counts the collection's charts.
