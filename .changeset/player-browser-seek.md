---
'@be-music/player-browser': minor
---

A play can seek: `PlayScene.seek(seconds)`, a `seek` play intent and `PlayFrame.seekable`. AUTO and replay playback also seek five seconds with the left and right arrow keys, and the host's `allowSeek: 'practice'` lets a manual play seek and marks its result as practice.
A seek sends the running play the engine's seek command and resolves once the play shows the second sought. The chart clock runs on from every engine frame and a paused play stays paused; the combo, max combo, graphs, timings and held long notes come from the engine's snapshot of the target, and a replay's recorded view is restored there. What the play showed of the old position (key beams, bombs, held long notes, judge plates, the POOR image, a lead-out under way) is cleared, the LR2 and beatoraja play views stop their per-judgment timers, and the Web Audio session stops the sounds playing, starts the ones still ringing partway (`triggerEventAt`), resets the dynamic volumes and moves a NONSTOP chart's fades.
The engine is prepared during loading and starts the chart at the skin's PLAY START cue, so a seek during the intro picks the starting position. Course stages and NONSTOP runs can seek too: the run stays practice for its later stages and keeps no course record, ranking or auto-saved replay after a seek.
beatoraja BGA videos stay at chart time from their cues through seeks, pauses, tempo changes and NONSTOP crossfades instead of restarting at the beginning, and BGA videos are set back in step with the chart when they drift.
