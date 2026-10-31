---
'@be-music/player-ui': minor
---

The preview's lanes now reach down to just above the video controls without running under them: on a phone held upright they stopped well short, and on a phone held sideways (SP or DP) the judgement line sat under the seek bar. `resolvePreviewPortrait` and the new `previewJudgementInset` keep clear only the controls' height on the smallest (320 px) phone and a 16 px gap; `PREVIEW_CONTROLS_CSS_HEIGHT` is exported with it. `be-music-preview-hud` also puts the controls along the bottom of the screen rather than the stage, so a stage letterboxed into the screen keeps them off its lanes.
