---
'@be-music/chart-model': patch
---

Play a BMS STOP without a positive `#STOPxx` (zero, negative or undefined) as LR2 does instead of ignoring it. LR2 never stores a STOP value at or below 0, so the slot keeps its initial `-1` and the STOP takes `1/192` of a measure (at the BPM in force) off everything after it. `createTimingResolver` now gives such a STOP a negative `StopPoint.seconds`, it takes part in the last-one-wins rule at its position, and `createBeatAtSecondsResolver` jumps the chart position ahead when the STOP is reached. The chart fingerprint (`bmfp0`) carries the STOP as `-1/48` beat, so charts with such a STOP get a new fingerprint. Non-positive bmson stops and `#STP` lines are still ignored.
