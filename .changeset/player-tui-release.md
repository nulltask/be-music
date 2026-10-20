---
'@be-music/player-tui': minor
---

Keep terminal playback, audio previews and chart summaries consistent with the shared chart and player rules.

- Resolve RANDOM/SWITCH outcomes once for both rendered audio and playback.
- Use the shared lane-mode and scored-note rules, including PMS, FREE ZONE and keyboard modes.
- Draw scroll gimmicks and negative-BPM reversal consistently, and keep BMP00 as the POOR image unless POORBGA is 2.
- Preserve detected key-release capabilities across plays in the same terminal process.

Migration: use canonical uppercase-abbreviation TUI and BGA API names.
