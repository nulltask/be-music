---
'@be-music/player-web': patch
---

The select scenes' pure helpers now come from `@be-music/scene-model` and are re-exported unchanged: `DEFAULT_PLAY_OPTIONS` and the option cycles, `resolveSkinPlayOptionValue` / `cycleSkinPlayOptionValue` (the scene model's `resolvePlayOptionValue` / `cyclePlayOptionValue`), `matchesSearchQuery`, `wrappedCursorDelta`, the hi-speed range and steps, `groupSongsByFolder` (`groupChartsByFolder`) and `resolveChartPlayVariant` (`resolveLibraryChartPlayVariant`). `resolveSelectNavigation` restores through the scene model's `restoreBrowse`. `PixiKeysFilter` and `PixiSelectSort` take the scene model's wider value lists (beatoraja's 24-key filters and sorts).
