---
'@be-music/scene-model': minor
---

Add `@be-music/scene-model`, the runtime-neutral models of what every screen shows and how it behaves, so the built-in, LR2 and beatoraja families can share one implementation per screen and only draw:

- Library: the charts, folders and courses a select screen lists (`LibraryChart`, `LibraryFolder`, `LibraryCourse`, `LibraryCourseStage`, `LibraryEntry`, `Library`), the root folders (`groupChartsByFolder`, `libraryRootFolders`), a chart's play variant and key mode (`resolveLibraryChartPlayVariant`, `seedLibraryChartPlayVariant`, `resolveLibraryChartKeyMode`) and the key naming a bar across rebuilds (`libraryEntryKey`).
- Browse: the folder stack, cursor, search, sort, filters and favourites as one immutable state (`BrowseState`, `createBrowseState`), changed by commands that report what happened (`reduceBrowse`), the list derived from it (`browseEntries`, `listEntriesAt`, `focusedEntry`, `focusedChart`, `focusedCourse`), its rules on their own (`matchesSearchQuery`, `sortLibraryEntries`, `chartMatchesDifficultyFilter`, `chartMatchesKeysFilter`, `courseMatchesKeysFilter`, `wrappedCursorDelta`) and its snapshot (`captureBrowse`, `restoreBrowse`), with adapters from the snapshots the select scenes keep today (`browseSnapshotFromSelectNavigation`, `browseSnapshotFromBeatorajaSelect`).
- Play options: `PlayOptions` and its value types, `DEFAULT_PLAY_OPTIONS`, each option's choices in LR2 button order (`PLAY_OPTION_CHOICES` and the `*_CYCLE` lists), validation and cycling (`resolvePlayOptionValue`, `resolvePlayOptions`, `cyclePlayOptionValue`, `nextChoice`, `isListPlayOption`) and the hi-speed range (`snapHiSpeed`, `stepPlayerHiSpeed`, `easeHiSpeed`, `HiSpeedTransition`).

Where the built-in / LR2 and beatoraja select scenes differed, the browse model follows LR2, and beatoraja for what LR2 does not have; docs/scene-model.md lists each choice.
