---
'@be-music/chart-model': minor
---

Remove helpers that implemented superseded interpretations: `parseBMSSwBGA`, `pickSwitchingBGAFrame` and `BMSSwitchingBGA` (cue-driven SWBGA; use `parseBMSKeyBoundBGA` and the A5 timeline), `resolveBmsBmpARGB` (slot tint; use `resolveBmsExBMPColorKey` and the A1–A4 tint timeline), and `wavCmdVolumeByteToLinearGain` (use `wavCmdVolumePercentToLinearGain`).
Rename `BMSExWAV.volumeCentibels` to `volumeMillibels` and `exWAVVolumeCentibelsToLinearGain` to `exWAVVolumeMillibelsToLinearGain`: the value is in hundredths of a decibel (millibels), not centibels.
