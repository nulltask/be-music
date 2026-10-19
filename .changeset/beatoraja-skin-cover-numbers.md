---
'@be-music/beatoraja-skin': patch
---

Play numbers 14 (lane cover) and 314 (LIFT) were in percent, so skins that divide them by 1000, such as ModernChic, showed them 10x too small, and 14 read wrong whenever the LIFT was raised. As beatoraja's `IntegerPropertyFactory` does, they are now `lanecover × 1000` and `lift × 1000`, truncated on `float`s, with the lane cover a fraction of the lane above the LIFT and read while the cover is off.
