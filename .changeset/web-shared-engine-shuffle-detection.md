---
'@be-music/player-web': patch
---

Fix `buildSharedEngineChart` mistaking `random1P: 'OFF'` for an active
shuffle, which silently rewrote `#LNTYPE 1` LN-source channels (`5x`/`6x`)
to playable channels (`1x`/`2x`) on the chart handed to the shared engine.

`PixiGameplayView.options.random1P` / `random2P` default to the **string
`'OFF'`** (not `undefined`), so the previous early-return guard
(`!this.options.random1P && !this.options.random2P && !this.options.dpFlip`)
evaluated to `false` for the default config because `!'OFF'` is `false`.
The function therefore fell through to the post-shuffle remap path even
on charts the player loaded with shuffle disabled.

That mattered because the `collect(this.notes)` walk registers a remap
entry whenever `note.channel !== event.channel` — and for `#LNTYPE 1` LNs
that mismatch is **structural**: `extractTimedNotes` normalizes the LN
source channel (`51..59` / `61..69`) onto the matching playable lane
(`11..19` / `21..29`) on `note.channel` while `event.channel` keeps the
original `5x` / `6x`. Every LN HEAD ended up in `remap`, the eventual
`events.map` rewrote LN HEADs from `5x` to `1x`, and the engine's own
`extractTimedNotes` then saw 1P LN HEADs as plain playable shorts and
lost the ability to pair them as LNs (only TAILs remained on `5x`).

The view-vs-engine bucket diff matched exactly on a real chart (Tigerlily
Virtual Highway 99 7keysSPA, `#LNTYPE 1`, no `#RANDOM`):
`viewBuckets["5"]=240, engineBuckets["5"]=120` (HEADs gone) and
`engineBuckets["1"]` gained 120+6 entries (the 6 are 1P invisible-channel
notes, same kind of normalization mismatch). With the engine playable
array growing 68 entries longer than the view's, the index-based note
sync in `applyEngineFrame` flipped the wrong notes' `hit` flag, which
caused: notes vanishing off the lane in HIDE-on-judge mode, the full-
combo cue firing mid-chart, and AUTO PLAY exScore landing below the
EX-MAX 200_000 ceiling.

Treat `'OFF'` and `undefined` as "no shuffle" explicitly so the early
return actually fires for the common case and the engine sees the chart
events untouched. Charts that load with `random1P` / `random2P` set to a
real shuffle mode (`'MIRROR'`, `'RANDOM'`, `'S-RANDOM'`, `'SCATTER'`)
still go through the remap path as before; this fix is scoped to the
default no-shuffle case.

Unrelated to `#BASE 62` — the bug surfaces on any `#LNTYPE 1` chart
loaded without shuffle, regardless of base.
