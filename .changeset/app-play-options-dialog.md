---
'@be-music/app-play': patch
---

The Debug Menu is now the Options dialog: the header's Settings button opens a Basecoat dialog with one tab per area (Play, Tempo & course, Skin & display, Audio, Library, Leaderboard, Developer) instead of toggling the floating panel over the stage. Nothing in it folds, Play options splits its many options into pages, and a **?** beside each option shows Help's description of it on hover. A gear on the play surface opens it in fullscreen, where the header is not shown. Every setting keeps its behaviour, its saved value and its lock during a play. The beatoraja Skin Config panel uses the same controls, its position offsets as x / y sliders. Its settings are now stored as `be-music.option-settings`; values saved under the former `be-music.debug-menu-*` keys are not carried over. The `tweakpane` dependency is removed.
