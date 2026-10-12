---
'@be-music/player-web': patch
---

Fix the beatoraja gameplay scene rolling `#RANDOM` / `#SWITCH` a second time: it handed the engine the chart the decide screen had already resolved, whose control flow is still attached, so the engine added a freshly rolled branch on top. A chart could play (and score, and record in the play log) both branches' notes and keysounds, or the same branch twice, while the skin graphs, markers and BGA showed only the first roll. The scene now hands the engine the resolved chart without its control flow, as the core gameplay scene already did, so every play uses the one resolution.
