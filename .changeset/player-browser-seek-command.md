---
'@be-music/player-browser': patch
---

A preview's seek no longer stops and relaunches the engine: `PlayScene.seek` sends the running play a seek command and resolves once the play shows the second sought. The chart's clock runs on from every engine frame, so a seek can no longer leave the playfield behind or ahead of the sound, and a paused play stays paused where it was sought. What the play showed of the old position (key beams, bombs, held long notes, judge plates, the POOR image, a lead-out under way) is cleared, the LR2 and beatoraja play views stop their per-judgment timers, and the BGA videos are set back in step with the chart when they drift. The web audio session stops the sounds playing at a seek, resets the dynamic volumes and moves a NONSTOP chart's fades, and a sound started partway with kept pitch now starts at the right offset.
