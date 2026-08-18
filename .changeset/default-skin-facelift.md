---
'@be-music/player-web': minor
---

Redesign the default (skinless) gameplay chrome as a "night cabinet": near-black violet ground with cyan / magenta
neon accents and gold money values.

The built-in chrome was a set of flat panels: single-colour bars, flat note rectangles, a star-sparkle bomb, and an
amber judgement strip. The redesign keeps the same geometry contract (LR2 default 7-keys lane positions, 640x480
design canvas) and repaints everything on top of it:

- Notes are three-tone plastic keys (highlight / body / shade with an outline) in white / neon cyan / hot pink; long
  notes render as a translucent core with bright side rails and real head/tail caps.
- The judgement line is neon magenta and breathes with the beat; an LR2-style keyboard of glassy key caps sits under
  it, blazing on press with an under-glow strip and a gradient key beam.
- The groove gauge is LR2's 50-cell segmented bar — orange below the clear line, red-hot above it, flickering tip,
  threshold notch — labelled with the active ruleset's own gauge id, and survival gauges run the all-red scheme.
- The header HUD carries a mode pill, LED-style BPM / HI-SPEED readouts, a beat-pulsed accent trim, and a ruleset
  chip (LR2 / BEATORAJA / IIDX) so the compat mode is visible at a glance.
- The score panel shows a gold score headline and a DJ-level meter under EX RATE with the IIDX ninth-boundary ticks,
  so the distance to the next rank letter is legible mid-play.
- A live judge tally column (PG/GR/GD/BD/PR plus FAST / SLOW) sits beside the BGA monitor, which idles as a hex
  reticle with a crosshair instead of a black hole.
- The playfield gets dark-chrome side rails with a magenta song-progress pipe, and bombs are a two-stage burst:
  white-hot core, flame ring, rotating starburst spokes, ember dots, and a light pillar in the lane.
- Combo readouts tier their colour (white → cyan at 50 → gold at 200) and judge text carries a same-hue glow.

`SkinlessGameplayChromeRuntime` gains `nowMs`, `progressRatio`, `beatPhase`, `rulesetLabel`, `gaugeLabel`,
`gaugeSurvival`, `fast`, and `slow`.
