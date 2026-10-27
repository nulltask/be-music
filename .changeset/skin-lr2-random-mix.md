---
'@be-music/skin-lr2': minor
---

Support LR2's RANDOM MIX select buttons 260-266 and texts 190-196: `resolveLR2CourseMakerAction` maps the buttons to a `random-mix` action, `resolveLR2RandomMixButtonState` draws them at the value they edit, and `resolveLR2RandomMixText` / `formatLR2RandomMixSetting` write the settings as LR2 does (`OFF`, `NO LIMIT`, `LEVEL n`, `+- nBPM`, `n BPM`, `RANDOM`, `n STAGE`). A RANDOM MIX bar draws bar body 9, falling back to the course body.
