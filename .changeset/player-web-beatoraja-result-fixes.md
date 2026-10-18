---
'@be-music/player-web': patch
---

beatoraja result and decide skin fixes:

- A result screen named every gauge NORMAL (`main_state.gauge_type()` and the gauge slab); it now names the gauge the play ended on, so a HARD play shows its HARD gauge and a course result its class gauge.
- A result screen could not be left on a phone or a tablet, as it took keys only. A tap (touch or pen) now presses on as Enter does once the skin's `input` has passed; a mouse click still does nothing there.
- A decide skin with `scene = 0` (or negative) left the screen waiting for a key, which a touch-only player could not press. The screen now moves on to the play at once and fades out over the skin's `fadeout`, as beatoraja's `MusicDecide` does; a skin without one still moves on after 3000 ms.
- A theme could play a voice clip instead of its clear jingle (ModernChic's `vo/<voice>/clear/clear.ogg` sorted before `Sound/clear.ogg`). The result and decide jingles now come from the folder holding the most of them, as beatoraja plays them from one sound set, then the shallowest, and an exact file name wins over a loose match, so `course_clear.wav` or `resultclose.wav` no longer stands in for `clear.wav` / `result.wav`.
