---
'@be-music/player-engine': minor
---

NONSTOP stitching rule version 4 keeps each stage's own rules, which the stitched chart lost or changed before:

- A BMS stage in a course stitched as bmson (one with a bmson stage, CN / HCN, or more than 3,843 keys) no longer plays its keysounds polyphonically or draws its layer images' black opaque.
- `#DEFEXRANK` now applies in BMS output too, the first stage's to the chart and a later stage's from its switch.
- A stage's `#EXRANKxx` changes (channel `A0`), 97 / 98 volume changes and `#SCROLL` / `#SPEED` changes are kept within its window; the rank changes come as the new `bms-exrank-change` stage-rank table, which only the `lr2` ruleset applies, and a later stage starts at full volume and a scroll of 1.
- Each stage's mines explode with its own `#WAV00` (`NonstopStitchMap.landmineSampleKeys`, passed to the new `landmineSampleKeys` player option); before, no mine sounded.
- A negative-BPM reversal inside its stage's window now freezes the rest of the play as LR2 does, instead of the notes, BGM and STOPs past it being played and judged as ordinary ones.

Replays keep their recorded rule version, so earlier runs stitch as they did.
