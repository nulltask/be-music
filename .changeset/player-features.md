---
'@be-music/player': minor
---

Engine-side gameplay improvements:

- **Landmine notes** — apply the chart-encoded damage value
  (default 4) on a manual mine hit; play `#WAV00` as the
  explosion sample so users get audible feedback consistent
  with LR2's mine semantics.
- **空 POOR (empty POOR)** — fire the LR2-compatible "phantom
  press" verdict when the player presses a lane key with no
  note in window. Drains the gauge per gauge type without
  breaking combo or scoring, and triggers the POOR BGA
  swap window — matching real LR2 behaviour.
- **Lanczos image resize option** — opt-in resampling for
  `#STAGEFILE` / `#BANNER` / `#BACKBMP` so high-res chart
  graphics down-scale cleanly to skin slot sizes instead of
  using the default nearest-neighbour path.
- **Gradual TUI note height option** — render notes that
  span multiple terminal rows as a vertically-tweened
  gradient rather than a hard-edged block, so close note
  pairs read as distinct rather than fused.
