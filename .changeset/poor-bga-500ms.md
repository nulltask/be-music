---
'@be-music/player': patch
'@be-music/player-tui': patch
'@be-music/player-web': patch
---

Shorten the default POOR / miss BGA display window from 2000 ms to 500 ms, matching real LR2.

LR2 ships `<poorbga>500</poorbga>` in its `config.xml` and its changelog documents 500 ms as the
miss-BGA default, so the previous 2-second window held the miss layer four times longer than LR2.
`DEFAULT_POOR_BGA_DISPLAY_SECONDS` is shared by the TUI compositor and the web LR2 scene, so both
runtimes pick up the corrected timing.
