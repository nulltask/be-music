---
'@be-music/player-engine': minor
---

Fix a NONSTOP course of four or five BMS stages that failed to stitch (`id-space`) when its keysounds or BGA keys together went past the 3843 keys BMS output holds; a 7-key chart commonly uses 800-1,300 keysounds, so four or five of them often did. From stitching rule version 3, `stitchNonstopCourse` stitches such a course as bmson instead, as it already does for a course with CN / HCN long notes. A course that stitched before stitches as it did, and earlier rule versions still refuse it, so existing replays are unchanged.

`RandomMixConditions` now takes one `keyMode` in place of the `keyModes` set: LR2 draws a RANDOM MIX in one key mode, and a course plays in one lane layout. `normalizeRandomMixConditions` reads a stored `keyModes` set as one key mode (7 keys when the set holds them, else its lowest).
