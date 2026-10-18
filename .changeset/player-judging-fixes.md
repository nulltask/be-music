---
'@be-music/player': patch
---

Fix judgments and results that differed between live play and play-log re-simulations:

- Under beatoraja's five-key and PMS rules the recorded max combo ran straight through an empty POOR that broke the displayed combo, while the simulator broke it.
- Scratch presses during a FREE ZONE never charged an empty POOR in live play: no reference gives FREE ZONE a judging effect (LR2 and beatoraja drop channels 17 / 27 from 7-key and 14-key charts, and IIDX never had FREE ZONE), so such a press is now judged as any other. Its keysound still plays.
- The simulator treated channels 16 / 26 as scratch in every lane mode, while in the BME-type 9 KEY layout and the 24 / 48 KEY keyboard modes they are keys: it now takes the scratch lanes from the play-mode table entry of the recorded lane mode, as the engine does.
- LR2 plays with `#EXRANK` changes chose a press's note with the widths at the note's time and judged an LN release with the widths at the tail, so a width change between them could turn a BAD into an empty POOR. Presses and releases now use the widths in force at that instant, as LR2 reads them, and the simulator reads a charge tail's late window and a mine's press leg at their own instants. Logs recorded under beatoraja or IIDX keep the chart's `#EXRANK` changes too, so re-simulating them under LR2 no longer judges with static windows.
- Play logs could record another gauge than the play ran on: the engine judged with `PlayerOptions.gauge` but the log took `recordPlaylog.gauge`. The engine now resolves one gauge, `gauge` falling back to `recordPlaylog.gauge`, and both plays and records it.
- The engine's recorded result and the simulators reported the same play differently: the native result now counts `noteCount` as the ruleset's judgments (charge notes twice) instead of note objects, always carries `djLevel`, carries `score` only under LR2's money score, and flags `gauge.failedMidPlay`; the simulators no longer round `gauge.final` to 0.01 (which could read 80 while uncleared), count a zero delta as neither FAST nor SLOW, and apply a mine's damage even when it is 0, as the engine does.
