---
'@be-music/player-web': minor
---

Replace the default (skinless) family chrome with an original ice-clock look: void navy, ice-cyan piping, gold lock-on, inverted triangles, and clock rings.

The previous night-cabinet pass was a static neon cabinet. This keeps the same 640×480 geometry contract (LR2 default 7-keys lane positions, PLAY / AUTO / SEARCH / list hit boxes) and rebuilds every skinless scene around per-element motion plus screen-to-screen iris covers:

- Notes are shallow parallelograms (scratch gold, odd-key ice, even-key cyan); long notes keep side rails and head/tail caps; bombs spray cyan/gold shards instead of a star burst.
- Select, decide, gameplay, and result each iris-open from a fully covered frame. Decide also iris-closes on its last beat so gameplay can open from void instead of popping HUD onto the READY plate.
- HUD pieces stagger in (header, playfield, BGA, gauge, song, score, tally). Judge popups run pop → overshoot → hold → fade; combo and score punch on change; the select cursor eases between rows; result metrics count up and the rank punches after timer 151.
- Canvas chrome uses Zen Kaku Gothic New for body text and Rajdhani for numeric / judge readouts. Host CSS outside the playfield still uses LINE Seed JP.

`SkinlessGameplayChromeRuntime` gains `sceneElapsedMs` so intros follow `PixiGameplayView.start()` rather than the wall-clock `nowMs` used for idle pulses. The default family now mounts a short skinless decide splash (about 1.5 s) when both decide and gameplay resolve to default.
