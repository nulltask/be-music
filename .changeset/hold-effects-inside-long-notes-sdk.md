---
'@be-music/player-skin-sdk': minor
---

Hold effects can stay on the held long note: `BeMusicLaneFrame.holdTop` is the held note's top this frame, `holdSparks` takes a `maxRise` that keeps sparks under it (fading over the last `HOLD_SPARK_CEILING_FADE` pixels), and `clampHoldSparkX` keeps a spark inside the lane's width.
