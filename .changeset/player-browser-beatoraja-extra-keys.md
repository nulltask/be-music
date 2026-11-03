---
'@be-music/player-browser': minor
---

beatoraja's extra select screen keys. Ctrl+F3 and Ctrl+Shift+F3 ask the host to copy the focused chart's MD5 and SHA-256 (`SelectSessionEvents.copyChartHash`), F10 hands the host the charts of the focused folder to play in AUTO one after the other (`SelectSessionEvents.autoplayFolder`), 8 opens the folder the focused chart is in, out of a search or a favourites list, and 9 opens its text file. A key table operation can now ask for Ctrl (or ⌘) and Shift (`ControlActionDefinition.modifiers`).
