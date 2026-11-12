---
'@be-music/chart-model': minor
---

Expose chart load warnings, play a non-positive STOP as LR2 does, and add chart BASE-SPEED and charatbeatHDX BGA placement.

- Expose nonfatal warnings on resolved charts, including dropped stacked bmson notes, undefined references and rejected chart options.
- Add `keysOutBGALayerBlack(json, bmpKey?)`, and let `usesMonophonicWAVPlayback(json, sampleKey?)` take a slot: both follow a slot's own format from `resources.bmpSourceFormat` / `resources.wavSourceFormat`, so a BMS stage in a NONSTOP chart stitched as bmson keeps restarting keysounds on retrigger and keying out layer black. `ResolvedChart.volumeChanges` now also lists the 97 / 98 changes of a bmson chart stitched from BMS stages.
- Compile initial nanasigroove CRA-RHS declarations as chart BASE-SPEED and include the rate in gameplay fingerprints.
- Compile charatbeatHDX BGAMODE declarations into the display program.
- Play a BMS STOP without a positive `#STOPxx` (zero, negative or undefined) as LR2 does instead of ignoring it. LR2 never stores a STOP value at or below 0, so the slot keeps its initial `-1` and the STOP takes `1/192` of a measure (at the BPM in force) off everything after it. `createTimingResolver` now gives such a STOP a negative `StopPoint.seconds`, it takes part in the last-one-wins rule at its position, and `createBeatAtSecondsResolver` jumps the chart position ahead when the STOP is reached. The chart fingerprint (`bmfp0`) carries the STOP as `-1/48` beat, so charts with such a STOP get a new fingerprint. Non-positive bmson stops and `#STP` lines are still ignored.
