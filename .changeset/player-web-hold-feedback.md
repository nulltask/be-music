---
'@be-music/player-web': minor
---

Held long notes now show it: in Synesthesia the lane's stretch of the judgement line glows in the lane's colour and embers keep rising from it (thinned with reduced effects, glow only with effects off); in Plain the line glows and white sparks rise. Pixi skins get the lanes in `PixiBombsContext.lanes`, so hit-effect layers can draw lane effects such as `holding`.

A long note's tail now shows whether it is judged: under LR2 (LN, tail not judged) it is drawn translucent, where to let go; under beatoraja / IIDX CN and HCN (judged on release) it keeps the solid cap. Pixi skins get the mode in `PixiLongNoteContext.mode`. Long-note bodies lose the white line down their middle.
