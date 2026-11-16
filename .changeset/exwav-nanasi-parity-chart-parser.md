---
'@be-music/chart-parser': patch
---

A `#WAVxx` after a slot's `#EXWAVxx` now redefines it, as nanasigroove 1.552 does: the later line wins, also across control flow, where the two now share one definition. Before, a valid `#EXWAVxx` always won.
