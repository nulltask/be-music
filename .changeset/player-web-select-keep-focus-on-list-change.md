---
'@be-music/player-web': patch
---

On the built-in and LR2 select screens, the cursor stays on the bar it was on when the sort or a filter changes (an LR2 skin's sort, key filter or difficulty filter button, a be-music skin's play option, or the host's `setPlayOptions`), and on the same row, clamped, when the filter takes that bar out. It used to go back to the top of the list, or, after the host's change, to stay on the same row whatever bar was there.
