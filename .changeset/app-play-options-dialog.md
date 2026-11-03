---
'@be-music/app-play': patch
---

The Debug Menu is now the Options dialog: the header's Settings button opens a Basecoat dialog with one tab per area (Play, Tempo & course, Skin & display, Audio, Library, Leaderboard, Developer) instead of toggling the floating panel over the stage, and a gear on the play surface opens it in fullscreen, where the header is not shown. Every setting keeps its behaviour, its saved value and its lock during a play. The beatoraja Skin Config panel uses the same controls, its position offsets as x / y sliders. Its settings are now stored as `be-music.option-settings` and `be-music.option-folders`; the former `be-music.debug-menu-*` keys move there on the first visit. The `tweakpane` dependency is removed.
