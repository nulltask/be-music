---
'@be-music/player-web': patch
---

On a beatoraja theme, a NONSTOP run switched the BGA at a stage seam at once to the stitched chart's latest cue. The beatoraja play scene now cross-fades the BGA over 3 s around each seam as LR2 does, drawing each stage's own cues from the same per-stage stacks (`resolveBGAStacks`) the built-in and LR2 scenes draw.
