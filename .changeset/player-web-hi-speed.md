---
'@be-music/player-web': minor
---

Let a host remember and set the hi-speed. `createPlayScene` starts at the `initialHiSpeed` setting on every family (a beatoraja play always started at 1.0×), reports the player's changes through `on.hiSpeed`, and takes a new value mid-play with `setHiSpeed()`; `getHiSpeed()` reads the one in force, a replay's recorded one included. A hi-speed change glides the note scroll over 200 ms instead of making the notes stutter to their new place; the SPEED readout still updates at once and the judgement timing is unchanged.

HS-FIX fixes:

- HS-FIX `AVERAGE` (and `CONSTANT`, which falls back to it) pegs the hi-speed to the chart's main BPM, the BPM the most judged notes sit at, as beatoraja's `MAINBPM` does. The time-weighted average it used was skewed by BPM × N + STOP gimmicks, so notes could scroll 5.6 times too slow.
- Under HS-FIX the in-play HI-SPEED readouts (LR2 number 10, the HS slider and the built-in HUD) showed the scaled scroll speed (200 for a picked 3.0), and ArrowUp / ArrowDown stepped that value off the 0.1 grid (3.0 → 3.15). They now show and step the player's hi-speed; HS-FIX still scales only the scroll.
- A beatoraja play ignored HS-FIX and recorded `hsFix: 'OFF'`; it now applies the host's `hsFix` as every family does, rescaling the drawn hi-speed at the chart's MAXBPM, MINBPM or main BPM, and the play log records the mode.
