---
'@be-music/player-web': minor
---

Let hosts remember and set the hi-speed. The gameplay scenes report in-play hi-speed changes through `onHiSpeedChange` and take a new value mid-play through `setHiSpeed`; the beatoraja gameplay scene also takes `initialHiSpeed`, so it no longer always starts at the engine's 1.0×. The shared range is exported as `HISPEED_MIN` / `HISPEED_MAX` / `HISPEED_STEP` / `DEFAULT_HISPEED`, with `snapHiSpeed(value)` to snap and clamp a value into it.
