---
'@be-music/scene-model': minor
---

Add `@be-music/scene-model`, the runtime-neutral models of what every screen shows and how it behaves, so the built-in, LR2 and beatoraja families can share one implementation per screen and only draw:

- Library: the charts, folders and courses a select screen lists (`LibraryChart`, `LibraryFolder`, `LibraryCourse`, `LibraryCourseStage`, `LibraryEntry`, `Library`), the root folders (`groupChartsByFolder`, `libraryRootFolders`), a chart's play variant and key mode (`resolveLibraryChartPlayVariant`, `seedLibraryChartPlayVariant`, `resolveLibraryChartKeyMode`) and the key naming a bar across rebuilds (`libraryEntryKey`).
