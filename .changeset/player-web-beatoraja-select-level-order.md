---
'@be-music/player-web': patch
---

The beatoraja select screen's LEVEL sort reads a level written as text with its fraction (`12.5` after `12`) and orders charts of the same level by title, as the built-in and LR2 screens do. It used to cut a text level to its whole number and keep equal levels in the library's order.
