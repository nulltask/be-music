---
'@be-music/player-web': minor
---

Replace the default (skinless) family chrome with original cut-in plates in navy / cyan / gold.

Layout and motion slam like a comic cut-in (skewed parallelograms, diagonal slashes, rotated stamps, per-piece overshoot). Colouring stays navy void with cyan accent and gold lock-on — not a crimson/black copy. The 640×480 geometry contract is unchanged (LR2 default 7-keys lane positions, PLAY / AUTO / SEARCH / list hit boxes).

- Notes are shallow parallelograms (scratch gold, odd-key ice, even-key cyan); long notes keep side rails and head/tail caps; bombs spray cyan/gold shards with a slash flash.
- Select, decide, gameplay, and result each wipe-open from a fully covered frame. Decide also wipe-closes on its last beat so gameplay can open from void instead of popping HUD onto the READY plate.
- HUD pieces stagger in with their own slam. Judge popups run slam → overshoot → hold → fade plus a chromatic ghost; combo and score punch on change; the select cursor eases between rows; result metrics count up and the rank slams after timer 151.
- Canvas chrome uses Dela Gothic One for body stamps and Staatliches for numeric / judge readouts. Host CSS outside the playfield still uses LINE Seed JP.

`SkinlessGameplayChromeRuntime` gains `sceneElapsedMs` so intros follow `PixiGameplayView.start()` rather than the wall-clock `nowMs` used for idle pulses. The default family now mounts a short skinless decide splash (about 1.5 s) when both decide and gameplay resolve to default.
