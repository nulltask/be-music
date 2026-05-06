---
'@be-music/player-web': patch
---

`BeatorajaPlaySkinView` now treats `value[]` declarations as image-like sources during scene construction, so
destinations targeting a value id (numeric counters such as combo / score / hi-speed slots) get a sprite
painted at the right position with cell 0 of the value's number-strip texture. The `digit` / `padding` /
`align` fields are recorded on the underlying source rect but not yet wired to dynamic text — the placeholder
`'0'` cell renders until the engine integration lands. Image declarations win on id collision, matching
beatoraja's own resolver order.
