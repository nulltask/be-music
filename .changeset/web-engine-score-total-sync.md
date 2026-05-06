---
'@be-music/player-web': patch
---

Sync `score.total` from the engine's authoritative `summary.total` in
`applyEngineFrame` so the view's full-combo predicate
(`tracker.combo === score.total`) sees the same scorable population the
engine is judging against.

Previously the view computed `score.total` independently in `prepareSong`
from `notes.filter(isPlayableInputChannel).length` (which counts every
`1x` / `2x` channel including Free-Zone), while the engine's
`summary.total` is `scorableNotes.length` (Free-Zone excluded). On Free-
Zone charts the two diverge by the Free-Zone count, so `tracker.combo`
(driven by the engine, capped at `scorableNotes.length`) can never reach
the view's larger `score.total` and the full-combo cue never fires. The
view now mirrors `summary.total` on every frame so both sides agree on
the scorable count.
