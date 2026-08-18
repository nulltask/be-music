---
'@be-music/player-web': minor
---

Give the default (skinless) gameplay chrome an arcade-grade look.

The built-in chrome was a set of flat panels: single-colour bars, flat note rectangles, a star-sparkle bomb, and an
amber judgement strip. The redesign keeps the same geometry contract (LR2 default 7-keys lane positions, 640x480
design canvas) and repaints everything on top of it:

- Notes are three-tone plastic keys (highlight / body / shade with an outline) in white / blue / red; long notes
  render as a translucent core with bright side rails and real head/tail caps.
- The judgement line is red-hot with a glow, and an LR2-style keyboard of per-lane key caps sits under it, lighting
  up on press together with a gradient key beam.
- The groove gauge is LR2's 50-cell segmented bar: orange below the clear line, red-hot above it, flickering tip,
  and a threshold notch.
- The playfield gets metallic side rails, with a song-progress track filling bottom-up inside the left rail.
- A live judge tally column (PG/GR/GD/BD/PR) sits beside the BGA monitor, which now has corner brackets and an
  idle-state emblem instead of a black hole.
- Background is a deep-navy vertical gradient with a vignette; the status bar carries a mode pill and LED-style
  BPM / HI-SPEED readouts with baseline-aligned labels.
- Bombs are a two-stage burst: white-hot core, flame ring, rotating starburst spokes, ember dots, and a light
  pillar in the lane.

`SkinlessGameplayChromeRuntime` gains `nowMs` (chrome-side animation clock) and `progressRatio` (song progress).
