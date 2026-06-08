---
'@be-music/player': patch
---

Align the manual-play empty-press lane keysound fallback with LR2 / beatoraja.

- Invisible `3x` / `4x` objects now always update a lane's current keysound during manual play, decoupled from the show-invisible debug overlay, so audio semantics no longer depend on rendering settings.
- An empty press falls back to the latest same-lane visible/invisible keysound whose early-BAD window has already opened, instead of sounding the next pending note before its judgment window opens.
