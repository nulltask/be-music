---
'@be-music/player-web': patch
---

Fix multiple gameplay regressions caused by a `extractTimedNotes` argument
mismatch between the view and the shared engine.

The view called `extractTimedNotes(resolved, { inferBmsLnTypeWhenMissing:
true, ... })` to build `this.notes`, but `runEngineDriver` did not forward
the flag, so the engine's own extract used the default `false`. On any
chart without an explicit `#LNTYPE` directive (= the majority of LN-bearing
BMS charts in the wild) the two callers therefore disagreed about whether
LN HEAD/TAIL pairs collapse into a single note (`endBeat`) or stay as two
separate notes:

- view sees N playable notes (HEAD-only, with `endBeat`)
- engine sees N + L playable notes (every LN counted as 2 entries)

`PixiGameplayView.applyEngineFrame` syncs the engine's `judged` flag onto
the view's runtime notes by index (`frameNotes[i].judged →
this.notes[i].hit = true`), and that index correspondence breaks the moment
the two arrays drift in length. The visible symptoms — all rooted in this
single bug — were:

- **Notes vanish before reaching the judgment line in HIDE-on-judge mode**:
  a `judged=true` flag sourced from a different (later) engine note
  crosses over and flips `note.hit = true` on a still-approaching view note.
- **Full-combo presentation fires partway through the chart**: the engine's
  `combo` counter advances faster than the view's `score.total` since the
  engine counts an extra entry per LN, so the view-side
  `tracker.combo === score.total` predicate trips early.
- **AUTO PLAY scores below the EX-MAX 200_000 ceiling**: when the engine's
  judge index lands on a note that the view (or `markScorableJudged`) has
  already accounted for, the score event is silently suppressed and the
  total exScore comes out short.

Fix: pass `inferBmsLnTypeWhenMissing: true` through `engineOptions` so the
engine's `extractTimedNotes` matches the view's. Long-term, the view should
use the engine's `frame.notes` as the authoritative array (or sync by event
identity) so this kind of independent-extract mismatch can't recur, but the
flag alignment is the minimum safe fix that restores the expected behaviour
for the whole class of regressions above.
