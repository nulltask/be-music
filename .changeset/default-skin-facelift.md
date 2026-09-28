---
'@be-music/player-web': minor
---

Redesign the default (skinless) skin family in a "Phantom" poster style: ink-black ground, blood-red slabs and halftone fields, slanted paper plates, jagged starbursts, and condensed italic type. Gameplay, song select, and result all share the new look while keeping the same geometry contract (LR2 default 7-keys lane positions, 640x480 design canvas, unchanged select hit areas).

- Gameplay chrome: sawtooth header kicker that swells on the beat, slanted mode / ruleset tags, a halftone floor wedge under a slanted score plate with a starburst rank badge, a segmented slanted-cell groove gauge, a paper "track card" song plate, ransom-note judge tally chips, and a BGA monitor that idles on a turning starburst "STAND BY" screen.
- The playfield stays deliberately plain and IIDX-like: flat white / blue / red notes, solid-rail long notes, a red judgement line, and a simple ring-and-core hit flash, so reading is never traded for style.
- Judgement words and all live numerals (score, EX score, combo, gauge, tally, BPM / HI-SPEED) use Anton with tabular figures, laid out per glyph in fixed-width cells so changing values never jitter sideways.
- Song select: red halftone slab with a drifting dot field, a starburst that pulses at the focused chart's BPM, speed streaks, a scrolling header kicker, a beat-kicking row pointer, a glint sweeping the focused card, a staggered fly-in of the song list on entry, and a slide-in of the focused card and title on every cursor move. PLAY is now the primary (larger) action and AUTO PLAY secondary.
- Result: an entrance timeline — the red halftone slash sweeps in, the STAGE CLEAR / FAILED tag slams down, metric plates and judgement rows slide in one after another while every counter rolls up, count bars grow, run graphs draw left to right, and the rank burst pops before its letter stamps down. Afterwards the burst keeps turning and pulsing, the halftone drifts, the header kicker scrolls, speed streaks rake across, and a glint sweeps the verdict tag; a skip jumps straight to the settled layout.
- Type stack: Anton for Latin display text, Dela Gothic One for song titles, and M PLUS 1p for small UI and Japanese text, with LINE Seed JP as the fallback. Hosts should load these faces (the demo does via Google Fonts).

`SkinlessGameplayChromeRuntime` gains `nowMs`, `progressRatio`, `beatPhase`, `rulesetLabel`, `gaugeLabel`, `gaugeSurvival`, `fast`, and `slow`.
