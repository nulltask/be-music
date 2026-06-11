---
'@be-music/player': patch
---

Fix four spec-compliance deviations found by the BMS spec audit:

- HARD / DEATH gauges now report FAILED when they bottom out at 0 % (previously `isGrooveGaugeCleared` treated 0 % as cleared).
- Dynamic `#EXRANKxx` (channel `A0`) values now go through the same `RANK 2 = 100` unit conversion as `#DEFEXRANK`, so `#EXRANK 100` restores exactly the NORMAL judgment width instead of widening it by 4/3.
- bmson `key_channels[].notes[].damage` is now applied as the mine's gauge damage, taking precedence over the BMS `value / 2` rule.
- `#SPEEDxx` now holds the first keyframe's value before its beat (Bemuse reference semantics) instead of ramping linearly from 1.0.
