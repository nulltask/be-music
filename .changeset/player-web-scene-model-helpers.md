---
'@be-music/player-web': patch
---

The select scenes' pure helpers now come from `@be-music/scene-model` and are re-exported unchanged: `matchesSearchQuery`, `wrappedCursorDelta`, `groupSongsByFolder` (`groupChartsByFolder`) and `resolveChartPlayVariant` (`resolveLibraryChartPlayVariant`); the built-in / LR2 select sorts and filters by difficulty with the browse model's rules, and `resolveSelectNavigation` restores through its `restoreBrowse`.
