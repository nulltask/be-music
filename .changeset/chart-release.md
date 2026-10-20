---
'@be-music/chart': minor
---

Provide a shared chart-resolution API for timing, judging, playback, rendering and fingerprinting.

- Add `resolveChart` with lazily computed playable notes, long notes, mines, invisible notes, sample triggers, tempo changes, bar lines, BGA cues, scroll and speed changes, judge-rank inputs and TOTAL.
- Expose timing resolvers, sample-trigger helpers and timeline builders through `@be-music/chart`.
- Define shared play-mode layouts for 5, 7, both 9-key layouts, 10, 14, 24 and 48 keys, including scratch, FREE ZONE and keyboard-wheel mappings.
- Evaluate RANDOM and SWITCH control flow from explicit `RandomDraws` so playback, replay and verification use the same branches.
- Add chart and play fingerprints with canonical fingerprint documents. Chart fingerprints preserve control-flow alternatives; play fingerprints identify the selected branches.
- Match LR2 negative-BPM reversal timing and display values, keep the last duplicated BMS STOP at a position, and preserve authored bmson bar lines.
- Reduce sorting work when resolving long notes.

Migration: use the canonical uppercase-abbreviation exports and fields. Timing and timeline APIs previously imported from the audio renderer or player now come from this package. Fingerprint version `bmfp0` remains a development format.
